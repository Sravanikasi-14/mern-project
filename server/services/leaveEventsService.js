import EventEmitter from "node:events";

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
 * Express SSE handler for cross-portal live synchronization
 */
export function subscribeLeaveEvents(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const companyId = String(req.auth.company._id);
  const userRole = req.auth.user.role;
  const userEmail = req.auth.user.email;

  // Send immediate connection acknowledgement
  res.write(
    `data: ${JSON.stringify({
      type: "CONNECTED",
      companyId,
      userRole,
    })}\n\n`
  );

  // If request specifies test probe, end immediately after writing connection ack
  if (req.headers["x-test-probe"] || req.query.probe) {
    res.end();
    return;
  }

  // Periodic heartbeat to prevent timeout on proxies / load balancers
  const heartbeat = setInterval(() => {
    try {
      res.write(": heartbeat\n\n");
    } catch {
      clearInterval(heartbeat);
    }
  }, 25000);

  const listener = (event) => {
    try {
      // 1. Enforce strict company isolation: NEVER broadcast cross-tenant
      if (String(event.companyId) !== companyId) {
        return;
      }

      // 2. Role-based event delivery:
      // HR_ADMIN receives all company leave events (submissions, decisions)
      // EMPLOYEE receives decisions affecting them or their own submission ack
      if (userRole === "EMPLOYEE") {
        if (event.employeeEmail && event.employeeEmail !== userEmail) {
          // If event has specific target employee email and it does not match, don't send
          return;
        }
      }

      res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch (err) {
      console.warn("[LeaveEvents] Client write error:", err.message);
    }
  };

  leaveEvents.on("leave_update", listener);

  req.on("close", () => {
    clearInterval(heartbeat);
    leaveEvents.off("leave_update", listener);
  });
}
