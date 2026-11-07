import { useQuery } from "@tanstack/react-query";
import api from "../services/api";
import { qk } from "../lib/queryKeys";
import { STALE } from "../lib/queryClient";

export function useCompanyAdminDashboardQuery(options = {}) {
  return useQuery({
    queryKey: qk.companyAdminDashboard(),
    queryFn: async () => {
      const res = await api.get("/company-admin/dashboard");
      return res.data;
    },
    staleTime: STALE.adminDashboard,
    ...options,
  });
}

export function useCompanyHrAdminsQuery(params = {}, options = {}) {
  const normalized = {
    page: params.page || 1,
    limit: params.limit || 20,
    search: params.search || "",
    status: params.status || "ALL",
    invitationStatus: params.invitationStatus || "ALL",
  };

  return useQuery({
    queryKey: qk.companyHrAdmins(normalized),
    queryFn: async () => {
      const res = await api.get("/company-admin/hr-admins", { params: normalized });
      return res.data;
    },
    staleTime: STALE.employees,
    ...options,
  });
}

export function useCompanyHrAccessEnforcementQuery(options = {}) {
  return useQuery({
    queryKey: qk.companyHrAccessEnforcement(),
    queryFn: async () => {
      const res = await api.get("/company-admin/hr-access/enforcement");
      return res.data;
    },
    staleTime: STALE.employees,
    ...options,
  });
}
