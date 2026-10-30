import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Calendar,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock,
  ListTodo,
} from "lucide-react";
import StatusBadge from "../../components/StatusBadge";
import Modal from "../../components/Modal";
import SearchBar from "../../components/SearchBar";
import EmptyState, { ErrorState, Skeleton } from "../../components/EmptyState";
import SoftRefresh from "../../components/SoftRefresh";
import ProfileAvatar, { initialsFrom } from "../../components/ProfileAvatar";
import { useToast } from "../../components/Toast";
import { useAuth } from "../../app/AuthContext";
import { useNotify } from "../../app/notifyContext";
import api from "../../services/api";
import {
  addCivilDays,
  formatCivilDate,
  formatDisplayDate,
  getCompanyBusinessDate,
  parseCivilDate,
  resolveCompanyTimezone,
} from "../../utils/dateUtils";
import {
  useDashboardQuery,
  useImpactMeQuery,
  useMyTasksQuery,
  useTasksMetaQuery,
  useTeamTasksQuery,
} from "../../hooks/useEmployeeQueries";
import { invalidateEmployeeWork, qk } from "../../app/queryKeys";

const PENDING_STATUSES = ["ASSIGNED", "CHANGES_REQUESTED"];
const IN_PROGRESS_STATUSES = ["IN_PROGRESS", "SUBMITTED"];
const COMPLETED_STATUSES = ["APPROVED", "REJECTED"];

function statusOf(task) {
  return String(task?.status || "").toUpperCase();
}

function matchesFilter(task, tab) {
  const status = statusOf(task);
  if (tab === "ALL" || tab === "TEAM") return true;
  if (tab === "PENDING") return PENDING_STATUSES.includes(status);
  if (tab === "IN_PROGRESS") return IN_PROGRESS_STATUSES.includes(status);
  if (tab === "COMPLETED") return COMPLETED_STATUSES.includes(status);
  return true;
}

function tomorrowStr(todayStr) {
  const parts = parseCivilDate(todayStr);
  if (!parts) return "";
  const next = addCivilDays(parts.year, parts.month, parts.day, 1);
  return formatCivilDate(next.year, next.month, next.day);
}

function deadlineInfo(task, todayStr, timezone) {
  const status = statusOf(task);
  const completed = COMPLETED_STATUSES.includes(status);
  if (!task?.deadline) {
    return { group: completed ? "completed" : "upcoming", label: "No deadline", overdue: false, dueSoon: false };
  }
  const due = getCompanyBusinessDate(new Date(task.deadline), timezone);
  const dated = formatDisplayDate(task.deadline, timezone);
  if (!due) {
    return { group: completed ? "completed" : "upcoming", label: "No deadline", overdue: false, dueSoon: false };
  }
  if (completed) {
    return { group: "completed", label: dated, overdue: false, dueSoon: false };
  }
  if (due === todayStr) {
    return { group: "today", label: "Due today", overdue: false, dueSoon: true };
  }
  if (due < todayStr) {
    return { group: "today", label: `Overdue · ${dated}`, overdue: true, dueSoon: false };
  }
  if (due === tomorrowStr(todayStr)) {
    return { group: "upcoming", label: "Tomorrow", overdue: false, dueSoon: true };
  }
  return { group: "upcoming", label: dated, overdue: false, dueSoon: false };
}

function pointsFor(task) {
  const awarded = Number(task?.pointsAwarded);
  if (Number.isFinite(awarded) && awarded > 0) return awarded;
  const priority = String(task?.priority || "").toUpperCase();
  return priority === "CRITICAL" || priority === "HIGH" ? 20 : 10;
}

function emptyMessage(tab) {
  if (tab === "PENDING") return "No pending tasks assigned to you.";
  if (tab === "IN_PROGRESS") return "No tasks in progress.";
  if (tab === "COMPLETED") return "No completed tasks yet.";
  if (tab === "TEAM") return "No team submissions waiting for review.";
  return "No tasks assigned to you.";
}

function normalizeLink(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function firstNameOf(value) {
  return String(value || "Colleague").trim().split(/\s+/)[0] || "Colleague";
}

function greetingForHour(date = new Date()) {
  const hour = date.getHours();
  if (hour < 12) return "Good morning,";
  if (hour < 17) return "Good afternoon,";
  return "Good evening,";
}

function taskIcon(status) {
  if (status === "APPROVED") return CheckCircle2;
  if (status === "SUBMITTED" || status === "CHANGES_REQUESTED") return ClipboardList;
  if (status === "IN_PROGRESS") return ListTodo;
  return Calendar;
}

function folderTone(group, index) {
  if (group === "today") return "is-today";
  if (group === "upcoming") return "is-upcoming";
  return index % 2 === 0 ? "is-done-a" : "is-done-b";
}

export default function EmployeeTasksPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const notify = useNotify();
  const { company, user } = useAuth();
  const timezone = resolveCompanyTimezone(company);
  const [todayStr, setTodayStr] = useState(() => getCompanyBusinessDate(new Date(), timezone));
  const [tab, setTab] = useState("ALL");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [priority] = useState("ALL");
  const [selected, setSelected] = useState(null);
  const [modalMode, setModalMode] = useState("detail");
  const [detailLoading, setDetailLoading] = useState(false);
  const [notes, setNotes] = useState("");
  const [links, setLinks] = useState([""]);
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [startingId, setStartingId] = useState("");
  const [uploading, setUploading] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [actionError, setActionError] = useState("");

  const closeModal = () => {
    setSelected(null);
    setModalMode("detail");
    setSubmitError("");
    setBusy(false);
  };

  useEffect(() => {
    setTodayStr(getCompanyBusinessDate(new Date(), timezone));
  }, [timezone]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), search ? 250 : 0);
    return () => clearTimeout(timer);
  }, [search]);

  const dashQuery = useDashboardQuery();
  const impactQuery = useImpactMeQuery({ retry: 0 });
  const metaQuery = useTasksMetaQuery();
  const isManager = Boolean(metaQuery.data?.isManager);
  // Client Today/Upcoming/Completed grouping needs a broader page of tasks;
  // server page UI would hide grouped items across pages.
  const taskParams = { page: 1, limit: 50, search: debouncedSearch, priority };
  const myTasksQuery = useMyTasksQuery(taskParams);
  const teamTasksQuery = useTeamTasksQuery(taskParams, { enabled: isManager });

  const tasks = useMemo(() => {
    const raw = myTasksQuery.data;
    return Array.isArray(raw) ? raw : Array.isArray(raw?.tasks) ? raw.tasks : [];
  }, [myTasksQuery.data]);
  const teamTasks = useMemo(() => {
    if (!isManager) return [];
    const raw = teamTasksQuery.data;
    return Array.isArray(raw) ? raw : Array.isArray(raw?.tasks) ? raw.tasks : [];
  }, [isManager, teamTasksQuery.data]);
  const loading = myTasksQuery.isLoading && tasks.length === 0;
  const error = actionError
    || myTasksQuery.error?.response?.data?.message
    || myTasksQuery.error?.message
    || "";
  const refreshing = (myTasksQuery.isFetching || teamTasksQuery.isFetching) && tasks.length > 0;

  const employee = dashQuery.data?.employee;
  const fullName = employee?.preferredName || employee?.fullName || user?.fullName || user?.email || "Colleague";
  const firstName = firstNameOf(fullName);
  const impactBalance = impactQuery.data?.balance ?? impactQuery.data?.points ?? impactQuery.data?.totalPoints;
  const pointsLabel = Number.isFinite(Number(impactBalance)) ? Number(impactBalance) : null;

  const load = () => Promise.all([
    myTasksQuery.refetch(),
    isManager ? teamTasksQuery.refetch() : Promise.resolve(),
  ]);

  useEffect(() => {
    setSelected((prev) => {
      if (!prev) return prev;
      const found = tasks.find((task) => task._id === prev._id) || teamTasks.find((task) => task._id === prev._id);
      if (!found) return prev;
      return {
        ...prev,
        ...found,
        description: found.description || prev.description,
        acceptanceCriteria: found.acceptanceCriteria?.length ? found.acceptanceCriteria : prev.acceptanceCriteria,
        deliverables: found.deliverables?.length ? found.deliverables : prev.deliverables,
        review: found.review || prev.review,
        submissionNotes: found.submissionNotes || prev.submissionNotes,
      };
    });
  }, [tasks, teamTasks]);

  const counts = useMemo(() => ({
    ALL: tasks.length,
    PENDING: tasks.filter((task) => matchesFilter(task, "PENDING")).length,
    IN_PROGRESS: tasks.filter((task) => matchesFilter(task, "IN_PROGRESS")).length,
    COMPLETED: tasks.filter((task) => matchesFilter(task, "COMPLETED")).length,
    TEAM: teamTasks.length,
  }), [tasks, teamTasks]);

  const visible = useMemo(
    () => (tab === "TEAM" ? teamTasks : tasks.filter((task) => matchesFilter(task, tab))),
    [tasks, teamTasks, tab]
  );

  const groups = useMemo(() => {
    const today = [];
    const upcoming = [];
    const completed = [];
    visible.forEach((task) => {
      const info = deadlineInfo(task, todayStr, timezone);
      if (tab === "COMPLETED" || info.group === "completed") completed.push(task);
      else if (info.group === "today") today.push(task);
      else upcoming.push(task);
    });
    return { today, upcoming, completed };
  }, [visible, todayStr, timezone, tab]);

  const patchTaskCaches = (full) => {
    if (!full?._id) return;
    queryClient.setQueryData(qk.task(full._id), full);
    queryClient.setQueriesData({ queryKey: ["employee", "tasks"] }, (prev) => {
      if (!Array.isArray(prev)) return prev;
      return prev.map((item) => (item._id === full._id ? { ...item, ...full } : item));
    });
  };

  const openTask = async (task, { submit = false } = {}) => {
    setSelected(task);
    setSubmitError("");
    if (submit) {
      setNotes(task.submissionNotes || "");
      const existingLinks = (task.deliverables || []).flatMap((item) => item.links || []).filter(Boolean);
      setLinks(existingLinks.length ? existingLinks : [""]);
      setFiles([]);
      setModalMode("submit");
    } else {
      setModalMode("detail");
    }
    try {
      setDetailLoading(true);
      const res = await api.get(`/tasks/${task._id}`);
      const full = res.data?.task || res.data?.data || task;
      setSelected(full);
      patchTaskCaches(full);
      if (submit) {
        setNotes(full.submissionNotes || task.submissionNotes || "");
        const existingLinks = (full.deliverables || task.deliverables || [])
          .flatMap((item) => item.links || [])
          .filter(Boolean);
        setLinks(existingLinks.length ? existingLinks : [""]);
      }
    } catch (err) {
      setSubmitError(err.response?.data?.message || "Could not refresh task details. Showing the latest list data.");
    } finally {
      setDetailLoading(false);
    }
  };

  const start = async (task) => {
    try {
      setBusy(true);
      setStartingId(task._id);
      setActionError("");
      await api.post(`/tasks/${task._id}/start`);
      toast.push("Task started.");
      await invalidateEmployeeWork(queryClient);
      await openTask({ ...task, status: "IN_PROGRESS" });
    } catch (err) {
      setActionError(err.response?.data?.message || "Could not start task.");
    } finally {
      setBusy(false);
      setStartingId("");
    }
  };

  const onFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setSubmitError("File size exceeds 10MB limit.");
      return;
    }
    try {
      setUploading(true);
      setSubmitError("");
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const res = await api.post("/tasks/upload", {
        fileName: file.name,
        fileData: base64,
        mimeType: file.type,
      });
      const fileInfo = res.data?.data || res.data?.attachment || {};
      if (!fileInfo.fileName && !fileInfo.documentUrl && !fileInfo.fileUrl) {
        setSubmitError("Could not attach evidence.");
        return;
      }
      setFiles((prev) => [...prev, fileInfo]);
    } catch (err) {
      setSubmitError(err.response?.data?.message || "File upload failed.");
    } finally {
      setUploading(false);
    }
  };

  const openSubmit = (task) => {
    const target = task || selected;
    if (!target) return;
    setSelected(target);
    setNotes(target.submissionNotes || "");
    const existingLinks = (target.deliverables || []).flatMap((item) => item.links || []).filter(Boolean);
    setLinks(existingLinks.length ? existingLinks : [""]);
    setFiles([]);
    setSubmitError("");
    setModalMode("submit");
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!selected || busy || uploading) return;
    const validLinks = links.map(normalizeLink).filter(Boolean);
    const deliverables = [];
    if (validLinks.length) {
      deliverables.push({
        description: "Deliverable Links & References",
        links: validLinks,
      });
    }
    files.forEach((file) => {
      deliverables.push({
        description: file.fileName || "Evidence",
        documentUrl: file.documentUrl || file.fileUrl || "",
        fileName: file.fileName || "",
        fileSize: file.fileSize || 0,
        mimeType: file.mimeType || "",
        storageKey: file.storageKey || "",
      });
    });
    if (!notes.trim() && deliverables.length === 0) {
      setSubmitError("Please provide submission notes or attach deliverables before submitting.");
      return;
    }
    if (!notes.trim()) {
      setSubmitError("Please describe the work completed.");
      return;
    }
    try {
      setBusy(true);
      setSubmitError("");
      const res = await api.post(`/tasks/${selected._id}/submit`, {
        submissionNotes: notes.trim(),
        deliverables,
      });
      const updated =
        res.data?.task ||
        res.data?.data ||
        {
          ...selected,
          status: "SUBMITTED",
          submissionNotes: notes.trim(),
          deliverables: deliverables.length ? deliverables : selected.deliverables,
        };
      setSelected(updated);
      patchTaskCaches(updated);
      setModalMode("detail");
      setNotes("");
      setLinks([""]);
      setFiles([]);
      toast.push("Work submitted for verification.");
      try {
        await invalidateEmployeeWork(queryClient);
      } catch {
        // Submission already succeeded; list will catch up on next natural refetch.
      }
    } catch (err) {
      setSubmitError(err.response?.data?.message || "Could not submit work.");
    } finally {
      setBusy(false);
    }
  };

  const selectedInfo = selected ? deadlineInfo(selected, todayStr, timezone) : null;
  const selectedStatus = statusOf(selected);
  const teamView = tab === "TEAM";
  const canStart = !teamView && selectedStatus === "ASSIGNED";
  const canSubmit = !teamView && (selectedStatus === "IN_PROGRESS" || selectedStatus === "CHANGES_REQUESTED");
  const awaitingReview = !teamView && selectedStatus === "SUBMITTED";

  const chips = [
    { value: "ALL", label: "All", count: counts.ALL },
    { value: "PENDING", label: "Pending", count: counts.PENDING },
    { value: "IN_PROGRESS", label: "In Progress", count: counts.IN_PROGRESS },
    { value: "COMPLETED", label: "Completed", count: counts.COMPLETED },
  ];
  if (isManager) {
    chips.push({ value: "TEAM", label: "Team", count: counts.TEAM });
  }

  const renderFolder = (task, groupKey, index, stackSize) => {
    const info = deadlineInfo(task, todayStr, timezone);
    const status = statusOf(task);
    const IconCmp = taskIcon(status);
    const DueIcon = info.overdue ? Clock : Calendar;
    const metaBits = [info.label];
    if (task.projectName && task.projectName !== "General") metaBits.push(task.projectName);
    const dueClass = info.overdue ? " is-overdue" : "";

    return (
      <button
        key={task._id}
        type="button"
        className={`tk-folder ${folderTone(groupKey, index)}`}
        style={{ zIndex: stackSize - index }}
        onClick={() => openTask(task)}
      >
        <span className={`tk-folder-ico is-${groupKey}`} aria-hidden="true">
          <IconCmp size={18} strokeWidth={2} />
        </span>
        <span className="tk-folder-main">
          <strong className="tk-folder-title">{task.title}</strong>
          <span className={`tk-folder-due${dueClass}`}>
            <DueIcon size={12} strokeWidth={2} aria-hidden="true" />
            {metaBits.join(" · ")}
          </span>
        </span>
        <StatusBadge status={task.status} />
        <span className="tk-folder-chevron" aria-hidden="true">
          <ChevronRight size={16} strokeWidth={2.25} />
        </span>
      </button>
    );
  };

  const renderStack = (title, groupKey, rows, dotClass) => {
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
        <div className="tk-folder-stack">
          {rows.map((task, index) => renderFolder(task, groupKey, index, rows.length))}
        </div>
      </section>
    );
  };

  const pageHeader = (
    <header className="tk-hero">
      <div className="tk-hero-left">
        <span className="summary-avatar tk-hero-avatar">{initialsFrom(fullName)}</span>
        <div>
          <p className="tk-hero-greet">{greetingForHour()}</p>
          <h1 className="tk-hero-title">My Tasks</h1>
        </div>
      </div>
      <div className="tk-hero-right">
        {pointsLabel != null ? (
          <span className="tk-points-pill" title="Impact Points">
            <span className="tk-points-coin" aria-hidden="true" />
            {pointsLabel}
          </span>
        ) : null}
        <button type="button" className="icon-btn emp-id-action" onClick={() => notify()} aria-label="Notifications">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" aria-hidden="true">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        </button>
      </div>
    </header>
  );

  if (loading) {
    return (
      <div className="tk-page tk-page--folders">
        {pageHeader}
        <Skeleton />
      </div>
    );
  }
  if (error && tasks.length === 0) {
    return (
      <div className="tk-page tk-page--folders">
        {pageHeader}
        <ErrorState message={error} onRetry={load} />
      </div>
    );
  }

  return (
    <div className="tk-page tk-page--folders">
      {pageHeader}

      {refreshing ? (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
          <SoftRefresh active />
        </div>
      ) : null}
      {error ? <div className="alert alert-error">{error}</div> : null}

      <SearchBar value={search} onChange={setSearch} placeholder="Find a task" />

      <div className="chip-row tk-chip-row" role="tablist" aria-label="Task filters">
        {chips.map((chip) => (
          <button
            key={chip.value}
            type="button"
            role="tab"
            aria-selected={tab === chip.value}
            className={`chip${tab === chip.value ? " is-active" : ""}`}
            onClick={() => setTab(chip.value)}
          >
            {chip.label} ({chip.count})
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <EmptyState message={emptyMessage(tab)} />
      ) : teamView || tab === "COMPLETED" ? (
        renderStack(
          tab === "COMPLETED" ? "Completed" : "Team review queue",
          "completed",
          visible,
          tab === "COMPLETED" ? "is-done" : "is-upcoming"
        )
      ) : (
        <>
          {renderStack("Today", "today", groups.today, "is-today")}
          {renderStack("Upcoming", "upcoming", groups.upcoming, "is-upcoming")}
          {renderStack("Completed", "completed", groups.completed, "is-done")}
        </>
      )}

      <Modal
        open={Boolean(selected)}
        onClose={closeModal}
        title={
          modalMode === "submit" ? (
            "Submit for verification"
          ) : (
            <span className="tk-modal-title">
              <span>{selected?.title || "Task"}</span>
              {selected ? <StatusBadge status={selected.status} /> : null}
            </span>
          )
        }
        footer={
          modalMode === "submit" ? (
            <>
              <button type="button" className="btn-secondary" disabled={busy} onClick={() => setModalMode("detail")}>
                Back
              </button>
              <button type="submit" form="submit-task" className="btn-primary" disabled={busy || uploading}>
                {busy ? "Submitting..." : "Submit for verification"}
              </button>
            </>
          ) : canStart || canSubmit || awaitingReview ? (
            <>
              {canStart ? (
                <button type="button" className="btn-primary" disabled={busy || startingId === selected?._id} onClick={() => start(selected)}>
                  {busy || startingId === selected?._id ? "Starting..." : "Start task"}
                </button>
              ) : null}
              {canSubmit ? (
                <button type="button" className="btn-primary" disabled={busy} onClick={() => openSubmit(selected)}>
                  {selectedStatus === "CHANGES_REQUESTED" ? "Resubmit work" : "Submit for verification"}
                </button>
              ) : null}
              {awaitingReview ? (
                <p className="caption" style={{ margin: 0, width: "100%" }}>Awaiting manager review. You cannot approve your own task.</p>
              ) : null}
            </>
          ) : null
        }
      >
        {selected && modalMode === "submit" ? (
          <form id="submit-task" className="form-grid" onSubmit={submit}>
            {submitError ? <div className="alert alert-error">{submitError}</div> : null}
            <label>
              Completion notes
              <textarea
                required
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Describe the solution implemented, verified criteria, outcomes, and any access or credentials still needed..."
              />
            </label>
            <p className="caption">
              There is no separate credentials ticket. If you need logins, keys, or environment access, include that in these notes or attach a link so the reviewer can provide them.
            </p>
            <div className="form-grid">
              <span className="caption">Deliverable links (PR, Figma, docs)</span>
              {links.map((link, index) => (
                <div key={`link-${index}`} className="tk-link-row">
                  <input
                    type="url"
                    value={link}
                    placeholder="https://..."
                    onChange={(event) => {
                      const next = [...links];
                      next[index] = event.target.value;
                      setLinks(next);
                    }}
                  />
                  {links.length > 1 ? (
                    <button
                      type="button"
                      className="btn-ghost"
                      aria-label="Remove link"
                      onClick={() => setLinks(links.filter((_, itemIndex) => itemIndex !== index))}
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              ))}
              <button type="button" className="btn-secondary" onClick={() => setLinks((prev) => [...prev, ""])}>
                Add link
              </button>
            </div>
            <label>
              Evidence
              <input type="file" onChange={onFile} disabled={uploading || busy} />
            </label>
            {uploading ? <p className="caption">Uploading file...</p> : null}
            {files.length ? (
              <ul className="tk-files">
                {files.map((file) => (
                  <li key={file.storageKey || file.fileName} className="tk-file tk-file-row">
                    <span>{file.fileName}</span>
                    <button type="button" className="btn-ghost" onClick={() => setFiles((prev) => prev.filter((item) => item !== file))}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </form>
        ) : selected ? (
          <dl className="lv-detail">
            {detailLoading ? <p className="caption">Refreshing details...</p> : null}
            {submitError ? <div className="alert alert-error">{submitError}</div> : null}
            <div>
              <dt>Status</dt>
              <dd><StatusBadge status={selected.status} /></dd>
            </div>
            <div>
              <dt>Project</dt>
              <dd>{selected.projectName || "General"}</dd>
            </div>
            <div>
              <dt>Deadline</dt>
              <dd>{selectedInfo?.label || "No deadline"}</dd>
            </div>
            <div>
              <dt>Assigned by</dt>
              <dd>{selected.assignedBySnapshot?.fullName || selected.assignedBySnapshot?.email || "HR Admin"}</dd>
            </div>
            <div>
              <dt>Points reward</dt>
              <dd>+{pointsFor(selected)} pts</dd>
            </div>
            {selected.description ? (
              <div>
                <dt>Description</dt>
                <dd>{selected.description}</dd>
              </div>
            ) : null}
            {selected.acceptanceCriteria?.length ? (
              <div>
                <dt>Acceptance criteria</dt>
                <dd>
                  <ul className="tk-criteria">
                    {selected.acceptanceCriteria.map((item, index) => (
                      <li key={`${item}-${index}`}>{item}</li>
                    ))}
                  </ul>
                </dd>
              </div>
            ) : null}
            {selected.review?.comments ? (
              <div>
                <dt>{selectedStatus === "CHANGES_REQUESTED" ? "Changes requested" : "Reviewer comments"}</dt>
                <dd>{selected.review.comments}</dd>
              </div>
            ) : null}
            {selected.submissionNotes || selected.deliverables?.length ? (
              <div>
                <dt>Submitted work</dt>
                <dd>
                  {selected.submissionNotes ? <p style={{ margin: "0 0 8px" }}>{selected.submissionNotes}</p> : null}
                  {(selected.deliverables || []).map((item, index) => (
                    <div key={item.storageKey || item.fileName || index} className="tk-file">
                      {item.description || item.fileName}
                      {(item.links || []).map((link) => (
                        <div key={link}>
                          <a href={link} target="_blank" rel="noopener noreferrer">{link}</a>
                        </div>
                      ))}
                    </div>
                  ))}
                </dd>
              </div>
            ) : null}
            {awaitingReview ? (
              <div>
                <dt>Verification</dt>
                <dd>Submitted and waiting for manager or HR verification.</dd>
              </div>
            ) : null}
          </dl>
        ) : null}
      </Modal>
    </div>
  );
}
