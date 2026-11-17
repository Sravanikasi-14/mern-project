import { useQuery } from "@tanstack/react-query";
import api from "../services/api";
import {
  CHAT_ACTIVE_THREAD_POLL_MS,
  CHAT_LIST_POLL_MS,
  CHAT_UNREAD_POLL_MS,
  chatPollIntervalMs,
} from "../lib/chatPollInterval";

export const chatKeys = {
  conversations: () => ["chat", "conversations"],
  messages: (id) => ["chat", "messages", id],
  members: (id) => ["chat", "members", id],
  unread: () => ["chat", "unread"],
  directory: (search) => ["chat", "directory", search],
};

const CONVERSATION_LIST_LIMIT = 50;

export function useConversationsQuery(options = {}) {
  return useQuery({
    queryKey: chatKeys.conversations(),
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
    queryKey: chatKeys.messages(conversationId),
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

export function useChatUnreadQuery(options = {}) {
  return useQuery({
    queryKey: chatKeys.unread(),
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

export async function refreshChat(queryClient, conversationId) {
  const jobs = [
    queryClient.invalidateQueries({ queryKey: chatKeys.conversations() }),
    queryClient.invalidateQueries({ queryKey: chatKeys.unread() }),
  ];
  if (conversationId) {
    jobs.push(queryClient.invalidateQueries({ queryKey: chatKeys.messages(conversationId) }));
    jobs.push(queryClient.invalidateQueries({ queryKey: chatKeys.members(conversationId) }));
  }
  await Promise.all(jobs);
}
