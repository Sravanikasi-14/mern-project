import EventEmitter from "node:events";
import Company from "../models/Company.js";
import { USER_ROLES } from "../models/User.js";
import {
  resolveHrAccessContext,
  assertHrPermission,
  isEmployeeIdInScope,
} from "./hrAccessEnforcementService.js";
import { HttpError } from "../utils/httpError.js";

class LeaveEventEmitter extends EventEmitter {}

export const leaveEvents = new LeaveEventEmitter();
leaveEvents.setMaxListeners(300);

/**
 * Emits a company-scoped leave update event
 */
export function emitLeaveEvent(eventData) {
  try {
    leaveEvents.emit("leave_update", {
      ...eventData,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[LeaveEvents] Emit error:", err.message);
  }
}

/**
 * Express SSE handler for cross-portal live synchronization.
 * When ENFORCED, HR_ADMIN must have leave.view and only receives in-scope employee events.
 * Permission and scope are checked again on each event so a scope reduction stops
 * delivery on the existing connection.
 */
export async function subscribeLeaveEvents(req, res, next) {
  try {
    const companyId = String(req.auth.company._id);
    const userRole = req.auth.user.role;
    const userEmail = req.auth.user.email;

    let hrAccess = req.hrAccess;

    if (userRole === USER_ROLES.HR_ADMIN) {
      if (!hrAccess) {
        hrAccess = await resolveHrAccessContext({
          user: req.auth.user,
          company: req.auth.company,
          models: req.auth.models,
        });
      }
      assertHrPermission(hrAccess, "leave.view");
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    res.write(
      `data: ${JSON.stringify({
        type: "CONNECTED",
        companyId,
        userRole,
      })}\n\n`
    );

    if (req.headers["x-test-probe"] || req.query.probe) {
      res.end();
      return;
    }

    const heartbeat = setInterval(() => {
      try {
        res.write(": heartbeat\n\n");
      } catch {
        clearInterval(heartbeat);
      }
    }, 25000);

    const listener = async (event) => {
      try {
        if (String(event.companyId) !== companyId) {
          return;
        }

        if (userRole === USER_ROLES.EMPLOYEE) {
          if (!event.employeeEmail || event.employeeEmail !== userEmail) {
            return;
          }
        } else if (userRole === USER_ROLES.HR_ADMIN) {
          // Re-read access on each event so a scope reduction takes effect
          // without forcing the client to reconnect.
          const [freshUser, freshCompany] = await Promise.all([
            req.auth.models.User.findById(req.auth.user._id)
              .select("role email isActive hrAccess")
              .lean(),
            Company.findById(companyId).select("config.hrAccessEnforcement status").lean(),
          ]);
          if (!freshUser?.isActive || !freshCompany) return;
          let current;
          try {
            current = await resolveHrAccessContext({
              user: freshUser,
              company: freshCompany,
              models: req.auth.models,
            });
            assertHrPermission(current, "leave.view");
          } catch {
            return;
          }
          const eventEmployeeId = event.employeeId || event.employee?._id;
          if (!isEmployeeIdInScope(current, eventEmployeeId)) return;
        }

        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        }
      } catch (err) {
        console.warn("[LeaveEvents] Client write error:", err.message);
      }
    };

    leaveEvents.on("leave_update", listener);

    req.on("close", () => {
      clearInterval(heartbeat);
      leaveEvents.off("leave_update", listener);
    });
  } catch (err) {
    if (err instanceof HttpError || err.status) {
      return next(err);
    }
    return next(err);
  }
}
