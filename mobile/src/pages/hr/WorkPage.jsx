import { useCallback, useEffect, useMemo, useState } from "react";
import { Calendar, CheckCircle2, ChevronRight, ClipboardList, Clock, Plus } from "lucide-react";
import HrPortalHeader from "../../components/HrPortalHeader";
import SearchBar from "../../components/SearchBar";
import StatusBadge from "../../components/StatusBadge";
import Modal from "../../components/Modal";
import ConfirmDialog from "../../components/ConfirmDialog";
import EmptyState, { ErrorState, Skeleton } from "../../components/EmptyState";
import Pagination from "../../components/Pagination";
import ProfileAvatar from "../../components/ProfileAvatar";
import { useToast } from "../../components/Toast";
import api from "../../services/api";
import { formatDisplayDate } from "../../utils/dateUtils";

const WORK_PAGE_SIZE = 20;

const TABS = [
  { value: "ALL", label: "All" },
  { value: "SUBMITTED", label: "To review" },
  { value: "ACTIVE", label: "In progress" },
  { value: "DONE", label: "Completed" },
];

function assigneeName(task) {
  return (
    task?.assigneeName ||
    task?.assigneeSnapshot?.fullName ||
    task?.assignee?.fullName ||
    task?.assignedTo?.fullName ||
    task?.employeeName ||
    "Unassigned"
  );
}

function assigneePhoto(task) {
  return (
    task?.assigneeSnapshot?.avatar ||
    task?.assignee?.avatar ||
    task?.assignedTo?.avatar ||
    task?.avatar ||
    ""
  );
}

function folderTone(status) {
  const s = String(status || "").toUpperCase();
  if (s === "SUBMITTED") return "is-upcoming";
  if (s === "APPROVED") return "is-done-a";
  if (s === "REJECTED") return "is-done-b";
  if (s === "IN_PROGRESS" || s === "ASSIGNED" || s === "CHANGES_REQUESTED") return "is-today";
  return "is-upcoming";
}

function matchesTab(task, tab) {
  const s = String(task.status || "").toUpperCase();
  if (tab === "ALL") return true;
  if (tab === "SUBMITTED") return s === "SUBMITTED";
  if (tab === "ACTIVE") return ["ASSIGNED", "IN_PROGRESS", "CHANGES_REQUESTED"].includes(s);
  if (tab === "DONE") return ["APPROVED", "REJECTED"].includes(s);
  return true;
}

function priorityLabel(priority) {
  const p = String(priority || "").toUpperCase();
  if (!p || p === "MEDIUM") return "";
  return p.charAt(0) + p.slice(1).toLowerCase();
}

export default function HrWorkPage() {
  const toast = useToast();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("ALL");
  const [page, setPage] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [selected, setSelected] = useState(null);
  const [review, setReview] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [people, setPeople] = useState([]);
  const [taskForm, setTaskForm] = useState({
    title: "",
    description: "",
    assigneeId: "",
    deadline: "",
    priority: "MEDIUM",
  });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [defaultedTab, setDefaultedTab] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [taskRes, peopleRes] = await Promise.all([
        api.get("/tasks", {
          params: {
            page,
            limit: WORK_PAGE_SIZE,
            ...(search.trim() ? { search: search.trim() } : {}),
          },
        }),
        api.get("/employees", { params: { page: 1, limit: 100, status: "ACTIVE" } }).catch(() => null),
      ]);
      const list = taskRes.data?.tasks || taskRes.data?.data?.tasks || [];
      const pagination = taskRes.data?.pagination || taskRes.data?.data?.pagination || {};
      setTasks(list);
      setTotalItems(pagination.total ?? list.length);
      setTotalPages(pagination.pages ?? pagination.totalPages ?? 1);
      setPeople(peopleRes?.data?.employees || []);
    } catch (err) {
      setError(err.response?.data?.message || "Could not load work.");
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    setPage(1);
  }, [search]);

  useEffect(() => {
    const t = setTimeout(load, search ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  useEffect(() => {
    if (defaultedTab || loading) return;
    const needsReview = tasks.some((task) => String(task.status || "").toUpperCase() === "SUBMITTED");
    if (needsReview) setTab("SUBMITTED");
    setDefaultedTab(true);
  }, [tasks, loading, defaultedTab]);

  const visible = useMemo(() => tasks.filter((task) => matchesTab(task, tab)), [tasks, tab]);

  const tabCounts = useMemo(() => {
    const counts = { ALL: tasks.length, SUBMITTED: 0, ACTIVE: 0, DONE: 0 };
    tasks.forEach((task) => {
      const s = String(task.status || "").toUpperCase();
      if (s === "SUBMITTED") counts.SUBMITTED += 1;
      else if (["ASSIGNED", "IN_PROGRESS", "CHANGES_REQUESTED"].includes(s)) counts.ACTIVE += 1;
      else if (["APPROVED", "REJECTED"].includes(s)) counts.DONE += 1;
    });
    return counts;
  }, [tasks]);

  const grouped = useMemo(() => {
    if (tab !== "ALL") return null;
    return {
      review: visible.filter((t) => String(t.status).toUpperCase() === "SUBMITTED"),
      active: visible.filter((t) =>
        ["ASSIGNED", "IN_PROGRESS", "CHANGES_REQUESTED"].includes(String(t.status).toUpperCase())
      ),
      done: visible.filter((t) => ["APPROVED", "REJECTED"].includes(String(t.status).toUpperCase())),
    };
  }, [tab, visible]);

  const completeReview = async () => {
    if (!selected?._id || !review) return;
    try {
      const decision = review === "APPROVE" ? "APPROVED" : review;
      const comments =
        decision === "APPROVED"
          ? "Approved"
          : "Changes requested — please revise and resubmit.";
      await api.post(`/tasks/${selected._id}/review`, { decision, comments });
      toast.push(decision === "APPROVED" ? "Task approved." : "Changes requested.");
      setReview(null);
      setSelected(null);
      setError("");
      await load();
    } catch (err) {
      const message = err.response?.data?.message || "Could not review this task.";
      setError(message);
      toast.push(message);
      setReview(null);
    }
  };

  const createTask = async (event) => {
    event.preventDefault();
    if (!taskForm.description.trim()) {
      setCreateError("Task description is required.");
      return;
    }
    if (!taskForm.deadline) {
      setCreateError("Task deadline is required.");
      return;
    }
    try {
      setCreating(true);
      setCreateError("");
      await api.post("/tasks", {
        title: taskForm.title.trim(),
        description: taskForm.description.trim(),
        assigneeId: taskForm.assigneeId,
        priority: taskForm.priority,
        deadline: taskForm.deadline,
      });
      toast.push("Task created.");
      setCreateOpen(false);
      setCreateError("");
      setTaskForm({ title: "", description: "", assigneeId: "", deadline: "", priority: "MEDIUM" });
      setTab("ACTIVE");
      await load();
    } catch (err) {
      setCreateError(err.response?.data?.message || "Could not create this task.");
    } finally {
      setCreating(false);
    }
  };

  const openCreate = () => {
    setCreateError("");
    setCreateOpen(true);
  };

  const renderTask = (task, index, stackSize) => {
    const tone = folderTone(task.status);
    const name = assigneeName(task);
    const status = String(task.status || "").toUpperCase();
    const priority = priorityLabel(task.priority);
    const needsReview = status === "SUBMITTED";

    return (
      <div key={task._id} className="hr-work-item" style={{ zIndex: stackSize - index }}>
        <button type="button" className={`tk-folder ${tone}`} onClick={() => setSelected(task)}>
          <span className="tk-folder-ico" aria-hidden="true">
            {needsReview ? (
              <Clock size={18} strokeWidth={2} />
            ) : status === "APPROVED" ? (
              <CheckCircle2 size={18} strokeWidth={2} />
            ) : (
              <ClipboardList size={18} strokeWidth={2} />
            )}
          </span>
          <span className="tk-folder-main">
            <strong className="tk-folder-title">{task.title}</strong>
            <span className="tk-folder-due">
              <ProfileAvatar name={name} photo={assigneePhoto(task)} size={18} />
              {name}
              {task.deadline ? (
                <>
                  {" · "}
                  <Calendar size={12} strokeWidth={2} aria-hidden="true" />
                  {formatDisplayDate(task.deadline)}
                </>
              ) : null}
              {priority ? (
                <>
                  {" · "}
                  <em className={`hr-work-priority is-${String(task.priority).toLowerCase()}`}>{priority}</em>
                </>
              ) : null}
            </span>
          </span>
          <StatusBadge status={task.status} />
          <span className="tk-folder-chevron" aria-hidden="true">
            <ChevronRight size={16} strokeWidth={2.25} />
          </span>
        </button>
      </div>
    );
  };

  const renderStack = (title, dotClass, rows) => {
    if (!rows.length) return null;
    return (
      <section className="tk-folder-section">
        <div className="tk-folder-head">
          <h2>
            <span className={`tk-folder-dot ${dotClass}`} aria-hidden="true" />
            {title}
          </h2>
          <span className="tk-folder-count">
            {rows.length} {rows.length === 1 ? "TASK" : "TASKS"}
          </span>
        </div>
        <div className="tk-folder-stack">{rows.map((task, index) => renderTask(task, index, rows.length))}</div>
      </section>
    );
  };

  return (
    <div className="hr-work tk-page tk-page--folders">
      <HrPortalHeader title="Work Management" />

      <div className="hr-work-toolbar">
        <SearchBar value={search} onChange={setSearch} placeholder="Search tasks" />
        <button type="button" className="btn-primary hr-work-create" onClick={openCreate}>
          <Plus size={18} strokeWidth={2.25} aria-hidden="true" />
          Create
        </button>
      </div>
      {error ? <div className="alert alert-error">{error}</div> : null}

      <div className="chip-row tk-chip-row" role="tablist" aria-label="Work filters">
        {TABS.map((chip) => (
          <button
            key={chip.value}
            type="button"
            role="tab"
            aria-selected={tab === chip.value}
            className={`chip${tab === chip.value ? " is-active" : ""}${chip.value === "SUBMITTED" && tabCounts.SUBMITTED > 0 ? " has-alert" : ""}`}
            onClick={() => setTab(chip.value)}
          >
            {chip.label} ({tabCounts[chip.value] ?? 0})
          </button>
        ))}
      </div>

      {loading ? (
        <Skeleton />
      ) : error && tasks.length === 0 ? (
        <ErrorState message={error} onRetry={load} />
      ) : visible.length === 0 ? (
        <EmptyState
          message={
            tab === "SUBMITTED"
              ? "No submissions waiting for review."
              : tab === "ACTIVE"
                ? "No tasks in progress."
                : tab === "DONE"
                  ? "No completed tasks yet."
                  : "No tasks yet."
          }
          actionLabel="Create task"
          onAction={openCreate}
        />
      ) : tab === "ALL" && grouped ? (
        <>
          {renderStack("To review", "is-upcoming", grouped.review)}
          {renderStack("In progress", "is-today", grouped.active)}
          {renderStack("Completed", "is-done", grouped.done)}
        </>
      ) : (
        renderStack(
          TABS.find((t) => t.value === tab)?.label || "Tasks",
          tab === "SUBMITTED" ? "is-upcoming" : tab === "DONE" ? "is-done" : "is-today",
          visible
        )
      )}

      <Pagination
        page={page}
        totalPages={totalPages}
        totalItems={totalItems}
        pageSize={WORK_PAGE_SIZE}
        onPageChange={setPage}
        itemLabel="tasks"
      />

      <Modal open={Boolean(selected) && !review} onClose={() => setSelected(null)} title={selected?.title || "Task"}>
        {selected ? (
          <div className="form-grid">
            <p>{selected.description || "No description."}</p>
            <p className="caption">
              {assigneeName(selected)}
              {selected.deadline ? ` · Due ${formatDisplayDate(selected.deadline)}` : ""}
              {priorityLabel(selected.priority) ? ` · ${priorityLabel(selected.priority)}` : ""}
            </p>
            <StatusBadge status={selected.status} />
            {String(selected.status).toUpperCase() === "SUBMITTED" ? (
              <div className="row-actions">
                <button type="button" className="btn-danger" onClick={() => setReview("CHANGES_REQUESTED")}>
                  Request changes
                </button>
                <button type="button" className="btn-primary" onClick={() => setReview("APPROVE")}>
                  Approve
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={Boolean(review)}
        onClose={() => setReview(null)}
        title={review === "APPROVE" ? "Approve work" : "Request changes"}
        message="This is recorded on the task and Impact Points ledger."
        confirmLabel={review === "APPROVE" ? "Approve" : "Request changes"}
        danger={review !== "APPROVE"}
        onConfirm={completeReview}
      />

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create task"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setCreateOpen(false)}>
              Cancel
            </button>
            <button type="submit" form="create-task" className="btn-primary" disabled={creating}>
              {creating ? "Saving..." : "Create task"}
            </button>
          </>
        }
      >
        <form id="create-task" className="form-grid" onSubmit={createTask}>
          {createError ? <div className="alert alert-error">{createError}</div> : null}
          <label>
            Title
            <input
              value={taskForm.title}
              onChange={(event) => setTaskForm((prev) => ({ ...prev, title: event.target.value }))}
              required
            />
          </label>
          <label>
            Description
            <textarea
              value={taskForm.description}
              onChange={(event) => setTaskForm((prev) => ({ ...prev, description: event.target.value }))}
              required
            />
          </label>
          <label>
            Assignee
            <select
              value={taskForm.assigneeId}
              onChange={(event) => setTaskForm((prev) => ({ ...prev, assigneeId: event.target.value }))}
              required
            >
              <option value="">Select</option>
              {people.map((person) => (
                <option key={person._id} value={person._id}>
                  {person.fullName}
                </option>
              ))}
            </select>
          </label>
          <label>
            Priority
            <select
              value={taskForm.priority}
              onChange={(event) => setTaskForm((prev) => ({ ...prev, priority: event.target.value }))}
            >
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
              <option value="CRITICAL">Critical</option>
            </select>
          </label>
          <label>
            Deadline
            <input
              type="date"
              value={taskForm.deadline}
              onChange={(event) => setTaskForm((prev) => ({ ...prev, deadline: event.target.value }))}
              required
            />
          </label>
        </form>
      </Modal>
    </div>
  );
}
