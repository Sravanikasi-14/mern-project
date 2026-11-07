import EventEmitter from "node:events";
import Company from "../models/Company.js";
import { USER_ROLES } from "../models/User.js";
import { assertHrPermission, resolveHrAccessContext } from "./hrAccessEnforcementService.js";

class OnboardingEventEmitter extends EventEmitter {}

export const onboardingEvents = new OnboardingEventEmitter();
onboardingEvents.setMaxListeners(300);

export const ONBOARDING_EVENT_TYPES = Object.freeze({
  SUBMISSION: "SUBMISSION",
  SECTION_REVIEW: "SECTION_REVIEW",
  CORRECTION_REQUESTED: "CORRECTION_REQUESTED",
  RESUBMITTED: "RESUBMITTED",
  HR_APPROVED: "HR_APPROVED",
  INVITE_SENT: "INVITE_SENT",
  ACCOUNT_ACTIVATED: "ACCOUNT_ACTIVATED",
  EMPLOYEE_CREATED: "EMPLOYEE_CREATED",
  REJECTED: "REJECTED",
});

/**
 * Emits a company-scoped onboarding update event.
 * Payload intentionally carries ids/status only (no PII): { type, companyId, submissionId, status?, section? }.
 */
export function emitOnboardingEvent(eventData) {
  try {
    const { type, companyId, submissionId, status, section } = eventData || {};
    onboardingEvents.emit("onboarding_update", {
      type,
      companyId: companyId !== undefined && companyId !== null ? String(companyId) : companyId,
      submissionId:
        submissionId !== undefined && submissionId !== null ? String(submissionId) : submissionId,
      ...(status ? { status } : {}),
      ...(section ? { section } : {}),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[OnboardingEvents] Emit error:", err.message);
  }
}

/**
 * Express SSE handler for live HR onboarding review synchronization.
 * HR_ADMIN only (enforced by route middleware); strictly company scoped.
 */
export function subscribeOnboardingEvents(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const companyId = String(req.auth.company._id);

  // Immediate connection acknowledgement
  res.write(
    `data: ${JSON.stringify({
      type: "CONNECTED",
      companyId,
    })}\n\n`
  );

  // Test probe: end immediately after the connection ack
  if (req.headers["x-test-probe"] || req.query.probe) {
    res.end();
    return;
  }

  // Heartbeat to keep proxies / load balancers from timing out
  const heartbeat = setInterval(() => {
    try {
      res.write(": heartbeat\n\n");
    } catch {
      clearInterval(heartbeat);
    }
  }, 25000);

  const listener = async (event) => {
    try {
      // Strict company isolation: never broadcast cross-tenant
      if (String(event.companyId) !== companyId) {
        return;
      }

      // Re-read access on each event so a permission revocation stops delivery
      // on an already-open connection.
      const [freshUser, freshCompany] = await Promise.all([
        req.auth.models.User.findById(req.auth.user._id)
          .select("role email isActive hrAccess")
          .lean(),
        Company.findById(companyId).select("config.hrAccessEnforcement status").lean(),
      ]);
      if (
        !freshUser?.isActive ||
        (freshUser.role !== USER_ROLES.HR_ADMIN && freshUser.role !== USER_ROLES.COMPANY_ADMIN) ||
        !freshCompany
      ) {
        return;
      }
      try {
        const current = await resolveHrAccessContext({
          user: freshUser,
          company: freshCompany,
          models: req.auth.models,
        });
        assertHrPermission(current, "hiring.view");
      } catch {
        return;
      }

      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    } catch (err) {
      console.warn("[OnboardingEvents] Client write error:", err.message);
    }
  };

  onboardingEvents.on("onboarding_update", listener);

  req.on("close", () => {
    clearInterval(heartbeat);
    onboardingEvents.off("onboarding_update", listener);
  });
}
