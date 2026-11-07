import { useQuery } from "@tanstack/react-query";
import api from "../services/api";
import { qk } from "../lib/queryKeys";

export function useConversationsQuery(options = {}) {
  return useQuery({
    queryKey: qk.chatConversations(),
    queryFn: async () => {
      const res = await api.get("/conversations");
      return res.data?.conversations || [];
    },
    refetchInterval: 10_000,
    staleTime: 5_000,
    ...options,
  });
}

export function useChatMessagesQuery(conversationId, options = {}) {
  return useQuery({
    queryKey: qk.chatMessages(conversationId),
    enabled: Boolean(conversationId),
    queryFn: async () => {
      const res = await api.get(`/conversations/${conversationId}/messages`);
      return {
        messages: res.data?.messages || [],
        hasMore: Boolean(res.data?.hasMore),
        nextBefore: res.data?.nextBefore || null,
      };
    },
    refetchInterval: conversationId ? 10_000 : false,
    staleTime: 3_000,
    ...options,
  });
}

export function useGroupMembersQuery(conversationId, enabled = false) {
  return useQuery({
    queryKey: qk.chatMembers(conversationId),
    enabled: Boolean(conversationId) && enabled,
    queryFn: async () => {
      const res = await api.get(`/conversations/${conversationId}/members`);
      return res.data?.members || [];
    },
    refetchInterval: enabled && conversationId ? 10_000 : false,
    staleTime: 5_000,
  });
}

export function useChatUnreadQuery(options = {}) {
  return useQuery({
    queryKey: qk.chatUnread(),
    queryFn: async () => {
      const res = await api.get("/conversations/unread-count");
      return Number(res.data?.unreadCount || 0);
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
    ...options,
  });
}
