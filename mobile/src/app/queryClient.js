import { QueryClient } from "@tanstack/react-query";

export const STALE = {
  dashboard: 30_000,
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

export function clearUserQueries() {
  queryClient.clear();
}
