import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Megaphone, MessageSquarePlus, Search, X } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ProfileAvatar from "../../components/ProfileAvatar";
import { ErrorState, Skeleton } from "../../components/EmptyState";
import Modal from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { useAuth } from "../../app/AuthContext";
import { chatKeys, useConversationsQuery, refreshChat } from "../../hooks/useChatQueries";
import api from "../../services/api";
import {
  PRIORITY_LABEL,
  announcementTiming,
  audienceLabelFor,
  timingPrefix,
} from "../../utils/announcementDisplay";
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
 * Supports ?view=announcements&a=<announcementId> deep links from notifications.
 * @param {{ basePath: string }} props basePath e.g. /app/messages or /admin/messages
 */
export default function MessagesListPage({ basePath }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const conversationsQuery = useConversationsQuery();
  const [searchOpen, setSearchOpen] = useState(false);
  const [listQuery, setListQuery] = useState("");
  const [directoryOpen, setDirectoryOpen] = useState(false);

  const view = (searchParams.get("view") || "").toLowerCase();
  const showAnnouncements = view === "announcements";
  const selectedAnnouncementId = (searchParams.get("a") || "").trim();

  const announcementsQuery = useQuery({
    queryKey: ["announcements", "mobile-list"],
    enabled: showAnnouncements,
    queryFn: async () => {
      const res = await api.get("/announcements", { params: { limit: 40 } });
      return res.data?.announcements || [];
    },
    staleTime: 15_000,
  });

  const announcementDetailQuery = useQuery({
    queryKey: ["announcements", "mobile-detail", selectedAnnouncementId],
    enabled: showAnnouncements && Boolean(selectedAnnouncementId),
    queryFn: async () => {
      const res = await api.get(`/announcements/${selectedAnnouncementId}`);
      return res.data?.announcement || null;
    },
    retry: false,
  });

  useEffect(() => {
    if (!showAnnouncements || !selectedAnnouncementId) return undefined;
    const detail = announcementDetailQuery.data;
    if (!detail || detail.status !== "PUBLISHED") return undefined;
    let cancelled = false;
    api.post(`/announcements/${selectedAnnouncementId}/read`).then(() => {
      if (cancelled) return;
      queryClient.invalidateQueries({ queryKey: ["announcements"] });
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [showAnnouncements, selectedAnnouncementId, announcementDetailQuery.data, queryClient]);

  const conversations = conversationsQuery.data || [];
  const announcements = announcementsQuery.data || [];
  const filtered = useMemo(() => {
    const q = listQuery.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((item) => {
      const label = conversationTitle(item);
      return `${label} ${item.preview || ""}`.toLowerCase().includes(q);
    });
  }, [conversations, listQuery]);

  const setChannel = (nextView) => {
    const next = new URLSearchParams(searchParams);
    if (nextView === "announcements") {
      next.set("view", "announcements");
    } else {
      next.delete("view");
      next.delete("a");
    }
    setSearchParams(next, { replace: true });
  };

  const openAnnouncement = (id) => {
    const next = new URLSearchParams(searchParams);
    next.set("view", "announcements");
    if (id) next.set("a", id);
    else next.delete("a");
    setSearchParams(next, { replace: true });
  };

  const startChat = async (person) => {
    const participantUserId = person.userId || person.id;
    if (!participantUserId) throw new Error("Missing colleague");
    const res = await api.post("/conversations", { participantUserId });
    const id = res.data?.conversation?.id;
    if (!id) throw new Error("Missing conversation");
    await refreshChat(queryClient, id);
    navigate(`${basePath}/${id}`);
  };

  const detail = announcementDetailQuery.data;
  const detailTiming = announcementTiming(detail);
  const detailError =
    announcementDetailQuery.isError
      ? announcementDetailQuery.error?.response?.data?.message ||
        "This announcement could not be opened."
      : "";

  return (
    <div className="msg-list-page">
      <div className="msg-list-header">
        <h1>{showAnnouncements ? "Announcements" : "Messages"}</h1>
        {!showAnnouncements ? (
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
        ) : null}
      </div>

      <div className="msg-channel-tabs" role="tablist" aria-label="Message views">
        <button
          type="button"
          role="tab"
          aria-selected={!showAnnouncements}
          className={!showAnnouncements ? "is-active" : ""}
          onClick={() => setChannel("messages")}
        >
          Chats
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={showAnnouncements}
          className={showAnnouncements ? "is-active" : ""}
          onClick={() => setChannel("announcements")}
        >
          <Megaphone size={14} aria-hidden="true" />
          Announcements
        </button>
      </div>

      {showAnnouncements ? (
        <>
          {announcementsQuery.isLoading ? <Skeleton /> : null}
          {announcementsQuery.isError ? (
            <ErrorState
              message={
                announcementsQuery.error?.response?.data?.message ||
                "Announcements could not be loaded."
              }
              onRetry={() => announcementsQuery.refetch()}
            />
          ) : null}
          {!announcementsQuery.isLoading && !announcementsQuery.isError && announcements.length === 0 ? (
            <div className="msg-state">
              <p style={{ margin: "0 0 8px", fontWeight: 650, color: "var(--ink)" }}>
                No announcements yet
              </p>
              <p className="caption" style={{ margin: 0 }}>
                Company updates will appear here when published.
              </p>
            </div>
          ) : null}
          {announcements.map((item) => {
            const timing = announcementTiming(item);
            return (
              <button
                key={item.id}
                type="button"
                className={`msg-row${item.isRead === false ? " is-unread" : ""}`}
                onClick={() => openAnnouncement(item.id)}
              >
                <span className="msg-row-body">
                  <span className="msg-row-top">
                    <span className="msg-row-name">{item.title}</span>
                    <span className="msg-row-time">{timing.label}</span>
                  </span>
                  <span className="msg-row-preview">
                    <span>{item.preview || audienceLabelFor(item)}</span>
                    {item.status === "PUBLISHED" && item.isRead === false ? (
                      <span className="msg-unread">New</span>
                    ) : null}
                  </span>
                </span>
              </button>
            );
          })}

          <Modal
            open={Boolean(selectedAnnouncementId)}
            onClose={() => openAnnouncement("")}
            title={detail?.title || "Announcement"}
          >
            {announcementDetailQuery.isLoading ? <Skeleton /> : null}
            {detailError ? <ErrorState message={detailError} /> : null}
            {detail && !announcementDetailQuery.isLoading ? (
              <div className="stack" style={{ gap: 12 }}>
                <div className="caption">
                  {PRIORITY_LABEL[detail.priority] || "Normal"}
                  {" · "}
                  {audienceLabelFor(detail)}
                  {detailTiming.label
                    ? ` · ${timingPrefix(detailTiming.kind)} ${detailTiming.label}`
                    : ""}
                </div>
                {detail.publishedByName ? (
                  <p className="caption" style={{ margin: 0 }}>
                    By {detail.publishedByName}
                  </p>
                ) : null}
                <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                  {detail.body || "This announcement has no body text."}
                </div>
              </div>
            ) : null}
          </Modal>
        </>
      ) : (
        <>
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
        </>
      )}
    </div>
  );
}
