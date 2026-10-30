export const qk = {
  // Employee portal
  dashboard: () => ["employee", "dashboard"],
  tasks: (params = {}) => ["employee", "tasks", params],
  task: (id) => ["employee", "task", id],
  tasksMeta: () => ["shared", "tasks-meta"],
  attendanceHistory: (startDate, endDate) => [
    "employee",
    "attendance-history",
    startDate,
    endDate,
  ],
  trackingStatus: () => ["employee", "tracking-status"],
  impactMe: () => ["employee", "impact-me"],
  impactLeaderboard: (params = {}) => ["employee", "impact-leaderboard", params],
  profile: () => ["employee", "profile"],
  payslips: () => ["employee", "payslips"],
  settlement: () => ["employee", "settlement"],
  assets: () => ["employee", "assets"],
  notifications: () => ["shared", "notifications"],

  // HR / admin portal
  adminDashboard: (params = {}) => ["admin", "dashboard", params],
  employeesSummary: () => ["admin", "employees-summary"],
  employeesPool: () => ["admin", "employees-pool"],
  employees: (params = {}) => ["admin", "employees", params],
  employee: (id) => ["admin", "employee", id],
  leaveRequests: (params = {}) => ["admin", "leave-requests", params],
  leavePoliciesActive: () => ["admin", "leave-policies-active"],
  attendanceOverview: (params = {}) => ["admin", "attendance-overview", params],
  adminTasks: (params = {}) => ["admin", "tasks", params],
  adminImpactLeaderboard: (params = {}) => ["admin", "impact-leaderboard", params],
  adminImpactTransactions: (params = {}) => ["admin", "impact-transactions", params],
  adminAssets: (params = {}) => ["admin", "assets", params],
  payrollCycles: () => ["admin", "payroll-cycles"],
  payrollCycle: (id) => ["admin", "payroll-cycle", id],
  settlements: (params = {}) => ["admin", "settlements", params],
  companySettings: () => ["admin", "company-settings"],
};

export function invalidateEmployeeWork(client) {
  return Promise.all([
    client.invalidateQueries({ queryKey: ["employee", "dashboard"] }),
    client.invalidateQueries({ queryKey: ["employee", "tasks"] }),
    client.invalidateQueries({ queryKey: ["employee", "task"] }),
    client.invalidateQueries({ queryKey: ["admin", "tasks"] }),
    client.invalidateQueries({ queryKey: ["employee", "impact-me"] }),
  ]);
}

export function invalidateAttendance(client) {
  return Promise.all([
    client.invalidateQueries({ queryKey: ["employee", "dashboard"] }),
    client.invalidateQueries({ queryKey: ["employee", "attendance-history"] }),
    client.invalidateQueries({ queryKey: ["employee", "tracking-status"] }),
    client.invalidateQueries({ queryKey: ["admin", "attendance-overview"] }),
    client.invalidateQueries({ queryKey: ["admin", "dashboard"] }),
  ]);
}

export function invalidateLeave(client) {
  return Promise.all([
    client.invalidateQueries({ queryKey: ["employee", "dashboard"] }),
    client.invalidateQueries({ queryKey: ["admin", "leave-requests"] }),
    client.invalidateQueries({ queryKey: ["admin", "dashboard"] }),
  ]);
}

export function invalidateProfile(client) {
  return Promise.all([
    client.invalidateQueries({ queryKey: ["employee", "profile"] }),
    client.invalidateQueries({ queryKey: ["employee", "dashboard"] }),
  ]);
}

export function invalidateImpact(client) {
  return Promise.all([
    client.invalidateQueries({ queryKey: ["employee", "impact-me"] }),
    client.invalidateQueries({ queryKey: ["employee", "impact-leaderboard"] }),
    client.invalidateQueries({ queryKey: ["admin", "impact-leaderboard"] }),
    client.invalidateQueries({ queryKey: ["admin", "impact-transactions"] }),
  ]);
}

export function invalidateAssets(client) {
  return Promise.all([
    client.invalidateQueries({ queryKey: ["employee", "assets"] }),
    client.invalidateQueries({ queryKey: ["admin", "assets"] }),
  ]);
}

export function invalidateNotifications(client) {
  return client.invalidateQueries({ queryKey: ["shared", "notifications"] });
}

export function invalidateEmployees(client) {
  return Promise.all([
    client.invalidateQueries({ queryKey: ["admin", "employees"] }),
    client.invalidateQueries({ queryKey: ["admin", "employees-summary"] }),
    client.invalidateQueries({ queryKey: ["admin", "employees-pool"] }),
    client.invalidateQueries({ queryKey: ["admin", "employee"] }),
    client.invalidateQueries({ queryKey: ["admin", "dashboard"] }),
  ]);
}

export function invalidatePayroll(client) {
  return Promise.all([
    client.invalidateQueries({ queryKey: ["admin", "payroll-cycles"] }),
    client.invalidateQueries({ queryKey: ["admin", "payroll-cycle"] }),
    client.invalidateQueries({ queryKey: ["admin", "settlements"] }),
    client.invalidateQueries({ queryKey: ["employee", "payslips"] }),
    client.invalidateQueries({ queryKey: ["employee", "settlement"] }),
    client.invalidateQueries({ queryKey: ["admin", "dashboard"] }),
  ]);
}
