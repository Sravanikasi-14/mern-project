import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import AppHeader from "../components/AppHeader";
import SoftRefresh from "../components/SoftRefresh";
import StatusBadge from "../components/StatusBadge";
import Pagination from "../components/Pagination";
import { TableSkeletonRows } from "../components/TableSkeleton";
import {
  IconCheck,
  IconClose,
  IconAlertCircle,
  IconSearch,
  IconCalendar,
} from "../components/EmployeeIcon";
import AppModal from "../components/AppModal";
import api from "../services/api";
import { useAuth } from "../context/AuthContext";
import {
  useImpactMeQuery,
  useMyTasksQuery,
  useTasksMetaQuery,
} from "../hooks/useEmployeeQueries";
import { invalidateEmployeeWork } from "../lib/queryKeys";
import {
  buildWeekStrip,
  formatDisplayDate,
  isCompletedToday,
  resolveCompanyTimezone,
  toDateOnlyString,
} from "../utils/dateUtils";
import "./WorkManagement.css";

const EMPLOYEE_TABS = {
  ALL: "ALL",
  TODO: "ASSIGNED",
  IN_PROGRESS: "IN_PROGRESS",
  SUBMITTED: "SUBMITTED",
  COMPLETED: "APPROVED",
  TEAM_QUEUE: "TEAM_QUEUE",
};

const VIEW_MODES = {
  KANBAN: "KANBAN",
  LIST: "LIST",
};

export default function EmployeeTasks() {
  const { user, company } = useAuth();
  const queryClient = useQueryClient();
  const timeZone = resolveCompanyTimezone(company);
  const [activeTab, setActiveTab] = useState(EMPLOYEE_TABS.ALL);
  const [viewMode, setViewMode] = useState(VIEW_MODES.KANBAN);
  const [actionError, setActionError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // Filters
  const [priorityFilter, setPriorityFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [searchApplied, setSearchApplied] = useState("");
  const [selectedProject, setSelectedProject] = useState("ALL");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);

  const metaQuery = useTasksMetaQuery();
  const impactQuery = useImpactMeQuery();
  const meta = metaQuery.data || {
    userRole: "",
    isManager: false,
    directReportsCount: 0,
    assignableEmployees: [],
    departments: [],
  };
  const myPoints = impactQuery.data ?? null;

  const taskParams = useMemo(() => {
    const params = {
      page,
      limit,
      priority: priorityFilter,
      search: searchApplied,
      scope: "my_tasks",
      status: "",
      completedScope: "",
    };
    if (activeTab === EMPLOYEE_TABS.TEAM_QUEUE) {
      params.scope = "team_tasks";
      params.status = "SUBMITTED";
    } else if (activeTab !== EMPLOYEE_TABS.ALL) {
      params.status = activeTab;
    }
    if (viewMode === VIEW_MODES.KANBAN && activeTab !== EMPLOYEE_TABS.TEAM_QUEUE) {
      params.completedScope = "today";
    }
    return params;
  }, [activeTab, priorityFilter, searchApplied, page, limit, viewMode]);

  const tasksQuery = useMyTasksQuery(taskParams);
  const tasks = tasksQuery.data?.tasks || [];
  const pagination = {
    page,
    limit,
    total: tasksQuery.data?.pagination?.total ?? tasks.length,
    pages: tasksQuery.data?.pagination?.pages ?? 1,
  };
  const loading = tasksQuery.isLoading && !tasksQuery.data;
  const queryError = tasksQuery.error?.response?.data?.message || (tasksQuery.error ? "Failed to load tasks" : "");
  const error = actionError || queryError;

  // Drag and Drop state
  const [draggedTaskId, setDraggedTaskId] = useState(null);
  const [dragOverCol, setDragOverCol] = useState(null);

  // Side Panel state: 'none' | 'details' | 'submit'
  const [sidePanelMode, setSidePanelMode] = useState("none");
  const [selectedTask, setSelectedTask] = useState(null);

  // Task Execution & Submission State
  const [startingTaskId, setStartingTaskId] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitForm, setSubmitForm] = useState({
    notes: "",
    links: [""],
    files: [],
  });
  const [uploadingFile, setUploadingFile] = useState(false);

  useEffect(() => {
    if (!selectedTask || !tasksQuery.data?.tasks) return;
    const updated = tasksQuery.data.tasks.find((t) => t._id === selectedTask._id);
    if (updated) setSelectedTask(updated);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasksQuery.data]);

  useEffect(() => {
    setPage(1);
  }, [activeTab, priorityFilter, viewMode]);

  // Auto-dismiss toasts after 4.5 seconds
  useEffect(() => {
    if (error || successMsg) {
      const timer = setTimeout(() => {
        setActionError("");
        setSuccessMsg("");
      }, 4500);
      return () => clearTimeout(timer);
    }
  }, [error, successMsg]);

  const patchTasksCache = (updater) => {
    queryClient.setQueriesData({ queryKey: ["employee", "tasks"] }, (old) => {
      if (!old?.tasks) return old;
      return { ...old, tasks: updater(old.tasks) };
    });
  };

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    setPage(1);
    setSearchApplied(search);
  };

  // Start Task
  const handleStartTask = async (task) => {
    try {
      setStartingTaskId(task._id);
      setActionError("");
      const res = await api.post(`/tasks/${task._id}/start`);
      if (res.data?.success) {
        const updatedTask = res.data.task || res.data.data || {
          ...task,
          status: "IN_PROGRESS",
          startDate: new Date().toISOString(),
        };
        setSuccessMsg(`Task "${task.title}" is now In Progress.`);
        patchTasksCache((prev) => prev.map((t) => (t._id === updatedTask._id ? updatedTask : t)));
        if (selectedTask?._id === task._id) setSelectedTask(updatedTask);
        await invalidateEmployeeWork(queryClient);
      }
    } catch (err) {
      setActionError(err.response?.data?.message || "Failed to start task");
    } finally {
      setStartingTaskId(null);
    }
  };

  // Drag and drop handlers
  const handleDragStart = (e, task) => {
    e.dataTransfer.setData("text/plain", task._id);
    e.dataTransfer.effectAllowed = "move";
    setDraggedTaskId(task._id);
  };

  const handleDragEnd = () => {
    setDraggedTaskId(null);
    setDragOverCol(null);
  };

  const handleDragOver = (e, status) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverCol !== status) {
      setDragOverCol(status);
    }
  };

  const handleDragLeave = (e) => {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setDragOverCol(null);
  };

  const handleDrop = async (e, targetStatus) => {
    e.preventDefault();
    setDragOverCol(null);
    const taskId = e.dataTransfer.getData("text/plain") || draggedTaskId;
    if (!taskId) return;

    const task = tasks.find((t) => t._id === taskId);
    if (!task || task.status === targetStatus) return;

    // Check Employee Role authorization for status transitions
    if (targetStatus === "APPROVED") {
      setActionError("Task approval requires manager or HR verification.");
      return;
    }

    if (targetStatus === "ASSIGNED") {
      setActionError("Only the assigning manager or an HR Admin can reassign tasks.");
      return;
    }

    if (targetStatus === "SUBMITTED") {
      if (task.status === "ASSIGNED") {
        // Start task then open submit drawer
        await handleStartTask(task);
      }
      setSelectedTask(task);
      setSubmitError("");
      setSidePanelMode("submit");
      return;
    }

    if (targetStatus === "IN_PROGRESS") {
      if (task.status === "ASSIGNED") {
        handleStartTask(task);
        return;
      }
      if (task.status === "SUBMITTED") {
        setActionError("Deliverables already submitted. Awaiting manager review.");
        return;
      }
    }
  };

  // Submit Evidence
  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      setSubmitError("File size exceeds 10MB limit");
      return;
    }

    try {
      setUploadingFile(true);
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

      if (res.data?.success) {
        const fileInfo = res.data?.data || res.data?.attachment || {};
        setSubmitForm((prev) => ({
          ...prev,
          files: [...prev.files, fileInfo],
        }));
        await invalidateEmployeeWork(queryClient);
      }
    } catch (err) {
      setSubmitError(err.response?.data?.message || "File upload failed");
    } finally {
      setUploadingFile(false);
      e.target.value = "";
    }
  };

  const handleSubmitEvidence = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!selectedTask) return;

    const deliverables = [];
    const validLinks = submitForm.links
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => (/^https?:\/\//i.test(l) ? l : `https://${l}`));

    if (validLinks.length > 0) {
      deliverables.push({
        description: "Deliverable Links & References",
        links: validLinks,
      });
    }
    submitForm.files.forEach((f) => {
      deliverables.push({
        description: f.fileName,
        documentUrl: f.documentUrl || f.fileUrl,
        fileName: f.fileName,
        fileSize: f.fileSize,
      });
    });

    if (deliverables.length === 0 && !submitForm.notes.trim()) {
      setSubmitError("Please provide submission notes or attach deliverables before submitting.");
      return;
    }

    try {
      setSubmitting(true);
      setSubmitError("");
      const res = await api.post(`/tasks/${selectedTask._id}/submit`, {
        submissionNotes: submitForm.notes.trim(),
        deliverables,
      });

      if (res.data?.success) {
        const updatedTask = res.data.task || {
          ...selectedTask,
          status: "SUBMITTED",
          deliverables,
          submissionNotes: submitForm.notes.trim(),
          submittedAt: new Date().toISOString(),
        };
        setSelectedTask(updatedTask);
        patchTasksCache((prev) => prev.map((t) => (t._id === updatedTask._id ? updatedTask : t)));
        setSuccessMsg(`Task "${selectedTask.title}" submitted successfully for verification.`);
        setSubmitForm({ notes: "", links: [""], files: [] });
        setSidePanelMode("none");
        await invalidateEmployeeWork(queryClient);
      }
    } catch (err) {
      setSubmitError(err.response?.data?.message || "Failed to submit deliverables");
    } finally {
      setSubmitting(false);
    }
  };

  // Metrics (Personal summary inspired by Stitch screen & Pryme reference)
  const metrics = useMemo(() => {
    const list = tasks || [];
    const now = new Date();
    const upcomingDeadlines = list.filter((t) => {
      if (!t.deadline || t.status === "APPROVED") return false;
      const due = new Date(t.deadline);
      const diffHours = (due - now) / (1000 * 60 * 60);
      return diffHours > 0 && diffHours <= 48;
    }).length;

    const overdueCount = list.filter((t) => {
      if (!t.deadline || t.status === "APPROVED") return false;
      return new Date(t.deadline) < now;
    }).length;

    return {
      inProgress: list.filter((t) => t.status === "IN_PROGRESS").length,
      completed: list.filter((t) => t.status === "APPROVED").length,
      upcoming: upcomingDeadlines,
      overdue: overdueCount,
      points: myPoints?.currentBalance || 0,
      rank: myPoints?.currentRank || "—",
    };
  }, [tasks, myPoints]);

  // Project Filter list
  const projectSummaries = useMemo(() => {
    const map = {};
    (tasks || []).forEach((t) => {
      const pName = t.projectName?.trim() || "General";
      if (!map[pName]) {
        map[pName] = { name: pName, count: 0 };
      }
      map[pName].count += 1;
    });
    return Object.values(map);
  }, [tasks]);

  const displayedTasks = useMemo(() => {
    if (selectedProject === "ALL") return tasks;
    return tasks.filter((t) => (t.projectName?.trim() || "General") === selectedProject);
  }, [tasks, selectedProject]);

  const weeklyTimeline = useMemo(() => {
    return buildWeekStrip(new Date(), timeZone, 1).map((day) => ({
      ...day,
      tasks: (tasks || []).filter((t) => t.deadline && toDateOnlyString(t.deadline, timeZone) === day.dateStr),
    }));
  }, [tasks, timeZone]);

  // Kanban Columns
  const kanbanColumns = [
    {
      id: "ASSIGNED",
      title: "To Do / Assigned",
      dotClass: "col-assigned",
      tasks: displayedTasks.filter((t) => t.status === "ASSIGNED"),
    },
    {
      id: "IN_PROGRESS",
      title: "In Progress",
      dotClass: "col-in-progress",
      tasks: displayedTasks.filter((t) => t.status === "IN_PROGRESS"),
    },
    {
      id: "SUBMITTED",
      title: "Under Review",
      dotClass: "col-submitted",
      tasks: displayedTasks.filter((t) => t.status === "SUBMITTED" || t.status === "CHANGES_REQUESTED"),
    },
    {
      id: "APPROVED",
      title: "Completed today",
      dotClass: "col-approved",
      tasks: displayedTasks.filter((t) => isCompletedToday(t, timeZone)),
    },
  ];

  const getDeadlineInfo = (deadlineDate, status) => {
    if (!deadlineDate) return { text: "No deadline", isOverdue: false, isSoon: false };
    const now = new Date();
    const due = new Date(deadlineDate);
    const diffHours = (due - now) / (1000 * 60 * 60);

    if (due < now && status !== "APPROVED") {
      return { text: "Overdue", isOverdue: true, isSoon: false };
    }
    if (diffHours <= 48 && status !== "APPROVED") {
      return { text: "Due in ≤48h", isOverdue: false, isSoon: true };
    }
    return { text: due.toLocaleDateString(), isOverdue: false, isSoon: false };
  };

  const selectTaskDetails = (task) => {
    setSelectedTask(task);
    setSidePanelMode("details");
  };

  return (
    <div className="container-wide split-page-container wm-page-container">
      {/* Compact Top Header */}
      <AppHeader
        title="My Tasks"
        hideLogout={true}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <SoftRefresh active={tasksQuery.isFetching && !!tasksQuery.data} />
          <div className="wm-view-switcher" role="tablist" aria-label="Task view">
            <button
              type="button"
              className={`wm-tab-btn ${viewMode === VIEW_MODES.KANBAN ? "active" : ""}`}
              onClick={() => setViewMode(VIEW_MODES.KANBAN)}
            >
              Board
            </button>
            <button
              type="button"
              className={`wm-tab-btn ${viewMode === VIEW_MODES.LIST ? "active" : ""}`}
              onClick={() => setViewMode(VIEW_MODES.LIST)}
            >
              List
            </button>
          </div>
        </div>
      </AppHeader>

      {/* Floating Non-intrusive Toast (Never pushes down summary cards) */}
      {(error || successMsg) && (
        <div className="wm-toast-container">
          {error && (
            <div className="wm-toast-item error">
              <IconAlertCircle size={16} />
              <span>{error}</span>
              <button className="wm-toast-close" onClick={() => setActionError("")}>
                <IconClose size={14} />
              </button>
            </div>
          )}
          {successMsg && (
            <div className="wm-toast-item success">
              <IconCheck size={16} />
              <span>{successMsg}</span>
              <button className="wm-toast-close" onClick={() => setSuccessMsg("")}>
                <IconClose size={14} />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Main 2-Region Grid Layout */}
      <div className="wm-unified-grid">
        {/* Main Workspace (Left ~75%) */}
        <div className="wm-main-col">
          {/* Consolidated Compact Toolbar: Tabs, Search & Filters in One Row */}
          <div
            className="wm-toolbar-card"
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 10,
              padding: "8px 14px",
              marginBottom: 12,
            }}
          >
            {/* Left: Task Tabs & Projects */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <div className="wm-tab-group">
                <button
                  type="button"
                  onClick={() => setActiveTab(EMPLOYEE_TABS.ALL)}
                  className={`wm-tab-btn ${activeTab === EMPLOYEE_TABS.ALL ? "active" : ""}`}
                >
                  My Tasks
                </button>
                {meta.isManager && (
                  <button
                    type="button"
                    onClick={() => setActiveTab(EMPLOYEE_TABS.TEAM_QUEUE)}
                    className={`wm-tab-btn ${activeTab === EMPLOYEE_TABS.TEAM_QUEUE ? "active" : ""}`}
                  >
                    Team Review Queue
                  </button>
                )}
              </div>

              {projectSummaries.length > 1 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className={`wm-tab-btn ${selectedProject === "ALL" ? "active" : ""}`}
                    onClick={() => setSelectedProject("ALL")}
                    style={{ fontSize: 11.5, padding: "3px 8px" }}
                  >
                    All Projects
                  </button>
                  {projectSummaries.slice(0, 3).map((p) => (
                    <button
                      key={p.name}
                      type="button"
                      className={`wm-tab-btn ${selectedProject === p.name ? "active" : ""}`}
                      onClick={() => setSelectedProject(selectedProject === p.name ? "ALL" : p.name)}
                      style={{ fontSize: 11.5, padding: "3px 8px" }}
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Right: Search & Priority Filter */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <form onSubmit={handleSearchSubmit} className="wm-search-wrapper" style={{ minWidth: 160 }}>
                <span className="wm-search-icon">
                  <IconSearch size={14} />
                </span>
                <input
                  type="text"
                  className="wm-input-search"
                  style={{ height: 30, fontSize: 12, paddingLeft: 28 }}
                  placeholder="Search tasks..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </form>

              <select
                className="wm-select"
                style={{ height: 30, fontSize: 12, minHeight: 30 }}
                value={priorityFilter}
                onChange={(e) => setPriorityFilter(e.target.value)}
              >
                <option value="ALL">Priority: All</option>
                <option value="LOW">Low</option>
                <option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option>
                <option value="CRITICAL">Critical</option>
              </select>
            </div>
          </div>

          {/* Weekly Delivery Schedule Strip */}
          <div className="wm-timeline-card">
            <div className="wm-timeline-header">
              <h4 className="wm-timeline-title">
                <IconCalendar size={15} />
                This week
              </h4>
            </div>

            <div className="wm-timeline-days-grid">
              {weeklyTimeline.map((day) => (
                <div
                  key={day.dateStr}
                  className={`wm-timeline-day ${day.isToday ? "is-today" : ""}`}
                >
                  <div className="wm-timeline-day-header">
                    <span>{day.dayName} {day.dayNumber}</span>
                    {day.isToday && (
                      <span style={{ fontSize: 9.5, background: "#155a37", color: "#ffffff", padding: "1px 4px", borderRadius: 3 }}>
                        Today
                      </span>
                    )}
                  </div>
                  <div className="wm-timeline-day-tasks">
                    {day.tasks.length === 0 ? (
                      <span style={{ fontSize: 10, color: "#94a3b8", fontStyle: "italic", marginTop: 4 }}>
                        Free day
                      </span>
                    ) : (
                      day.tasks.map((task) => (
                        <div
                          key={task._id}
                          className="wm-timeline-task-pill"
                          onClick={() => selectTaskDetails(task)}
                          title={task.title}
                        >
                          {task.title}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Kanban Board View */}
          {viewMode === VIEW_MODES.KANBAN ? (
            <div className="wm-kanban-board">
              {kanbanColumns.map((col) => {
                const isOver = dragOverCol === col.id;
                return (
                  <div
                    key={col.id}
                    className={`wm-kanban-col ${isOver ? "is-drop-target" : ""}`}
                    onDragOver={(e) => handleDragOver(e, col.id)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, col.id)}
                  >
                    <div className="wm-kanban-col-header">
                      <div className="wm-kanban-col-title">
                        <span className={`wm-kanban-col-dot ${col.dotClass}`} />
                        <span>{col.title}</span>
                      </div>
                      <span className="wm-kanban-count-pill">{col.tasks.length}</span>
                    </div>

                    <div className="wm-kanban-cards">
                      {loading ? (
                        <div style={{ padding: 16, textAlign: "center", color: "#94a3b8", fontSize: 12 }}>
                          Loading tasks...
                        </div>
                      ) : col.tasks.length === 0 ? (
                        <div
                          style={{
                            padding: "36px 16px",
                            textAlign: "center",
                            color: "#94a3b8",
                            fontSize: 12,
                            border: "1px dashed #e2e8f0",
                            borderRadius: 8,
                            margin: "4px 0",
                          }}
                        >
                          {col.id === "APPROVED"
                            ? "None today"
                            : "No tasks in this stage"}
                        </div>
                      ) : (
                        col.tasks.map((task) => {
                          const isDragging = draggedTaskId === task._id;
                          const deadlineInfo = getDeadlineInfo(task.deadline, task.status);
                          return (
                            <div
                              key={task._id}
                              className={`wm-task-card ${isDragging ? "is-dragging" : ""}`}
                              draggable={true}
                              onDragStart={(e) => handleDragStart(e, task)}
                              onDragEnd={handleDragEnd}
                              onClick={() => selectTaskDetails(task)}
                            >
                              <div className="wm-task-card-header">
                                <span className="wm-project-tag">
                                  {task.projectName || "General"}
                                </span>
                                <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                                  <span
                                    className={`wm-priority-badge ${
                                      task.priority === "CRITICAL"
                                        ? "wm-priority-critical"
                                        : task.priority === "HIGH"
                                        ? "wm-priority-high"
                                        : task.priority === "LOW"
                                        ? "wm-priority-low"
                                        : "wm-priority-medium"
                                    }`}
                                  >
                                    {task.priority}
                                  </span>
                                  <span className="wm-points-tag">
                                    ★ {task.priority === "CRITICAL" || task.priority === "HIGH" ? "+20" : "+10"}
                                  </span>
                                </div>
                              </div>

                              <h5 className="wm-task-card-title">{task.title}</h5>

                              {task.description && (
                                <p className="wm-task-card-desc">{task.description}</p>
                              )}

                              <div className="wm-task-card-footer">
                                <div style={{ fontSize: 11, color: "#64748b" }}>
                                  Assigned by {task.assignedBySnapshot?.fullName?.split(" ")[0] || "HR"}
                                </div>
                                <div
                                  className={`wm-task-due ${
                                    deadlineInfo.isOverdue ? "overdue" : deadlineInfo.isSoon ? "soon" : ""
                                  }`}
                                >
                                  {deadlineInfo.text}
                                </div>
                              </div>

                              {/* Card Action Button Bar */}
                              <div
                                className="wm-card-actions-bar"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {task.status === "ASSIGNED" && (
                                  <button
                                    type="button"
                                    className="wm-card-btn-action action-green"
                                    onClick={() => handleStartTask(task)}
                                    disabled={startingTaskId === task._id}
                                  >
                                    {startingTaskId === task._id ? "Starting..." : (
                                      <>
                                        <span className="m-title-full">Start Task →</span>
                                        <span className="m-title-short">Start task</span>
                                      </>
                                    )}
                                  </button>
                                )}

                                {task.status === "IN_PROGRESS" && (
                                  <button
                                    type="button"
                                    className="wm-card-btn-action action-green"
                                    onClick={() => {
                                      setSelectedTask(task);
                                      setSubmitError("");
                                      setSidePanelMode("submit");
                                    }}
                                  >
                                    <span className="m-title-full">Submit Work →</span>
                                    <span className="m-title-short">Submit work</span>
                                  </button>
                                )}

                                {task.status === "SUBMITTED" && (
                                  <span style={{ fontSize: 11, color: "#d97706", fontWeight: 600 }}>
                                    Awaiting Review
                                  </span>
                                )}

                                {task.status === "APPROVED" && (
                                  <span style={{ fontSize: 11, color: "#059669", fontWeight: 700 }}>
                                    Completed ✓
                                  </span>
                                )}

                                <button
                                  type="button"
                                  className="wm-card-btn-action"
                                  style={{ marginLeft: "auto", background: "transparent", color: "#64748b", border: "1px solid #e2e8f0" }}
                                  onClick={() => selectTaskDetails(task)}
                                >
                                  Details
                                </button>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* Table View Mode */
            <div className="wm-table-card">
              <div className="wm-table-container">
                <table className="wm-table">
                  <thead>
                    <tr>
                      <th>Task Title</th>
                      <th>Project</th>
                      <th>Priority</th>
                      <th>Deadline</th>
                      <th>Status</th>
                      <th style={{ textAlign: "right" }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <TableSkeletonRows cols={6} rows={5} />
                    ) : displayedTasks.length === 0 ? (
                      <tr>
                        <td colSpan={6}>
                          <div className="wm-empty-state">
                            <h4 className="wm-empty-title">No tasks found</h4>
                            <p className="wm-empty-desc">No matching tasks.</p>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      displayedTasks.map((task) => (
                        <tr
                          key={task._id}
                          onClick={() => selectTaskDetails(task)}
                          style={{ cursor: "pointer" }}
                        >
                          <td>
                            <div style={{ fontWeight: 600, color: "#0f172a" }}>{task.title}</div>
                          </td>
                          <td>
                            <span style={{ fontSize: 12, color: "#64748b" }}>
                              {task.projectName || "General"}
                            </span>
                          </td>
                          <td>
                            <span
                              className={`wm-priority-badge ${
                                task.priority === "CRITICAL"
                                  ? "wm-priority-critical"
                                  : task.priority === "HIGH"
                                  ? "wm-priority-high"
                                  : task.priority === "LOW"
                                  ? "wm-priority-low"
                                  : "wm-priority-medium"
                              }`}
                            >
                              {task.priority}
                            </span>
                          </td>
                          <td>{task.deadline ? formatDisplayDate(task.deadline, timeZone) : "—"}</td>
                          <td>
                            <StatusBadge status={task.status} />
                          </td>
                          <td style={{ textAlign: "right" }}>
                            <button
                              type="button"
                              className="wm-btn-table-action"
                              onClick={(e) => {
                                e.stopPropagation();
                                selectTaskDetails(task);
                              }}
                            >
                              Details
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <Pagination
                currentPage={pagination.page}
                totalPages={pagination.pages}
                totalItems={pagination.total}
                pageSize={pagination.limit}
                pageSizeOptions={[10, 25, 50, 100]}
                onPageChange={(p) => setPage(p)}
                onPageSizeChange={(s) => {
                  setLimit(s);
                  setPage(1);
                }}
                itemLabel="tasks"
              />
            </div>
          )}
        </div>

      </div>

      <AppModal
        open={sidePanelMode !== "none"}
        onClose={() => setSidePanelMode("none")}
        size="md"
        locked={submitting}
        title={
          sidePanelMode === "submit"
            ? "Submit deliverables"
            : selectedTask?.title || "Task details"
        }
        subtitle={
          sidePanelMode === "details" && selectedTask
            ? `${selectedTask.priority || "MEDIUM"} · ${selectedTask.status || ""}`
            : undefined
        }
      >
          {/* Details Mode */}
          {sidePanelMode === "details" && selectedTask && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <StatusBadge status={selectedTask.status} />
                <span className="wm-priority-badge wm-priority-medium">
                  {selectedTask.priority}
                </span>
              </div>

              <div className="wm-panel-body">
                <div style={{ background: "#f8faf8", borderRadius: 10, padding: "14px 16px", border: "1px solid #e2e8f0" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, fontSize: 12 }}>
                    <div>
                      <div style={{ color: "#64748b", fontWeight: 600 }}>Project</div>
                      <div style={{ fontWeight: 700, color: "#0f172a", marginTop: 2 }}>
                        {selectedTask.projectName || "General"}
                      </div>
                    </div>
                    <div>
                      <div style={{ color: "#64748b", fontWeight: 600 }}>Deadline</div>
                      <div style={{ fontWeight: 700, color: "#0f172a", marginTop: 2 }}>
                        {selectedTask.deadline ? new Date(selectedTask.deadline).toLocaleDateString() : "—"}
                      </div>
                    </div>
                    <div>
                      <div style={{ color: "#64748b", fontWeight: 600 }}>Assigned By</div>
                      <div style={{ fontWeight: 600, color: "#0f172a", marginTop: 2 }}>
                        {selectedTask.assignedBySnapshot?.fullName || "HR Admin"}
                      </div>
                    </div>
                    <div>
                      <div style={{ color: "#64748b", fontWeight: 600 }}>Points Reward</div>
                      <div style={{ fontWeight: 700, color: "#059669", marginTop: 2 }}>
                        ★ {selectedTask.priority === "CRITICAL" || selectedTask.priority === "HIGH" ? "+20 pts" : "+10 pts"}
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <div className="wm-section-divider">Description</div>
                  <div style={{ fontSize: 13, color: "#334155", lineHeight: 1.5, whiteSpace: "pre-wrap", marginTop: 8 }}>
                    {selectedTask.description}
                  </div>
                </div>

                {selectedTask.acceptanceCriteria?.length > 0 && (
                  <div>
                    <div className="wm-section-divider">Acceptance Criteria</div>
                    <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 13, color: "#334155" }}>
                      {selectedTask.acceptanceCriteria.map((c, idx) => (
                        <li key={idx} style={{ marginBottom: 4 }}>{c}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Submitted Deliverables if any */}
                {selectedTask.deliverables?.length > 0 && (
                  <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 14 }}>
                    <div className="wm-section-divider">Submitted Deliverables</div>
                    {selectedTask.submissionNotes && (
                      <div style={{ fontStyle: "italic", fontSize: 12, color: "#475569", margin: "8px 0", background: "#f8faf8", padding: "10px 12px", borderRadius: 8, border: "1px solid #e2e8f0" }}>
                        &ldquo;{selectedTask.submissionNotes}&rdquo;
                      </div>
                    )}
                    {selectedTask.deliverables.map((deliv, idx) => (
                      <div key={idx} style={{ background: "#f1f5f9", borderRadius: 8, padding: "10px 12px", marginBottom: 8, fontSize: 12, border: "1px solid #e2e8f0" }}>
                        {deliv.description && <div style={{ fontWeight: 600, color: "#0f172a" }}>{deliv.description}</div>}
                        {deliv.links?.map((link, lIdx) => (
                          <div key={lIdx} style={{ marginTop: 4 }}>
                            <a href={link} target="_blank" rel="noopener noreferrer" style={{ color: "#2563eb", textDecoration: "underline", wordBreak: "break-all" }}>
                              {link}
                            </a>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="wm-panel-footer">
                <button type="button" className="wm-btn-secondary" onClick={() => setSidePanelMode("none")}>
                  Close
                </button>
                {selectedTask.status === "ASSIGNED" && (
                  <button
                    type="button"
                    className="wm-btn-primary"
                    onClick={() => handleStartTask(selectedTask)}
                    disabled={startingTaskId === selectedTask._id}
                  >
                    {startingTaskId === selectedTask._id ? "Starting..." : "Start Task"}
                  </button>
                )}
                {selectedTask.status === "IN_PROGRESS" && (
                  <button
                    type="button"
                    className="wm-btn-primary"
                    onClick={() => {
                      setSubmitError("");
                      setSidePanelMode("submit");
                    }}
                  >
                    Submit Work
                  </button>
                )}
              </div>
            </>
          )}

          {/* Submit Deliverables Mode */}
          {sidePanelMode === "submit" && selectedTask && (
            <>
              <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--muted)" }}>
                {selectedTask.title}
              </p>
              {submitError && (
                <div className="alert alert-danger" style={{ margin: "0 0 12px", padding: "8px 12px", fontSize: 12 }}>
                  <span>{submitError}</span>
                </div>
              )}

              <form onSubmit={handleSubmitEvidence} style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
                <div className="wm-panel-body">
                  <div className="wm-form-group">
                    <label className="wm-form-label">
                      <span>Completion Notes / Summary <span className="req">*</span></span>
                    </label>
                    <textarea
                      required
                      rows={4}
                      className="wm-form-textarea"
                      placeholder="Describe the solution implemented, verified criteria, and outcomes..."
                      value={submitForm.notes}
                      onChange={(e) => setSubmitForm({ ...submitForm, notes: e.target.value })}
                    />
                  </div>

                  <div className="wm-form-group">
                    <label className="wm-form-label">Deliverable Links (PR, Figma, Docs)</label>
                    {submitForm.links.map((link, idx) => (
                      <div key={idx} style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                        <input
                          type="url"
                          className="wm-form-input"
                          placeholder="https://github.com/... or https://figma.com/..."
                          value={link}
                          onChange={(e) => {
                            const updated = [...submitForm.links];
                            updated[idx] = e.target.value;
                            setSubmitForm({ ...submitForm, links: updated });
                          }}
                        />
                        {submitForm.links.length > 1 && (
                          <button
                            type="button"
                            className="wm-panel-close-btn"
                            onClick={() => {
                              const updated = submitForm.links.filter((_, i) => i !== idx);
                              setSubmitForm({ ...submitForm, links: updated });
                            }}
                          >
                            <IconClose size={14} />
                          </button>
                        )}
                      </div>
                    ))}
                    <button
                      type="button"
                      className="wm-btn-secondary"
                      onClick={() => setSubmitForm({ ...submitForm, links: [...submitForm.links, ""] })}
                      style={{ fontSize: 11, height: 28, alignSelf: "flex-start", marginTop: 4 }}
                    >
                      + Add Link
                    </button>
                  </div>

                  <div className="wm-form-group">
                    <label className="wm-form-label">Attach File (optional, max 10MB)</label>
                    <input
                      type="file"
                      className="wm-form-input"
                      onChange={handleFileUpload}
                      disabled={uploadingFile}
                    />
                    {uploadingFile && <span style={{ fontSize: 11, color: "#155a37" }}>Uploading file...</span>}
                    {submitForm.files.map((f, i) => (
                      <div key={i} style={{ fontSize: 12, color: "#155a37", display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                        <span>📎 {f.fileName}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="wm-panel-footer">
                  <button type="button" className="wm-btn-secondary" onClick={() => setSidePanelMode("none")}>
                    Cancel
                  </button>
                  <button type="submit" className="wm-btn-primary" disabled={submitting}>
                    {submitting ? "Submitting..." : "Submit for Verification"}
                  </button>
                </div>
              </form>
            </>
          )}
      </AppModal>
    </div>
  );
}
