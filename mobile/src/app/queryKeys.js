export const qk = {
  dashboard: () => ["employee", "dashboard"],
  tasks: (params = {}) => ["employee", "tasks", params],
  task: (id) => ["employee", "task", id],
  tasksMeta: () => ["employee", "tasks-meta"],
  attendanceHistory: (startDate, endDate) => ["employee", "attendance-history", startDate, endDate],
  trackingStatus: () => ["employee", "tracking-status"],
  impactMe: () => ["employee", "impact-me"],
  impactLeaderboard: (params = {}) => ["employee", "impact-leaderboard", params],
  profile: () => ["employee", "profile"],
  payslips: () => ["employee", "payslips"],
  settlement: () => ["employee", "settlement"],
  assets: () => ["employee", "assets"],
  // Pass userId for cache isolation; omit (undefined) for prefix invalidation across users.
  notifications: (userId) =>
    userId === undefined
      ? ["employee", "notifications"]
      : ["employee", "notifications", userId ? String(userId) : "anon"],
  /** HR leave request intelligence — never used on employee screens */
  leaveImpact: (id) => ["hr", "leave-impact", String(id || "")],
  leaveBackup: (id) => ["hr", "leave-backup", String(id || "")],
  leaveHandover: (id) => ["hr", "leave-handover", String(id || "")],
  leaveRequestDetail: (id) => ["hr", "leave-request", String(id || "")],
  employeeLeaveInsights: () => ["employee", "leave-insights"],
};

export function invalidateEmployeeWork(queryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ["employee", "dashboard"] }),
    queryClient.invalidateQueries({ queryKey: ["employee", "tasks"] }),
    queryClient.invalidateQueries({ queryKey: ["employee", "task"] }),
    queryClient.invalidateQueries({ queryKey: ["employee", "impact-me"] }),
  ]);
}

export function invalidateAttendance(queryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ["employee", "dashboard"] }),
    queryClient.invalidateQueries({ queryKey: ["employee", "attendance-history"] }),
    queryClient.invalidateQueries({ queryKey: ["employee", "tracking-status"] }),
  ]);
}

export function invalidateLeave(queryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ["employee", "dashboard"] }),
    queryClient.invalidateQueries({ queryKey: ["employee", "leave-insights"] }),
  ]);
}

/** Clear / refresh HR leave intelligence caches after decisions or coordination changes. */
export function invalidateLeaveIntelligence(queryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ["hr", "leave-impact"] }),
    queryClient.invalidateQueries({ queryKey: ["hr", "leave-backup"] }),
    queryClient.invalidateQueries({ queryKey: ["hr", "leave-handover"] }),
    queryClient.invalidateQueries({ queryKey: ["hr", "leave-request"] }),
    queryClient.invalidateQueries({ queryKey: ["employee", "dashboard"] }),
  ]);
}

export function invalidateProfile(queryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ["employee", "profile"] }),
    queryClient.invalidateQueries({ queryKey: ["employee", "dashboard"] }),
  ]);
}

export function invalidateImpact(queryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ["employee", "impact-me"] }),
    queryClient.invalidateQueries({ queryKey: ["employee", "impact-leaderboard"] }),
  ]);
}

export function invalidateAssets(queryClient) {
  return queryClient.invalidateQueries({ queryKey: ["employee", "assets"] });
}

export function invalidateNotifications(queryClient, userId) {
  if (userId) {
    return queryClient.invalidateQueries({
      queryKey: ["employee", "notifications", String(userId)],
    });
  }
  return queryClient.invalidateQueries({ queryKey: ["employee", "notifications"] });
}
