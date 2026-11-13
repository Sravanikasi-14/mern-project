import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import Modal from "./Modal";
import EmptyState, { ErrorState, Skeleton } from "./EmptyState";
import SoftRefresh from "./SoftRefresh";
import api from "../services/api";
import { useAuth } from "../app/AuthContext";
import { useNotificationsQuery } from "../hooks/useEmployeeQueries";
import { invalidateNotifications, qk } from "../app/queryKeys";
import { activateNotification } from "@shared/notificationNavigation.js";
import { useToast } from "./Toast";

export default function NotificationSheet({ open, onClose }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();
  const userId = user?._id || user?.id || null;
  const notesQuery = useNotificationsQuery({ enabled: open });
  const items = notesQuery.data?.notifications || [];
  const unreadCount = notesQuery.data?.unreadCount ?? items.length;
  const error = notesQuery.error?.response?.data?.message || notesQuery.error?.message || "";

  const removeFromVisibleList = (notifId) => {
    queryClient.setQueryData(qk.notifications(userId), (old) => {
      if (!old) return { notifications: [], unreadCount: 0 };
      const remaining = (old.notifications || []).filter(
        (n) => String(n.id || n._id) !== String(notifId)
      );
      return {
        ...old,
        notifications: remaining,
        unreadCount: Math.max(0, Math.min(remaining.length, (old.unreadCount || 1) - 1)),
      };
    });
  };

  const clearVisibleList = () => {
    queryClient.setQueryData(qk.notifications(userId), {
      notifications: [],
      unreadCount: 0,
    });
  };

  const markAll = async (event) => {
    event?.stopPropagation?.();
    const previous = queryClient.getQueryData(qk.notifications(userId));
    clearVisibleList();
    try {
      await api.post("/notifications/mark-all-read");
      await invalidateNotifications(queryClient, userId);
    } catch {
      if (previous) {
        queryClient.setQueryData(qk.notifications(userId), previous);
      }
    }
  };

  const markOne = async (item, event) => {
    if (event?.target?.closest?.("[data-notif-stop]")) {
      return;
    }

    await activateNotification(item, {
      role: user?.role,
      platform: "mobile",
      closePanel: onClose,
      markRead: async (notif) => {
        const notifId = notif.id || notif._id;
        removeFromVisibleList(notifId);
        try {
          await api.patch(`/notifications/${notifId}/read`);
        } catch {
          await notesQuery.refetch();
          toast.push("Could not mark the notification as read. It may still appear as unread.");
        }
      },
      navigateTo: (to, opts) => {
        if (!to) return;
        // Close overlay first so its history entry is released before route push.
        queueMicrotask(() => {
          navigate(to, opts);
        });
      },
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Notifications"
      footer={
        items.length > 0 ? (
          <button
            type="button"
            className="btn-secondary"
            data-notif-stop="true"
            onClick={markAll}
          >
            Mark all as read{unreadCount > 0 ? ` (${unreadCount})` : ""}
          </button>
        ) : null
      }
    >
      {notesQuery.isFetching && items.length > 0 ? (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
          <SoftRefresh active />
        </div>
      ) : null}
      {notesQuery.isLoading && items.length === 0 ? (
        <Skeleton />
      ) : error && items.length === 0 ? (
        <ErrorState message={error} onRetry={() => notesQuery.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState message="No notifications yet." />
      ) : (
        items.map((item) => (
          <button
            key={item._id || item.id}
            type="button"
            className="summary-row"
            onClick={(e) => markOne(item, e)}
            style={{ marginBottom: 8 }}
          >
            <span className="summary-body">
              <span className="summary-title">{item.title || item.message}</span>
              <span className="summary-sub">{item.body || item.message || ""}</span>
            </span>
          </button>
        ))
      )}
    </Modal>
  );
}
