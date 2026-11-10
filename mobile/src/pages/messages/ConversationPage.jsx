import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Copy, CornerUpLeft, MoreVertical, Paperclip, Send, Trash2, X } from "lucide-react";
import ProfileAvatar from "../../components/ProfileAvatar";
import Modal from "../../components/Modal";
import ConfirmDialog from "../../components/ConfirmDialog";
import { ErrorState, Skeleton } from "../../components/EmptyState";
import { useToast } from "../../components/Toast";
import { useAuth } from "../../app/AuthContext";
import { chatKeys, useChatMessagesQuery, useConversationsQuery, refreshChat } from "../../hooks/useChatQueries";
import api from "../../services/api";
import "./messages.css";

const ATTACHMENT_ACCEPT = ".png,.jpg,.jpeg,.webp,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt";
const ATTACHMENT_EXTENSIONS = new Set(ATTACHMENT_ACCEPT.split(",").map((ext) => ext.slice(1)));
const ATTACHMENT_MAX_BYTES = 3 * 1024 * 1024;
const ATTACHMENT_MAX_COUNT = 5;

function conversationTitle(item) {
  if (!item) return "Conversation";
  if (item.type === "GROUP") return item.name || "Group";
  return item.peer?.displayName || "Colleague";
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

function dayKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

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

/**
 * Full-screen conversation thread.
 * @param {{ basePath: string }} props
 */
export default function ConversationPage({ basePath }) {
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();
  const myId = String(user?._id || user?.id || "");

  const conversationsQuery = useConversationsQuery();
  const messagesQuery = useChatMessagesQuery(conversationId);
  const conversation =
    (conversationsQuery.data || []).find((item) => item.id === conversationId) || null;

  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState([]);
  const [replyTo, setReplyTo] = useState(null);
  const [menuMessage, setMenuMessage] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [sending, setSending] = useState(false);
  const [older, setOlder] = useState([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [threadSearch, setThreadSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [openedMeta, setOpenedMeta] = useState(null);

  const scrollRef = useRef(null);
  const bottomRef = useRef(null);
  const fileInputRef = useRef(null);
  const stickToBottom = useRef(true);
  const filesRef = useRef([]);
  const conversationIdRef = useRef(conversationId);
  filesRef.current = files;

  useEffect(() => {
    const previousConversation = conversationIdRef.current;
    const previousFiles = filesRef.current;
    conversationIdRef.current = conversationId;

    setOlder([]);
    setHasOlder(false);
    setReplyTo(null);
    setDraft("");
    setFiles([]);
    setOpenedMeta(null);
    setThreadSearch("");
    setSearchOpen(false);

    if (previousConversation && previousConversation !== conversationId) {
      for (const file of previousFiles) {
        if (!file?.id) continue;
        api.delete(`/conversations/${previousConversation}/attachments/${file.id}`).catch(() => {});
      }
    }
  }, [conversationId]);

  useEffect(() => {
    return () => {
      const pendingConversation = conversationIdRef.current;
      const pendingFiles = filesRef.current;
      if (!pendingConversation) return;
      for (const file of pendingFiles) {
        if (!file?.id) continue;
        api.delete(`/conversations/${pendingConversation}/attachments/${file.id}`).catch(() => {});
      }
    };
  }, []);

  useEffect(() => {
    if (!conversationId) return undefined;
    let active = true;
    api
      .get(`/conversations/${conversationId}`)
      .then((res) => {
        if (active) setOpenedMeta(res.data?.conversation || null);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [conversationId]);

  const liveMessages = messagesQuery.data?.messages || [];
  const latestId = liveMessages.length ? liveMessages[liveMessages.length - 1].id : "";

  useEffect(() => {
    if (!conversationId || !latestId) return undefined;
    let cancelled = false;
    api
      .post(`/conversations/${conversationId}/read`)
      .then(() => {
        if (cancelled) return;
        // Do not invalidate messages here — that would change dataUpdatedAt and re-trigger this effect.
        queryClient.invalidateQueries({ queryKey: chatKeys.conversations() });
        queryClient.invalidateQueries({ queryKey: chatKeys.unread() });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [conversationId, latestId, queryClient]);

  useEffect(() => {
    if (messagesQuery.data?.hasMore != null) {
      setHasOlder(Boolean(messagesQuery.data.hasMore) || older.length > 0);
    }
  }, [messagesQuery.data?.hasMore, older.length]);

  const messages = useMemo(() => {
    const seen = new Set(liveMessages.map((message) => message.id));
    return [...older.filter((message) => !seen.has(message.id)), ...liveMessages];
  }, [older, liveMessages]);

  const visibleMessages = useMemo(() => {
    const q = threadSearch.trim().toLowerCase();
    if (!q) return messages;
    return messages.filter((m) => !m.deleted && String(m.body || "").toLowerCase().includes(q));
  }, [messages, threadSearch]);

  const unreadAnchorId = useMemo(() => {
    const firstUnread = messages.find(
      (m) => String(m.senderUserId) !== myId && !m.deleted
    );
    // Backend does not return per-message read flags; use conversation unreadCount as a soft cue.
    if (!conversation?.unreadCount) return null;
    return firstUnread?.id || null;
  }, [messages, myId, conversation?.unreadCount]);

  useEffect(() => {
    if (!stickToBottom.current) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [visibleMessages.length, sending]);

  const title = conversationTitle(conversation || openedMeta);
  const subtitle =
    conversation?.type === "GROUP" || openedMeta?.type === "GROUP"
      ? `${conversation?.memberCount || openedMeta?.memberCount || ""} members`.trim()
      : "Company chat";

  const loadOlder = async () => {
    if (loadingOlder || !hasOlder) return;
    const cursor = messages[0]?.id;
    if (!cursor) return;
    setLoadingOlder(true);
    stickToBottom.current = false;
    try {
      const res = await api.get(`/conversations/${conversationId}/messages`, {
        params: { before: cursor },
      });
      const batch = res.data?.messages || [];
      setOlder((prev) => [...batch, ...prev]);
      setHasOlder(Boolean(res.data?.hasMore));
    } catch (err) {
      toast.push(err.response?.data?.message || "Could not load earlier messages.");
    } finally {
      setLoadingOlder(false);
    }
  };

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    stickToBottom.current = nearBottom;
    if (el.scrollTop < 40) loadOlder();
  };

  const uploadAttachment = async (file) => {
    const ext = attachmentExtension(file.name);
    if (!ATTACHMENT_EXTENSIONS.has(ext)) {
      throw new Error("Unsupported file type.");
    }
    if (file.size > ATTACHMENT_MAX_BYTES) {
      throw new Error("Each attachment must be 3 MB or smaller.");
    }
    const fileData = await readFileAsDataUrl(file);
    const res = await api.post(`/conversations/${conversationId}/attachments`, {
      fileName: file.name,
      fileData,
      mimeType: file.type || "application/octet-stream",
    });
    return res.data?.file;
  };

  const onPickFiles = async (event) => {
    const picked = [...(event.target.files || [])];
    event.target.value = "";
    if (!picked.length) return;
    if (files.length + picked.length > ATTACHMENT_MAX_COUNT) {
      toast.push(`You can attach up to ${ATTACHMENT_MAX_COUNT} files.`);
      return;
    }
    try {
      const uploaded = [];
      for (const file of picked) {
        const meta = await uploadAttachment(file);
        if (!meta?.id) throw new Error("Attachment upload did not return a file id.");
        uploaded.push(meta);
      }
      setFiles((prev) => [...prev, ...uploaded]);
    } catch (err) {
      toast.push(err.response?.data?.message || err.message || "Attachment failed.");
    }
  };

  const removePendingFile = async (file) => {
    setFiles((prev) => prev.filter((item) => item.id !== file.id));
    try {
      await api.delete(`/conversations/${conversationId}/attachments/${file.id}`);
    } catch {
      /* draft cleanup best-effort */
    }
  };

  const send = async () => {
    const body = draft.trim();
    const attachmentIds = files.map((f) => f.id).filter(Boolean);
    if (!body && attachmentIds.length === 0) return;
    setSending(true);
    try {
      await api.post(`/conversations/${conversationId}/messages`, {
        body,
        attachmentIds,
        replyToMessageId: replyTo?.id || undefined,
      });
      setDraft("");
      setFiles([]);
      setReplyTo(null);
      stickToBottom.current = true;
      await refreshChat(queryClient, conversationId);
    } catch (err) {
      toast.push(err.response?.data?.message || "Message could not be sent.");
    } finally {
      setSending(false);
    }
  };

  const copyMessage = async (message) => {
    try {
      await navigator.clipboard.writeText(message.body || "");
      toast.push("Copied");
    } catch {
      toast.push("Could not copy.");
    }
    setMenuMessage(null);
  };

  const deleteMessage = async () => {
    if (!deleteTarget) return;
    try {
      await api.delete(`/conversations/${conversationId}/messages/${deleteTarget.id}`);
      setDeleteTarget(null);
      setMenuMessage(null);
      await refreshChat(queryClient, conversationId);
    } catch (err) {
      toast.push(err.response?.data?.message || "Could not delete message.");
    }
  };

  const openAttachment = async (message, file) => {
    try {
      const res = await api.get(
        `/conversations/${conversationId}/messages/${message.id}/attachments/${file.id}`,
        { responseType: "blob" }
      );
      const blob = res.data;
      const contentType = String(res.headers?.["content-type"] || blob?.type || "");
      if (contentType.includes("application/json") || contentType.includes("text/json")) {
        const text = await blob.text();
        let messageText = "Attachment unavailable.";
        try {
          const parsed = JSON.parse(text);
          if (parsed?.message) messageText = parsed.message;
        } catch {
          /* keep default */
        }
        throw new Error(messageText);
      }
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      toast.push(err.response?.data?.message || err.message || "Attachment unavailable.");
    }
  };

  if (messagesQuery.isLoading && !messages.length) {
    return (
      <div className="msg-thread-page">
        <div className="msg-thread-header">
          <button type="button" className="icon-btn" aria-label="Back" onClick={() => navigate(basePath)}>
            <ArrowLeft size={22} />
          </button>
          <div className="msg-thread-peer">
            <strong>Loading…</strong>
          </div>
        </div>
        <Skeleton />
      </div>
    );
  }

  if (messagesQuery.isError && !messages.length) {
    return (
      <div className="msg-thread-page">
        <div className="msg-thread-header">
          <button type="button" className="icon-btn" aria-label="Back" onClick={() => navigate(basePath)}>
            <ArrowLeft size={22} />
          </button>
        </div>
        <ErrorState
          message={messagesQuery.error?.response?.data?.message || "Conversation could not be loaded."}
          onRetry={() => messagesQuery.refetch()}
        />
      </div>
    );
  }

  let lastDay = "";

  return (
    <div className="msg-thread-page">
      <div className="msg-thread-header">
        <button type="button" className="icon-btn" aria-label="Back" onClick={() => navigate(basePath)}>
          <ArrowLeft size={22} />
        </button>
        <div className="msg-thread-peer">
          <ProfileAvatar name={title} size={36} />
          <div style={{ minWidth: 0 }}>
            <strong>{title}</strong>
            <span>{subtitle}</span>
          </div>
        </div>
        <button
          type="button"
          className="icon-btn"
          aria-label="Search in conversation"
          onClick={() => setSearchOpen((v) => !v)}
        >
          <MoreVertical size={20} />
        </button>
      </div>

      {searchOpen ? (
        <div className="msg-search-bar">
          <input
            value={threadSearch}
            onChange={(e) => setThreadSearch(e.target.value)}
            placeholder="Search in conversation"
            aria-label="Search in conversation"
          />
        </div>
      ) : null}

      <div className="msg-thread-scroll" ref={scrollRef} onScroll={onScroll}>
        {loadingOlder ? <p className="caption" style={{ textAlign: "center" }}>Loading earlier…</p> : null}
        {hasOlder && !loadingOlder ? (
          <button type="button" className="btn-secondary" style={{ margin: "0 auto 10px", display: "block" }} onClick={loadOlder}>
            Load earlier messages
          </button>
        ) : null}

        {visibleMessages.map((message) => {
          const mine = String(message.senderUserId) === myId;
          const day = dayKey(message.createdAt);
          const showDay = day && day !== lastDay;
          if (showDay) lastDay = day;
          return (
            <div key={message.id}>
              {showDay ? (
                <div className="msg-day-sep">
                  <span>{formatDay(message.createdAt)}</span>
                </div>
              ) : null}
              {unreadAnchorId && message.id === unreadAnchorId ? (
                <div className="msg-unread-sep">Unread messages</div>
              ) : null}
              <div className={`msg-bubble-row ${mine ? "is-mine" : "is-theirs"}`}>
                <button
                  type="button"
                  className={`msg-bubble ${mine ? "is-mine" : "is-theirs"}${message.deleted ? " is-deleted" : ""}`}
                  onClick={() => {
                    if (!message.deleted) setMenuMessage(message);
                  }}
                >
                  {message.replyTo?.available !== false && message.replyTo ? (
                    <div className="msg-bubble-reply">
                      <strong>{message.replyTo.senderName || "Reply"}</strong>
                      <span>{message.replyTo.preview || "Message"}</span>
                    </div>
                  ) : null}
                  <div className="msg-bubble-body">
                    {message.deleted ? "This message was deleted" : message.body || (message.attachments?.length ? "" : " ")}
                  </div>
                  {!message.deleted && message.attachments?.length
                    ? message.attachments.map((file) => (
                        <button
                          key={file.id}
                          type="button"
                          className="msg-attach-chip"
                          style={{ marginTop: 6 }}
                          onClick={(e) => {
                            e.stopPropagation();
                            openAttachment(message, file);
                          }}
                        >
                          {file.fileName || "Attachment"}
                        </button>
                      ))
                    : null}
                  <div className="msg-bubble-meta">
                    {message.editedAt ? <span>edited</span> : null}
                    <span>{formatTime(message.createdAt)}</span>
                  </div>
                </button>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div className="msg-composer">
        {replyTo ? (
          <div className="msg-composer-reply">
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong>{replyTo.senderName || "Replying"}</strong>
              <span className="caption">{replyTo.body || replyTo.preview || "Message"}</span>
            </div>
            <button type="button" className="icon-btn" aria-label="Cancel reply" onClick={() => setReplyTo(null)}>
              <X size={16} />
            </button>
          </div>
        ) : null}
        {files.length ? (
          <div>
            {files.map((file) => (
              <span key={file.id} className="msg-attach-chip">
                {file.fileName || "File"}
                <button type="button" aria-label="Remove attachment" onClick={() => removePendingFile(file)}>
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <div className="msg-composer-row">
          <button
            type="button"
            className="msg-attach"
            aria-label="Attach file"
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip size={20} />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            hidden
            multiple
            accept={ATTACHMENT_ACCEPT}
            onChange={onPickFiles}
          />
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Message"
            rows={1}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <button
            type="button"
            className="msg-send"
            aria-label="Send"
            disabled={sending || (!draft.trim() && files.length === 0)}
            onClick={send}
          >
            <Send size={18} />
          </button>
        </div>
      </div>

      <Modal open={Boolean(menuMessage)} onClose={() => setMenuMessage(null)} title="Message" size="sm">
        <div className="msg-action-sheet">
          <button
            type="button"
            onClick={() => {
              setReplyTo(menuMessage);
              setMenuMessage(null);
            }}
          >
            <CornerUpLeft size={16} style={{ marginRight: 8, verticalAlign: "-2px" }} />
            Reply
          </button>
          <button type="button" onClick={() => copyMessage(menuMessage)}>
            <Copy size={16} style={{ marginRight: 8, verticalAlign: "-2px" }} />
            Copy
          </button>
          {menuMessage && String(menuMessage.senderUserId) === myId ? (
            <button
              type="button"
              className="is-danger"
              onClick={() => {
                setDeleteTarget(menuMessage);
                setMenuMessage(null);
              }}
            >
              <Trash2 size={16} style={{ marginRight: 8, verticalAlign: "-2px" }} />
              Delete
            </button>
          ) : null}
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete message?"
        message="This removes the message for everyone in the conversation."
        confirmLabel="Delete"
        danger
        onClose={() => setDeleteTarget(null)}
        onConfirm={deleteMessage}
      />
    </div>
  );
}
