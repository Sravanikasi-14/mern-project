import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import api from "../services/api";
import { useNotificationsQuery } from "../hooks/useEmployeeQueries";
import { invalidateNotifications, qk } from "../lib/queryKeys";

function formatTimeAgo(dateStr) {
  if (!dateStr) return "";
  try {
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return "Just now";
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDays = Math.floor(diffHr / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return new Date(dateStr).toLocaleDateString("en-IN", {
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

export default function NotificationPanel({ isOpen, onClose, onCountChange }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const panelRef = useRef(null);

  const notificationsQuery = useNotificationsQuery();
  const notifications = notificationsQuery.data?.notifications || [];
  const unreadCount = notificationsQuery.data?.unreadCount ?? 0;
  const loading = notificationsQuery.isLoading && !notificationsQuery.data;
  const error = notificationsQuery.error?.response?.data?.message ||
    (notificationsQuery.error && !notificationsQuery.data ? "Failed to load notifications" : "");

  useEffect(() => {
    if (onCountChange) {
      onCountChange(unreadCount);
    }
  }, [unreadCount, onCountChange]);

  // Refetch when panel opens
  useEffect(() => {
    if (isOpen) {
      notificationsQuery.refetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Handle escape key and click outside
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    const handleClickOutside = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        // Only close if click was not on the notification button itself
        const bellBtn = document.querySelector(".fernly-notification-btn");
        if (bellBtn && bellBtn.contains(e.target)) {
          return;
        }
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen, onClose]);

  const handleItemClick = async (notif) => {
    // Optimistically mark as read
    if (!notif.isRead) {
      try {
        await api.patch(`/notifications/${notif.id}/read`);
        queryClient.setQueryData(qk.notifications(), (old) => {
          if (!old) return old;
          const nextUnread = Math.max(0, (old.unreadCount || 0) - 1);
          return {
            ...old,
            notifications: (old.notifications || []).map((n) =>
              n.id === notif.id ? { ...n, isRead: true } : n
            ),
            unreadCount: nextUnread,
          };
        });
      } catch {
        // ignore read error
      }
    }

    onClose();

    if (notif.link) {
      navigate(notif.link);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await api.post("/notifications/mark-all-read");
      queryClient.setQueryData(qk.notifications(), (old) => {
        if (!old) return old;
        return {
          ...old,
          notifications: (old.notifications || []).map((n) => ({ ...n, isRead: true })),
          unreadCount: 0,
        };
      });
      await invalidateNotifications(queryClient);
    } catch (err) {
      console.error("Failed to mark all as read:", err.message);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      ref={panelRef}
      className="notif-dropdown-panel"
      role="region"
      aria-label="Notifications"
    >
      {/* Header */}
      <div className="notif-panel-header">
        <div className="notif-panel-title-row">
          <span className="notif-panel-title">Notifications</span>
          {unreadCount > 0 && (
            <span className="notif-unread-pill">{unreadCount} unread</span>
          )}
        </div>
        <div className="notif-panel-actions">
          {unreadCount > 0 && (
            <button
              type="button"
              className="notif-mark-all-btn"
              onClick={handleMarkAllRead}
            >
              Mark all read
            </button>
          )}
          <button
            type="button"
            className="notif-close-btn"
            onClick={onClose}
            aria-label="Close notifications"
          >
            ×
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="notif-panel-body">
        {loading && (
          <div className="notif-loading-state">
            <div className="notif-spinner" />
            <span>Loading notifications...</span>
          </div>
        )}

        {!loading && error && (
          <div className="notif-error-state">
            <p>{error}</p>
            <button
              type="button"
              className="notif-retry-btn"
              onClick={() => notificationsQuery.refetch()}
            >
              Retry
            </button>
          </div>
        )}

        {!loading && !error && notifications.length === 0 && (
          <div className="notif-empty-state">
            <svg
              className="notif-empty-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            <p className="notif-empty-title">No notifications</p>
          </div>
        )}

        {!loading && !error && notifications.length > 0 && (
          <div className="notif-list">
            {notifications.map((notif) => (
              <div
                key={notif.id}
                className={`notif-item ${notif.isRead ? "notif-item--read" : "notif-item--unread"}`}
                onClick={() => handleItemClick(notif)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    handleItemClick(notif);
                  }
                }}
              >
                <div className="notif-item-icon-wrap">
                  {notif.type === "LEAVE" ? (
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="4" width="18" height="18" rx="2" />
                      <line x1="16" y1="2" x2="16" y2="6" />
                      <line x1="8" y1="2" x2="8" y2="6" />
                      <line x1="3" y1="10" x2="21" y2="10" />
                    </svg>
                  ) : notif.type === "TASK" ? (
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M9 11l3 3L22 4" />
                      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="12" />
                      <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                  )}
                </div>
                <div className="notif-item-content">
                  <div className="notif-item-title-row">
                    <span className="notif-item-title">{notif.title}</span>
                    <span className="notif-item-time">{formatTimeAgo(notif.createdAt)}</span>
                  </div>
                  <p className="notif-item-message">{notif.message}</p>
                </div>
                {!notif.isRead && <span className="notif-item-dot" aria-label="Unread" />}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
