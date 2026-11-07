import { useQuery } from "@tanstack/react-query";
import api from "../services/api";
import { qk } from "../lib/queryKeys";
import { STALE } from "../lib/queryClient";
import {
  EXPLORER_VIEWS,
  normalizeExplorerConfig,
  resolveActiveExplorerView,
} from "./organizationExplorerConfig.js";

export { EXPLORER_VIEWS, normalizeExplorerConfig, resolveActiveExplorerView };

export function useOrganizationExplorerConfigQuery(options = {}) {
  return useQuery({
    queryKey: qk.organizationExplorerConfig(),
    queryFn: async () => {
      const res = await api.get("/settings/organization-explorer");
      return normalizeExplorerConfig(res.data?.data);
    },
    staleTime: STALE.settings,
    // Keep last successful config across background refetch only — never invent tabs on error.
    placeholderData: (previous) => previous,
    ...options,
  });
}

export function useOrgExplorerDepartmentsQuery(options = {}) {
  return useQuery({
    queryKey: qk.orgExplorerDepartments(),
    queryFn: async () => {
      const res = await api.get("/employees/organization-explorer/departments");
      return {
        departments: Array.isArray(res.data?.departments) ? res.data.departments : [],
        meta: res.data?.meta || {},
      };
    },
    staleTime: STALE.employees,
    ...options,
  });
}

export function useOrgExplorerDepartmentQuery(department, options = {}) {
  const name = typeof department === "string" ? department.trim() : "";
  return useQuery({
    queryKey: qk.orgExplorerDepartment(name),
    queryFn: async () => {
      const res = await api.get(
        `/employees/organization-explorer/departments/${encodeURIComponent(name)}`
      );
      return {
        department: res.data?.department || name,
        employees: Array.isArray(res.data?.employees) ? res.data.employees : [],
        meta: res.data?.meta || {},
      };
    },
    enabled: Boolean(name),
    staleTime: STALE.employees,
    ...options,
  });
}

export function useOrgExplorerProjectsQuery(options = {}) {
  return useQuery({
    queryKey: qk.orgExplorerProjects(),
    queryFn: async () => {
      const res = await api.get("/employees/organization-explorer/projects");
      return {
        projects: Array.isArray(res.data?.projects) ? res.data.projects : [],
        meta: res.data?.meta || {},
      };
    },
    staleTime: STALE.employees,
    ...options,
  });
}

export function useOrgExplorerProjectQuery(project, options = {}) {
  const name = typeof project === "string" ? project.trim() : "";
  return useQuery({
    queryKey: qk.orgExplorerProject(name),
    queryFn: async () => {
      const res = await api.get(
        `/employees/organization-explorer/projects/${encodeURIComponent(name)}`
      );
      return {
        project: res.data?.project || name,
        projectType: res.data?.projectType ?? null,
        employees: Array.isArray(res.data?.employees) ? res.data.employees : [],
        meta: res.data?.meta || {},
      };
    },
    enabled: Boolean(name),
    staleTime: STALE.employees,
    ...options,
  });
}

export function useOrgExplorerTeamsQuery(params = {}, options = {}) {
  const includeInactive = Boolean(params.includeInactive);
  return useQuery({
    queryKey: qk.orgExplorerTeams({ includeInactive }),
    queryFn: async () => {
      const query = includeInactive ? { includeInactive: "true" } : undefined;
      const res = await api.get("/employees/organization-explorer/teams", { params: query });
      return {
        teams: Array.isArray(res.data?.teams) ? res.data.teams : [],
        meta: res.data?.meta || {},
      };
    },
    staleTime: STALE.employees,
    ...options,
  });
}

export function useOrgExplorerTeamQuery(teamId, options = {}) {
  const id = teamId ? String(teamId) : "";
  return useQuery({
    queryKey: qk.orgExplorerTeam(id),
    queryFn: async () => {
      const res = await api.get(`/employees/organization-explorer/teams/${encodeURIComponent(id)}`);
      return {
        team: res.data?.team || null,
      };
    },
    enabled: Boolean(id),
    staleTime: STALE.employees,
    ...options,
  });
}
