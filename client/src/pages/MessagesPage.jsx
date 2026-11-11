import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ImagePlus, Info, Megaphone, MessageSquarePlus, MoreHorizontal, Paperclip, Search, Send, Users, X } from "lucide-react";
import AnnouncementsPane from "../components/chat/AnnouncementsPane";
import MessageSearch from "../components/chat/MessageSearch";
import MessageAttachments, { formatAttachmentSize } from "../components/chat/MessageAttachments";
import AppHeader from "../components/AppHeader";
import AppModal from "../components/AppModal";
import { useAuth } from "../context/AuthContext";
import { useChatMessagesQuery, useConversationsQuery, useGroupMembersQuery } from "../hooks/useChatQueries";
import { qk } from "../lib/queryKeys";
import api from "../services/api";
import AuthedAvatar from "../components/AuthedAvatar";
import { initialsFromName } from "../utils/employeeAvatar";
import "./Messages.css";

function initials(name) {
  return initialsFromName(name, "?");
}

function PersonAvatar({ person, name }) {
  const label = name || person?.displayName || "Colleague";
  return (
    <AuthedAvatar
      className="msg-avatar"
      employee={
        person
          ? {
              _id: person.employeeId || person._id,
              avatar: person.avatar,
            }
          : undefined
      }
      avatar={person?.avatar}
      name={label}
      initials={initials(label)}
      alt={label}
    />
  );
}

function formatTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatDay(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date();
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diff = Math.round((startToday - startDate) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function apiMessage(error, fallback) {
  return error?.response?.data?.message || fallback;
}

const ATTACHMENT_ACCEPT = ".png,.jpg,.jpeg,.webp,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt";
const ATTACHMENT_EXTENSIONS = new Set(ATTACHMENT_ACCEPT.split(",").map((ext) => ext.slice(1)));
const ATTACHMENT_MAX_BYTES = 3 * 1024 * 1024;
const ATTACHMENT_MAX_COUNT = 5;

function attachmentExtension(name) {
  const match = String(name || "").toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : "";
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("The file could not be read."));
    reader.readAsDataURL(file);
  });
}

function conversationTitle(item) {
  if (!item) return "Conversation";
  if (item.type === "GROUP") return item.name || "Group";
  return item.peer?.displayName || "Colleague";
}

async function refreshChat(queryClient, conversationId) {
  const jobs = [
    queryClient.invalidateQueries({ queryKey: qk.chatConversations() }),
    queryClient.invalidateQueries({ queryKey: qk.chatUnread() }),
    queryClient.invalidateQueries({ queryKey: qk.notifications() }),
  ];
  if (conversationId) {
    jobs.push(queryClient.invalidateQueries({ queryKey: qk.chatMessages(conversationId) }));
    jobs.push(queryClient.invalidateQueries({ queryKey: qk.chatMembers(conversationId) }));
  }
  await Promise.all(jobs);
}

export default function MessagesPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("c") || "";
  const view = params.get("view") || "all";
  const channel = ["direct", "groups", "announcements", "search"].includes(view) ? view : "all";
  const focusMessageId = params.get("m") || "";
  const [listQuery, setListQuery] = useState("");
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [directoryQuery, setDirectoryQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState([]);
  const [replyTo, setReplyTo] = useState(null);
  const [editing, setEditing] = useState(null);
  const [menuId, setMenuId] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [focusId, setFocusId] = useState("");
  const [sending, setSending] = useState(false);
  const [opening, setOpening] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [opened, setOpened] = useState(null);
  const [error, setError] = useState("");
  const [older, setOlder] = useState([]);
  const [contextWindow, setContextWindow] = useState(null);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const threadRef = useRef(null);
  const filesRef = useRef([]);
  const conversationRef = useRef(selectedId);
  const narrow = useNarrow();
  filesRef.current = files;

  const conversationsQuery = useConversationsQuery();
  const messagesQuery = useChatMessagesQuery(selectedId);
  const conversations = conversationsQuery.data || [];
  const selected = conversations.find((item) => item.id === selectedId) || (opened?.id === selectedId ? opened : null);

  const filtered = useMemo(() => {
    const scoped = conversations.filter((item) => {
      if (channel === "direct") return item.type !== "GROUP";
      if (channel === "groups") return item.type === "GROUP";
      return true;
    });
    const q = listQuery.trim().toLowerCase();
    if (!q) return scoped;
    return scoped.filter((item) => {
      const label = item.type === "GROUP" ? item.name || "" : item.peer?.displayName || "";
      return `${label} ${item.preview || ""}`.toLowerCase().includes(q);
    });
  }, [conversations, listQuery, channel]);

  function setChannel(next) {
    const nextParams = new URLSearchParams(params);
    if (next === "all") nextParams.delete("view");
    else nextParams.set("view", next);
    if (next !== "announcements") nextParams.delete("a");
    setParams(nextParams, { replace: true });
  }

  const liveMessages = messagesQuery.data?.messages || [];
  const messages = useMemo(() => {
    const seen = new Set(liveMessages.map((message) => message.id));
    return [...older.filter((message) => !seen.has(message.id)), ...liveMessages];
  }, [older, liveMessages]);
  const timeline = contextWindow?.messages || messages;
  const timelineHasOlder = contextWindow ? contextWindow.hasMoreBefore : hasOlder;

  const latestId = liveMessages.length ? liveMessages[liveMessages.length - 1].id : "";

  useEffect(() => {
    setOlder([]);
    setHasOlder(false);
    setDraft("");
    setDetailsOpen(false);
    if (selectedId) setError("");
  }, [selectedId]);

  useEffect(() => {
    if (!messagesQuery.isError || !selectedId) return;
    if (messagesQuery.error?.response?.status === 404) {
      setError("That conversation is no longer available.");
      selectConversation("");
    }
  }, [messagesQuery.isError, messagesQuery.error, selectedId]);

  useEffect(() => {
    if (!messagesQuery.data || older.length > 0) return;
    setHasOlder(Boolean(messagesQuery.data.hasMore));
  }, [messagesQuery.data, older.length]);

  useEffect(() => {
    if (!selectedId || !latestId) return undefined;
    let cancelled = false;
    api.post(`/conversations/${selectedId}/read`).then(() => {
      if (cancelled) return;
      queryClient.invalidateQueries({ queryKey: qk.chatUnread() });
      queryClient.invalidateQueries({ queryKey: qk.chatConversations() });
      queryClient.invalidateQueries({ queryKey: qk.notifications() });
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selectedId, latestId, queryClient]);

  useEffect(() => {
    const node = threadRef.current;
    if (!node || loadingOlder || focusId || contextWindow) return;
    node.scrollTop = node.scrollHeight;
  }, [selectedId, latestId, loadingOlder, focusId, contextWindow]);

  useEffect(() => {
    if (!focusId) return undefined;
    const node = document.getElementById(`msg-${focusId}`);
    if (!node) return undefined;
    node.scrollIntoView({ block: "center" });
    node.classList.add("is-target");
    const timer = window.setTimeout(() => node.classList.remove("is-target"), 1600);
    setFocusId("");
    return () => window.clearTimeout(timer);
  }, [focusId, messages]);

  useEffect(() => {
    if (!menuId) return undefined;
    const close = () => setMenuId("");
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [menuId]);

  useEffect(() => {
    const previousConversation = conversationRef.current;
    const previousFiles = filesRef.current;
    conversationRef.current = selectedId;
    if (!previousConversation || previousConversation === selectedId) return undefined;
    setFiles([]);
    setReplyTo(null);
    setEditing(null);
    setMenuId("");
    setDeleteTarget(null);
    for (const file of previousFiles) {
      if (!file.attachmentId) continue;
      api.delete(`/conversations/${previousConversation}/attachments/${file.attachmentId}`).catch(() => {});
    }
    return undefined;
  }, [selectedId]);

  function selectConversation(id) {
    const next = new URLSearchParams(params);
    if (id) next.set("c", id);
    else next.delete("c");
    next.delete("m");
    setParams(next, { replace: true });
  }

  function openSearchResult(result) {
    const next = new URLSearchParams(params);
    next.set("view", "search");
    next.set("c", result.conversationId);
    next.set("m", result.id);
    setParams(next, { replace: true });
  }

  function showLatest() {
    setContextWindow(null);
    const next = new URLSearchParams(params);
    next.delete("m");
    setParams(next, { replace: true });
  }

  useEffect(() => {
    if (!selectedId || !focusMessageId) {
      setContextWindow(null);
      return undefined;
    }
    let cancelled = false;
    api.get(`/conversations/${selectedId}/messages/around/${focusMessageId}`).then((res) => {
      if (cancelled) return;
      setContextWindow({
        messages: res.data?.messages || [],
        hasMoreBefore: Boolean(res.data?.hasMoreBefore),
        hasMoreAfter: Boolean(res.data?.hasMoreAfter),
      });
      setFocusId(focusMessageId);
    }).catch((err) => {
      if (cancelled) return;
      setContextWindow(null);
      setError(apiMessage(err, "That message is no longer available."));
      setParams((current) => {
        const next = new URLSearchParams(current);
        if (next.get("m") !== focusMessageId) return current;
        next.delete("m");
        return next;
      }, { replace: true });
    });
    return () => {
      cancelled = true;
    };
  }, [selectedId, focusMessageId, setParams]);

  async function loadOlder() {
    if (contextWindow) {
      const cursor = contextWindow.messages[0]?.id;
      if (!selectedId || !cursor || loadingOlder) return;
      setLoadingOlder(true);
      try {
        const res = await api.get(`/conversations/${selectedId}/messages`, { params: { before: cursor } });
        const page = res.data?.messages || [];
        setContextWindow((current) => {
          if (!current) return current;
          const seen = new Set(current.messages.map((message) => message.id));
          return {
            ...current,
            hasMoreBefore: Boolean(res.data?.hasMore),
            messages: [...page.filter((message) => !seen.has(message.id)), ...current.messages],
          };
        });
      } catch (err) {
        setError(apiMessage(err, "Earlier messages could not be loaded."));
      } finally {
        setLoadingOlder(false);
      }
      return;
    }
    const cursor = messages[0]?.id;
    if (!selectedId || !cursor || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const res = await api.get(`/conversations/${selectedId}/messages`, { params: { before: cursor } });
      const page = res.data?.messages || [];
      setHasOlder(Boolean(res.data?.hasMore));
      setOlder((current) => {
        const seen = new Set(current.map((message) => message.id));
        return [...page.filter((message) => !seen.has(message.id)), ...current];
      });
    } catch (err) {
      setError(apiMessage(err, "Earlier messages could not be loaded."));
    } finally {
      setLoadingOlder(false);
    }
  }

  async function loadNewer() {
    const cursor = contextWindow?.messages?.at(-1)?.id;
    if (!contextWindow || !selectedId || !cursor || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const res = await api.get(`/conversations/${selectedId}/messages`, { params: { after: cursor } });
      const page = res.data?.messages || [];
      setContextWindow((current) => {
        if (!current) return current;
        const seen = new Set(current.messages.map((message) => message.id));
        return {
          ...current,
          hasMoreAfter: Boolean(res.data?.hasMore),
          messages: [...current.messages, ...page.filter((message) => !seen.has(message.id))],
        };
      });
    } catch (err) {
      setError(apiMessage(err, "Newer messages could not be loaded."));
    } finally {
      setLoadingOlder(false);
    }
  }

  async function uploadOne(localId, file, conversationId) {
    setFiles((current) => current.map((item) => (
      item.localId === localId ? { ...item, status: "uploading", progress: 0, error: "" } : item
    )));
    try {
      const fileData = await readFileAsDataUrl(file);
      const response = await api.post(`/conversations/${conversationId}/attachments`, {
        fileName: file.name,
        fileData,
        mimeType: file.type,
      }, {
        onUploadProgress: (event) => {
          if (!event.total) return;
          const progress = Math.min(100, Math.round((event.loaded / event.total) * 100));
          setFiles((current) => current.map((item) => (
            item.localId === localId ? { ...item, progress } : item
          )));
        },
      });
      const uploaded = response.data?.file;
      setFiles((current) => current.map((item) => (
        item.localId === localId
          ? { ...item, status: "uploaded", progress: 100, attachmentId: uploaded?.id, error: "" }
          : item
      )));
    } catch (err) {
      setFiles((current) => current.map((item) => (
        item.localId === localId
          ? { ...item, status: "error", error: apiMessage(err, "The file could not be uploaded.") }
          : item
      )));
    }
  }

  async function addFiles(list) {
    const picked = Array.from(list || []);
    if (!selectedId || picked.length === 0) return;
    const room = ATTACHMENT_MAX_COUNT - files.length;
    if (room <= 0) {
      setError(`You can attach up to ${ATTACHMENT_MAX_COUNT} files.`);
      return;
    }
    const accepted = [];
    for (const file of picked.slice(0, room)) {
      if (!ATTACHMENT_EXTENSIONS.has(attachmentExtension(file.name))) {
        setError("This file type is not supported.");
        continue;
      }
      if (file.size > ATTACHMENT_MAX_BYTES) {
        setError("Each file must be 3 MB or smaller.");
        continue;
      }
      accepted.push({
        localId: `${Date.now()}-${file.name}-${Math.random().toString(16).slice(2)}`,
        file,
        name: file.name,
        size: file.size,
        preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : "",
        status: "uploading",
        progress: 0,
        error: "",
        attachmentId: "",
      });
    }
    if (picked.length > room) setError(`You can attach up to ${ATTACHMENT_MAX_COUNT} files.`);
    if (accepted.length === 0) return;
    setFiles((current) => [...current, ...accepted]);
    const conversationId = selectedId;
    for (const item of accepted) {
      uploadOne(item.localId, item.file, conversationId);
    }
  }

  async function removeFile(localId) {
    const file = files.find((item) => item.localId === localId);
    setFiles((current) => current.filter((item) => item.localId !== localId));
    if (file?.preview) URL.revokeObjectURL(file.preview);
    if (file?.attachmentId && selectedId) {
      try {
        await api.delete(`/conversations/${selectedId}/attachments/${file.attachmentId}`);
      } catch (err) {
        setError(apiMessage(err, "The file could not be removed."));
      }
    }
  }

  async function send() {
    const body = draft.trim();
    const ready = files.filter((file) => file.status === "uploaded" && file.attachmentId);
    if (!selectedId || sending) return;
    if (!body && ready.length === 0) return;
    if (files.some((file) => file.status === "uploading" || file.status === "error")) return;
    setSending(true);
    setError("");
    try {
      await api.post(`/conversations/${selectedId}/messages`, {
        body,
        attachmentIds: ready.map((file) => file.attachmentId),
        replyToMessageId: replyTo?.id || undefined,
      });
      for (const file of files) {
        if (file.preview) URL.revokeObjectURL(file.preview);
      }
      setDraft("");
      setFiles([]);
      setReplyTo(null);
      setContextWindow(null);
      if (focusMessageId) showLatest();
      await refreshChat(queryClient, selectedId);
    } catch (err) {
      setError(apiMessage(err, "The message could not be sent."));
    } finally {
      setSending(false);
    }
  }

  async function saveEdit() {
    const body = draft.trim();
    if (!selectedId || !editing || sending) return;
    if (!body && !editing.hasAttachments) return;
    setSending(true);
    setError("");
    try {
      await api.patch(`/conversations/${selectedId}/messages/${editing.id}`, { body });
      setDraft("");
      setEditing(null);
      await refreshChat(queryClient, selectedId);
    } catch (err) {
      setError(apiMessage(err, "The message could not be updated."));
    } finally {
      setSending(false);
    }
  }

  async function confirmDelete() {
    if (!selectedId || !deleteTarget || sending) return;
    setSending(true);
    setError("");
    try {
      await api.delete(`/conversations/${selectedId}/messages/${deleteTarget.id}`);
      if (editing?.id === deleteTarget.id) {
        setEditing(null);
        setDraft("");
      }
      if (replyTo?.id === deleteTarget.id) setReplyTo(null);
      setDeleteTarget(null);
      await refreshChat(queryClient, selectedId);
    } catch (err) {
      setError(apiMessage(err, "The message could not be deleted."));
    } finally {
      setSending(false);
    }
  }

  function beginReply(message) {
    const preview = message.body?.trim()
      || (message.attachments?.length === 1 ? message.attachments[0].fileName : "")
      || (message.attachments?.length > 1 ? `${message.attachments.length} attachments` : "Attachment");
    setReplyTo({
      id: message.id,
      senderName: message.senderName || (String(message.senderUserId) === String(user?.id || user?._id) ? "You" : "Message"),
      preview,
    });
    setEditing(null);
    setMenuId("");
  }

  function beginEdit(message) {
    setEditing({ id: message.id, hasAttachments: (message.attachments || []).length > 0 });
    setDraft(message.body || "");
    setReplyTo(null);
    setMenuId("");
  }

  async function openWith(person) {
    if (!person?.userId || person.userId === String(user?.id || user?._id) || opening) return;
    setOpening(true);
    setError("");
    try {
      const res = await api.post("/conversations", { participantUserId: person.userId });
      const id = res.data?.conversation?.id;
      setDirectoryOpen(false);
      setDirectoryQuery("");
      if (id) {
        await queryClient.invalidateQueries({ queryKey: qk.chatConversations() });
        selectConversation(id);
      }
    } catch (err) {
      setError(apiMessage(err, "The conversation could not be opened."));
    } finally {
      setOpening(false);
    }
  }

  const showList = !narrow || !selectedId;
  const showThread = (!narrow || Boolean(selectedId)) && !(channel === "search" && !selectedId);
  const searchOnly = channel === "search" && !selectedId;

  return (
    <main className="container-wide msg-page">
      <AppHeader title="Messages" subtitle="Talk with people in your company." />
      {error ? <p className="msg-banner" role="alert">{error}</p> : null}
      <div className="msg-channels" role="tablist" aria-label="Message views">
        {[
          ["all", "All"],
          ["direct", "Direct"],
          ["groups", "Groups"],
          ["search", "Search"],
          ["announcements", "Announcements"],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={channel === id}
            className={channel === id ? "is-active" : ""}
            onClick={() => setChannel(id)}
          >
            {id === "announcements" ? <Megaphone size={14} aria-hidden="true" /> : null}
            {id === "search" ? <Search size={14} aria-hidden="true" /> : null}
            {label}
          </button>
        ))}
      </div>
      <section className={`msg-shell${channel === "announcements" ? " is-announcements" : searchOnly ? " is-search" : showList && showThread ? "" : showList ? " is-list" : " is-thread"}`} aria-label="Messages">
        {channel === "announcements" ? <AnnouncementsPane narrow={narrow} /> : null}
        {channel === "search" && showList ? (
          <aside className="msg-list msg-search-pane" aria-label="Message search">
            <MessageSearch conversations={conversations} activeId={focusMessageId} onOpen={openSearchResult} />
          </aside>
        ) : null}
        {channel !== "announcements" && channel !== "search" && showList ? (
          <aside className="msg-list" aria-label="Conversations">
            <div className="msg-list-tools">
              <label className="msg-search">
                <Search size={15} aria-hidden="true" />
                <input
                  type="search"
                  value={listQuery}
                  onChange={(event) => setListQuery(event.target.value)}
                  placeholder="Search conversations"
                  aria-label="Search conversations"
                />
              </label>
              <div className="msg-tool-row">
                <button type="button" className="btn-primary" onClick={() => { setError(""); setDirectoryOpen(true); }}>
                  <MessageSquarePlus size={16} aria-hidden="true" />
                  New message
                </button>
                <button type="button" className="btn-secondary" onClick={() => { setError(""); setGroupOpen(true); }}>
                  <Users size={16} aria-hidden="true" />
                  New group
                </button>
              </div>
            </div>
            {conversationsQuery.isLoading ? <p className="msg-muted">Loading conversations…</p> : null}
            {conversationsQuery.isError ? (
              <p className="msg-banner" role="alert">
                {apiMessage(conversationsQuery.error, "Conversations could not be loaded.")}
              </p>
            ) : null}
            {!conversationsQuery.isLoading && filtered.length === 0 ? (
              <div className="msg-empty">
                <p>{conversations.length === 0 ? "No conversations yet." : "No conversations match this search."}</p>
              </div>
            ) : (
              <ul className="msg-people">
                {filtered.map((item) => {
                  const name = conversationTitle(item);
                  const active = item.id === selectedId;
                  const preview = item.type === "GROUP"
                    ? `${item.memberCount || 0} members${item.preview ? ` · ${item.preview}` : ""}`
                    : (item.preview || "No messages yet");
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        className={`msg-person${active ? " is-active" : ""}`}
                        onClick={() => selectConversation(item.id)}
                        aria-current={active ? "true" : undefined}
                      >
                        <ConversationAvatar
                          id={item.id}
                          name={name}
                          hasImage={item.hasImage}
                          imageVersion={item.imageVersion}
                        />
                        <span className="msg-person-body">
                          <span className="msg-person-top">
                            <strong>{name}</strong>
                            <time dateTime={item.lastMessageAt || ""}>{formatTime(item.lastMessageAt)}</time>
                          </span>
                          <span className="msg-preview">
                            {preview}
                          </span>
                        </span>
                        {item.unreadCount > 0 ? (
                          <span className="msg-unread">{item.unreadCount > 99 ? "99+" : item.unreadCount}</span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </aside>
        ) : null}

        {channel !== "announcements" && showThread ? (
          <section className="msg-thread" aria-label={conversationTitle(selected)}>
            {!selectedId ? (
              <div className="msg-empty msg-thread-empty">
                <p>Select a conversation, or start a new one.</p>
              </div>
            ) : (
              <>
                <header className="msg-thread-head">
                  {narrow ? (
                    <button type="button" className="msg-back" onClick={() => selectConversation("")} aria-label={channel === "search" ? "Back to search" : "Back to conversations"}>
                      <ArrowLeft size={18} />
                    </button>
                  ) : null}
                  <ConversationAvatar
                    id={selected?.id}
                    name={conversationTitle(selected)}
                    hasImage={selected?.hasImage}
                    imageVersion={selected?.imageVersion}
                  />
                  <div className="msg-head-text">
                    <h2>{conversationTitle(selected)}</h2>
                    <p>
                      {selected?.type === "GROUP"
                        ? `${selected.memberCount || 0} members${selected.isAdmin ? " · Admin" : ""}`
                        : ([selected?.peer?.jobTitle, selected?.peer?.department].filter(Boolean).join(" · ") || "Direct message")}
                    </p>
                  </div>
                  {selected?.type === "GROUP" ? (
                    <button type="button" className="msg-back" onClick={() => setDetailsOpen(true)} aria-label="Group information">
                      <Info size={18} />
                    </button>
                  ) : null}
                </header>
                <div className="msg-history" ref={threadRef}>
                  {timelineHasOlder ? (
                    <button type="button" className="btn-secondary btn-sm msg-earlier" onClick={loadOlder} disabled={loadingOlder}>
                      {loadingOlder ? "Loading…" : "Earlier messages"}
                    </button>
                  ) : null}
                  {contextWindow?.hasMoreAfter ? (
                    <button type="button" className="btn-secondary btn-sm msg-earlier" onClick={showLatest} disabled={loadingOlder}>
                      Latest messages
                    </button>
                  ) : null}
                  {messagesQuery.isLoading && !contextWindow ? <p className="msg-muted">Loading messages…</p> : null}
                  {!messagesQuery.isLoading && timeline.length === 0 ? (
                    <div className="msg-empty"><p>No messages yet. Write the first one.</p></div>
                  ) : null}
                  {timeline.map((message, index) => {
                    const mine = String(message.senderUserId) === String(user?.id || user?._id);
                    const day = formatDay(message.createdAt);
                    const previousDay = index > 0 ? formatDay(timeline[index - 1].createdAt) : "";
                    return (
                      <div key={message.id}>
                        {day !== previousDay ? <p className="msg-day">{day}</p> : null}
                        <article id={`msg-${message.id}`} className={`msg-bubble-row${mine ? " is-mine" : ""}`}>
                          <div className={`msg-bubble${message.deleted ? " is-removed" : ""}`}>
                            {!message.deleted ? (
                              <div className="msg-actions">
                                <button
                                  type="button"
                                  className="msg-menu-btn"
                                  aria-label="Message actions"
                                  aria-expanded={menuId === message.id}
                                  onPointerDown={(event) => event.stopPropagation()}
                                  onClick={() => setMenuId((current) => (current === message.id ? "" : message.id))}
                                >
                                  <MoreHorizontal size={16} />
                                </button>
                                {menuId === message.id ? (
                                  <div className="msg-menu" onPointerDown={(event) => event.stopPropagation()}>
                                    <button type="button" onClick={() => beginReply(message)}>Reply</button>
                                    {mine ? <button type="button" onClick={() => beginEdit(message)}>Edit</button> : null}
                                    {mine ? (
                                      <button type="button" className="is-danger" onClick={() => { setDeleteTarget(message); setMenuId(""); }}>
                                        Delete
                                      </button>
                                    ) : null}
                                  </div>
                                ) : null}
                              </div>
                            ) : null}
                            {!mine && selected?.type === "GROUP" && message.senderName ? (
                              <p className="msg-sender">{message.senderName}</p>
                            ) : null}
                            {message.replyTo ? (
                              <button
                                type="button"
                                className={`msg-quote${message.replyTo.available ? "" : " is-unavailable"}`}
                                onClick={() => message.replyTo.available && setFocusId(message.replyTo.id)}
                                disabled={!message.replyTo.available}
                              >
                                <span>{message.replyTo.deleted ? "This message was deleted" : message.replyTo.available ? message.replyTo.senderName || "Message" : "Original message is unavailable."}</span>
                                {message.replyTo.available && !message.replyTo.deleted && message.replyTo.preview ? <small>{message.replyTo.preview}</small> : null}
                              </button>
                            ) : null}
                            {message.deleted ? <p>This message was deleted</p> : null}
                            {!message.deleted && message.body ? <p>{message.body}</p> : null}
                            {!message.deleted ? (
                              <MessageAttachments conversationId={selectedId} messageId={message.id} files={message.attachments} />
                            ) : null}
                            <time dateTime={message.createdAt}>
                              {formatTime(message.createdAt)}
                              {message.editedAt && !message.deleted ? <em>Edited</em> : null}
                            </time>
                          </div>
                        </article>
                      </div>
                    );
                  })}
                  {contextWindow?.hasMoreAfter ? (
                    <button type="button" className="btn-secondary btn-sm msg-earlier" onClick={loadNewer} disabled={loadingOlder}>
                      {loadingOlder ? "Loading…" : "Newer messages"}
                    </button>
                  ) : null}
                </div>
                <form
                  className="msg-composer"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (editing) saveEdit();
                    else send();
                  }}
                >
                  {replyTo ? (
                    <div className="msg-reply-bar">
                      <span>
                        <strong>Replying to {replyTo.senderName}</strong>
                        <small>{replyTo.preview}</small>
                      </span>
                      <button type="button" className="msg-back" onClick={() => setReplyTo(null)} aria-label="Cancel reply">
                        <X size={16} />
                      </button>
                    </div>
                  ) : null}
                  {editing ? (
                    <div className="msg-reply-bar">
                      <span>
                        <strong>Editing message</strong>
                        <small>Attachments stay with this message.</small>
                      </span>
                      <button
                        type="button"
                        className="msg-back"
                        onClick={() => { setEditing(null); setDraft(""); }}
                        aria-label="Cancel edit"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ) : null}
                  {files.length > 0 ? (
                    <ul className="msg-selected-files">
                      {files.map((file) => (
                        <li key={file.localId} className="msg-selected-file">
                          {file.preview ? <img src={file.preview} alt="" /> : null}
                          <span className="msg-file-copy">
                            <strong>{file.name}</strong>
                            <span>
                              {formatAttachmentSize(file.size)}
                              {file.status === "uploading" ? ` · Uploading ${file.progress || 0}%` : ""}
                              {file.status === "error" ? ` · ${file.error}` : ""}
                            </span>
                            {file.status === "uploading" ? <span className="msg-progress" style={{ width: `${file.progress || 0}%` }} /> : null}
                          </span>
                          {file.status === "error" ? (
                            <button type="button" className="btn-secondary btn-sm" onClick={() => uploadOne(file.localId, file.file, selectedId)}>Retry</button>
                          ) : null}
                          <button type="button" className="msg-back" onClick={() => removeFile(file.localId)} aria-label={`Remove ${file.name}`}>
                            <X size={16} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="msg-composer-row">
                    <label className="msg-attach">
                      <Paperclip size={18} aria-hidden="true" />
                      <input
                        type="file"
                        accept={ATTACHMENT_ACCEPT}
                        multiple
                        aria-label="Add attachment"
                        disabled={sending || !selectedId || Boolean(editing)}
                        onChange={(event) => {
                          addFiles(event.target.files);
                          event.target.value = "";
                        }}
                      />
                    </label>
                    <textarea
                      value={draft}
                      rows={1}
                      maxLength={4000}
                      placeholder="Write a message"
                      aria-label="Write a message"
                      disabled={sending}
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          if (editing) saveEdit();
                          else send();
                        }
                      }}
                    />
                    <button
                      type="submit"
                      className="btn-primary"
                      disabled={
                        sending
                        || (!editing && files.some((file) => file.status !== "uploaded"))
                        || (!draft.trim() && (editing ? !editing.hasAttachments : files.length === 0))
                      }
                    >
                      <Send size={16} aria-hidden="true" />
                      {sending ? "Saving…" : editing ? "Save" : "Send"}
                    </button>
                  </div>
                </form>
              </>
            )}
          </section>
        ) : null}
      </section>

      <AppModal
        open={Boolean(deleteTarget)}
        onClose={() => { if (!sending) setDeleteTarget(null); }}
        title="Delete message"
        locked={sending}
        footer={(
          <>
            <button type="button" className="btn-secondary" onClick={() => setDeleteTarget(null)} disabled={sending}>Cancel</button>
            <button type="button" className="btn-primary" onClick={confirmDelete} disabled={sending}>Delete</button>
          </>
        )}
      >
        <p>This message will be removed for everyone in the conversation. Replies will stay, without the original text.</p>
      </AppModal>
      <DirectoryDialog
        open={directoryOpen}
        query={directoryQuery}
        onQuery={setDirectoryQuery}
        onClose={() => { if (!opening) setDirectoryOpen(false); }}
        onSelect={openWith}
        busy={opening}
        selfId={String(user?.id || user?._id || "")}
      />
      <GroupCreateDialog
        open={groupOpen}
        selfId={String(user?.id || user?._id || "")}
        onClose={() => setGroupOpen(false)}
        onCreated={async (conversation) => {
          setOpened(conversation);
          setGroupOpen(false);
          await refreshChat(queryClient, conversation.id);
          selectConversation(conversation.id);
        }}
      />
      <GroupDetailsDialog
        open={detailsOpen && selected?.type === "GROUP"}
        conversation={selected}
        selfId={String(user?.id || user?._id || "")}
        onClose={() => setDetailsOpen(false)}
        onChanged={async (conversation) => {
          if (conversation?.id) setOpened(conversation);
          await refreshChat(queryClient, selectedId);
        }}
        onLeft={async () => {
          setDetailsOpen(false);
          setOpened(null);
          await refreshChat(queryClient, selectedId);
          selectConversation("");
        }}
      />
    </main>
  );
}

function DirectoryDialog({ open, query, onQuery, onClose, onSelect, busy, selfId }) {
  const directoryQuery = useQuery({
    queryKey: qk.chatDirectory(query.trim()),
    enabled: open,
    queryFn: async () => {
      const res = await api.get("/conversations/directory", { params: { search: query.trim() } });
      return res.data?.people || [];
    },
    staleTime: 10_000,
  });
  const people = (directoryQuery.data || []).filter((person) => person.userId !== selfId);

  return (
    <AppModal
      open={open}
      onClose={onClose}
      title="New message"
      subtitle="Search people in your company."
      locked={busy}
    >
      <label className="msg-search msg-search-block">
        <Search size={15} aria-hidden="true" />
        <input
          type="search"
          value={query}
          autoFocus
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Search by name, title, or department"
          aria-label="Search colleagues"
        />
      </label>
      {directoryQuery.isLoading ? <p className="msg-muted">Searching…</p> : null}
      {directoryQuery.isError ? (
        <p className="msg-banner" role="alert">{apiMessage(directoryQuery.error, "People could not be loaded.")}</p>
      ) : null}
      {!directoryQuery.isLoading && people.length === 0 ? (
        <div className="msg-empty"><p>No one matches that search.</p></div>
      ) : (
        <ul className="msg-directory">
          {people.map((person) => (
            <li key={person.userId}>
              <button type="button" className="msg-person" onClick={() => onSelect(person)} disabled={busy}>
                <PersonAvatar person={person} />
                <span className="msg-person-body">
                  <strong>{person.displayName}</strong>
                  <span className="msg-preview">
                    {[person.jobTitle, person.department, person.employeeCode].filter(Boolean).join(" · ") || "Colleague"}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </AppModal>
  );
}

function ConversationAvatar({ id, name, hasImage, imageVersion }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    if (!hasImage || !id) {
      setSrc("");
      return undefined;
    }
    let cancelled = false;
    let url = "";
    api.get(`/conversations/${id}/image`, { responseType: "blob", params: { v: imageVersion || "" } })
      .then((res) => {
        if (cancelled) return;
        url = URL.createObjectURL(res.data);
        setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setSrc("");
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [id, hasImage, imageVersion]);

  if (src) return <img className="msg-avatar" src={src} alt="" />;
  return <span className="msg-avatar" aria-hidden="true">{initials(name)}</span>;
}

function personMeta(person) {
  return [person.jobTitle, person.department, person.employeeCode].filter(Boolean).join(" · ") || "Colleague";
}

function GroupCreateDialog({ open, selfId, onClose, onCreated }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState([]);
  const [image, setImage] = useState(null);
  const [localError, setLocalError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName("");
    setDescription("");
    setQuery("");
    setSelected([]);
    setImage(null);
    setLocalError("");
    setSaving(false);
  }, [open]);

  const directoryQuery = useQuery({
    queryKey: qk.chatDirectory(`group:${query.trim()}`),
    enabled: open,
    queryFn: async () => {
      const res = await api.get("/conversations/directory", { params: { search: query.trim() } });
      return res.data?.people || [];
    },
    staleTime: 10_000,
  });
  const people = (directoryQuery.data || []).filter((person) => person.userId !== selfId && !selected.some((item) => item.userId === person.userId));

  function toggle(person) {
    if (!person?.userId || person.userId === selfId) return;
    setSelected((current) => current.some((item) => item.userId === person.userId)
      ? current.filter((item) => item.userId !== person.userId)
      : [...current, person]);
  }

  async function chooseImage(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setLocalError("Group image must be 2 MB or smaller.");
      return;
    }
    try {
      const fileData = await readFileAsDataUrl(file);
      setImage({ fileName: file.name, fileData, mimeType: file.type, preview: fileData });
      setLocalError("");
    } catch (err) {
      setLocalError(err.message || "The image could not be read.");
    }
  }

  async function createGroup(event) {
    event.preventDefault();
    if (saving) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setLocalError("Enter a group name.");
      return;
    }
    if (selected.length === 0) {
      setLocalError("Add at least one other person.");
      return;
    }
    setSaving(true);
    setLocalError("");
    try {
      const res = await api.post("/conversations/groups", {
        name: trimmed,
        description: description.trim(),
        memberUserIds: selected.map((person) => person.userId),
        image: image ? { fileName: image.fileName, fileData: image.fileData, mimeType: image.mimeType } : undefined,
      });
      const conversation = res.data?.conversation;
      if (!conversation?.id) throw new Error("The group could not be created.");
      onCreated(conversation);
    } catch (err) {
      setLocalError(apiMessage(err, "The group could not be created."));
      setSaving(false);
    }
  }

  return (
    <AppModal open={open} onClose={() => { if (!saving) onClose(); }} title="New group" subtitle="Name the group and choose people." locked={saving} size="lg">
      <form onSubmit={createGroup}>
        {localError ? <p className="msg-banner" role="alert">{localError}</p> : null}
        <label className="msg-field">
          Group name
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required placeholder="Platform team" />
        </label>
        <label className="msg-field">
          Description
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} rows={2} placeholder="Optional" />
        </label>
        <label className="msg-file">
          <ImagePlus size={16} aria-hidden="true" />
          {image ? "Change image" : "Add image"}
          <input type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" onChange={chooseImage} />
        </label>
        {image?.preview ? <img className="msg-image-preview" src={image.preview} alt="" /> : null}
        {selected.length > 0 ? (
          <ul className="msg-chips" aria-label="Selected people">
            {selected.map((person) => (
              <li key={person.userId}>
                <span className="msg-chip">
                  {person.displayName}
                  <button type="button" onClick={() => toggle(person)} aria-label={`Remove ${person.displayName}`}>
                    <X size={14} />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <label className="msg-search msg-search-block">
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name, title, or department"
            aria-label="Search colleagues"
          />
        </label>
        {directoryQuery.isLoading ? <p className="msg-muted">Searching…</p> : null}
        <ul className="msg-directory">
          {people.map((person) => (
            <li key={person.userId}>
              <button type="button" className="msg-person" onClick={() => toggle(person)}>
                <PersonAvatar person={person} />
                <span className="msg-person-body">
                  <strong>{person.displayName}</strong>
                  <span className="msg-preview">{personMeta(person)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="msg-dialog-actions">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={saving}>{saving ? "Creating…" : "Create group"}</button>
        </div>
      </form>
    </AppModal>
  );
}

function GroupDetailsDialog({ open, conversation, selfId, onClose, onChanged, onLeft }) {
  const membersQuery = useGroupMembersQuery(conversation?.id, open);
  const [name, setName] = useState(conversation?.name || "");
  const [description, setDescription] = useState(conversation?.description || "");
  const [query, setQuery] = useState("");
  const [localError, setLocalError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [image, setImage] = useState(null);
  const members = membersQuery.data || [];
  const isAdmin = Boolean(conversation?.isAdmin);

  useEffect(() => {
    if (!open) return;
    setName(conversation?.name || "");
    setDescription(conversation?.description || "");
    setQuery("");
    setLocalError("");
    setConfirmLeave(false);
    setImage(null);
  }, [open, conversation?.id, conversation?.name, conversation?.description]);

  const directoryQuery = useQuery({
    queryKey: qk.chatDirectory(`add:${conversation?.id || ""}:${query.trim()}`),
    enabled: open && isAdmin,
    queryFn: async () => {
      const res = await api.get("/conversations/directory", { params: { search: query.trim() } });
      return res.data?.people || [];
    },
    staleTime: 10_000,
  });
  const memberIds = new Set(members.map((member) => member.userId));
  const candidates = (directoryQuery.data || []).filter((person) => person.userId !== selfId && !memberIds.has(person.userId));

  async function run(action, fallback) {
    if (busy) return;
    setBusy(true);
    setLocalError("");
    try {
      await action();
    } catch (err) {
      setLocalError(apiMessage(err, fallback));
    } finally {
      setBusy(false);
    }
  }

  async function saveDetails(event) {
    event.preventDefault();
    await run(async () => {
      const res = await api.patch(`/conversations/${conversation.id}`, {
        name: name.trim(),
        description: description.trim(),
        image: image ? { fileName: image.fileName, fileData: image.fileData, mimeType: image.mimeType } : undefined,
      });
      setImage(null);
      await onChanged(res.data?.conversation);
    }, "The group could not be updated.");
  }

  async function chooseImage(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setLocalError("Group image must be 2 MB or smaller.");
      return;
    }
    try {
      const fileData = await readFileAsDataUrl(file);
      setImage({ fileName: file.name, fileData, mimeType: file.type });
      setLocalError("");
    } catch (err) {
      setLocalError(err.message || "The image could not be read.");
    }
  }

  return (
    <AppModal
      open={open}
      onClose={() => { if (!busy) onClose(); }}
      title={conversation?.name || "Group"}
      subtitle={conversation?.description || `${conversation?.memberCount || members.length || 0} members`}
      locked={busy}
      size="lg"
    >
      {localError ? <p className="msg-banner" role="alert">{localError}</p> : null}
      {isAdmin ? (
        <form onSubmit={saveDetails}>
          <label className="msg-field">
            Group name
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required />
          </label>
          <label className="msg-field">
            Description
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} rows={2} />
          </label>
          <label className="msg-file">
            <ImagePlus size={16} aria-hidden="true" />
            {image ? image.fileName : "Update image"}
            <input type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" onChange={chooseImage} />
          </label>
          <div className="msg-dialog-actions">
            <button type="submit" className="btn-primary" disabled={busy}>{busy ? "Saving…" : "Save details"}</button>
          </div>
        </form>
      ) : (
        <p className="msg-note">{conversation?.description || "You can view members and leave this group."}</p>
      )}

      <h3 className="msg-section-title">Members</h3>
      {membersQuery.isLoading ? <p className="msg-muted">Loading members…</p> : null}
      <ul className="msg-directory">
        {members.map((member) => (
          <li key={member.userId} className="msg-member">
            <PersonAvatar person={member} />
            <span className="msg-person-body">
              <strong>
                {member.displayName}
                {member.isAdmin ? <span className="msg-admin-pill">Admin</span> : null}
              </strong>
              <span className="msg-preview">{personMeta(member)}</span>
            </span>
            {isAdmin && member.userId !== selfId ? (
              <span className="msg-member-actions">
                {member.isAdmin ? (
                  <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={() => run(async () => {
                    const res = await api.delete(`/conversations/${conversation.id}/admins/${member.userId}`);
                    await onChanged(res.data?.conversation);
                  }, "The admin role could not be removed.")}>Remove admin</button>
                ) : (
                  <>
                    <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={() => run(async () => {
                      const res = await api.post(`/conversations/${conversation.id}/admins`, { userId: member.userId });
                      await onChanged(res.data?.conversation);
                    }, "This person could not be made an admin.")}>Make admin</button>
                    <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={() => run(async () => {
                      const res = await api.post(`/conversations/${conversation.id}/admins/transfer`, { userId: member.userId });
                      await onChanged(res.data?.conversation);
                    }, "Administration could not be transferred.")}>Transfer admin</button>
                  </>
                )}
                <button type="button" className="msg-danger" disabled={busy} onClick={() => run(async () => {
                  const res = await api.delete(`/conversations/${conversation.id}/members/${member.userId}`);
                  await onChanged(res.data?.conversation);
                }, "This person could not be removed.")}>Remove</button>
              </span>
            ) : null}
          </li>
        ))}
      </ul>

      {isAdmin ? (
        <>
          <label className="msg-search msg-search-block">
            <Search size={15} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Add a colleague"
              aria-label="Search colleagues to add"
            />
          </label>
          <ul className="msg-directory">
            {candidates.map((person) => (
              <li key={person.userId}>
                <button type="button" className="msg-person" disabled={busy} onClick={() => run(async () => {
                  const res = await api.post(`/conversations/${conversation.id}/members`, { userIds: [person.userId] });
                  setQuery("");
                  await onChanged(res.data?.conversation);
                }, "This person could not be added.")}>
                  <PersonAvatar person={person} />
                  <span className="msg-person-body">
                    <strong>{person.displayName}</strong>
                    <span className="msg-preview">{personMeta(person)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <div className="msg-dialog-actions">
        {confirmLeave ? (
          <>
            <p className="msg-note">Leave this group? You will lose access to later messages.</p>
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => setConfirmLeave(false)}>Stay</button>
            <button type="button" className="msg-danger" disabled={busy} onClick={() => run(onLeftRequest, "You could not leave the group.")}>Confirm leave</button>
          </>
        ) : (
          <button type="button" className="msg-danger" disabled={busy} onClick={() => setConfirmLeave(true)}>Leave group</button>
        )}
      </div>
    </AppModal>
  );

  async function onLeftRequest() {
    await api.post(`/conversations/${conversation.id}/leave`);
    await onLeft();
  }
}

function useNarrow() {
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 800px)").matches);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 800px)");
    const onChange = () => setNarrow(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return narrow;
}
