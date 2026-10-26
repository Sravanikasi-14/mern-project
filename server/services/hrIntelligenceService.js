import { getGeminiClient, DEFAULT_GEMINI_MODEL } from "../config/gemini.js";
import { getActiveCompanyHrPolicy } from "../models/CompanyHrPolicy.js";
import { getCompanyBusinessDate } from "./attendanceService.js";

/**
 * Tenant-scoped in-memory cache for AI explanations.
 * Never stores personal employee data.
 * Key: companyKey (companyId or slug)
 * Value: Map<category, { count, summary, severity, explanation, action, timestamp }>
 */
const companyExplanationCache = new Map();

/**
 * Resets the in-memory explanation cache for testing or tenant reset.
 */
export function clearCompanyExplanationCache(companyKey) {
  if (companyKey) {
    companyExplanationCache.delete(String(companyKey));
  } else {
    companyExplanationCache.clear();
  }
}

/**
 * Manually populates an explanation into the in-memory cache (for testing or seeding).
 */
export function setCachedCompanyExplanation(companyKey, category, data) {
  const compIdStr = String(companyKey);
  let map = companyExplanationCache.get(compIdStr);
  if (!map) {
    map = new Map();
    companyExplanationCache.set(compIdStr, map);
  }
  map.set(category, data);
}

/**
 * Calculates deterministic HR actionable findings from tenant-scoped data.
 * Adheres strictly to tenant isolation through models.
 * Zero PII or private financial numbers are shared with external services.
 */
export async function calculateDeterministicFindings({ models, company }) {
  const {
    Employee,
    Task,
    Attendance,
    CompanyHrPolicy,
    LeaveRequest,
    PayrollCycle,
    EmployeeCompensation,
  } = models;

  const findings = [];
  const now = new Date();
  const companyTimezone = company?.config?.timezone || "Asia/Kolkata";
  const todayStr = getCompanyBusinessDate(now, companyTimezone);

  // --------------------------------------------------------------------------
  // 1. Missing Employee Information & Onboarding Completeness
  // --------------------------------------------------------------------------
  if (Employee) {
    try {
      const activeEmployees = await Employee.find({ status: "ACTIVE" })
        .select("employeeCode invitation bankDetails emergencyContact taxDetails")
        .lean();

      let pendingInvitations = 0;
      let missingBankDetails = 0;
      let missingEmergencyContacts = 0;
      let missingTaxDetails = 0;
      let incompleteEmployeesCount = 0;

      for (const emp of activeEmployees) {
        const hasPendingInv = emp.invitation?.status === "PENDING" || emp.invitation?.status === "EXPIRED";
        const hasMissingBank = !emp.bankDetails?.accountNumber || !emp.bankDetails?.ifscCode;
        const hasMissingEmergency = !emp.emergencyContact?.phone || !emp.emergencyContact?.name;
        const hasMissingTax = !emp.taxDetails?.panNumber;

        if (hasPendingInv) pendingInvitations++;
        if (hasMissingBank) missingBankDetails++;
        if (hasMissingEmergency) missingEmergencyContacts++;
        if (hasMissingTax) missingTaxDetails++;

        if (hasPendingInv || hasMissingBank || hasMissingEmergency || hasMissingTax) {
          incompleteEmployeesCount++;
        }
      }

      if (incompleteEmployeesCount > 0) {
        // Condition: Do not automatically treat missing bank or PAN details as high-severity
        const severity = pendingInvitations > 0 ? "HIGH" : missingBankDetails > 0 ? "MEDIUM" : "LOW";
        const breakdown = [];
        if (pendingInvitations > 0) breakdown.push(`${pendingInvitations} pending onboarding invitation(s)`);
        if (missingBankDetails > 0) breakdown.push(`${missingBankDetails} missing direct deposit bank detail(s)`);
        if (missingEmergencyContacts > 0) breakdown.push(`${missingEmergencyContacts} missing emergency contact(s)`);
        if (missingTaxDetails > 0) breakdown.push(`${missingTaxDetails} missing PAN tax record(s)`);

        findings.push({
          id: "insight-onboarding-profile",
          category: "ONBOARDING_PROFILE",
          title: "Incomplete Employee Profile & Onboarding Data",
          severity,
          count: incompleteEmployeesCount,
          summary: breakdown.join(", "),
          explanation: `${incompleteEmployeesCount} employee profile or onboarding record(s) require attention (${breakdown.slice(0, 2).join(", ")}).`,
          action: "Review employee records in the directory and request missing onboarding details for statutory and payroll readiness.",
          link: "/admin",
          linkText: "Review Employees",
        });
      }
    } catch {
      // Non-blocking
    }
  }

  // --------------------------------------------------------------------------
  // 2. Overdue Tasks and Submitted Tasks Awaiting HR/Manager Review
  // --------------------------------------------------------------------------
  if (Task) {
    try {
      const [overdueCount, pendingReviewCount] = await Promise.all([
        Task.countDocuments({
          status: { $in: ["ASSIGNED", "IN_PROGRESS", "CHANGES_REQUESTED"] },
          deadline: { $lt: now },
        }),
        Task.countDocuments({
          status: "SUBMITTED",
        }),
      ]);

      const totalTaskIssues = overdueCount + pendingReviewCount;
      if (totalTaskIssues > 0) {
        const severity = overdueCount > 0 ? "HIGH" : "MEDIUM";
        const parts = [];
        if (overdueCount > 0) parts.push(`${overdueCount} task(s) past deadline`);
        if (pendingReviewCount > 0) parts.push(`${pendingReviewCount} submitted task(s) awaiting review`);

        findings.push({
          id: "insight-tasks-action",
          category: "WORK_MANAGEMENT",
          title: "Overdue Deliverables & Pending Task Reviews",
          severity,
          count: totalTaskIssues,
          summary: parts.join(", "),
          explanation: `${parts.join(" and ")}. Awaiting review delays Impact Point allocations and progress tracking.`,
          action: "Open Work Management to evaluate submitted evidence, approve deliverables, and unblock overdue assignments.",
          link: "/admin/work-management",
          linkText: "Open Work Management",
        });
      }
    } catch {
      // Non-blocking
    }
  }

  // --------------------------------------------------------------------------
  // 3. Attendance Exceptions (Verified against policy, shifts & leaves)
  // --------------------------------------------------------------------------
  if (Attendance && CompanyHrPolicy && Employee) {
    try {
      const policy = await getActiveCompanyHrPolicy(CompanyHrPolicy);
      const weekendRules = policy?.weekendRules || { saturdayOff: true, sundayOff: true };
      const holidays = policy?.holidays || [];

      const currentDayOfWeek = now.getDay();
      const isWeekend =
        (currentDayOfWeek === 0 && weekendRules.sundayOff) ||
        (currentDayOfWeek === 6 && weekendRules.saturdayOff);

      const isHoliday = holidays.some((h) => {
        if (!h.date) return false;
        const d = new Date(h.date).toISOString().slice(0, 10);
        return d === todayStr;
      });

      // Only check attendance exceptions on regular working days
      if (!isWeekend && !isHoliday) {
        const officeStartTime = policy?.attendanceRules?.officeStartTime || "09:30";
        const gracePeriodMinutes = policy?.attendanceRules?.gracePeriodMinutes ?? 15;
        const [h, m] = officeStartTime.split(":").map(Number);
        const lateThresholdMinutes = (h || 9) * 60 + (m || 30) + gracePeriodMinutes;

        const todayRecords = await Attendance.find({ date: todayStr }).lean();
        let lateArrivalsCount = 0;

        for (const att of todayRecords) {
          if (att.checkIn) {
            const checkInDate = new Date(att.checkIn);
            const checkInMins = checkInDate.getHours() * 60 + checkInDate.getMinutes();
            if (checkInMins > lateThresholdMinutes) {
              lateArrivalsCount++;
            }
          }
        }

        if (lateArrivalsCount > 0) {
          findings.push({
            id: "insight-attendance-exceptions",
            category: "ATTENDANCE",
            title: "Shift Attendance Exceptions Logged Today",
            severity: lateArrivalsCount >= 5 ? "HIGH" : "MEDIUM",
            count: lateArrivalsCount,
            summary: `${lateArrivalsCount} employee(s) arrived past the ${gracePeriodMinutes}-minute grace window`,
            explanation: `${lateArrivalsCount} employee(s) checked in after the official start cutoff (${officeStartTime} + ${gracePeriodMinutes}m grace).`,
            action: "Inspect today's attendance log in Attendance Overview to regularize timestamps or communicate shift expectations.",
            link: "/admin/attendance",
            linkText: "View Attendance",
          });
        }
      }
    } catch {
      // Non-blocking
    }
  }

  // --------------------------------------------------------------------------
  // 4. Pending Leave Requests Needing Action
  // --------------------------------------------------------------------------
  if (LeaveRequest) {
    try {
      const inThreeDays = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
      const [pendingCount, urgentCount] = await Promise.all([
        LeaveRequest.countDocuments({ status: "PENDING" }),
        LeaveRequest.countDocuments({
          status: "PENDING",
          fromDate: { $lte: inThreeDays },
        }),
      ]);

      if (pendingCount > 0) {
        const severity = urgentCount > 0 ? "HIGH" : "MEDIUM";
        findings.push({
          id: "insight-pending-leaves",
          category: "LEAVES",
          title: "Pending Employee Leave Applications",
          severity,
          count: pendingCount,
          summary: `${pendingCount} leave request(s) awaiting approval${urgentCount > 0 ? ` (${urgentCount} within 3 days)` : ""}`,
          explanation: `${pendingCount} leave request(s) require HR or manager authorization.${urgentCount > 0 ? ` Note: ${urgentCount} are scheduled within the next 72 hours.` : ""}`,
          action: "Review pending applications in Leave Management to approve or decline so project schedules remain accurate.",
          link: "/admin/leave?status=PENDING",
          linkText: "Review Leaves",
        });
      }
    } catch {
      // Non-blocking
    }
  }

  // --------------------------------------------------------------------------
  // 5. Payroll Validation Issues & Readiness
  // --------------------------------------------------------------------------
  if (PayrollCycle && EmployeeCompensation && Employee) {
    try {
      const [activeEmployeesCount, unconfiguredCompCount] = await Promise.all([
        Employee.countDocuments({ status: "ACTIVE" }),
        (async () => {
          const compEmployees = await EmployeeCompensation.distinct("employeeId");
          const activeWithoutComp = await Employee.countDocuments({
            status: "ACTIVE",
            _id: { $nin: compEmployees },
          });
          return activeWithoutComp;
        })(),
      ]);

      const latestCycle = await PayrollCycle.findOne({})
        .sort({ periodYear: -1, periodMonth: -1 })
        .lean();

      const validationIssuesCount = latestCycle?.validationIssues?.length || 0;
      const totalPayrollIssues = validationIssuesCount + (unconfiguredCompCount > 0 ? unconfiguredCompCount : 0);

      if (totalPayrollIssues > 0 || (latestCycle && latestCycle.status === "FINALIZED" && latestCycle.paymentStatus !== "PAID")) {
        const isDisbursementPending = latestCycle?.status === "FINALIZED" && latestCycle?.paymentStatus !== "PAID";
        const severity = validationIssuesCount > 0 || isDisbursementPending ? "HIGH" : "MEDIUM";

        const issueParts = [];
        if (validationIssuesCount > 0) issueParts.push(`${validationIssuesCount} register calculation issue(s)`);
        if (unconfiguredCompCount > 0) issueParts.push(`${unconfiguredCompCount} active staff without salary structure`);
        if (isDisbursementPending) issueParts.push("Finalized cycle awaiting disbursement recording");

        findings.push({
          id: "insight-payroll-readiness",
          category: "PAYROLL",
          title: "Payroll Validation & Disbursement Readiness",
          severity,
          count: totalPayrollIssues || 1,
          summary: issueParts.join(", "),
          explanation: `${issueParts.join("; ")}. Ensuring compensation and register data is verified avoids payout discrepancies.`,
          action: "Open the Payroll Action Centre to resolve register issues and manage monthly salary disbursements.",
          link: "/admin/payroll?tab=payroll_registers",
          linkText: "Open Payroll",
        });
      }
    } catch {
      // Non-blocking
    }
  }

  return findings;
}

/**
 * Enriches deterministic findings with concise executive summaries from Gemini Flash.
 * Strictly sends only aggregated counts, categories, and titles. Zero PII is sent.
 *
 * Optimization & Correctness:
 * Reuses existing valid explanations for unchanged findings to prevent unnecessary
 * Gemini API calls during manual refreshes, but NEVER shows an outdated explanation
 * if the underlying counts or conditions have changed.
 */
export async function enrichFindingsWithGemini(findings, { companyKey, forceRefresh = false } = {}) {
  if (!findings || findings.length === 0) {
    if (companyKey) {
      companyExplanationCache.delete(String(companyKey));
    }
    return { findings: [], aiEnriched: false };
  }

  const compIdStr = companyKey ? String(companyKey) : "default";
  let explanationMap = companyExplanationCache.get(compIdStr);
  if (!explanationMap) {
    explanationMap = new Map();
    companyExplanationCache.set(compIdStr, explanationMap);
  }

  // 1. Separate findings into those that can reuse valid existing explanations
  //    vs those that have changed/are new and need fresh enrichment.
  const enrichedList = [];
  const needsEnrichment = [];

  for (const finding of findings) {
    const cached = explanationMap.get(finding.category);

    const isIdentical =
      cached &&
      cached.count === finding.count &&
      cached.summary === finding.summary &&
      cached.severity === finding.severity &&
      typeof cached.explanation === "string" &&
      typeof cached.action === "string";

    if (isIdentical) {
      // Reuse verified explanation without re-calling Gemini
      enrichedList.push({
        ...finding,
        explanation: cached.explanation,
        action: cached.action,
      });
    } else {
      // Finding is new or its counts/summary have changed: must NOT show stale explanation
      needsEnrichment.push(finding);
      enrichedList.push({ ...finding });
    }
  }

  // Prune any resolved categories from the company's explanation cache
  const activeCategories = new Set(findings.map((f) => f.category));
  for (const cat of explanationMap.keys()) {
    if (!activeCategories.has(cat)) {
      explanationMap.delete(cat);
    }
  }

  // If all findings already have valid, matching explanations, return immediately!
  if (needsEnrichment.length === 0) {
    return { findings: enrichedList, aiEnriched: true };
  }

  // Check if Gemini API key is configured
  if (!process.env.GEMINI_API_KEY?.trim()) {
    return { findings: enrichedList, aiEnriched: false };
  }

  try {
    const ai = getGeminiClient();
    const model = DEFAULT_GEMINI_MODEL;

    // Build sanitized prompt for ONLY the findings needing enrichment
    const sanitizedSummaries = needsEnrichment.map((f, idx) => ({
      index: idx,
      category: f.category,
      title: f.title,
      count: f.count,
      severity: f.severity,
      summary: f.summary,
    }));

    const prompt = `You are an HRMS intelligence engine for enterprise HR leaders.
Analyze these ${sanitizedSummaries.length} verified HR operational findings:
${JSON.stringify(sanitizedSummaries, null, 2)}

For each finding, provide:
1. "explanation": A concise 1-2 sentence executive explanation of the operational impact.
2. "action": Exactly 1 practical recommended next action for the HR administrator.

Return your response strictly as a JSON array of objects with fields:
[
  { "index": 0, "explanation": "...", "action": "..." }
]
Do not output markdown code blocks or extra text. Output only valid JSON.`;

    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), 12000);

    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        temperature: 0.2,
        maxOutputTokens: 1024,
        abortSignal: abortController.signal,
      },
    });

    clearTimeout(timeout);

    const rawText = response.text?.trim() || "";
    const cleanJson = rawText
      .replace(/^```json/i, "")
      .replace(/^```/i, "")
      .replace(/```$/, "")
      .trim();

    const parsedArray = JSON.parse(cleanJson);
    if (!Array.isArray(parsedArray)) {
      return { findings: enrichedList, aiEnriched: false };
    }

    // Apply Gemini explanations to the findings needing enrichment and update cache
    needsEnrichment.forEach((finding, idx) => {
      const match = parsedArray.find((item) => item.index === idx);
      if (match && typeof match.explanation === "string" && typeof match.action === "string") {
        const finalExpl = match.explanation.trim();
        const finalAct = match.action.trim();

        // Update in enrichedList
        const target = enrichedList.find((f) => f.id === finding.id);
        if (target) {
          target.explanation = finalExpl;
          target.action = finalAct;
        }

        // Cache the successful explanation
        explanationMap.set(finding.category, {
          count: finding.count,
          summary: finding.summary,
          severity: finding.severity,
          explanation: finalExpl,
          action: finalAct,
          timestamp: Date.now(),
        });
      }
    });

    return { findings: enrichedList, aiEnriched: true };
  } catch {
    // Graceful fallback to deterministic findings on any AI error/timeout
    // Note: Never cache Gemini errors as successful results!
    return { findings: enrichedList, aiEnriched: false };
  }
}

/**
 * Main service entrypoint for gathering HR Intelligence.
 */
export async function getHrIntelligenceReport({ models, company, forceRefresh = false }) {
  const companyKey = company?._id || company?.slug || "default";

  // Authoritative calculations are always executed directly against the tenant database
  const deterministicFindings = await calculateDeterministicFindings({ models, company });

  // Enrich with Gemini explanations (reusing valid explanations when findings haven't changed)
  const { findings, aiEnriched } = await enrichFindingsWithGemini(deterministicFindings, {
    companyKey,
    forceRefresh,
  });

  return {
    success: true,
    generatedAt: new Date().toISOString(),
    aiEnriched,
    model: aiEnriched ? DEFAULT_GEMINI_MODEL : null,
    totalInsightsCount: findings.length,
    highPriorityCount: findings.filter((f) => f.severity === "HIGH").length,
    insights: findings,
  };
}
