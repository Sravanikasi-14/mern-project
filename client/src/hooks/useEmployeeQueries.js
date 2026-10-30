import { useQuery } from "@tanstack/react-query";
import api from "../services/api";
import { qk } from "../lib/queryKeys";
import { STALE } from "../lib/queryClient";

export function useDashboardQuery(options = {}) {
  return useQuery({
    queryKey: qk.dashboard(),
    queryFn: async () => {
      const res = await api.get("/employees/me/dashboard");
      return res.data;
    },
    staleTime: STALE.dashboard,
    ...options,
  });
}

export function useMyTasksQuery(params = {}, options = {}) {
  const normalized = {
    page: params.page || 1,
    limit: params.limit || 50,
    scope: params.scope || "my_tasks",
    search: params.search || "",
    priority: params.priority || "ALL",
    status: params.status || "",
    completedScope: params.completedScope || "",
  };
  return useQuery({
    queryKey: qk.tasks(normalized),
    queryFn: async () => {
      const request = {
        page: normalized.page,
        limit: normalized.limit,
        scope: normalized.scope,
      };
      if (normalized.search.trim()) request.search = normalized.search.trim();
      if (normalized.priority !== "ALL") request.priority = normalized.priority;
      if (normalized.status) request.status = normalized.status;
      if (normalized.completedScope) request.completedScope = normalized.completedScope;
      const res = await api.get("/tasks", { params: request });
      const tasks = res.data?.tasks || res.data?.data?.tasks || [];
      const pagination = res.data?.pagination || res.data?.data?.pagination || {
        page: normalized.page,
        limit: normalized.limit,
        total: tasks.length,
        pages: 1,
      };
      return {
        success: Boolean(res.data?.success ?? true),
        tasks: Array.isArray(tasks) ? tasks : [],
        pagination,
      };
    },
    staleTime: STALE.tasks,
    ...options,
  });
}

export function useTasksMetaQuery(options = {}) {
  return useQuery({
    queryKey: qk.tasksMeta(),
    queryFn: async () => {
      const res = await api.get("/tasks/meta");
      const metaData = res.data?.data || res.data || {};
      return {
        userRole: metaData.userRole || "",
        isManager: Boolean(metaData.isManager),
        directReportsCount: metaData.directReportsCount || 0,
        assignableEmployees: Array.isArray(metaData.assignableEmployees)
          ? metaData.assignableEmployees
          : [],
        departments: Array.isArray(metaData.departments) ? metaData.departments : [],
      };
    },
    staleTime: STALE.meta,
    ...options,
  });
}

export function useAttendanceHistoryQuery(startDate, endDate, options = {}) {
  return useQuery({
    queryKey: qk.attendanceHistory(startDate, endDate),
    queryFn: async () => {
      const res = await api.get("/employees/me/attendance/history", {
        params: { startDate, endDate, page: 1, limit: 100 },
      });
      return res.data?.records || res.data?.history || res.data?.days || [];
    },
    enabled: Boolean(startDate && endDate),
    staleTime: STALE.attendance,
    ...options,
  });
}

export function useTrackingStatusQuery(options = {}) {
  return useQuery({
    queryKey: qk.trackingStatus(),
    queryFn: async () => {
      const res = await api.get("/employees/me/tracking/status");
      return res.data;
    },
    staleTime: STALE.attendance,
    ...options,
  });
}

export function useImpactMeQuery(options = {}) {
  return useQuery({
    queryKey: qk.impactMe(),
    queryFn: async () => {
      const res = await api.get("/impact-points/me");
      return res.data?.summary || res.data?.data || res.data;
    },
    staleTime: STALE.impact,
    ...options,
  });
}

export function useImpactLeaderboardQuery(params = {}, options = {}) {
  const normalized = {
    period: params.period || "all",
    department: params.department || "ALL",
  };
  return useQuery({
    queryKey: qk.impactLeaderboard(normalized),
    queryFn: async () => {
      const request = {};
      if (normalized.department !== "ALL") request.department = normalized.department;
      if (normalized.period !== "all") request.period = normalized.period;
      const res = await api.get("/impact-points/leaderboard", { params: request });
      return (
        res.data?.leaderboard ||
        res.data?.data?.leaderboard ||
        (Array.isArray(res.data?.data) ? res.data.data : []) ||
        []
      );
    },
    staleTime: STALE.impact,
    ...options,
  });
}

export function useProfileQuery(options = {}) {
  return useQuery({
    queryKey: qk.profile(),
    queryFn: async () => {
      const res = await api.get("/employees/me");
      return {
        employee: res.data?.employee || res.data?.data || res.data,
        documents:
          res.data?.documents ||
          res.data?.employee?.documents ||
          res.data?.data?.documents ||
          [],
      };
    },
    staleTime: STALE.profile,
    ...options,
  });
}

function mapPayslip(p) {
  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const mName = monthNames[p.periodMonth - 1] || `Month ${p.periodMonth}`;
  const startDateStr = p.periodStartDate
    ? new Date(p.periodStartDate).toLocaleDateString("en-IN")
    : "";
  const endDateStr = p.periodEndDate
    ? new Date(p.periodEndDate).toLocaleDateString("en-IN")
    : "";

  return {
    id: p._id?.toString() || p.id,
    payslipNumber:
      p.payslipNumber || `PS-${p.periodYear}-${String(p.periodMonth).padStart(2, "0")}`,
    month: mName,
    year: p.periodYear,
    periodMonth: p.periodMonth,
    period:
      startDateStr && endDateStr ? `${startDateStr} – ${endDateStr}` : `${mName} ${p.periodYear}`,
    grossSalary: p.grossEarnings || 0,
    deductions: p.totalDeductions || 0,
    netPay: p.netPayable || 0,
    status: p.paymentStatus === "PAID" ? "PAID" : p.status || "FINALIZED",
    paymentStatus: p.paymentStatus || "UNPAID",
    disbursedDate: p.payments?.[0]?.paymentDate
      ? new Date(p.payments[0].paymentDate).toLocaleDateString("en-IN")
      : p.finalizedAt
        ? new Date(p.finalizedAt).toLocaleDateString("en-IN")
        : null,
    isPersisted: true,
    isFinalizedPayroll: true,
    daysBreakdown: p.daysBreakdown,
    earnings: p.earnings || [],
    employeeDeductions: p.employeeDeductions || [],
    employerContributions: p.employerContributions || [],
    payments: p.payments || [],
    employeeSnapshot: p.employeeSnapshot,
  };
}

function getMonthNumber(name) {
  const months = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
  ];
  const idx = months.indexOf(String(name).toLowerCase().trim());
  return idx >= 0 ? idx + 1 : 1;
}

export function usePayslipsQuery(options = {}) {
  return useQuery({
    queryKey: qk.payslips(),
    queryFn: async () => {
      const payrollRes = await api.get("/payroll/employee/payslips").catch(() => null);
      let items = [];
      if (payrollRes?.data?.payslips) {
        items = payrollRes.data.payslips.map(mapPayslip);
      }
      if (items.length === 0) {
        try {
          const dashboardRes = await api.get("/employees/me/dashboard");
          if (dashboardRes.data?.payslips) {
            items = dashboardRes.data.payslips
              .filter((ps) => ps.isPersisted === true)
              .map((ps) => ({
                ...ps,
                periodMonth:
                  typeof ps.month === "string" ? getMonthNumber(ps.month) : ps.periodMonth || 1,
                isPersisted: true,
                isFinalizedPayroll: true,
              }));
          }
        } catch {
          // ignore fallback
        }
      }
      return items;
    },
    staleTime: STALE.payslips,
    ...options,
  });
}

export function useSettlementQuery(options = {}) {
  return useQuery({
    queryKey: qk.settlement(),
    queryFn: async () => {
      try {
        const res = await api.get("/settlements/my-settlement");
        return res.data?.settlement || res.data?.data || null;
      } catch {
        return null;
      }
    },
    staleTime: STALE.payslips,
    ...options,
  });
}

export function useAssetsQuery(options = {}) {
  return useQuery({
    queryKey: qk.assets(),
    queryFn: async () => {
      try {
        const res = await api.get("/assets/my-assets");
        return {
          assets: res.data?.assets || [],
          history: res.data?.history || [],
        };
      } catch {
        const dashRes = await api.get("/employees/me/dashboard");
        return {
          assets: dashRes.data?.assets || [],
          history: [],
        };
      }
    },
    staleTime: STALE.assets,
    ...options,
  });
}

export function useNotificationsQuery(options = {}) {
  return useQuery({
    queryKey: qk.notifications(),
    queryFn: async () => {
      const res = await api.get("/notifications");
      return {
        notifications: res.data?.notifications || res.data?.data || [],
        unreadCount: res.data?.unreadCount ?? 0,
      };
    },
    staleTime: STALE.notifications,
    ...options,
  });
}
