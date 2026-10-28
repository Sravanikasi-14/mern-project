import { useEffect, useMemo, useState } from "react";
import AppHeader from "../components/AppHeader";
import StatusBadge from "../components/StatusBadge";
import Pagination from "../components/Pagination";
import { TableSkeletonRows } from "../components/TableSkeleton";
import {
  IconCheck,
  IconClose,
  IconAlertCircle,
  IconDocument,
  IconSearch,
  IconPlus,
} from "../components/Icons";
import api from "../services/api";
import { useAuth } from "../context/AuthContext";
import {
  buildWeekStrip,
  formatDisplayDate,
  isCompletedToday,
  resolveCompanyTimezone,
  toDateOnlyString,
} from "../utils/dateUtils";
import "./WorkManagement.css";

const TASK_TABS = {
  ALL: "ALL",
  REVIEW_QUEUE: "REVIEW_QUEUE",
  TEAM: "TEAM",
};

const VIEW_MODES = {
  KANBAN: "KANBAN",
  LIST: "LIST",
};

export default function AdminWorkManagement() {
  const { company } = useAuth();
  const timeZone = resolveCompanyTimezone(company);
  const [activeTab, setActiveTab] = useState(TASK_TABS.ALL);
  const [viewMode, setViewMode] = useState(VIEW_MODES.KANBAN);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // Filters
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [priorityFilter, setPriorityFilter] = useState("ALL");
  const [departmentFilter, setDepartmentFilter] = useState("ALL");
  const [selectedProject, setSelectedProject] = useState("ALL");
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, pages: 1 });

  // Metadata
  const [meta, setMeta] = useState({
    userRole: "",
    isManager: false,
    directReportsCount: 0,
    assignableEmployees: [],
    departments: [],
  });

  // Drag and Drop state
  const [draggedTaskId, setDraggedTaskId] = useState(null);
  const [dragOverCol, setDragOverCol] = useState(null);

  // Side panel mode: 'none' | 'details' | 'create'
  const [sidePanelMode, setSidePanelMode] = useState("none");
  const [selectedTask, setSelectedTask] = useState(null);

  // Create form state
  const [creatingTask, setCreatingTask] = useState(false);
  const [createError, setCreateError] = useState("");
  const [taskForm, setTaskForm] = useState({
    title: "",
    description: "",
    assigneeId: "",
    department: "",
    projectName: "",
    priority: "MEDIUM",
    deadline: "",
    acceptanceCriteria: "",
  });

  // Review state
  const [reviewDecision, setReviewDecision] = useState("APPROVED");
  const [reviewComments, setReviewComments] = useState("");
  const [submittingReview, setSubmittingReview] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const [showReviewForm, setShowReviewForm] = useState(false);

  // Auto-dismiss floating notifications after 4 seconds
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(""), 4500);
      return () => clearTimeout(timer);
    }
  }, [error]);

  useEffect(() => {
    if (successMsg) {
      const timer = setTimeout(() => setSuccessMsg(""), 4000);
      return () => clearTimeout(timer);
    }
  }, [successMsg]);

  // Load Metadata
  useEffect(() => {
    let cancelled = false;
    const fetchMeta = async () => {
      try {
        const res = await api.get("/tasks/meta");
        if (!cancelled && res.data?.success) {
          const metaData = res.data?.data || res.data || {};
          setMeta({
            userRole: metaData.userRole || "",
            isManager: Boolean(metaData.isManager),
            directReportsCount: metaData.directReportsCount || 0,
            assignableEmployees: Array.isArray(metaData.assignableEmployees)
              ? metaData.assignableEmployees
              : [],
            departments: Array.isArray(metaData.departments) ? metaData.departments : [],
          });
        }
      } catch {
        // Non-blocking
      }
    };
    fetchMeta();
    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch tasks
  const fetchTasks = async () => {
    try {
      setLoading(true);
      setError("");
      const params = {
        page: pagination.page,
        limit: pagination.limit,
      };

      if (activeTab === TASK_TABS.REVIEW_QUEUE) {
        params.status = "SUBMITTED";
      } else if (statusFilter !== "ALL") {
        params.status = statusFilter;
      }

      if (activeTab === TASK_TABS.TEAM) {
        params.scope = "team_tasks";
      } else if (meta.userRole === "HR_ADMIN") {
        params.scope = "all";
      }

      if (priorityFilter !== "ALL") params.priority = priorityFilter;
      if (departmentFilter !== "ALL") params.department = departmentFilter;
      if (search.trim()) params.search = search.trim();
      if (viewMode === VIEW_MODES.KANBAN && activeTab !== TASK_TABS.REVIEW_QUEUE) {
        params.completedScope = "today";
      }

      const res = await api.get("/tasks", { params });
      if (res.data?.success) {
        const taskList = res.data?.tasks || res.data?.data?.tasks || [];
        const pag = res.data?.pagination || res.data?.data?.pagination || {
          total: taskList.length,
          page: 1,
          limit: 50,
          pages: 1,
        };
        setTasks(Array.isArray(taskList) ? taskList : []);
        setPagination(pag);

        if (selectedTask) {
          const updated = taskList.find((t) => t._id === selectedTask._id);
          if (updated) setSelectedTask(updated);
        }
      }
    } catch (err) {
      setError(err.response?.data?.message || "Failed to load tasks");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, statusFilter, priorityFilter, departmentFilter, pagination.page, pagination.limit, viewMode]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    fetchTasks();
  };

  // Drag and Drop handlers
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

    // Optimistic UI update
    const prevTasks = [...tasks];
    setTasks((current) =>
      current.map((t) => (t._id === taskId ? { ...t, status: targetStatus } : t))
    );

    try {
      if (targetStatus === "IN_PROGRESS" && task.status === "ASSIGNED") {
        await api.post(`/tasks/${taskId}/start`);
      } else if (targetStatus === "SUBMITTED") {
        await api.post(`/tasks/${taskId}/submit`, { notes: "Submitted via board transition" });
      } else if (targetStatus === "APPROVED") {
        await api.post(`/tasks/${taskId}/review`, {
          decision: "APPROVE",
          comments: "Approved via Kanban board transition",
        });
      } else {
        await api.patch(`/tasks/${taskId}`, { status: targetStatus });
      }
      setSuccessMsg(`Task "${task.title}" moved to ${targetStatus.replace("_", " ")}`);
      fetchTasks();
    } catch (err) {
      setTasks(prevTasks);
      setError(err.response?.data?.message || `Failed to update task to ${targetStatus}`);
    }
  };

  // Accessible fallback status change
  const handleStatusChange = async (task, targetStatus) => {
    if (task.status === targetStatus) return;
    const prevTasks = [...tasks];
    setTasks((current) =>
      current.map((t) => (t._id === task._id ? { ...t, status: targetStatus } : t))
    );
    try {
      if (targetStatus === "IN_PROGRESS" && task.status === "ASSIGNED") {
        await api.post(`/tasks/${task._id}/start`);
      } else if (targetStatus === "SUBMITTED") {
        await api.post(`/tasks/${task._id}/submit`, { notes: "Submitted via status change" });
      } else if (targetStatus === "APPROVED") {
        await api.post(`/tasks/${task._id}/review`, {
          decision: "APPROVE",
          comments: "Approved via status selector",
        });
      } else {
        await api.patch(`/tasks/${task._id}`, { status: targetStatus });
      }
      setSuccessMsg(`Task "${task.title}" updated to ${targetStatus.replace("_", " ")}`);
      fetchTasks();
    } catch (err) {
      setTasks(prevTasks);
      setError(err.response?.data?.message || `Failed to update task status`);
    }
  };

  // Create Task
  const handleCreateTask = async (e) => {
    e.preventDefault();
    try {
      setCreatingTask(true);
      setCreateError("");

      const payload = {
        title: taskForm.title.trim(),
        description: taskForm.description.trim(),
        assigneeId: taskForm.assigneeId,
        department: taskForm.department,
        projectName: taskForm.projectName,
        priority: taskForm.priority,
        deadline: taskForm.deadline,
        acceptanceCriteria: taskForm.acceptanceCriteria
          ? taskForm.acceptanceCriteria.split("\n").map((c) => c.trim()).filter(Boolean)
          : [],
      };

      const res = await api.post("/tasks", payload);
      if (res.data?.success) {
        setSidePanelMode("none");
        setTaskForm({
          title: "",
          description: "",
          assigneeId: "",
          department: "",
          projectName: "",
          priority: "MEDIUM",
          deadline: "",
          acceptanceCriteria: "",
        });
        setSuccessMsg("Task created and assigned successfully!");
        fetchTasks();
      }
    } catch (err) {
      setCreateError(err.response?.data?.message || "Failed to create task");
    } finally {
      setCreatingTask(false);
    }
  };

  // Review Task
  const handleReviewTask = async (e) => {
    e.preventDefault();
    if (!selectedTask) return;

    try {
      setSubmittingReview(true);
      setReviewError("");

      const res = await api.post(`/tasks/${selectedTask._id}/review`, {
        decision: reviewDecision,
        comments: reviewComments.trim(),
      });

      if (res.data?.success) {
        setShowReviewForm(false);
        setReviewComments("");
        setSuccessMsg(res.data.message || "Review submitted successfully!");
        fetchTasks();
      }
    } catch (err) {
      setReviewError(err.response?.data?.message || "Failed to review task");
    } finally {
      setSubmittingReview(false);
    }
  };

  // KPI Metrics (HR Portal: Active Tasks, Completed Tasks, Overdue Tasks, Active Projects)
  const metrics = useMemo(() => {
    const list = tasks || [];
    const activeProjects = new Set(list.map((t) => t.projectName?.trim()).filter(Boolean));
    const now = new Date();
    const overdueCount = list.filter((t) => {
      if (!t.deadline || t.status === "APPROVED") return false;
      return new Date(t.deadline) < now;
    }).length;

    return {
      activeTasks: list.filter((t) => t.status !== "APPROVED" && t.status !== "REJECTED").length,
      completedTasks: list.filter((t) => isCompletedToday(t, timeZone)).length,
      overdueTasks: overdueCount,
      activeProjects: Math.max(activeProjects.size, 1),
    };
  }, [tasks, timeZone]);

  // Project Summaries
  const projectSummaries = useMemo(() => {
    const map = {};
    (tasks || []).forEach((t) => {
      const pName = t.projectName?.trim() || "Core Platform";
      if (!map[pName]) {
        map[pName] = {
          name: pName,
          total: 0,
          completed: 0,
          inProgress: 0,
          assignees: new Set(),
          department: t.department || "Operations",
        };
      }
      map[pName].total += 1;
      if (t.status === "APPROVED") map[pName].completed += 1;
      if (t.status === "IN_PROGRESS") map[pName].inProgress += 1;
      if (t.assigneeSnapshot?.fullName) {
        map[pName].assignees.add(t.assigneeSnapshot.fullName);
      }
    });

    return Object.values(map)
      .slice(0, 4)
      .map((p) => ({
        ...p,
        assigneeList: Array.from(p.assignees),
        progress: p.total > 0 ? Math.round((p.completed / p.total) * 100) : 0,
      }));
  }, [tasks]);

  // Filter tasks by selected project if active
  const displayedTasks = useMemo(() => {
    if (selectedProject === "ALL") return tasks;
    return tasks.filter((t) => (t.projectName?.trim() || "Core Platform") === selectedProject);
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
      title: "Draft / Backlog",
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
      title: "In Review",
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

  // Helper for deadline urgency
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
    setShowReviewForm(false);
    setReviewError("");
    setSidePanelMode("details");
  };

  return (
    <div className="container-wide split-page-container wm-page-container">
      {/* Compact Top Header */}
      <AppHeader
        title="Work Management"
        hideLogout={true}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
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

          <button
            type="button"
            className="wm-btn-primary"
            onClick={() => {
              setSelectedTask(null);
              setCreateError("");
              setSidePanelMode("create");
            }}
            style={{ whiteSpace: "nowrap", height: 32, fontSize: 12, padding: "0 12px" }}
          >
            <IconPlus size={16} />
            Create Task
          </button>
        </div>
      </AppHeader>

      {/* Floating Non-intrusive Toast (Never pushes down summary cards) */}
      {(error || successMsg) && (
        <div className="wm-toast-container">
          {error && (
            <div className="wm-toast-item error">
              <IconAlertCircle size={16} />
              <span>{error}</span>
              <button className="wm-toast-close" onClick={() => setError("")}>
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

      {/* Unified 2-Region Grid Layout */}
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
            {/* Left: Task Tabs */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <div className="wm-tab-group">
                <button
                  type="button"
                  onClick={() => setActiveTab(TASK_TABS.ALL)}
                  className={`wm-tab-btn ${activeTab === TASK_TABS.ALL ? "active" : ""}`}
                >
                  All Tasks
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab(TASK_TABS.REVIEW_QUEUE)}
                  className={`wm-tab-btn ${activeTab === TASK_TABS.REVIEW_QUEUE ? "active" : ""}`}
                >
                  <span>Review Queue</span>
                  {metrics.overdueTasks > 0 && (
                    <span
                      style={{
                        padding: "1px 5px",
                        borderRadius: 10,
                        fontSize: 10.5,
                        background: "#fef3c7",
                        color: "#92400e",
                        fontWeight: 700,
                      }}
                    >
                      {metrics.overdueTasks}
                    </span>
                  )}
                </button>
                {meta.isManager && (
                  <button
                    type="button"
                    onClick={() => setActiveTab(TASK_TABS.TEAM)}
                    className={`wm-tab-btn ${activeTab === TASK_TABS.TEAM ? "active" : ""}`}
                  >
                    My Team
                  </button>
                )}
              </div>

              {selectedProject !== "ALL" && (
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <span style={{ fontSize: 11.5, color: "#64748b" }}>Project:</span>
                  <span
                    style={{
                      background: "#e3f2e9",
                      color: "#0d3a23",
                      fontSize: 11,
                      fontWeight: 700,
                      padding: "2px 7px",
                      borderRadius: 5,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    {selectedProject}
                    <button
                      type="button"
                      onClick={() => setSelectedProject("ALL")}
                      style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", color: "#0d3a23" }}
                    >
                      <IconClose size={11} />
                    </button>
                  </span>
                </div>
              )}
            </div>

            {/* Right: Search + Filters */}
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

              <select
                className="wm-select"
                style={{ height: 30, fontSize: 12, minHeight: 30 }}
                value={departmentFilter}
                onChange={(e) => setDepartmentFilter(e.target.value)}
              >
                <option value="ALL">Dept: All</option>
                {(meta?.departments || []).map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Compact Weekly Schedule Strip */}
          <div className="wm-timeline-card">
            <div className="wm-timeline-header">
              <h4 className="wm-timeline-title">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#155a37" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
                Weekly Delivery Schedule
              </h4>
              <span style={{ fontSize: 11, color: "#64748b" }}>This week's milestones</span>
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
                      <span style={{ fontSize: 9, background: "#155a37", color: "#ffffff", padding: "1px 3px", borderRadius: 3 }}>
                        Today
                      </span>
                    )}
                  </div>
                  <div className="wm-timeline-day-tasks">
                    {day.tasks.length === 0 ? (
                      <span style={{ fontSize: 9.5, color: "#94a3b8", fontStyle: "italic", marginTop: 2 }}>
                        —
                      </span>
                    ) : (
                      day.tasks.map((task) => (
                        <div
                          key={task._id}
                          className="wm-timeline-task-pill"
                          onClick={() => selectTaskDetails(task)}
                          title={`${task.title} (${task.assigneeSnapshot?.fullName || "Unassigned"})`}
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

          {/* Kanban Board Mode */}
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
                        <div style={{ padding: 14, textAlign: "center", color: "#94a3b8", fontSize: 11.5 }}>
                          Loading...
                        </div>
                      ) : col.tasks.length === 0 ? (
                        <div
                          style={{
                            padding: "28px 12px",
                            textAlign: "center",
                            color: "#94a3b8",
                            fontSize: 11.5,
                            border: "1px dashed #e2e8f0",
                            borderRadius: 6,
                            margin: "2px 0",
                          }}
                        >
                          {col.id === "APPROVED"
                            ? "No tasks completed today. Older completions remain in List view."
                            : "Drop here"}
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
                                  {task.projectName || "Core Platform"}
                                </span>
                                <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
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
                                <div className="wm-task-assignee">
                                  <div className="wm-task-avatar">
                                    {(task.assigneeSnapshot?.fullName || "U")[0].toUpperCase()}
                                  </div>
                                  <span className="wm-task-assignee-name">
                                    {task.assigneeSnapshot?.fullName?.split(" ")[0] || "Unassigned"}
                                  </span>
                                </div>

                                <div
                                  className={`wm-task-due ${
                                    deadlineInfo.isOverdue ? "overdue" : deadlineInfo.isSoon ? "soon" : ""
                                  }`}
                                >
                                  {deadlineInfo.text}
                                </div>
                              </div>

                              {/* Accessible quick status selector */}
                              <div
                                className="wm-card-actions-bar"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <select
                                  className="wm-status-select-fallback"
                                  value={task.status}
                                  onChange={(e) => handleStatusChange(task, e.target.value)}
                                  title="Change status directly"
                                >
                                  <option value="ASSIGNED">To: Assigned</option>
                                  <option value="IN_PROGRESS">To: In Progress</option>
                                  <option value="SUBMITTED">To: In Review</option>
                                  <option value="APPROVED">To: Approved</option>
                                </select>

                                <button
                                  type="button"
                                  className="wm-card-btn-action"
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
                      <th>Assignee</th>
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
                            <p className="wm-empty-desc">Adjust filters or create a new task.</p>
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
                            {task.projectName && (
                              <div style={{ fontSize: 11, color: "#64748b" }}>{task.projectName}</div>
                            )}
                          </td>
                          <td>
                            <div style={{ fontWeight: 500, color: "#1e293b" }}>
                              {task.assigneeSnapshot?.fullName || "Unassigned"}
                            </div>
                            <div style={{ fontSize: 11, color: "#64748b" }}>
                              {task.assigneeSnapshot?.department || "General"}
                            </div>
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
                onPageChange={(p) => setPagination((prev) => ({ ...prev, page: p }))}
                onPageSizeChange={(s) => setPagination((prev) => ({ ...prev, limit: s, page: 1 }))}
                itemLabel="tasks"
              />
            </div>
          )}
        </div>

      </div>

      {/* Slide-out Side Panels */}
      {sidePanelMode !== "none" && (
        <div
          style={{
            position: "fixed",
            top: 0,
            right: 0,
            bottom: 0,
            width: "min(460px, 94vw)",
            background: "#ffffff",
            boxShadow: "-4px 0 25px rgba(0,0,0,0.15)",
            zIndex: 999,
            display: "flex",
            flexDirection: "column",
            animation: "slideInRight 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        >
          {/* Detail Mode */}
          {sidePanelMode === "details" && selectedTask && (
            <>
              <div className="wm-panel-header">
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <StatusBadge status={selectedTask.status} />
                    <span className="wm-priority-badge wm-priority-medium">
                      {selectedTask.priority}
                    </span>
                  </div>
                  <h3 className="wm-panel-header-title">{selectedTask.title}</h3>
                </div>
                <button
                  type="button"
                  className="wm-panel-close-btn"
                  onClick={() => setSidePanelMode("none")}
                >
                  <IconClose size={16} />
                </button>
              </div>

              <div className="wm-panel-body">
                <div style={{ background: "#f8faf8", borderRadius: 10, padding: "14px 16px", border: "1px solid #e2e8f0" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, fontSize: 12 }}>
                    <div>
                      <div style={{ color: "#64748b", fontWeight: 600 }}>Assignee</div>
                      <div style={{ fontWeight: 700, color: "#0f172a", marginTop: 2 }}>
                        {selectedTask.assigneeSnapshot?.fullName || "Unassigned"}
                      </div>
                      <div style={{ color: "#64748b" }}>
                        {selectedTask.assigneeSnapshot?.department || selectedTask.department || "General"}
                      </div>
                    </div>
                    <div>
                      <div style={{ color: "#64748b", fontWeight: 600 }}>Deadline</div>
                      <div style={{ fontWeight: 700, color: "#0f172a", marginTop: 2 }}>
                        {selectedTask.deadline ? new Date(selectedTask.deadline).toLocaleDateString() : "—"}
                      </div>
                      <div style={{ color: "#64748b" }}>
                        {selectedTask.startDate ? `Started ${new Date(selectedTask.startDate).toLocaleDateString()}` : "Not started"}
                      </div>
                    </div>
                    <div>
                      <div style={{ color: "#64748b", fontWeight: 600 }}>Assigned By</div>
                      <div style={{ fontWeight: 600, color: "#0f172a", marginTop: 2 }}>
                        {selectedTask.assignedBySnapshot?.fullName || "HR Admin"}
                      </div>
                    </div>
                    <div>
                      <div style={{ color: "#64748b", fontWeight: 600 }}>Project</div>
                      <div style={{ fontWeight: 600, color: "#0f172a", marginTop: 2 }}>
                        {selectedTask.projectName || "General Initiative"}
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
                        {deliv.fileName && (
                          <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 5, color: "#475569" }}>
                            <IconDocument size={14} />
                            <span>{deliv.fileName}</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Review Form */}
                {showReviewForm && selectedTask.status === "SUBMITTED" && (
                  <form onSubmit={handleReviewTask} style={{ borderTop: "1px solid #e2e8f0", paddingTop: 14 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", marginBottom: 10 }}>
                      Verify & Submit Decision
                    </div>
                    {reviewError && (
                      <div className="alert alert-danger" style={{ marginBottom: 10, padding: "8px 12px", fontSize: 12 }}>
                        <span>{reviewError}</span>
                      </div>
                    )}
                    <div className="wm-form-group" style={{ marginBottom: 12 }}>
                      <label className="wm-form-label">Decision</label>
                      <select
                        className="wm-form-select"
                        value={reviewDecision}
                        onChange={(e) => setReviewDecision(e.target.value)}
                      >
                        <option value="APPROVED">Approve (Award Impact Points)</option>
                        <option value="CHANGES_REQUESTED">Request Changes</option>
                        <option value="REJECTED">Reject Submission</option>
                      </select>
                    </div>
                    <div className="wm-form-group" style={{ marginBottom: 14 }}>
                      <label className="wm-form-label">Feedback Comments</label>
                      <textarea
                        rows={3}
                        className="wm-form-textarea"
                        placeholder="Provide constructive verification feedback..."
                        value={reviewComments}
                        onChange={(e) => setReviewComments(e.target.value)}
                      />
                    </div>
                    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                      <button
                        type="button"
                        className="wm-btn-secondary"
                        onClick={() => setShowReviewForm(false)}
                        disabled={submittingReview}
                      >
                        Cancel
                      </button>
                      <button type="submit" className="wm-btn-primary" disabled={submittingReview}>
                        {submittingReview ? "Submitting..." : "Submit Review"}
                      </button>
                    </div>
                  </form>
                )}
              </div>

              <div className="wm-panel-footer">
                <button type="button" className="wm-btn-secondary" onClick={() => setSidePanelMode("none")}>
                  Close
                </button>
                {selectedTask.status === "SUBMITTED" && !showReviewForm && (
                  <button type="button" className="wm-btn-primary" onClick={() => setShowReviewForm(true)}>
                    Review Submission
                  </button>
                )}
              </div>
            </>
          )}

          {/* Create Task Mode */}
          {sidePanelMode === "create" && (
            <>
              <div className="wm-panel-header">
                <div>
                  <h3 className="wm-panel-header-title">New Task</h3>
                </div>
                <button type="button" className="wm-panel-close-btn" onClick={() => setSidePanelMode("none")}>
                  <IconClose size={16} />
                </button>
              </div>

              {createError && (
                <div className="alert alert-danger" style={{ margin: "12px 20px 0", padding: "8px 12px", fontSize: 12 }}>
                  <span>{createError}</span>
                </div>
              )}

              <form onSubmit={handleCreateTask} style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
                <div className="wm-panel-body">
                  <div className="wm-form-group">
                    <label className="wm-form-label">
                      <span>Task Title <span className="req">*</span></span>
                    </label>
                    <input
                      type="text"
                      required
                      className="wm-form-input"
                      placeholder="e.g. Implement OAuth2 client credentials"
                      value={taskForm.title}
                      onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })}
                    />
                  </div>

                  <div className="wm-form-group">
                    <label className="wm-form-label">
                      <span>Responsible Employee <span className="req">*</span></span>
                    </label>
                    <select
                      required
                      className="wm-form-select"
                      value={taskForm.assigneeId}
                      onChange={(e) => {
                        const empId = e.target.value;
                        const emp = (meta?.assignableEmployees || []).find((e) => e._id === empId);
                        setTaskForm({
                          ...taskForm,
                          assigneeId: empId,
                          department: emp?.job?.department || emp?.department || taskForm.department,
                        });
                      }}
                    >
                      <option value="">Select team member...</option>
                      {(meta?.assignableEmployees || []).map((emp) => (
                        <option key={emp._id} value={emp._id}>
                          {emp.fullName || emp.name} ({emp.employeeCode}) — {emp.job?.department || emp.department || "General"}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="wm-form-row">
                    <div className="wm-form-group">
                      <label className="wm-form-label">Priority</label>
                      <select
                        className="wm-form-select"
                        value={taskForm.priority}
                        onChange={(e) => setTaskForm({ ...taskForm, priority: e.target.value })}
                      >
                        <option value="LOW">Low (+10 completion)</option>
                        <option value="MEDIUM">Medium (+10 completion)</option>
                        <option value="HIGH">High (+20 bonus)</option>
                        <option value="CRITICAL">Critical (+20 bonus)</option>
                      </select>
                    </div>
                    <div className="wm-form-group">
                      <label className="wm-form-label">
                        <span>Deadline <span className="req">*</span></span>
                      </label>
                      <input
                        type="date"
                        required
                        className="wm-form-input"
                        value={taskForm.deadline}
                        onChange={(e) => setTaskForm({ ...taskForm, deadline: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="wm-form-row">
                    <div className="wm-form-group">
                      <label className="wm-form-label">Department</label>
                      <input
                        type="text"
                        className="wm-form-input"
                        placeholder="e.g. Engineering"
                        value={taskForm.department}
                        onChange={(e) => setTaskForm({ ...taskForm, department: e.target.value })}
                      />
                    </div>
                    <div className="wm-form-group">
                      <label className="wm-form-label">Project</label>
                      <input
                        type="text"
                        className="wm-form-input"
                        placeholder="e.g. Core Platform"
                        value={taskForm.projectName}
                        onChange={(e) => setTaskForm({ ...taskForm, projectName: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="wm-form-group">
                    <label className="wm-form-label">
                      <span>Description <span className="req">*</span></span>
                    </label>
                    <textarea
                      required
                      rows={3}
                      className="wm-form-textarea"
                      placeholder="Detail the work objectives and expectations..."
                      value={taskForm.description}
                      onChange={(e) => setTaskForm({ ...taskForm, description: e.target.value })}
                    />
                  </div>

                  <div className="wm-form-group">
                    <label className="wm-form-label">Acceptance Criteria (one per line)</label>
                    <textarea
                      rows={3}
                      className="wm-form-textarea"
                      placeholder="E.g.&#10;Unit tests passing&#10;Code reviewed"
                      value={taskForm.acceptanceCriteria}
                      onChange={(e) => setTaskForm({ ...taskForm, acceptanceCriteria: e.target.value })}
                    />
                  </div>
                </div>

                <div className="wm-panel-footer">
                  <button type="button" className="wm-btn-secondary" onClick={() => setSidePanelMode("none")}>
                    Cancel
                  </button>
                  <button type="submit" className="wm-btn-primary" disabled={creatingTask}>
                    {creatingTask ? "Assigning..." : "Assign Task"}
                  </button>
                </div>
              </form>
            </>
          )}

        </div>
      )}
    </div>
  );
}
