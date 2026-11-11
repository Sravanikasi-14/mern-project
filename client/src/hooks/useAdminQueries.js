import { useQuery } from "@tanstack/react-query";
import api from "../services/api";
import { qk } from "../lib/queryKeys";
import { STALE } from "../lib/queryClient";
import {
  civilDaysInMonth,
  formatCivilDate,
  getCompanyBusinessDate,
  resolveCompanyTimezone,
} from "../utils/dateUtils";

/**
 * Focus date for HR dashboard trends: explicit date, else clamp to selected month.
 * Past months end on month-end; current month uses company business "today".
 */
export function resolveAdminDashboardDate({ month, year, date, company } = {}) {
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(String(date))) return String(date);
  const m = Number(month);
  const y = Number(year);
  const tz = resolveCompanyTimezone(company);
  const todayStr = getCompanyBusinessDate(new Date(), tz);
  if (!Number.isFinite(m) || !Number.isFinite(y) || m < 1 || m > 12) return todayStr;
  const monthStart = formatCivilDate(y, m, 1);
  const monthEnd = formatCivilDate(y, m, civilDaysInMonth(y, m));
  if (todayStr < monthStart) return monthStart;
  if (todayStr > monthEnd) return monthEnd;
  return todayStr;
}

export function useAdminDashboardQuery(params = {}, options = {}) {
  const date = resolveAdminDashboardDate(params);
  const normalized = {
    month: params.month,
    year: params.year,
    department: params.department || "ALL",
    date,
  };
  return useQuery({
    queryKey: qk.adminDashboard(normalized),
    queryFn: async () => {
      try {
        const res = await api.get("/admin/dashboard", {
          params: {
            month: normalized.month,
            year: normalized.year,
            department: normalized.department,
            date: normalized.date,
          },
        });
        if (res.data?.success) return { source: "aggregated", data: res.data };
      } catch (err) {
        if (err.response?.status !== 404) throw err;
      }
      return { source: "fallback", data: null, params: normalized };
    },
    staleTime: STALE.adminDashboard,
    enabled: Boolean(normalized.month && normalized.year),
    ...options,
  });
}

export function useEmployeesSummaryQuery(options = {}) {
  return useQuery({
    queryKey: qk.employeesSummary(),
    queryFn: async () => {
      const res = await api.get("/employees/summary");
      return res.data;
    },
    staleTime: STALE.employees,
    ...options,
  });
}

export function useEmployeesPoolQuery(options = {}) {
  return useQuery({
    queryKey: qk.employeesPool(),
    queryFn: async () => {
      // Lean pool for project/dept cards — skip per-row compensation hydration.
      const res = await api.get("/employees", {
        params: { limit: 300, includeCompensation: false, sortBy: "fullName", sortOrder: "asc" },
      });
      return res.data?.employees || [];
    },
    staleTime: STALE.employees,
    ...options,
  });
}

export function useEmployeesQuery(params = {}, options = {}) {
  const normalized = {
    page: params.page || 1,
    limit: params.limit || 20,
    sortBy: params.sortBy || "fullName",
    sortOrder: params.sortOrder || "asc",
    search: params.search || "",
    status: params.status || "ALL",
    project: params.project || "ALL",
    department: params.department || "",
    jobTitle: params.jobTitle || "",
    /** null = no filter; "none" = unassigned; ObjectId string = direct reports */
    reportingManagerId: params.reportingManagerId || "",
    employmentType: params.employmentType || "",
    workLocation: params.workLocation || "",
    invitationStatus: params.invitationStatus || "",
    joiningFrom: params.joiningFrom || "",
    joiningTo: params.joiningTo || "",
    projectType: params.projectType || "",
  };
  return useQuery({
    queryKey: qk.employees(normalized),
    queryFn: async () => {
      const queryParams = {
        page: String(normalized.page),
        limit: String(normalized.limit),
        sortBy: normalized.sortBy,
        sortOrder: normalized.sortOrder,
      };
      if (normalized.search.trim()) queryParams.search = normalized.search.trim();
      if (normalized.status !== "ALL") queryParams.status = normalized.status;
      if (normalized.project && normalized.project !== "ALL") {
        queryParams.project = normalized.project;
      }
      if (normalized.department) queryParams.department = normalized.department;
      if (normalized.jobTitle.trim()) queryParams.jobTitle = normalized.jobTitle.trim();
      if (normalized.reportingManagerId) {
        queryParams.reportingManagerId = normalized.reportingManagerId;
      }
      if (normalized.employmentType.trim()) {
        queryParams.employmentType = normalized.employmentType.trim();
      }
      if (normalized.workLocation.trim()) {
        queryParams.workLocation = normalized.workLocation.trim();
      }
      if (normalized.invitationStatus.trim()) {
        queryParams.invitationStatus = normalized.invitationStatus.trim();
      }
      if (normalized.joiningFrom.trim()) queryParams.joiningFrom = normalized.joiningFrom.trim();
      if (normalized.joiningTo.trim()) queryParams.joiningTo = normalized.joiningTo.trim();
      if (normalized.projectType.trim()) queryParams.projectType = normalized.projectType.trim();
      const res = await api.get("/employees", { params: queryParams });
      return {
        employees: res.data?.employees || [],
        pagination: res.data?.pagination,
      };
    },
    staleTime: STALE.employees,
    ...options,
  });
}

export function useLeaveRequestsQuery(params = {}, options = {}) {
  const normalized = {
    page: params.page || 1,
    limit: params.limit || 20,
    status: params.status || "ALL",
    leaveType: params.leaveType || "ALL",
    search: params.search || "",
    fromDate: params.fromDate || "",
    toDate: params.toDate || "",
  };
  return useQuery({
    queryKey: qk.leaveRequests(normalized),
    queryFn: async () => {
      const request = {
        page: normalized.page,
        limit: normalized.limit,
      };
      if (normalized.status !== "ALL") request.status = normalized.status;
      if (normalized.leaveType !== "ALL") request.leaveType = normalized.leaveType;
      if (normalized.search) request.search = normalized.search;
      if (normalized.fromDate) request.fromDate = normalized.fromDate;
      if (normalized.toDate) request.toDate = normalized.toDate;
      const res = await api.get("/leave-requests", { params: request });
      return {
        leaveRequests: res.data?.leaveRequests || [],
        pagination: res.data?.pagination,
        summary: res.data?.summary,
      };
    },
    staleTime: STALE.leave,
    ...options,
  });
}

export function useActiveLeavePoliciesQuery(options = {}) {
  return useQuery({
    queryKey: qk.leavePoliciesActive(),
    queryFn: async () => {
      const res = await api.get("/policies/active");
      return res.data?.policy?.leaveTypes || [];
    },
    staleTime: STALE.policies,
    ...options,
  });
}

export function useAttendanceOverviewQuery(params = {}, options = {}) {
  const endDate = params.endDate || params.date || params.startDate || "";
  const startDate = params.startDate || endDate;
  const normalized = {
    // `date` stays equal to endDate for backward compatibility with the single-day API.
    date: endDate,
    startDate,
    endDate,
    department: params.department || "ALL",
  };
  return useQuery({
    queryKey: qk.attendanceOverview(normalized),
    queryFn: async ({ signal }) => {
      const request = {
        date: normalized.date,
        startDate: normalized.startDate,
        endDate: normalized.endDate,
      };
      if (normalized.department !== "ALL") request.department = normalized.department;
      const res = await api.get("/admin/attendance/overview", {
        params: request,
        signal,
      });
      return res.data;
    },
    enabled: Boolean(normalized.date),
    staleTime: STALE.attendance,
    ...options,
  });
}

export function useTrackingSessionsQuery(params = {}, options = {}) {
  const normalized = {
    startDate: params.startDate || "",
    endDate: params.endDate || params.startDate || "",
    department: params.department || "ALL",
    status: params.status || "ALL",
  };
  return useQuery({
    queryKey: qk.trackingSessions(normalized),
    queryFn: async ({ signal }) => {
      const request = {};
      if (normalized.startDate && normalized.endDate) {
        request.startDate = normalized.startDate;
        request.endDate = normalized.endDate;
      }
      if (normalized.department !== "ALL") request.department = normalized.department;
      if (normalized.status !== "ALL") request.status = normalized.status;
      const res = await api.get("/admin/attendance/tracking-sessions", {
        params: request,
        signal,
      });
      return res.data;
    },
    staleTime: STALE.attendance,
    ...options,
  });
}

export function useAdminTasksQuery(params = {}, options = {}) {
  const normalized = {
    page: params.page || 1,
    limit: params.limit || 50,
    scope: params.scope || "",
    status: params.status || "",
    priority: params.priority || "ALL",
    department: params.department || "ALL",
    search: params.search || "",
    completedScope: params.completedScope || "",
  };
  return useQuery({
    queryKey: qk.adminTasks(normalized),
    queryFn: async () => {
      const request = {
        page: normalized.page,
        limit: normalized.limit,
      };
      if (normalized.scope) request.scope = normalized.scope;
      if (normalized.status) request.status = normalized.status;
      if (normalized.priority !== "ALL") request.priority = normalized.priority;
      if (normalized.department !== "ALL") request.department = normalized.department;
      if (normalized.search.trim()) request.search = normalized.search.trim();
      if (normalized.completedScope) request.completedScope = normalized.completedScope;
      const res = await api.get("/tasks", { params: request });
      const tasks = res.data?.tasks || res.data?.data?.tasks || [];
      const pagination = res.data?.pagination || res.data?.data?.pagination || {
        total: tasks.length,
        page: 1,
        limit: 50,
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

export function useAdminImpactLeaderboardQuery(params = {}, options = {}) {
  const normalized = {
    period: params.period || "all",
    department: params.department || "ALL",
  };
  return useQuery({
    queryKey: qk.adminImpactLeaderboard(normalized),
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

export function useAdminImpactTransactionsQuery(params = {}, options = {}) {
  const normalized = {
    page: params.page || 1,
    limit: params.limit || 20,
    type: params.type || "ALL",
    source: params.source || "ALL",
    search: params.search || "",
  };
  return useQuery({
    queryKey: qk.adminImpactTransactions(normalized),
    queryFn: async () => {
      const request = {
        page: normalized.page,
        limit: normalized.limit,
      };
      if (normalized.type !== "ALL") request.type = normalized.type;
      if (normalized.source !== "ALL") request.source = normalized.source;
      if (normalized.search.trim()) request.search = normalized.search.trim();
      const res = await api.get("/impact-points/transactions", { params: request });
      const txList =
        res.data?.transactions ||
        res.data?.data?.transactions ||
        (Array.isArray(res.data?.data) ? res.data.data : []) ||
        [];
      return {
        transactions: Array.isArray(txList) ? txList : [],
        pagination: res.data?.pagination || res.data?.data?.pagination,
      };
    },
    staleTime: STALE.impact,
    ...options,
  });
}

export function useAdminAssetsQuery(params = {}, options = {}) {
  const normalized = {
    page: params.page || 1,
    limit: params.limit || 20,
    status: params.status || "",
    search: params.search || "",
    category: params.category || "",
    condition: params.condition || "",
  };
  return useQuery({
    queryKey: qk.adminAssets(normalized),
    queryFn: async () => {
      const request = {
        page: normalized.page,
        limit: normalized.limit,
      };
      if (normalized.status) request.status = normalized.status;
      if (normalized.search.trim()) request.search = normalized.search.trim();
      if (normalized.category) request.category = normalized.category;
      if (normalized.condition) request.condition = normalized.condition;
      const res = await api.get("/assets", { params: request });
      return res.data;
    },
    staleTime: STALE.assets,
    ...options,
  });
}

/** Fallback aggregator used when /admin/dashboard is unavailable. */
export async function buildAdminDashboardFallback({
  company,
  selectedMonth,
  selectedYear,
  selectedDept,
}) {
  const todayStr = getCompanyBusinessDate(new Date(), resolveCompanyTimezone(company));
  const focusDate = resolveAdminDashboardDate({
    month: selectedMonth,
    year: selectedYear,
    company,
  });
  const [empSummaryRes, attendanceRes, leavesRes, offersRes, cyclesRes] =
    await Promise.allSettled([
      api.get("/employees/summary"),
      api.get("/admin/attendance/overview", {
        params: { date: focusDate, department: selectedDept },
      }),
      api.get("/leave-requests"),
      api.get("/offer-letters/summary"),
      api.get("/payroll/cycles"),
    ]);

  const empSummary =
    empSummaryRes.status === "fulfilled" ? empSummaryRes.value.data?.summary || {} : {};
  const totalEmp = empSummary.activeEmployees ?? empSummary.totalEmployees ?? 0;
  const attData =
    attendanceRes.status === "fulfilled" ? attendanceRes.value.data || {} : {};
  const attSummary = attData.summary || {};
  const leavesList =
    leavesRes.status === "fulfilled" ? leavesRes.value.data?.leaves || [] : [];
  const offersData =
    offersRes.status === "fulfilled" ? offersRes.value.data || {} : {};
  const cyclesList =
    cyclesRes.status === "fulfilled" ? cyclesRes.value.data?.cycles || [] : [];

  const currentCycle =
    cyclesList.find(
      (c) => c.periodMonth === selectedMonth && c.periodYear === selectedYear
    ) ||
    cyclesList[0] ||
    null;

  const present = attSummary.presentCount ?? 0;
  const onLeave = leavesList.filter(
    (l) =>
      l.status === "APPROVED" &&
      l.fromDate?.split("T")[0] <= focusDate &&
      l.toDate?.split("T")[0] >= focusDate
  ).length;
  const absent = Math.max(0, totalEmp - present - onLeave);
  const late = attSummary.lateCount ?? 0;

  // Real focus-day point when aggregated dashboard is unavailable.
  // Never invent past-day percentages — empty history is preferable to dummy bars.
  const fallbackDays = [
    {
      date: focusDate,
      dayOfWeek: new Date(`${focusDate}T12:00:00`).getDay(),
      isWeekend: false,
      isToday: focusDate === todayStr,
      presentCount: present,
      absentCount: absent,
      lateCount: late,
      leaveCount: onLeave,
    },
  ];

  return {
    meta: {
      companyName: company?.companyName || "Organization",
      todayDate: todayStr,
      selectedDate: focusDate,
      selectedMonth,
      selectedYear,
      currencySymbol: "₹",
      departments: [],
      officeStartTime: "09:30 AM",
    },
    summary: {
      activeEmployees: totalEmp,
      todayPresent: present,
      todayAbsent: absent,
      todayLate: late,
      onLeave,
      monthlyPayroll: empSummary.totalMonthlySalary || 0,
      payrollStatus: currentCycle?.status || "Draft",
    },
    payrollCycleSummary: currentCycle
      ? {
          status: currentCycle.status,
          statusLabel:
            currentCycle.status.charAt(0) + currentCycle.status.slice(1).toLowerCase(),
          periodMonth: currentCycle.periodMonth,
          periodYear: currentCycle.periodYear,
          totalNetSalary: currentCycle.totalNetSalary || 0,
          employeeCount: currentCycle.employeeCount || 0,
          pendingAction:
            currentCycle.status === "FINALIZED"
              ? "Record salary disbursements"
              : "Review payroll calculations",
        }
      : {
          status: "DRAFT",
          statusLabel: "Draft",
          periodMonth: selectedMonth,
          periodYear: selectedYear,
          totalNetSalary: 0,
          employeeCount: 0,
          pendingAction: "Initialize monthly payroll register",
        },
    recruitmentFunnel: {
      offersGenerated: offersData.totalOffers || 0,
      accepted: offersData.acceptedCount || 0,
      acceptedPct:
        offersData.totalOffers > 0
          ? Math.round(((offersData.acceptedCount || 0) / offersData.totalOffers) * 100)
          : 0,
      pending: offersData.pendingCount || 0,
      pendingPct:
        offersData.totalOffers > 0
          ? Math.round(((offersData.pendingCount || 0) / offersData.totalOffers) * 100)
          : 0,
      declined: offersData.rejectedCount || 0,
      declinedPct:
        offersData.totalOffers > 0
          ? Math.round(((offersData.rejectedCount || 0) / offersData.totalOffers) * 100)
          : 0,
      acceptanceRate:
        offersData.totalOffers > 0
          ? (((offersData.acceptedCount || 0) / offersData.totalOffers) * 100).toFixed(1)
          : "0.0",
    },
    attendanceCalendar: {
      month: selectedMonth,
      year: selectedYear,
      days: fallbackDays,
    },
    attendanceOverview: {
      period: "Today",
      endDate: todayStr,
      days: fallbackDays,
      week: fallbackDays,
      thirtyDays: fallbackDays,
      activeEmployees: totalEmp,
    },
    recentLeaves: leavesList.slice(0, 5).map((l) => ({
      id: l._id,
      employeeName: l.employeeId?.fullName || "Team Member",
      department: l.employeeId?.job?.department || "General",
      leaveType: l.leaveTypeCode || "Leave",
      daysCount: l.daysCount || 1,
      status: l.status || "PENDING",
    })),
    recentOffers: [],
    upcomingHolidays: [],
    salaryExpenses: [],
    companyAssets: {
      totalEmployees: totalEmp,
      employeesWithAssets: Math.round(totalEmp * 0.75),
      employeesWithAssetsPct: 75,
    },
    projectTeams: {
      MANDATE: Math.round(totalEmp * 0.5),
      RETAIL: Math.round(totalEmp * 0.2),
      INTERNAL: Math.round(totalEmp * 0.2),
      BENCH: Math.max(0, totalEmp - Math.round(totalEmp * 0.9)),
    },
  };
}
