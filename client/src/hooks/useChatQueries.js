import { useQuery } from "@tanstack/react-query";
import api from "../services/api";
import { qk } from "../lib/queryKeys";
import { chatPollIntervalMs } from "../lib/chatPollInterval";

export function useConversationsQuery(options = {}) {
  return useQuery({
    queryKey: qk.chatConversations(),
    queryFn: async () => {
      const res = await api.get("/conversations");
      return res.data?.conversations || [];
    },
    refetchInterval: (query) => chatPollIntervalMs(10_000, query),
    refetchIntervalInBackground: false,
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
    refetchInterval: conversationId
      ? (query) => chatPollIntervalMs(10_000, query)
      : false,
    refetchIntervalInBackground: false,
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
    refetchInterval:
      enabled && conversationId ? (query) => chatPollIntervalMs(10_000, query) : false,
    refetchIntervalInBackground: false,
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
    refetchInterval: (query) => chatPollIntervalMs(30_000, query),
    refetchIntervalInBackground: false,
    staleTime: 15_000,
    ...options,
  });
}
