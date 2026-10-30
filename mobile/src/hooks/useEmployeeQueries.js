import { useQuery } from "@tanstack/react-query";
import api from "../services/api";
import { qk } from "../app/queryKeys";
import { STALE } from "../app/queryClient";

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

function tasksPayload(res) {
  const tasks = res.data?.tasks || res.data?.data?.tasks || [];
  const pagination = res.data?.pagination || res.data?.data?.pagination || {};
  return { tasks, pagination };
}

export function useMyTasksQuery(params = {}, options = {}) {
  const normalized = {
    page: params.page || 1,
    limit: params.limit || 100,
    scope: params.scope || "my_tasks",
    search: params.search || "",
    priority: params.priority || "ALL",
    status: params.status || "",
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
      const res = await api.get("/tasks", { params: request });
      return tasksPayload(res);
    },
    staleTime: STALE.tasks,
    ...options,
  });
}

export function useTeamTasksQuery(params = {}, options = {}) {
  const normalized = {
    page: params.page || 1,
    limit: params.limit || 100,
    search: params.search || "",
    priority: params.priority || "ALL",
  };
  return useQuery({
    queryKey: qk.tasks({
      ...normalized,
      scope: "team_tasks",
      status: "SUBMITTED",
    }),
    queryFn: async () => {
      const request = {
        page: normalized.page,
        limit: normalized.limit,
        scope: "team_tasks",
        status: "SUBMITTED",
      };
      if (normalized.search.trim()) request.search = normalized.search.trim();
      if (normalized.priority !== "ALL") request.priority = normalized.priority;
      const res = await api.get("/tasks", { params: request });
      return tasksPayload(res);
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
      return res.data?.data || res.data || {};
    },
    staleTime: STALE.meta,
    ...options,
  });
}

export function useTaskDetailQuery(id, options = {}) {
  return useQuery({
    queryKey: qk.task(id),
    queryFn: async () => {
      const res = await api.get(`/tasks/${id}`);
      return res.data?.task || res.data?.data || null;
    },
    enabled: Boolean(id),
    staleTime: STALE.taskDetail,
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
      return res.data?.leaderboard || res.data?.data?.leaderboard || [];
    },
    staleTime: STALE.impact,
    ...options,
  });
}

export function useProfileQuery(options = {}) {
  return useQuery({
    queryKey: qk.profile(),
    queryFn: async () => {
      const [me, dash] = await Promise.all([
        api.get("/employees/me"),
        api.get("/employees/me/dashboard").catch(() => null),
      ]);
      return {
        profile: me.data?.employee || me.data?.data || me.data,
        documents: me.data?.documents || me.data?.employee?.documents || [],
        dashboard: dash?.data || null,
      };
    },
    staleTime: STALE.profile,
    ...options,
  });
}

export function usePayslipsQuery(options = {}) {
  return useQuery({
    queryKey: qk.payslips(),
    queryFn: async () => {
      const res = await api.get("/payroll/employee/payslips");
      return res.data?.payslips || res.data?.data || [];
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
        return res.data?.settlement || res.data?.data || res.data || null;
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
      const res = await api.get("/assets/my-assets");
      return res.data?.assets || res.data?.data || [];
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
