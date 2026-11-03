import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../services/api";
import { STALE } from "../app/queryClient";
import { invalidateLeaveIntelligence, qk } from "../app/queryKeys";

export function useLeaveImpactQuery(leaveRequestId, options = {}) {
  return useQuery({
    queryKey: qk.leaveImpact(leaveRequestId),
    queryFn: async () => {
      const res = await api.get(`/leave-requests/${leaveRequestId}/impact`);
      if (res.data?.success === false) {
        throw new Error(res.data?.message || "Work impact could not be loaded.");
      }
      return res.data?.impact ?? null;
    },
    enabled: Boolean(leaveRequestId),
    staleTime: STALE.leave,
    ...options,
  });
}

export function useLeaveBackupQuery(leaveRequestId, options = {}) {
  return useQuery({
    queryKey: qk.leaveBackup(leaveRequestId),
    queryFn: async () => {
      const res = await api.get(`/leave-requests/${leaveRequestId}/backup-recommendations`);
      if (res.data?.success === false) {
        throw new Error(res.data?.message || "Backup recommendations could not be loaded.");
      }
      return res.data;
    },
    enabled: Boolean(leaveRequestId),
    staleTime: STALE.leave,
    ...options,
  });
}

export function useLeaveHandoverQuery(leaveRequestId, options = {}) {
  return useQuery({
    queryKey: qk.leaveHandover(leaveRequestId),
    queryFn: async () => {
      try {
        const res = await api.get(`/handovers/leave/${leaveRequestId}`);
        return res.data?.handover || null;
      } catch (err) {
        if (err.response?.status === 404) return null;
        throw err;
      }
    },
    enabled: Boolean(leaveRequestId),
    staleTime: STALE.leave,
    ...options,
  });
}

export function useLeaveRequestDetailQuery(leaveRequestId, options = {}) {
  return useQuery({
    queryKey: qk.leaveRequestDetail(leaveRequestId),
    queryFn: async () => {
      const res = await api.get(`/leave-requests/${leaveRequestId}`);
      return res.data;
    },
    enabled: Boolean(leaveRequestId),
    staleTime: STALE.leave,
    ...options,
  });
}

export function useProposeBackupMutation(leaveRequestId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ taskId, backupEmployeeId, explanationSnapshot }) => {
      const res = await api.put(`/leave-requests/${leaveRequestId}/backup-proposals`, {
        taskId,
        backupEmployeeId,
        explanationSnapshot,
      });
      return res.data;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.leaveBackup(leaveRequestId) }),
        queryClient.invalidateQueries({ queryKey: qk.leaveHandover(leaveRequestId) }),
        queryClient.invalidateQueries({ queryKey: qk.leaveRequestDetail(leaveRequestId) }),
      ]);
    },
  });
}

export function useClearBackupMutation(leaveRequestId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ taskId }) => {
      const res = await api.put(`/leave-requests/${leaveRequestId}/backup-proposals`, {
        taskId,
        backupEmployeeId: null,
      });
      return res.data;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.leaveBackup(leaveRequestId) }),
        queryClient.invalidateQueries({ queryKey: qk.leaveHandover(leaveRequestId) }),
        queryClient.invalidateQueries({ queryKey: qk.leaveRequestDetail(leaveRequestId) }),
      ]);
    },
  });
}

export function useHandoverActions(leaveRequestId) {
  const queryClient = useQueryClient();

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: qk.leaveHandover(leaveRequestId) });

  const createDraft = useMutation({
    mutationFn: async () => {
      const res = await api.post(`/handovers/leave/${leaveRequestId}`);
      return res.data?.handover;
    },
    onSuccess: invalidate,
  });

  const saveItem = useMutation({
    mutationFn: async ({ handoverId, itemId, instructions, backupEmployeeId }) => {
      const res = await api.put(`/handovers/${handoverId}`, {
        items: [{ itemId, instructions, backupEmployeeId }],
      });
      return res.data?.handover;
    },
    onSuccess: invalidate,
  });

  const reassignBackup = useMutation({
    mutationFn: async ({ handoverId, itemId, backupEmployeeId }) => {
      const res = await api.post(`/handovers/${handoverId}/items/${itemId}/reassign`, {
        backupEmployeeId,
      });
      return res.data?.handover;
    },
    onSuccess: invalidate,
  });

  const submit = useMutation({
    mutationFn: async (handoverId) => {
      const res = await api.post(`/handovers/${handoverId}/submit`);
      return res.data?.handover;
    },
    onSuccess: invalidate,
  });

  const coordinate = useMutation({
    mutationFn: async ({ handoverId, notes }) => {
      const res = await api.post(`/handovers/${handoverId}/coordinate`, { notes });
      return res.data?.handover;
    },
    onSuccess: invalidate,
  });

  const revise = useMutation({
    mutationFn: async ({ handoverId, reason }) => {
      const res = await api.post(`/handovers/${handoverId}/decide`, {
        decision: "REVISE",
        reason,
      });
      return res.data?.handover;
    },
    onSuccess: invalidate,
  });

  return { createDraft, saveItem, reassignBackup, submit, coordinate, revise };
}

export async function invalidateAfterLeaveDecision(queryClient) {
  return invalidateLeaveIntelligence(queryClient);
}
