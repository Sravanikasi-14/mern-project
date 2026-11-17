import { useQuery } from "@tanstack/react-query";
import api from "../services/api";
import { qk } from "../lib/queryKeys";
import {
  CHAT_ACTIVE_THREAD_POLL_MS,
  CHAT_LIST_POLL_MS,
  CHAT_UNREAD_POLL_MS,
  chatPollIntervalMs,
} from "../lib/chatPollInterval";

/** NEW-B04 — default page size for conversation list polls (server also soft-caps). */
const CONVERSATION_LIST_LIMIT = 50;

export function useConversationsQuery(options = {}) {
  return useQuery({
    queryKey: qk.chatConversations(),
    queryFn: async () => {
      const res = await api.get("/conversations", {
        params: { limit: CONVERSATION_LIST_LIMIT, offset: 0 },
      });
      return res.data?.conversations || [];
    },
    refetchInterval: (query) => chatPollIntervalMs(CHAT_LIST_POLL_MS, query),
    refetchIntervalInBackground: false,
    staleTime: 10_000,
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
      ? (query) => chatPollIntervalMs(CHAT_ACTIVE_THREAD_POLL_MS, query)
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
      enabled && conversationId
        ? (query) => chatPollIntervalMs(CHAT_LIST_POLL_MS, query)
        : false,
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
    refetchInterval: (query) => chatPollIntervalMs(CHAT_UNREAD_POLL_MS, query),
    refetchIntervalInBackground: false,
    staleTime: 15_000,
    ...options,
  });
}
