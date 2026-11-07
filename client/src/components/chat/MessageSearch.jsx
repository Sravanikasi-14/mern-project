import { useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import api from "../../services/api";

function apiMessage(error, fallback) {
  return error?.response?.data?.message || fallback;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function Highlight({ text, terms }) {
  const source = String(text || "");
  const usable = (terms || []).filter((term) => term.length >= 2);
  if (!source || usable.length === 0) return source;
  const pattern = new RegExp(`(${usable.map(escapeRegExp).join("|")})`, "ig");
  const parts = source.split(pattern);
  const exact = new RegExp(`^(?:${usable.map(escapeRegExp).join("|")})$`, "i");
  return parts.map((part, index) => (
    exact.test(part) ? <mark key={`${part}-${index}`}>{part}</mark> : <span key={`${part}-${index}`}>{part}</span>
  ));
}

function formatStamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function MessageSearch({ conversations, activeId, onOpen }) {
  const [input, setInput] = useState("");
  const [term, setTerm] = useState("");
  const [type, setType] = useState("all");
  const [conversationId, setConversationId] = useState("");
  const [senderQuery, setSenderQuery] = useState("");
  const [senderChoices, setSenderChoices] = useState([]);
  const [sender, setSender] = useState(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [attachmentsOnly, setAttachmentsOnly] = useState(false);
  const [results, setResults] = useState([]);
  const [terms, setTerms] = useState([]);
  const [cursor, setCursor] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setTerm(input.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [input]);

  useEffect(() => {
    const query = senderQuery.trim();
    if (query.length < 2) {
      setSenderChoices([]);
      return undefined;
    }
    let cancelled = false;
    api.get("/conversations/directory", { params: { search: query } }).then((res) => {
      if (!cancelled) setSenderChoices(res.data?.people || []);
    }).catch(() => {
      if (!cancelled) setSenderChoices([]);
    });
    return () => {
      cancelled = true;
    };
  }, [senderQuery]);

  useEffect(() => {
    const hasFilter = Boolean(conversationId || sender || from || to || attachmentsOnly);
    if (term.length < 2 && !hasFilter) {
      setResults([]);
      setTerms([]);
      setCursor("");
      setHasMore(false);
      setError("");
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    const params = {};
    if (term) params.q = term;
    if (type !== "all") params.type = type;
    if (conversationId) params.conversationId = conversationId;
    if (sender?.userId) params.senderId = sender.userId;
    if (from) params.from = from;
    if (to) params.to = to;
    if (attachmentsOnly) params.attachments = "1";
    api.get("/conversations/search", { params }).then((res) => {
      if (cancelled) return;
      setResults(res.data?.results || []);
      setTerms(res.data?.terms || []);
      setHasMore(Boolean(res.data?.hasMore));
      setCursor(res.data?.nextCursor || "");
    }).catch((err) => {
      if (cancelled) return;
      setResults([]);
      setError(apiMessage(err, "Messages could not be searched."));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [term, type, conversationId, sender, from, to, attachmentsOnly]);

  async function loadMore() {
    if (!cursor || loading) return;
    setLoading(true);
    setError("");
    try {
      const params = { cursor };
      if (term) params.q = term;
      if (type !== "all") params.type = type;
      if (conversationId) params.conversationId = conversationId;
      if (sender?.userId) params.senderId = sender.userId;
      if (from) params.from = from;
      if (to) params.to = to;
      if (attachmentsOnly) params.attachments = "1";
      const res = await api.get("/conversations/search", { params });
      const page = res.data?.results || [];
      setResults((current) => {
        const seen = new Set(current.map((item) => item.id));
        return [...current, ...page.filter((item) => !seen.has(item.id))];
      });
      setHasMore(Boolean(res.data?.hasMore));
      setCursor(res.data?.nextCursor || "");
    } catch (err) {
      setError(apiMessage(err, "More results could not be loaded."));
    } finally {
      setLoading(false);
    }
  }

  const ready = term.length >= 2 || conversationId || sender || from || to || attachmentsOnly;

  return (
    <div className="msg-search-workspace">
      <form className="msg-search-form" onSubmit={(event) => event.preventDefault()}>
        <label className="msg-search">
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Search messages"
            aria-label="Search messages"
          />
        </label>
        <div className="msg-search-filters">
          <label>
            <span>Type</span>
            <select aria-label="Conversation type" value={type} onChange={(event) => setType(event.target.value)}>
              <option value="all">All</option>
              <option value="direct">Direct</option>
              <option value="group">Groups</option>
            </select>
          </label>
          <label>
            <span>Conversation</span>
            <select aria-label="Conversation" value={conversationId} onChange={(event) => setConversationId(event.target.value)}>
              <option value="">Any conversation</option>
              {conversations.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.type === "GROUP" ? item.name || "Group" : item.peer?.displayName || "Direct message"}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>From</span>
            <input type="date" aria-label="From date" value={from} onChange={(event) => setFrom(event.target.value)} />
          </label>
          <label>
            <span>To</span>
            <input type="date" aria-label="To date" value={to} onChange={(event) => setTo(event.target.value)} />
          </label>
        </div>
        <label className="msg-search-sender">
          <span>Sender</span>
          {sender ? (
            <span className="msg-search-chip">
              {sender.displayName}
              <button type="button" onClick={() => { setSender(null); setSenderQuery(""); }} aria-label="Clear sender">
                <X size={14} />
              </button>
            </span>
          ) : (
            <input
              type="search"
              value={senderQuery}
              onChange={(event) => setSenderQuery(event.target.value)}
              placeholder="Name or email"
              aria-label="Sender"
            />
          )}
        </label>
        {senderChoices.length > 0 && !sender ? (
          <ul className="msg-search-people">
            {senderChoices.slice(0, 6).map((person) => (
              <li key={person.userId}>
                <button type="button" onClick={() => { setSender(person); setSenderChoices([]); }}>
                  {person.displayName}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <label className="msg-search-check">
          <input
            type="checkbox"
            checked={attachmentsOnly}
            onChange={(event) => setAttachmentsOnly(event.target.checked)}
          />
          Attachments only
        </label>
      </form>
      {error ? <p className="msg-banner" role="alert">{error}</p> : null}
      {loading && results.length === 0 ? <p className="msg-muted">Searching…</p> : null}
      {!loading && ready && results.length === 0 && !error ? (
        <div className="msg-empty"><p>No messages match this search.</p></div>
      ) : null}
      {!ready ? <div className="msg-empty"><p>Search message text and file names, or narrow the results with a filter.</p></div> : null}
      <ul className="msg-search-results">
        {results.map((result) => (
          <li key={result.id}>
            <button
              type="button"
              className={`msg-search-result${result.id === activeId ? " is-active" : ""}`}
              onClick={() => onOpen(result)}
            >
              <span className="msg-person-top">
                <strong>{result.conversationName}</strong>
                <time dateTime={result.createdAt}>{formatStamp(result.createdAt)}</time>
              </span>
              <span className="msg-search-meta">
                {result.conversationType === "GROUP" ? "Group" : "Direct"}
                {result.senderName ? ` · ${result.senderName}` : ""}
              </span>
              <span className="msg-preview">
                <Highlight text={result.preview || result.attachmentName || "Attachment"} terms={terms} />
              </span>
            </button>
          </li>
        ))}
      </ul>
      {hasMore ? (
        <button type="button" className="btn-secondary btn-sm msg-earlier" onClick={loadMore} disabled={loading}>
          {loading ? "Loading…" : "More results"}
        </button>
      ) : null}
    </div>
  );
}
