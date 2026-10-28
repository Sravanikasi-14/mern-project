import { useState, useRef, useEffect } from "react";
import api, { getApiBaseUrl } from "../services/api";
import { useAuth } from "../context/AuthContext";
import "./ChatbotWidget.css";

const EMPLOYEE_QUICK_PROMPTS = [
  "What are our standard office work hours and attendance policy?",
  "What leave types and yearly days are available?",
  "How many Impact Points do I currently have?",
  "What upcoming company holidays are scheduled?",
];

const HR_ADMIN_QUICK_PROMPTS = [
  "Analyse today's attendance & late arrivals",
  "Are any leave requests pending or overlapping in teams?",
  "Is payroll ready to process?",
  "Which employee profiles or onboarding tasks are incomplete?",
];

function formatTime(date) {
  return new Date(date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * Basic markdown parser for AI responses: bold, bullets, links, line breaks.
 */
function MarkdownText({ content }) {
  if (!content) return null;

  // Split lines
  const lines = content.split("\n");
  const elements = [];
  let currentList = [];

  const flushList = () => {
    if (currentList.length > 0) {
      elements.push(
        <ul key={`ul-${elements.length}`} style={{ margin: "4px 0 8px", paddingLeft: 18 }}>
          {currentList.map((item, idx) => (
            <li key={idx} dangerouslySetInnerHTML={{ __html: parseInline(item) }} />
          ))}
        </ul>
      );
      currentList = [];
    }
  };

  const parseInline = (text) => {
    return text
      .replace(
        /\[(.*?)\]\((.*?)\)/g,
        '<a href="$2" class="chat-markdown-link" style="color: #2563eb; text-decoration: underline; font-weight: 500;">$1</a>'
      )
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.*?)\*/g, "<em>$1</em>")
      .replace(/`(.*?)`/g, "<code>$1</code>");
  };

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("* ") || trimmed.startsWith("- ")) {
      currentList.push(trimmed.substring(2));
    } else {
      flushList();
      if (trimmed) {
        elements.push(
          <p
            key={`p-${index}`}
            style={{ margin: "0 0 6px" }}
            dangerouslySetInnerHTML={{ __html: parseInline(trimmed) }}
          />
        );
      }
    }
  });

  flushList();

  return <div>{elements}</div>;
}

export default function ChatbotWidget() {
  const { user } = useAuth();
  const isHrAdmin = user?.role === "HR_ADMIN";
  const quickPrompts = isHrAdmin ? HR_ADMIN_QUICK_PROMPTS : EMPLOYEE_QUICK_PROMPTS;

  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const abortControllerRef = useRef(null);
  const launcherRef = useRef(null);

  // Draggable Launcher State
  const [position, setPosition] = useState(() => {
    try {
      const saved = localStorage.getItem("hrms_assistant_position");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed.x === "number" && typeof parsed.y === "number") {
          return parsed;
        }
      }
    } catch {
      // ignore
    }
    return null;
  });

  const [isDragging, setIsDragging] = useState(false);
  const dragInfoRef = useRef({
    startX: 0,
    startY: 0,
    startPosX: 0,
    startPosY: 0,
    hasMoved: false,
    pointerId: null,
  });

  const clampPosition = (x, y) => {
    const launcherWidth = launcherRef.current?.offsetWidth || 48;
    const launcherHeight = launcherRef.current?.offsetHeight || 48;
    const margin = 16;
    const minX = margin;
    const maxX = Math.max(margin, window.innerWidth - launcherWidth - margin);
    const minY = margin;
    const maxY = Math.max(margin, window.innerHeight - launcherHeight - margin);

    return {
      x: Math.max(minX, Math.min(x, maxX)),
      y: Math.max(minY, Math.min(y, maxY)),
    };
  };

  // Adjust position on window resize to ensure launcher never falls offscreen
  useEffect(() => {
    const handleResize = () => {
      if (position) {
        setPosition((prev) => (prev ? clampPosition(prev.x, prev.y) : null));
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [position]);

  const handlePointerDown = (e) => {
    // Only drag on primary pointer
    if (e.button !== 0 && e.pointerType === "mouse") return;

    const launcherEl = launcherRef.current;
    if (!launcherEl) return;

    const rect = launcherEl.getBoundingClientRect();
    const currentX = position ? position.x : rect.left;
    const currentY = position ? position.y : rect.top;

    dragInfoRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startPosX: currentX,
      startPosY: currentY,
      hasMoved: false,
      pointerId: e.pointerId,
    };

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }

    setIsDragging(true);
  };

  const handlePointerMove = (e) => {
    const info = dragInfoRef.current;
    if (info.pointerId === null || info.pointerId !== e.pointerId) return;

    const deltaX = e.clientX - info.startX;
    const deltaY = e.clientY - info.startY;

    if (!info.hasMoved && Math.hypot(deltaX, deltaY) > 5) {
      info.hasMoved = true;
    }

    if (info.hasMoved) {
      const rawX = info.startPosX + deltaX;
      const rawY = info.startPosY + deltaY;
      const clamped = clampPosition(rawX, rawY);
      setPosition(clamped);
    }
  };

  const handlePointerUp = (e) => {
    const info = dragInfoRef.current;
    if (info.pointerId === null || info.pointerId !== e.pointerId) return;

    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }

    setIsDragging(false);
    info.pointerId = null;

    if (info.hasMoved) {
      // Persist user-selected launcher position
      setPosition((curr) => {
        if (curr) {
          try {
            localStorage.setItem("hrms_assistant_position", JSON.stringify(curr));
          } catch {
            // ignore
          }
        }
        return curr;
      });
    } else {
      // It was a tap/click, not a drag: open assistant
      setIsOpen(true);
    }
  };

  const handlePointerCancel = (e) => {
    dragInfoRef.current.pointerId = null;
    setIsDragging(false);
  };

  const handleSend = async (messageText) => {
    const textToSend = (messageText || input).trim();
    if (!textToSend || loading) return;

    setInput("");
    setError("");

    const userMessage = {
      role: "user",
      text: textToSend,
      time: new Date(),
    };

    const newHistory = [...messages, userMessage];
    setMessages(newHistory);
    setLoading(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      // Build API history payload (last 10 turns formatted)
      const apiHistory = messages.map((m) => ({
        role: m.role === "user" ? "user" : "model",
        text: m.text,
      }));

      const token = typeof window !== "undefined" ? localStorage.getItem("hrms_token") : null;
      const baseUrl = getApiBaseUrl();

      // Initiate SSE streaming request
      const response = await fetch(`${baseUrl}/chat/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: "include",
        body: JSON.stringify({
          message: textToSend,
          history: apiHistory,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        let errData;
        try {
          errData = await response.json();
        } catch {
          // ignore json parse error
        }
        throw new Error(
          errData?.message ||
          (response.status === 504
            ? "AI assistant request timed out. Please try again with a shorter message."
            : `AI assistant error (${response.status})`)
        );
      }

      // Read SSE stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let modelReply = "";
      let modelMessageAdded = false;
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const normalized = buffer.replace(/\r\n/g, "\n");
        const blocks = normalized.split("\n\n");
        buffer = blocks.pop() || "";

        for (const block of blocks) {
          const trimmed = block.trim();
          if (!trimmed || trimmed.startsWith(":")) continue; // skip heartbeats

          const eventMatch = trimmed.match(/^event:\s*([a-zA-Z0-9_-]+)/m);
          const dataMatch = trimmed.match(/^data:\s*(.+)$/m);

          const eventType = eventMatch ? eventMatch[1] : "chunk";
          const dataStr = dataMatch ? dataMatch[1] : "";

          if (eventType === "error") {
            let errorMsg = "An error occurred during response streaming.";
            try {
              const parsed = JSON.parse(dataStr);
              errorMsg = parsed.message || errorMsg;
            } catch {
              // ignore
            }
            throw new Error(errorMsg);
          }

          if (eventType === "chunk" && dataStr) {
            try {
              const parsed = JSON.parse(dataStr);
              const chunkText = parsed.text || "";
              if (chunkText) {
                modelReply += chunkText;
                if (!modelMessageAdded) {
                  modelMessageAdded = true;
                  setMessages((prev) => [
                    ...prev,
                    {
                      role: "model",
                      text: modelReply,
                      time: new Date(),
                    },
                  ]);
                } else {
                  setMessages((prev) => {
                    const updated = [...prev];
                    const lastIdx = updated.length - 1;
                    if (lastIdx >= 0 && updated[lastIdx].role === "model") {
                      updated[lastIdx] = {
                        ...updated[lastIdx],
                        text: modelReply,
                      };
                    }
                    return updated;
                  });
                }
              }
            } catch {
              // ignore partial line parse
            }
          }
        }
      }

      if (!modelReply && !modelMessageAdded) {
        throw new Error("Received empty response from assistant.");
      }
    } catch (err) {
      if (err.name === "AbortError") {
        // User voluntarily stopped generation or component unmounted
        return;
      }
      const errMsg =
        err.message ||
        "Unable to reach HRMS Assistant. Please try again.";
      setError(errMsg);
    } finally {
      abortControllerRef.current = null;
      setLoading(false);
    }
  };

  const handleStopGenerating = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setLoading(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleNewConversation = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setMessages([]);
    setError("");
    setInput("");
    inputRef.current?.focus();
  };

  const containerStyle = position
    ? {
        position: "fixed",
        left: `${position.x}px`,
        top: `${position.y}px`,
        bottom: "auto",
        right: "auto",
      }
    : undefined;

  const windowPlacementClass = position
    ? `${position.y > (typeof window !== "undefined" ? window.innerHeight / 2 : 500) ? "open-above" : "open-below"} ${
        position.x > (typeof window !== "undefined" ? window.innerWidth / 2 : 500) ? "align-right" : "align-left"
      }`
    : "default-placement";

  return (
    <div className={`hrms-chatbot-container ${isDragging ? "is-dragging" : ""}`} style={containerStyle}>
      {/* Draggable Floating Chat Launcher Button */}
      {!isOpen && (
        <button
          ref={launcherRef}
          type="button"
          className={`hrms-chatbot-launcher ${isDragging ? "dragging" : ""}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          aria-label="Open HR Assistant. Drag to reposition."
          title="HR Assistant — click to open, drag to move"
          style={{ touchAction: "none" }}
        >
          <div className="hrms-chatbot-launcher-icon" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              <path d="M8 9h.01M12 9h.01M16 9h.01" />
            </svg>
          </div>
        </button>
      )}

      {/* Floating Chat Modal */}
      {isOpen && (
        <div className={`hrms-chatbot-window ${windowPlacementClass}`}>
          {/* Header */}
          <div className="hrms-chatbot-header">
            <div className="hrms-chatbot-header-info">
              <div className="hrms-chatbot-avatar">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2a4 4 0 0 1 4 4v1a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4z" />
                  <path d="M6 10h12v7a6 6 0 0 1-12 0v-7z" />
                  <circle cx="9" cy="14" r="1" fill="currentColor" />
                  <circle cx="15" cy="14" r="1" fill="currentColor" />
                </svg>
              </div>
              <div>
                <div className="hrms-chatbot-title">HRMS Assistant</div>
                <div className="hrms-chatbot-subtitle">
                  <span className="hrms-chatbot-badge-active" />
                  Gemini AI Helper
                </div>
              </div>
            </div>

            <div className="hrms-chatbot-header-actions">
              {messages.length > 0 && (
                <button
                  type="button"
                  className="hrms-chatbot-btn-icon"
                  title="New Conversation"
                  onClick={handleNewConversation}
                  aria-label="New Conversation"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="1 4 1 10 7 10" />
                    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                  </svg>
                </button>
              )}
              <button
                type="button"
                className="hrms-chatbot-btn-icon"
                onClick={() => setIsOpen(false)}
                title="Minimize Chat"
                aria-label="Minimize Chat"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>

          {/* Messages Container */}
          <div className="hrms-chatbot-messages">
            {messages.length === 0 ? (
              <div className="hrms-chatbot-welcome">
                <div className="hrms-chatbot-welcome-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                  </svg>
                </div>
                <h4 className="hrms-chatbot-welcome-title">
                  {isHrAdmin ? "AI HR Analyst & Operational Advisor" : "How can I assist you?"}
                </h4>
                <p className="hrms-chatbot-welcome-desc">
                  {isHrAdmin
                    ? "Ask about real-time attendance, leave conflicts, payroll readiness, or onboarding blockers."
                    : "Ask about office hours, leave policies, your assigned tasks, or Impact Points."}
                </p>

                <div className="hrms-chatbot-suggestions">
                  {quickPrompts.map((prompt, idx) => (
                    <button
                      key={idx}
                      type="button"
                      className="hrms-chatbot-pill"
                      onClick={() => handleSend(prompt)}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                      <span>{prompt}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((msg, index) => (
                <div key={index} className={`hrms-chatbot-row ${msg.role}`}>
                  <div className="hrms-chatbot-bubble">
                    {msg.role === "user" ? msg.text : <MarkdownText content={msg.text} />}
                  </div>
                  <div className="hrms-chatbot-time">{formatTime(msg.time)}</div>
                </div>
              ))
            )}

            {/* Typing state */}
            {loading && (
              <div className="hrms-chatbot-row model">
                <div className="hrms-chatbot-typing">
                  <div className="hrms-chatbot-typing-dot" />
                  <div className="hrms-chatbot-typing-dot" />
                  <div className="hrms-chatbot-typing-dot" />
                </div>
              </div>
            )}

            {/* Error display */}
            {error && (
              <div className="hrms-chatbot-error">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <span>{error}</span>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input Footer */}
          <div className="hrms-chatbot-footer">
            <div className="hrms-chatbot-input-box">
              <input
                ref={inputRef}
                type="text"
                className="hrms-chatbot-input"
                placeholder="Ask HRMS Assistant..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={loading}
                maxLength={2000}
              />
              {loading ? (
                <button
                  type="button"
                  className="hrms-chatbot-btn-stop"
                  onClick={handleStopGenerating}
                  aria-label="Stop Generating"
                  title="Stop Generating"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="4" y="4" width="16" height="16" rx="2" />
                  </svg>
                </button>
              ) : (
                <button
                  type="button"
                  className="hrms-chatbot-btn-send"
                  onClick={() => handleSend()}
                  disabled={!input.trim()}
                  aria-label="Send Message"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13" />
                    <polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                </button>
              )}
            </div>
            <div className="hrms-chatbot-disclaimer">
              AI assistant provides guidance based on company policy.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
