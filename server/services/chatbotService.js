import mongoose from "mongoose";
import { getGeminiClient, DEFAULT_GEMINI_MODEL } from "../config/gemini.js";
import { getActiveCompanyHrPolicy } from "../models/CompanyHrPolicy.js";
import { getEmployeePointsSummaryService } from "./workManagementService.js";
import {
  HR_ANALYST_FUNCTION_DECLARATIONS,
  executeHrAnalystTool,
  formatDeterministicAnalysis,
} from "./hrAnalystTools.js";
import { HttpError } from "../utils/httpError.js";

/**
 * Gathers authorized HRMS factual context for the authenticated user and tenant.
 * Strictly adheres to tenant isolation using req.auth.models.
 * Never accesses passwords, hashes, bank details, or private identity documents.
 */
export async function getAuthorizedContext({ models, user, company }) {
  const { Employee, CompanyHrPolicy, Task, ImpactPointTransaction } = models;

  const isHrAdmin = user?.role === "HR_ADMIN";
  const contextData = {
    companyName: company?.companyName || "HRMS",
    userRole: user?.role || "EMPLOYEE",
    userEmail: user?.email || "",
    isHrAdmin,
  };

  try {
    // 1. Employee Profile (sanitized basic attributes only)
    if (Employee) {
      const employee = await Employee.findOne({
        $or: [{ userId: user._id }, { email: user.email.toLowerCase() }],
      }).lean();

      if (employee) {
        contextData.employee = {
          _id: employee._id,
          fullName: employee.fullName,
          employeeCode: employee.employeeCode,
          department: employee.job?.department || "Unassigned",
          designation: employee.job?.jobTitle || "Team Member",
          workLocation: employee.job?.workLocation || "Office",
          employmentType: employee.job?.employmentType || "Full-time",
        };

        // 2. Active tasks count
        if (Task) {
          try {
            const activeTasksCount = await Task.countDocuments({
              assigneeId: employee._id,
              status: { $in: ["ASSIGNED", "IN_PROGRESS", "CHANGES_REQUESTED"] },
            });
            contextData.activeTasksCount = activeTasksCount;
          } catch {
            // Non-blocking
          }
        }

        // 3. Impact points balance and summary from canonical service
        if (ImpactPointTransaction) {
          try {
            const summary = await getEmployeePointsSummaryService({
              models,
              employeeId: employee._id,
            });
            contextData.impactPoints = summary;
            contextData.impactPointsBalance = summary.balance;
          } catch {
            try {
              const balanceAgg = await ImpactPointTransaction.aggregate([
                { $match: { employeeId: new mongoose.Types.ObjectId(employee._id), isReversed: false } },
                { $group: { _id: null, balance: { $sum: "$points" } } },
              ]);
              contextData.impactPointsBalance = balanceAgg[0]?.balance || 0;
            } catch {
              contextData.impactPointsBalance = 0;
            }
          }
        }
      }
    }

    // 4. Company HR Policy (standard organizational guidelines)
    if (CompanyHrPolicy) {
      try {
        const policy = await getActiveCompanyHrPolicy(CompanyHrPolicy);
        if (policy) {
          contextData.hrPolicy = {
            officeStartTime: policy.attendanceRules?.officeStartTime || "09:30",
            officeEndTime: policy.attendanceRules?.officeEndTime || "18:30",
            gracePeriodMinutes: policy.attendanceRules?.gracePeriodMinutes ?? 15,
            standardDailyHours: policy.workHoursRules?.standardDailyHours || 8,
            weekendOff:
              policy.weekendRules?.saturdayOff && policy.weekendRules?.sundayOff
                ? "Saturday & Sunday"
                : "Sunday",
            leaveTypes: (policy.leaveTypes || [])
              .filter((l) => l.isActive)
              .map((l) => `${l.name} (${l.yearlyDays} days/yr)`),
            holidays: (policy.holidays || [])
              .slice(0, 10)
              .map((h) => `${h.name} (${new Date(h.date).toLocaleDateString()})`),
            impactPointsEnabled: Boolean(policy.impactPointRules?.enabled),
          };
        }
      } catch {
        // Non-blocking
      }
    }
  } catch {
    // Non-blocking fallback
  }

  return contextData;
}

/**
 * Builds system instruction prompt with authorized context.
 * Adjusts persona based on user role:
 * - HR_ADMIN: Proactive AI HR Analyst with real-time tool calling access
 * - EMPLOYEE: Standard helpful employee portal assistant
 */
export function buildSystemInstruction(context) {
  const emp = context.employee;
  const policy = context.hrPolicy;
  const points = context.impactPoints;

  const pointsSection = emp
    ? points
      ? `- Verified Impact Points Balance: ${points.balance} pts
- Total Points Earned: ${points.totalEarned} pts
- Deductions: ${points.totalDeducted} pts
- Points Earned This Month: ${points.pointsThisMonth} pts
- Company Leaderboard Rank: #${points.rankInCompany || "1"}${
          points.rankInDepartment && points.rankInDepartment !== "-"
            ? ` (${points.rankInDepartment} in ${emp.department})`
            : ""
        }${
          points.recentTransactions?.length
            ? `\n- Recent Activity: ${points.recentTransactions
                .slice(0, 3)
                .map((t) => `${t.type === "EARNED" ? "+" : "-"}${t.points} pts (${t.source || "Task Completion"})`)
                .join(", ")}`
            : ""
        }`
      : `- Verified Impact Points Balance: ${context.impactPointsBalance ?? 0} pts`
    : "";

  // HR Administrator System Prompt
  if (context.isHrAdmin || context.userRole === "HR_ADMIN") {
    return `You are "HRMS Assistant", an advanced, proactive AI HR Analyst and Strategic Operational Advisor for ${context.companyName}.
You are speaking directly with an authorized HR Administrator (${context.userEmail}).

### Your Role as Real-Time AI HR Analyst:
1. You have SECURE, REAL-TIME access to live database analytical tools:
   - analyzeAttendance: Today's live check-ins, late arrivals (past official office start + grace period), absences, employees on approved leave, department-level absence rates, recurring irregularities (multi-day patterns), and previous week comparisons.
   - analyzeEmployeesAndOnboarding: Incomplete employee profiles (missing bank details, emergency contacts, PAN tax details), active headcount by department, and candidate onboarding submissions awaiting review.
   - analyzeLeaves: Pending leave applications, urgent requests (next 72 hours), department-level overlapping leave date conflicts (understaffing risks), and leave trends.
   - analyzePayrollReadiness: Payroll cycle status, register calculation issues, active employees lacking salary compensation setup, payment disbursement readiness, and historical pay changes.
   - analyzeRecruitmentAndOffers: Recruitment pipeline funnel, offer letter acceptance rates, and candidate onboarding bottlenecks.
   - getCrossModuleOverview: Unified operational health check across attendance, leaves, payroll, candidate onboarding, and work management.

2. MANDATORY TOOL CALLING INSTRUCTIONS:
   - When asked ANY business question about attendance (e.g. "Who is late today?", "How many employees are present?", "Attendance breakdown"), employees, leaves, payroll readiness, or hiring, you MUST INVOKE the appropriate live analytical tool.
   - NEVER say "I do not have access to real-time attendance data" or "I cannot access live company records". You have real-time backend analytical tools explicitly designed for this.
   - If a request cannot be fulfilled by available data, explain the specific limitation based on recorded evidence. Never fabricate numbers.

3. STRUCTURE OF YOUR ANALYSIS:
   Provide concise, structured, and actionable intelligence for the HR Admin:
   - **Key Findings**: Clear summary supported by exact figures and percentages.
   - **Supporting Numbers & Patterns**: Break down affected departments or specific employees (e.g. late arrivals with minutes late, conflicting leave dates).
   - **Operational Implications / Risks**: Explain WHY this matters (e.g. "team understaffing risk", "statutory payroll delay due to missing PAN/bank data").
   - **Recommended Next Steps**: Practical, prioritized HR actions including markdown links to the relevant HRMS sections:
     - [Attendance Overview](/admin/attendance)
     - [Leave Management](/admin/leave)
     - [Payroll Action Centre](/admin/payroll)
     - [Candidate Onboarding Review](/admin/onboarding)
     - [Offer Letters Management](/admin/offers)
     - [Employee Directory](/admin)
     - [Work Management](/admin/work-management)

4. Prohibited Autonomous Actions:
   - You CANNOT directly execute destructive database mutations or approvals (e.g. you cannot mark attendance, disburse money, or approve leaves yourself). You analyze records and direct the HR Admin to the corresponding section with markdown links.

${policy ? `### Company HR Policy:\n- Office Timings: ${policy.officeStartTime} to ${policy.officeEndTime} (Grace period: ${policy.gracePeriodMinutes} mins)\n- Standard Work Hours: ${policy.standardDailyHours} hours/day\n- Weekend Policy: ${policy.weekendOff} off` : ""}`;
  }

  // Employee System Prompt
  return `You are "HRMS Assistant", a helpful, professional AI chatbot built into the HRMS portal for ${context.companyName}.

### Authenticated User Context:
- User Role: ${context.userRole}
- User Email: ${context.userEmail}
${
  emp
    ? `- Employee Name: ${emp.fullName}
- Employee Code: ${emp.employeeCode}
- Department: ${emp.department}
- Designation: ${emp.designation}
- Work Location: ${emp.workLocation}
- Active Tasks Assigned: ${context.activeTasksCount ?? 0}
${pointsSection}`
    : "- Note: No linked employee profile found."
}

${
  policy
    ? `### Organization Guidelines & Policies:
- Office Timings: ${policy.officeStartTime} to ${policy.officeEndTime} (Grace period: ${policy.gracePeriodMinutes} mins)
- Standard Work Hours: ${policy.standardDailyHours} hours/day
- Weekend Policy: ${policy.weekendOff} off
- Leave Types: ${policy.leaveTypes?.join(", ") || "Casual, Sick, Earned"}
- Upcoming Holidays: ${policy.holidays?.join("; ") || "None listed"}
- Impact Points Program: ${policy.impactPointsEnabled ? "Enabled" : "Disabled"}`
    : ""
}

### Guidelines:
1. Base factual answers ONLY on the authenticated user context and organization guidelines provided above.
2. If asked about details not present in the context (such as compensation amounts, other colleagues' personal records, or confidential data), politely state that you do not have access to that information.
3. NEVER fabricate or guess numbers, records, leaves, or policy rules.
4. Autonomous Actions Prohibition: You CANNOT perform database updates or approval actions (e.g. you cannot approve leave requests, change salaries, award points, or mark attendance). Always guide the user to the proper section in the portal instead (e.g. "To request leave, go to Leave Management in the navigation menu").
5. Provide concise, friendly, and structured responses using GitHub markdown (bullet points, bold text).`;
}

/**
 * Validates chat history and message inputs.
 */
export function validateChatInput(message, history = []) {
  if (!message || typeof message !== "string" || !message.trim()) {
    throw new HttpError(400, "Message text is required and cannot be empty.");
  }

  if (message.length > 2000) {
    throw new HttpError(400, "Message length exceeds 2000 characters limit.");
  }

  if (!Array.isArray(history)) {
    throw new HttpError(400, "History must be an array of messages.");
  }

  if (history.length > 20) {
    throw new HttpError(400, "Chat history exceeds the maximum allowed turns (20).");
  }

  const sanitizedHistory = history
    .filter((h) => h && typeof h === "object" && typeof h.text === "string" && h.text.trim())
    .slice(-10) // Keep last 10 turns for context efficiency
    .map((h) => ({
      role: h.role === "model" || h.role === "assistant" ? "model" : "user",
      parts: [{ text: String(h.text).trim().slice(0, 2000) }],
    }));

  return {
    userMessage: message.trim(),
    sanitizedHistory,
  };
}

/**
 * Detects user intent for HR analysis questions to enable graceful fallback
 * when Gemini API quota is temporarily exhausted or unavailable.
 */
export function detectHrQueryIntent(message = "") {
  const text = String(message || "").toLowerCase();

  // 1. Cross-module Health Check & Risk Overview (evaluate broad queries first)
  if (
    text.includes("health check") ||
    text.includes("cross module") ||
    text.includes("operational risk") ||
    text.includes("risk overview") ||
    text.includes("company status") ||
    text.includes("overall status") ||
    (text.includes("overview") && text.includes("risk"))
  ) {
    return {
      name: "getCrossModuleOverview",
      args: {},
    };
  }

  // 2. Attendance queries
  if (
    text.includes("attend") ||
    text.includes("present") ||
    text.includes("absent") ||
    text.includes("late") ||
    text.includes("checked in") ||
    text.includes("check in") ||
    text.includes("clock in") ||
    text.includes("who is working") ||
    text.includes("irregular") ||
    text.includes("previous week")
  ) {
    return {
      name: "analyzeAttendance",
      args: {
        comparePreviousWeek:
          text.includes("previous week") ||
          text.includes("last week") ||
          text.includes("compare"),
        checkIrregularities:
          text.includes("irregular") ||
          text.includes("recurring") ||
          text.includes("pattern") ||
          text.includes("repeat"),
      },
    };
  }

  // 3. Leave queries
  if (
    text.includes("leave") ||
    text.includes("vacation") ||
    text.includes("time off") ||
    text.includes("holiday request") ||
    text.includes("overlap")
  ) {
    return {
      name: "analyzeLeaves",
      args: {
        includeOverlaps:
          text.includes("overlap") ||
          text.includes("conflict") ||
          text.includes("same team") ||
          text.includes("same time"),
        urgentOnly:
          text.includes("urgent") ||
          text.includes("soon") ||
          text.includes("immediate"),
      },
    };
  }

  // 4. Payroll queries
  if (
    text.includes("payroll") ||
    text.includes("salary") ||
    text.includes("disbursement") ||
    text.includes("wage") ||
    text.includes("compensation") ||
    text.includes("ready to process")
  ) {
    return {
      name: "analyzePayrollReadiness",
      args: {
        compareHistoricalCycles:
          text.includes("history") ||
          text.includes("trend") ||
          text.includes("over time") ||
          text.includes("past month"),
      },
    };
  }

  // 5. Recruitment and Offer queries
  if (
    text.includes("offer") ||
    text.includes("recruitment") ||
    text.includes("funnel") ||
    text.includes("hiring") ||
    text.includes("candidate") ||
    text.includes("stuck") ||
    text.includes("bottleneck")
  ) {
    return {
      name: "analyzeRecruitmentAndOffers",
      args: {
        checkBottlenecks:
          text.includes("stuck") ||
          text.includes("bottleneck") ||
          text.includes("delay") ||
          text.includes("waiting"),
      },
    };
  }

  // 6. Employee Directory & Onboarding Completeness
  if (
    text.includes("onboard") ||
    text.includes("profile") ||
    text.includes("incomplete") ||
    text.includes("missing") ||
    /\bpan\b/i.test(text) ||
    /\bbank\b/i.test(text) ||
    text.includes("emergency contact") ||
    text.includes("headcount")
  ) {
    return {
      name: "analyzeEmployeesAndOnboarding",
      args: {
        focusArea: text.includes("onboard")
          ? "ONBOARDING"
          : text.includes("headcount")
          ? "HEADCOUNT"
          : "PROFILES",
      },
    };
  }

  return null;
}

/**
 * Executes a Gemini API call with bounded retries for transient 503/high-demand spikes.
 * Strictly avoids retrying if the abortSignal has already been triggered.
 */
async function executeWithRetry(apiCall, { maxRetries = 2, delayMs = 1200, abortSignal } = {}) {
  let attempt = 0;
  while (true) {
    if (abortSignal?.aborted) {
      throw new HttpError(504, "AI assistant request timed out or was cancelled.");
    }

    try {
      return await apiCall();
    } catch (error) {
      attempt++;
      const errorMsg = String(error?.message || "").toLowerCase();
      const isTransient =
        errorMsg.includes("503") ||
        errorMsg.includes("unavailable") ||
        errorMsg.includes("high demand") ||
        errorMsg.includes("spikes in demand");

      if (attempt <= maxRetries && isTransient && !abortSignal?.aborted) {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, delayMs * attempt);
          if (abortSignal) {
            abortSignal.addEventListener(
              "abort",
              () => {
                clearTimeout(timer);
                reject(new HttpError(504, "AI assistant request cancelled."));
              },
              { once: true }
            );
          }
        });
        continue;
      }
      throw error;
    }
  }
}

/**
 * Executes a Gemini chat interaction using the official @google/genai SDK.
 * Supports tool calling for HR Administrators with fallback on quota exhaustion.
 */
export async function sendChatMessage({
  models,
  user,
  company,
  message,
  history = [],
  abortSignal,
}) {
  const { userMessage, sanitizedHistory } = validateChatInput(message, history);

  const context = await getAuthorizedContext({ models, user, company });
  const systemInstruction = buildSystemInstruction(context);
  const isHrAdmin = context.isHrAdmin;

  let ai;
  try {
    ai = getGeminiClient();
  } catch (err) {
    // In test environments or when GEMINI_API_KEY is not configured:
    // If user is HR Admin asking an analytical question, execute live database tool deterministically
    if (isHrAdmin) {
      const intentTool = detectHrQueryIntent(userMessage);
      if (intentTool) {
        const toolResult = await executeHrAnalystTool(intentTool.name, intentTool.args, {
          models,
          company,
          user,
        });
        return {
          reply: formatDeterministicAnalysis(intentTool.name, toolResult, userMessage),
          model: "deterministic-live-analyst",
        };
      }
    }
    throw err;
  }

  const model = DEFAULT_GEMINI_MODEL;
  const tools = isHrAdmin ? [{ functionDeclarations: HR_ANALYST_FUNCTION_DECLARATIONS }] : undefined;

  const contents = [
    ...sanitizedHistory,
    {
      role: "user",
      parts: [{ text: userMessage }],
    },
  ];

  try {
    const initialResponse = await executeWithRetry(
      () =>
        ai.models.generateContent({
          model,
          contents,
          config: {
            systemInstruction,
            tools,
            temperature: 0.2,
            maxOutputTokens: 1024,
            abortSignal,
          },
        }),
      { abortSignal }
    );

    // If Gemini requested function calls to retrieve live database records
    if (initialResponse.functionCalls && initialResponse.functionCalls.length > 0) {
      const functionResponseParts = [];
      let lastToolName = "";
      let lastToolResult = null;

      for (const call of initialResponse.functionCalls) {
        lastToolName = call.name;
        const result = await executeHrAnalystTool(call.name, call.args || {}, {
          models,
          company,
          user,
        });
        lastToolResult = result;
        functionResponseParts.push({
          functionResponse: {
            name: call.name,
            id: call.id,
            response: { output: result },
          },
        });
      }

      const modelCallPart = initialResponse.candidates?.[0]?.content || {
        role: "model",
        parts: initialResponse.functionCalls.map((fc) => ({ functionCall: fc })),
      };

      const followUpContents = [
        ...contents,
        modelCallPart,
        {
          role: "user",
          parts: functionResponseParts,
        },
      ];

      try {
        const synthesisResponse = await executeWithRetry(
          () =>
            ai.models.generateContent({
              model,
              contents: followUpContents,
              config: {
                systemInstruction,
                temperature: 0.3,
                maxOutputTokens: 1500,
                abortSignal,
              },
            }),
          { abortSignal }
        );

        const replyText =
          synthesisResponse.text ||
          synthesisResponse.candidates?.[0]?.content?.parts?.[0]?.text ||
          formatDeterministicAnalysis(lastToolName, lastToolResult, userMessage);

        return {
          reply: replyText,
          model,
        };
      } catch (synthesisErr) {
        // Quota exhaustion during synthesis: fallback to formatted real-time tool data
        const errMsg = String(synthesisErr?.message || "").toLowerCase();
        if (errMsg.includes("429") || errMsg.includes("quota") || errMsg.includes("resource_exhausted")) {
          return {
            reply: formatDeterministicAnalysis(lastToolName, lastToolResult, userMessage),
            model: `${model}-fallback`,
          };
        }
        throw synthesisErr;
      }
    }

    const replyText =
      initialResponse.text ||
      initialResponse.candidates?.[0]?.content?.parts?.[0]?.text ||
      "I'm sorry, I couldn't generate a response. Please try rephrasing your question.";

    return {
      reply: replyText,
      model,
    };
  } catch (error) {
    if (isHrAdmin) {
      const errMsg = String(error?.message || "").toLowerCase();
      if (errMsg.includes("429") || errMsg.includes("quota") || errMsg.includes("resource_exhausted")) {
        const intentTool = detectHrQueryIntent(userMessage);
        if (intentTool) {
          try {
            const toolResult = await executeHrAnalystTool(intentTool.name, intentTool.args, {
              models,
              company,
              user,
            });
            return {
              reply: formatDeterministicAnalysis(intentTool.name, toolResult, userMessage),
              model: "deterministic-live-analyst",
            };
          } catch {
            // Fall through
          }
        }
      }
    }

    if (error instanceof HttpError) throw error;

    const errorMsg = String(error?.message || "");
    let cleanMessage = error?.message || "Unknown error";

    try {
      const jsonMatch = errorMsg.match(/\{[\s\S]*"error"[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed?.error?.message) {
          cleanMessage = parsed.error.message;
        }
      }
    } catch {
      // Fallback to errorMsg
    }

    if (
      error?.name === "AbortError" ||
      abortSignal?.aborted ||
      errorMsg.toLowerCase().includes("abort") ||
      errorMsg.toLowerCase().includes("timeout")
    ) {
      throw new HttpError(
        504,
        "AI assistant request timed out or was aborted. Please try again."
      );
    }

    if (errorMsg.includes("429") || errorMsg.toLowerCase().includes("quota")) {
      throw new HttpError(
        429,
        "Gemini AI rate limit or quota exceeded. Please wait a moment before trying again."
      );
    }

    if (errorMsg.toLowerCase().includes("safety") || errorMsg.toLowerCase().includes("blocked")) {
      throw new HttpError(
        400,
        "Your request could not be processed due to safety policy considerations."
      );
    }

    if (errorMsg.includes("404") || errorMsg.toLowerCase().includes("not found")) {
      throw new HttpError(
        502,
        `Gemini AI Model Error: ${cleanMessage}`
      );
    }

    throw new HttpError(
      502,
      `Failed to receive response from Gemini AI: ${cleanMessage}`
    );
  }
}

/**
 * Streams chat response chunks using the official @google/genai SDK generateContentStream.
 * Handles tool calling for HR Analysts before streaming the final synthesized intelligence.
 */
export async function* streamChatMessage({
  models,
  user,
  company,
  message,
  history = [],
  abortSignal,
}) {
  const { userMessage, sanitizedHistory } = validateChatInput(message, history);

  const context = await getAuthorizedContext({ models, user, company });
  const systemInstruction = buildSystemInstruction(context);
  const isHrAdmin = context.isHrAdmin;

  let ai;
  try {
    ai = getGeminiClient();
  } catch (err) {
    if (isHrAdmin) {
      const intentTool = detectHrQueryIntent(userMessage);
      if (intentTool) {
        const toolResult = await executeHrAnalystTool(intentTool.name, intentTool.args, {
          models,
          company,
          user,
        });
        yield formatDeterministicAnalysis(intentTool.name, toolResult, userMessage);
        return;
      }
    }
    throw err;
  }

  const model = DEFAULT_GEMINI_MODEL;
  const tools = isHrAdmin ? [{ functionDeclarations: HR_ANALYST_FUNCTION_DECLARATIONS }] : undefined;

  const contents = [
    ...sanitizedHistory,
    {
      role: "user",
      parts: [{ text: userMessage }],
    },
  ];

  try {
    if (isHrAdmin) {
      const initialResponse = await executeWithRetry(
        () =>
          ai.models.generateContent({
            model,
            contents,
            config: {
              systemInstruction,
              tools,
              temperature: 0.2,
              maxOutputTokens: 1024,
              abortSignal,
            },
          }),
        { abortSignal }
      );

      if (initialResponse.functionCalls && initialResponse.functionCalls.length > 0) {
        const functionResponseParts = [];
        let lastToolName = "";
        let lastToolResult = null;

        for (const call of initialResponse.functionCalls) {
          lastToolName = call.name;
          const result = await executeHrAnalystTool(call.name, call.args || {}, {
            models,
            company,
            user,
          });
          lastToolResult = result;
          functionResponseParts.push({
            functionResponse: {
              name: call.name,
              id: call.id,
              response: { output: result },
            },
          });
        }

        const modelCallPart = initialResponse.candidates?.[0]?.content || {
          role: "model",
          parts: initialResponse.functionCalls.map((fc) => ({ functionCall: fc })),
        };

        const followUpContents = [
          ...contents,
          modelCallPart,
          {
            role: "user",
            parts: functionResponseParts,
          },
        ];

        try {
          const responseStream = await executeWithRetry(
            () =>
              ai.models.generateContentStream({
                model,
                contents: followUpContents,
                config: {
                  systemInstruction,
                  temperature: 0.3,
                  maxOutputTokens: 1500,
                  abortSignal,
                },
              }),
            { abortSignal }
          );

          for await (const chunk of responseStream) {
            if (abortSignal?.aborted) break;
            const text = chunk.text;
            if (text) {
              yield text;
            }
          }
          return;
        } catch (synthesisErr) {
          const errMsg = String(synthesisErr?.message || "").toLowerCase();
          if (errMsg.includes("429") || errMsg.includes("quota") || errMsg.includes("resource_exhausted")) {
            yield formatDeterministicAnalysis(lastToolName, lastToolResult, userMessage);
            return;
          }
          throw synthesisErr;
        }
      }

      // If no function call was made, yield the initial text response
      const text =
        initialResponse.text ||
        initialResponse.candidates?.[0]?.content?.parts?.[0]?.text ||
        "";
      if (text) {
        yield text;
        return;
      }
    }

    // Default stream for regular employee
    const responseStream = await executeWithRetry(
      () =>
        ai.models.generateContentStream({
          model,
          contents,
          config: {
            systemInstruction,
            temperature: 0.3,
            maxOutputTokens: 1024,
            abortSignal,
          },
        }),
      { abortSignal }
    );

    for await (const chunk of responseStream) {
      if (abortSignal?.aborted) break;
      const text = chunk.text;
      if (text) {
        yield text;
      }
    }
  } catch (error) {
    if (isHrAdmin) {
      const errMsg = String(error?.message || "").toLowerCase();
      if (errMsg.includes("429") || errMsg.includes("quota") || errMsg.includes("resource_exhausted")) {
        const intentTool = detectHrQueryIntent(userMessage);
        if (intentTool) {
          try {
            const toolResult = await executeHrAnalystTool(intentTool.name, intentTool.args, {
              models,
              company,
              user,
            });
            yield formatDeterministicAnalysis(intentTool.name, toolResult, userMessage);
            return;
          } catch {
            // Fall through
          }
        }
      }
    }

    if (error instanceof HttpError) throw error;

    const errorMsg = String(error?.message || "");
    let cleanMessage = error?.message || "Unknown error";

    try {
      const jsonMatch = errorMsg.match(/\{[\s\S]*"error"[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed?.error?.message) {
          cleanMessage = parsed.error.message;
        }
      }
    } catch {
      // Fallback to errorMsg
    }

    if (
      error?.name === "AbortError" ||
      abortSignal?.aborted ||
      errorMsg.toLowerCase().includes("abort") ||
      errorMsg.toLowerCase().includes("timeout")
    ) {
      throw new HttpError(
        504,
        "AI assistant stream request timed out or was aborted. Please try again."
      );
    }

    if (errorMsg.includes("429") || errorMsg.toLowerCase().includes("quota")) {
      throw new HttpError(
        429,
        "Gemini AI rate limit or quota exceeded. Please wait a moment before trying again."
      );
    }

    if (errorMsg.toLowerCase().includes("safety") || errorMsg.toLowerCase().includes("blocked")) {
      throw new HttpError(
        400,
        "Your request could not be processed due to safety policy considerations."
      );
    }

    if (errorMsg.includes("404") || errorMsg.toLowerCase().includes("not found")) {
      throw new HttpError(
        502,
        `Gemini AI Model Error: ${cleanMessage}`
      );
    }

    throw new HttpError(
      502,
      `Failed to receive response from Gemini AI: ${cleanMessage}`
    );
  }
}
