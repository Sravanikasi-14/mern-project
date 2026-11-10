import { useQuery } from "@tanstack/react-query";
import api from "../services/api";
import { useAuth } from "../context/AuthContext";
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

function normalizeUnreadNotificationsPayload(data) {
  const raw = Array.isArray(data?.notifications)
    ? data.notifications
    : Array.isArray(data?.data)
      ? data.data
      : [];
  // Defense in depth: panel is unread-only even if a stale payload includes isRead:true.
  const notifications = raw.filter((n) => n && n.isRead !== true);
  const unreadCount =
    typeof data?.unreadCount === "number"
      ? data.unreadCount
      : notifications.length;
  return { notifications, unreadCount };
}

export function useNotificationsQuery(options = {}) {
  const { user } = useAuth();
  const userId = user?._id || user?.id || null;
  const { enabled = true, ...rest } = options;
  return useQuery({
    queryKey: qk.notifications(userId),
    queryFn: async () => {
      const res = await api.get("/notifications");
      return normalizeUnreadNotificationsPayload(res.data);
    },
    staleTime: STALE.notifications,
    ...rest,
    enabled: Boolean(userId) && enabled,
  });
}

/** Company-wide organization chart for employees (Phase 3B backend). */
export function useEmployeeOrganizationViewQuery(options = {}) {
  return useQuery({
    queryKey: qk.organizationView(),
    queryFn: async () => {
      const res = await api.get("/employees/organization-view");
      return {
        employees: Array.isArray(res.data?.employees) ? res.data.employees : [],
        rootIds: Array.isArray(res.data?.rootIds) ? res.data.rootIds : [],
        hierarchyRootIds: Array.isArray(res.data?.hierarchyRootIds)
          ? res.data.hierarchyRootIds
          : [],
        unassignedIds: Array.isArray(res.data?.unassignedIds) ? res.data.unassignedIds : [],
        childrenByManagerId: res.data?.childrenByManagerId || {},
        meta: res.data?.meta || {},
      };
    },
    staleTime: STALE.employees,
    ...options,
  });
}

/** Company-wide People Directory (Phase 2 backend). */
export function useEmployeeDirectoryQuery(params = {}, options = {}) {
  const normalized = {
    page: params.page || 1,
    limit: params.limit || 20,
    search: typeof params.search === "string" ? params.search.trim() : "",
  };
  return useQuery({
    queryKey: qk.directory(normalized),
    queryFn: async () => {
      const queryParams = {
        page: String(normalized.page),
        limit: String(normalized.limit),
      };
      if (normalized.search) queryParams.search = normalized.search;
      const res = await api.get("/employees/directory", { params: queryParams });
      return {
        data: Array.isArray(res.data?.data) ? res.data.data : [],
        pagination: res.data?.pagination || {
          page: normalized.page,
          limit: normalized.limit,
          totalEmployees: 0,
          totalPages: 0,
        },
      };
    },
    staleTime: STALE.employees,
    placeholderData: (previousData) => previousData,
    ...options,
  });
}

/** Relationship-scoped profile for directory popup (Phase 1 backend). */
export function useVisibleEmployeeProfileQuery(employeeId, options = {}) {
  const id = employeeId ? String(employeeId) : "";
  return useQuery({
    queryKey: qk.visibleProfile(id),
    queryFn: async () => {
      const res = await api.get(`/employees/${id}/visible-profile`);
      return {
        relationship: res.data?.relationship || null,
        visibilityTier: res.data?.visibilityTier || null,
        employee: res.data?.employee || null,
      };
    },
    enabled: Boolean(id),
    staleTime: STALE.employeeDetail,
    ...options,
  });
}
