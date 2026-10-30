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
  notifications: () => ["employee", "notifications"],
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
  return queryClient.invalidateQueries({ queryKey: ["employee", "dashboard"] });
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

export function invalidateNotifications(queryClient) {
  return queryClient.invalidateQueries({ queryKey: ["employee", "notifications"] });
}
