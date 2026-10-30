import { useState } from "react";
import { getApiBaseUrl } from "../services/api";
import Modal from "./Modal";

export default function AskAiSheet({ open, onClose }) {
  const [message, setMessage] = useState("");
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const send = async (event) => {
    event.preventDefault();
    if (!message.trim()) return;
    setBusy(true);
    setError("");
    setReply("");
    try {
      const token = localStorage.getItem("hrms_token");
      const response = await fetch(`${getApiBaseUrl()}/chat/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: "include",
        body: JSON.stringify({ message: message.trim(), history: [] }),
      });
      if (!response.ok) {
        throw new Error("The assistant is unavailable right now.");
      }
      const reader = response.body?.getReader();
      if (!reader) {
        const text = await response.text();
        setReply(text);
        return;
      }
      const decoder = new TextDecoder();
      let acc = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        const chunks = acc.split("\n\n");
        acc = chunks.pop() || "";
        for (const chunk of chunks) {
          const line = chunk.split("\n").find((row) => row.startsWith("data:"));
          if (!line) continue;
          const payload = line.replace(/^data:\s?/, "");
          if (payload === "[DONE]") continue;
          try {
            const parsed = JSON.parse(payload);
            setReply((prev) => prev + (parsed.text || parsed.delta || parsed.content || ""));
          } catch {
            setReply((prev) => prev + payload);
          }
        }
      }
    } catch (err) {
      setError(err.message || "Could not reach the assistant.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Ask AI">
      <form className="form-grid" onSubmit={send}>
        <label>
          Your question
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Ask about leave, attendance, or policies"
          />
        </label>
        {error ? <div className="alert alert-error">{error}</div> : null}
        {reply ? <div className="card"><p style={{ whiteSpace: "pre-wrap" }}>{reply}</p></div> : null}
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "Thinking..." : "Ask"}
        </button>
      </form>
    </Modal>
  );
}
