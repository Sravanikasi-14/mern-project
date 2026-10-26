import mongoose from "mongoose";
import { getGeminiClient, DEFAULT_GEMINI_MODEL } from "../config/gemini.js";
import { getActiveCompanyHrPolicy } from "../models/CompanyHrPolicy.js";
import { getEmployeePointsSummaryService } from "./workManagementService.js";
import { HttpError } from "../utils/httpError.js";

/**
 * Gathers authorized HRMS factual context for the authenticated user and tenant.
 * Strictly adheres to tenant isolation using req.auth.models.
 * Never accesses passwords, hashes, bank details, or private identity documents.
 */
export async function getAuthorizedContext({ models, user, company }) {
  const { Employee, CompanyHrPolicy, Task, ImpactPointTransaction } = models;

  const contextData = {
    companyName: company?.companyName || "HRMS",
    userRole: user?.role || "EMPLOYEE",
    userEmail: user?.email || "",
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
            gracePeriodMinutes: policy.attendanceRules?.gracePeriodMinutes || 15,
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
        errorMsg.includes("resource_exhausted") ||
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

  const ai = getGeminiClient();
  const model = DEFAULT_GEMINI_MODEL;

  const contents = [
    ...sanitizedHistory,
    {
      role: "user",
      parts: [{ text: userMessage }],
    },
  ];

  try {
    const response = await executeWithRetry(
      () =>
        ai.models.generateContent({
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

    const replyText =
      response.text ||
      response.candidates?.[0]?.content?.parts?.[0]?.text ||
      "I'm sorry, I couldn't generate a response. Please try rephrasing your question.";

    return {
      reply: replyText,
      model,
    };
  } catch (error) {
    // Graceful error mapping
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
 * Yields text tokens in real time.
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

  const ai = getGeminiClient();
  const model = DEFAULT_GEMINI_MODEL;

  const contents = [
    ...sanitizedHistory,
    {
      role: "user",
      parts: [{ text: userMessage }],
    },
  ];

  try {
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
