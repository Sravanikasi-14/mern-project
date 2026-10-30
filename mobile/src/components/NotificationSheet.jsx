import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import Modal from "./Modal";
import EmptyState, { ErrorState, Skeleton } from "./EmptyState";
import SoftRefresh from "./SoftRefresh";
import api from "../services/api";
import { useNotificationsQuery } from "../hooks/useEmployeeQueries";
import { invalidateNotifications } from "../app/queryKeys";

export default function NotificationSheet({ open, onClose }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const notesQuery = useNotificationsQuery({ enabled: open });
  const items = notesQuery.data?.notifications || [];
  const error = notesQuery.error?.response?.data?.message || notesQuery.error?.message || "";

  const markAll = async () => {
    await api.post("/notifications/mark-all-read");
    await invalidateNotifications(queryClient);
  };

  const markOne = async (item) => {
    try {
      await api.patch(`/notifications/${item.id || item._id}/read`);
      await invalidateNotifications(queryClient);
    } catch {
      // still allow navigation
    }
    if (item.link) {
      onClose();
      navigate(item.link);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Notifications"
      footer={
        items.length > 0 ? (
          <button type="button" className="btn-secondary" onClick={markAll}>
            Mark all as read
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
            onClick={() => markOne(item)}
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
