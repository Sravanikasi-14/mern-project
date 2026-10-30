import { QueryClient } from "@tanstack/react-query";

/** Domain-specific stale times for desktop HR + employee portals. */
export const STALE = {
  dashboard: 30_000,
  adminDashboard: 45_000,
  employees: 45_000,
  employeeDetail: 60_000,
  tasks: 30_000,
  taskDetail: 20_000,
  attendance: 45_000,
  leave: 30_000,
  impact: 60_000,
  profile: 120_000,
  payslips: 300_000,
  assets: 120_000,
  notifications: 30_000,
  meta: 120_000,
  policies: 180_000,
  payroll: 60_000,
  settings: 120_000,
};

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      retry: 1,
    },
  },
});

/** Wipe all cached server state on logout / account switch / hard 401. */
export function clearUserQueries() {
  queryClient.clear();
}
