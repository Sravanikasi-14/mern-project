import { useQuery } from "@tanstack/react-query";
import api from "../services/api";

export const chatKeys = {
  conversations: () => ["chat", "conversations"],
  messages: (id) => ["chat", "messages", id],
  members: (id) => ["chat", "members", id],
  unread: () => ["chat", "unread"],
  directory: (search) => ["chat", "directory", search],
};

export function useConversationsQuery(options = {}) {
  return useQuery({
    queryKey: chatKeys.conversations(),
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
    refetchInterval: conversationId ? 10_000 : false,
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
    refetchInterval: 30_000,
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
