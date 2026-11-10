import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MessageSquarePlus, Search, X } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ProfileAvatar from "../../components/ProfileAvatar";
import { ErrorState, Skeleton } from "../../components/EmptyState";
import Modal from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { useAuth } from "../../app/AuthContext";
import { chatKeys, useConversationsQuery, refreshChat } from "../../hooks/useChatQueries";
import api from "../../services/api";
import "./messages.css";

function conversationTitle(item) {
  if (!item) return "Conversation";
  if (item.type === "GROUP") return item.name || "Group";
  return item.peer?.displayName || "Colleague";
}

function formatListTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diff = Math.round((startToday - startDate) / 86400000);
  if (diff === 0) {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  if (diff === 1) return "Yesterday";
  if (diff < 7) return date.toLocaleDateString([], { weekday: "short" });
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function useDebouncedValue(value, delayMs = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

function DirectoryPicker({ open, onClose, onPick, selfId }) {
  const [query, setQuery] = useState("");
  const [picking, setPicking] = useState(false);
  const toast = useToast();
  const debouncedQuery = useDebouncedValue(query, 300);
  const search = debouncedQuery.trim();

  useEffect(() => {
    if (!open) {
      setQuery("");
      setPicking(false);
    }
  }, [open]);

  const directoryQuery = useQuery({
    queryKey: chatKeys.directory(search),
    enabled: open,
    queryFn: async () => {
      const res = await api.get("/conversations/directory", { params: { search } });
      return res.data?.people || res.data?.results || [];
    },
    staleTime: 10_000,
  });

  const people = useMemo(() => {
    const rows = directoryQuery.data || [];
    const seen = new Set();
    return rows.filter((person) => {
      const id = String(person.userId || person.id || "");
      if (!id || (selfId && id === String(selfId))) return false;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }, [directoryQuery.data, selfId]);

  const pick = async (person) => {
    if (picking) return;
    setPicking(true);
    try {
      await onPick(person);
      onClose();
      setQuery("");
    } catch (err) {
      toast.push(err.response?.data?.message || "Could not start conversation.");
      setPicking(false);
    }
  };

  const showEmpty =
    open &&
    !directoryQuery.isLoading &&
    !directoryQuery.isFetching &&
    !directoryQuery.isError &&
    people.length === 0;

  return (
    <Modal open={open} onClose={onClose} title="New chat" size="md">
      <div className="stack" style={{ gap: 10 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search employees by name or email"
          aria-label="Search employees"
          autoFocus
          style={{
            width: "100%",
            height: 42,
            borderRadius: 12,
            border: "1px solid var(--hair)",
            padding: "0 12px",
            font: "inherit",
          }}
        />
        {directoryQuery.isFetching ? <p className="caption">Searching…</p> : null}
        {directoryQuery.isError ? (
          <p className="caption" style={{ color: "var(--rose)" }}>
            {directoryQuery.error?.response?.data?.message || "Directory search failed."}
          </p>
        ) : null}
        {showEmpty ? (
          <p className="caption">
            {search ? "No matching colleagues." : "Type a name or email to find colleagues."}
          </p>
        ) : null}
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {people.map((person) => (
            <li key={person.userId || person.id}>
              <button
                type="button"
                className="msg-row"
                style={{ paddingLeft: 0, paddingRight: 0, border: 0 }}
                disabled={picking}
                onClick={() => pick(person)}
              >
                <ProfileAvatar name={person.displayName || person.fullName || person.email} size={40} />
                <span className="msg-row-body">
                  <span className="msg-row-name">{person.displayName || person.fullName || person.email}</span>
                  <span className="caption">{person.jobTitle || person.email || ""}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}

/**
 * Shared chat landing list for Employee and HR portals.
 * @param {{ basePath: string }} props basePath e.g. /app/messages or /admin/messages
 */
export default function MessagesListPage({ basePath }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const conversationsQuery = useConversationsQuery();
  const [searchOpen, setSearchOpen] = useState(false);
  const [listQuery, setListQuery] = useState("");
  const [directoryOpen, setDirectoryOpen] = useState(false);

  const conversations = conversationsQuery.data || [];
  const filtered = useMemo(() => {
    const q = listQuery.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((item) => {
      const label = conversationTitle(item);
      return `${label} ${item.preview || ""}`.toLowerCase().includes(q);
    });
  }, [conversations, listQuery]);

  const startChat = async (person) => {
    const participantUserId = person.userId || person.id;
    if (!participantUserId) throw new Error("Missing colleague");
    const res = await api.post("/conversations", { participantUserId });
    const id = res.data?.conversation?.id;
    if (!id) throw new Error("Missing conversation");
    await refreshChat(queryClient, id);
    navigate(`${basePath}/${id}`);
  };

  return (
    <div className="msg-list-page">
      <div className="msg-list-header">
        <h1>Messages</h1>
        <button
          type="button"
          className="icon-btn"
          aria-label={searchOpen ? "Close search" : "Search conversations"}
          onClick={() => {
            setSearchOpen((v) => !v);
            if (searchOpen) setListQuery("");
          }}
        >
          {searchOpen ? <X size={20} /> : <Search size={20} />}
        </button>
      </div>

      {searchOpen ? (
        <div className="msg-search-bar">
          <input
            value={listQuery}
            onChange={(e) => setListQuery(e.target.value)}
            placeholder="Search conversations"
            aria-label="Search conversations"
            autoFocus
          />
        </div>
      ) : null}

      {conversationsQuery.isLoading ? <Skeleton /> : null}
      {conversationsQuery.isError ? (
        <ErrorState
          message={conversationsQuery.error?.response?.data?.message || "Conversations could not be loaded."}
          onRetry={() => conversationsQuery.refetch()}
        />
      ) : null}

      {!conversationsQuery.isLoading && !conversationsQuery.isError && filtered.length === 0 ? (
        <div className="msg-state">
          <p style={{ margin: "0 0 8px", fontWeight: 650, color: "var(--ink)" }}>
            {conversations.length === 0 ? "No conversations yet" : "No matches"}
          </p>
          <p className="caption" style={{ margin: 0 }}>
            {conversations.length === 0
              ? "Tap + to message a colleague. Chats sync with desktop."
              : "Try a different search."}
          </p>
        </div>
      ) : null}

      {filtered.map((item) => {
        const title = conversationTitle(item);
        const mine = item.lastSenderUserId && String(item.lastSenderUserId) === String(user?._id || user?.id);
        return (
          <button
            key={item.id}
            type="button"
            className="msg-row"
            onClick={() => navigate(`${basePath}/${item.id}`)}
          >
            <ProfileAvatar name={title} size={48} />
            <span className="msg-row-body">
              <span className="msg-row-top">
                <span className="msg-row-name">{title}</span>
                <span className="msg-row-time">{formatListTime(item.lastMessageAt)}</span>
              </span>
              <span className="msg-row-preview">
                <span>
                  {mine ? "You: " : ""}
                  {item.preview || "No messages yet"}
                </span>
                {item.unreadCount > 0 ? (
                  <span className="msg-unread">{item.unreadCount > 99 ? "99+" : item.unreadCount}</span>
                ) : null}
              </span>
            </span>
          </button>
        );
      })}

      <button
        type="button"
        className="msg-fab"
        aria-label="New conversation"
        onClick={() => setDirectoryOpen(true)}
      >
        <MessageSquarePlus size={24} />
      </button>

      <DirectoryPicker
        open={directoryOpen}
        onClose={() => setDirectoryOpen(false)}
        onPick={startChat}
        selfId={user?._id || user?.id}
      />
    </div>
  );
}
