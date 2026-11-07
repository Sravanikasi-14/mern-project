/**
 * Pure view-state helpers for Company Admin dashboard UI.
 * Keeps loading / success / empty / error classification testable without a React runner.
 */

export function resolveCompanyAdminDashboardViewState({
  isLoading,
  isError,
  data,
  error,
} = {}) {
  if (isLoading && !data) {
    return { state: "loading", message: null };
  }

  if (isError && !data) {
    return {
      state: "error",
      message:
        error?.response?.data?.message ||
        error?.message ||
        "Unable to load company dashboard",
    };
  }

  if (!data) {
    return { state: "empty", message: "No dashboard data" };
  }

  return { state: "success", message: null };
}

export function isModuleEmpty(moduleKey, data) {
  if (!data) return true;

  switch (moduleKey) {
    case "leave":
      return !data.leave?.available || data.leave.total === 0;
    case "payroll":
      return !data.payroll?.available || !data.payroll?.hasCycle;
    case "hiring":
      return !data.hiring?.available;
    case "assets":
      return !data.assets?.available || data.assets.total === 0;
    case "activity":
      return !Array.isArray(data.recentActivity) || data.recentActivity.length === 0;
    case "attendance":
      return !data.attendance?.available;
    default:
      return false;
  }
}

export function assertPayrollPayloadIsAggregateOnly(payroll) {
  if (!payroll || typeof payroll !== "object") return true;
  const forbidden = [
    "bankAccount",
    "bankDetails",
    "accountNumber",
    "ifsc",
    "monthlySalary",
    "payments",
    "validationIssues",
    "employees",
    "salaryRecords",
  ];
  return forbidden.every((key) => !(key in payroll));
}
