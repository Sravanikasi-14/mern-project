import { useNavigate } from "react-router-dom";
import { useAskAi } from "../app/askAiContext";
import { useNotify } from "../app/notifyContext";
import { initialsFrom } from "./SummaryRow";
import { useAuth } from "../app/AuthContext";

export default function PageHeader({
  title,
  subtitle,
  back = false,
  onAskAi,
  onNotifications,
  showAvatar = false,
  greeting = false,
}) {
  const askAi = useAskAi();
  const notify = useNotify();
  const navigate = useNavigate();
  const { user } = useAuth();
  const openAsk = onAskAi || askAi;
  const openNotes = onNotifications || notify;

  return (
    <header className="page-header">
      {back ? (
        <button type="button" className="icon-btn is-back" aria-label="Go back" onClick={() => navigate(-1)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
      ) : null}
      <div style={{ flex: 1, minWidth: 0 }}>
        {greeting ? <p className="greet-kicker">{subtitle}</p> : null}
        <h1 className={greeting ? "greet-title" : undefined}>{title}</h1>
        {!greeting && subtitle ? <p className="caption">{subtitle}</p> : null}
      </div>
      <div className="page-header-actions">
        <button type="button" className="icon-btn" onClick={openNotes} aria-label="Notifications">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        </button>
        {showAvatar ? (
          <button
            type="button"
            className="avatar-btn"
            aria-label="Account"
            onClick={() => navigate(user?.role === "HR_ADMIN" ? "/admin/settings" : "/app/profile")}
          >
            {initialsFrom(user?.name || user?.email || "U")}
          </button>
        ) : (
          <button type="button" className="icon-btn" onClick={openAsk} aria-label="Ask AI">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </button>
        )}
      </div>
    </header>
  );
}
