import { useEffect, useMemo, useState } from "react";
import AppHeader from "../components/AppHeader";
import StatusBadge from "../components/StatusBadge";
import { TableSkeletonRows } from "../components/TableSkeleton";
import {
  IconCheck,
  IconClose,
  IconAlertCircle,
  IconInfo,
  IconDocument,
  IconSearch,
} from "../components/Icons";
import api from "../services/api";
import "./WorkManagement.css";

const TASK_TABS = {
  ALL: "ALL",
  REVIEW_QUEUE: "REVIEW_QUEUE",
  TEAM: "TEAM",
};

export default function AdminWorkManagement() {
  const [activeTab, setActiveTab] = useState(TASK_TABS.ALL);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // Filters
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [priorityFilter, setPriorityFilter] = useState("ALL");
  const [departmentFilter, setDepartmentFilter] = useState("ALL");
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, pages: 1 });

  // Metadata
  const [meta, setMeta] = useState({
    userRole: "",
    isManager: false,
    directReportsCount: 0,
    assignableEmployees: [],
    departments: [],
  });

  // In-layout Right Side Panel Mode: 'none' | 'details' | 'create'
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

  // Review state (inline in task details panel)
  const [reviewDecision, setReviewDecision] = useState("APPROVED");
  const [reviewComments, setReviewComments] = useState("");
  const [submittingReview, setSubmittingReview] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const [showReviewForm, setShowReviewForm] = useState(false);

  // Fetch metadata once on mount
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

      const res = await api.get("/tasks", { params });
      if (res.data?.success) {
        const taskList = res.data?.tasks || res.data?.data?.tasks || [];
        const pag = res.data?.pagination || res.data?.data?.pagination || {
          total: taskList.length,
          page: 1,
          limit: 20,
          pages: 1,
        };
        setTasks(Array.isArray(taskList) ? taskList : []);
        setPagination(pag);

        // Keep selected task updated if currently viewing details
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
  }, [activeTab, statusFilter, priorityFilter, departmentFilter, pagination.page]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    fetchTasks();
  };

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

  const metrics = useMemo(() => {
    const list = tasks || [];
    return {
      total: pagination.total || list.length,
      inProgress: list.filter((t) => t.status === "IN_PROGRESS").length,
      submitted: list.filter((t) => t.status === "SUBMITTED").length,
      approved: list.filter((t) => t.status === "APPROVED").length,
    };
  }, [tasks, pagination.total]);

  const selectTaskDetails = (task) => {
    setSelectedTask(task);
    setShowReviewForm(false);
    setReviewError("");
    setSidePanelMode("details");
  };

  const toggleCreatePanel = () => {
    if (sidePanelMode === "create") {
      setSidePanelMode("none");
    } else {
      setSelectedTask(null);
      setCreateError("");
      setSidePanelMode("create");
    }
  };

  return (
    <div className="container-wide split-page-container wm-page-container">
      {/* Header */}
      <AppHeader
        title="Work Management"
        subtitle="Coordinate tasks, verify deliverables, and credit Impact Points"
        hideLogout={true}
      >
        <button
          className={sidePanelMode === "create" ? "wm-btn-secondary" : "wm-btn-primary"}
          onClick={toggleCreatePanel}
          style={{ whiteSpace: "nowrap" }}
        >
          {sidePanelMode === "create" ? "Cancel Create" : "+ Create Task"}
        </button>
      </AppHeader>

      {/* Notifications */}
      {(error || successMsg) && (
        <div className="split-page-alerts">
          {error && (
            <div className="alert alert-danger" style={{ marginBottom: 16 }}>
              <IconAlertCircle size={18} />
              <span>{error}</span>
              <button className="btn-icon" onClick={() => setError("")} style={{ marginLeft: "auto" }}>
                <IconClose size={14} />
              </button>
            </div>
          )}

          {successMsg && (
            <div className="alert alert-success" style={{ marginBottom: 16 }}>
              <IconCheck size={18} />
              <span>{successMsg}</span>
              <button className="btn-icon" onClick={() => setSuccessMsg("")} style={{ marginLeft: "auto" }}>
                <IconClose size={14} />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Summary KPI Cards - Strict 4-column balanced grid */}
      <div className="wm-kpi-grid">
        <div className="wm-kpi-card accent-slate">
          <div className="wm-kpi-header">
            <span className="wm-kpi-label">Total Tasks</span>
          </div>
          <div className="wm-kpi-value">{metrics.total}</div>
          <div className="wm-kpi-subtext">In active query scope</div>
        </div>

        <div className="wm-kpi-card accent-blue">
          <div className="wm-kpi-header">
            <span className="wm-kpi-label" style={{ color: "#2563eb" }}>In Progress</span>
          </div>
          <div className="wm-kpi-value" style={{ color: "#2563eb" }}>{metrics.inProgress}</div>
          <div className="wm-kpi-subtext">Actively underway</div>
        </div>

        <div className="wm-kpi-card accent-amber">
          <div className="wm-kpi-header">
            <span className="wm-kpi-label" style={{ color: "#d97706" }}>Review Queue</span>
          </div>
          <div className="wm-kpi-value" style={{ color: "#d97706" }}>{metrics.submitted}</div>
          <div className="wm-kpi-subtext">Awaiting verification</div>
        </div>

        <div className="wm-kpi-card accent-emerald">
          <div className="wm-kpi-header">
            <span className="wm-kpi-label" style={{ color: "#059669" }}>Approved</span>
          </div>
          <div className="wm-kpi-value" style={{ color: "#059669" }}>{metrics.approved}</div>
          <div className="wm-kpi-subtext">Completed with points</div>
        </div>
      </div>

      {/* Main Responsive Grid Layout (Resizes dynamically when right side panel opens) */}
      <div
        className="split-page-grid wm-split-grid"
        style={{
          gridTemplateColumns: sidePanelMode !== "none" ? "minmax(0, 1fr) minmax(360px, 440px)" : "1fr",
        }}
      >
        {/* Left Column: Task Table and Toolbar */}
        <div className="split-page-left-col wm-left-col">
          {/* Navigation & Toolbar Card */}
          <div className="wm-toolbar-card">
            {/* Toolbar: Navigation Tabs */}
            <div className="wm-tab-strip">
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
                  {metrics.submitted > 0 && (
                    <span
                      style={{
                        padding: "1px 6px",
                        borderRadius: 10,
                        fontSize: 11,
                        background: "#fef3c7",
                        color: "#92400e",
                        fontWeight: 700,
                      }}
                    >
                      {metrics.submitted}
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

              <div className="wm-tab-count">
                {pagination.total} task{pagination.total === 1 ? "" : "s"}
              </div>
            </div>

            {/* Filters Row */}
            <div className="wm-filter-row">
              <form onSubmit={handleSearchSubmit} className="wm-search-wrapper">
                <span className="wm-search-icon">
                  <IconSearch size={15} />
                </span>
                <input
                  type="text"
                  className="wm-input-search"
                  placeholder="Search tasks by title, project, or assignee..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </form>

              <div className="wm-filter-group">
                {activeTab !== TASK_TABS.REVIEW_QUEUE && (
                  <select
                    className="wm-select"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                  >
                    <option value="ALL">Status: All</option>
                    <option value="ASSIGNED">Assigned</option>
                    <option value="IN_PROGRESS">In Progress</option>
                    <option value="SUBMITTED">Submitted</option>
                    <option value="CHANGES_REQUESTED">Changes Req.</option>
                    <option value="APPROVED">Approved</option>
                    <option value="REJECTED">Rejected</option>
                  </select>
                )}

                <select
                  className="wm-select"
                  value={priorityFilter}
                  onChange={(e) => setPriorityFilter(e.target.value)}
                >
                  <option value="ALL">Priority: All</option>
                  <option value="LOW">Low Priority</option>
                  <option value="MEDIUM">Medium Priority</option>
                  <option value="HIGH">High Priority</option>
                  <option value="CRITICAL">Critical Priority</option>
                </select>

                <select
                  className="wm-select"
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
          </div>

          {/* Task Table Card */}
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
                  ) : tasks.length === 0 ? (
                    <tr>
                      <td colSpan={6}>
                        <div className="wm-empty-state">
                          <div style={{ width: 44, height: 44, borderRadius: "50%", background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", marginBottom: 6 }}>
                            <IconInfo size={22} />
                          </div>
                          <h4 className="wm-empty-title">No tasks found</h4>
                          <p className="wm-empty-desc">
                            {search || statusFilter !== "ALL" || priorityFilter !== "ALL"
                              ? "Try adjusting search terms or clearing active filters"
                              : "Get started by assigning a new task to your team member"}
                          </p>
                          <button
                            type="button"
                            className="wm-btn-secondary"
                            style={{ marginTop: 10 }}
                            onClick={() => setSidePanelMode("create")}
                          >
                            + Assign Task
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    tasks.map((task) => {
                      const isSelected = selectedTask?._id === task._id && sidePanelMode === "details";
                      const isPastDeadline =
                        task.deadline &&
                        new Date(task.deadline) < new Date() &&
                        task.status !== "APPROVED";

                      return (
                        <tr
                          key={task._id}
                          onClick={() => selectTaskDetails(task)}
                          className={isSelected ? "wm-row-active" : ""}
                          style={{ cursor: "pointer" }}
                        >
                          <td>
                            <div style={{ fontWeight: 600, color: "#0f172a" }}>{task.title}</div>
                            {task.projectName && (
                              <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                                {task.projectName}
                              </div>
                            )}
                          </td>
                          <td>
                            <div style={{ fontWeight: 500, color: "#1e293b" }}>
                              {task.assigneeSnapshot?.fullName || task.assignee?.name || "Unassigned"}
                            </div>
                            <div style={{ fontSize: 11, color: "#64748b" }}>
                              {task.assigneeSnapshot?.department || task.department || "General"}
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
                          <td style={{ whiteSpace: "nowrap" }}>
                            <div style={{ color: isPastDeadline ? "#dc2626" : "#475569", fontWeight: isPastDeadline ? 600 : 400 }}>
                              {task.deadline ? new Date(task.deadline).toLocaleDateString() : "—"}
                            </div>
                            {isPastDeadline && (
                              <span style={{ fontSize: 10, color: "#dc2626", fontWeight: 700 }}>
                                Overdue
                              </span>
                            )}
                          </td>
                          <td>
                            <StatusBadge status={task.status} />
                          </td>
                          <td style={{ textAlign: "right" }}>
                            <button
                              type="button"
                              className={`wm-btn-table-action ${isSelected ? "primary" : ""}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                selectTaskDetails(task);
                              }}
                            >
                              {isSelected ? "Viewing" : "Details"}
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            {pagination.pages > 1 && (
              <div
                style={{
                  padding: "10px 18px",
                  borderTop: "1px solid #e2e8f0",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  backgroundColor: "#f8fafc",
                  fontSize: 12,
                  color: "#64748b",
                }}
              >
                <span>
                  Page {pagination.page} of {pagination.pages} ({pagination.total} total)
                </span>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    disabled={pagination.page <= 1}
                    onClick={() => setPagination((prev) => ({ ...prev, page: prev.page - 1 }))}
                    className="btn btn-secondary btn-sm"
                    style={{ height: 28, padding: "0 10px", fontSize: 11 }}
                  >
                    Previous
                  </button>
                  <button
                    disabled={pagination.page >= pagination.pages}
                    onClick={() => setPagination((prev) => ({ ...prev, page: prev.page + 1 }))}
                    className="btn btn-secondary btn-sm"
                    style={{ height: 28, padding: "0 10px", fontSize: 11 }}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Persistent In-Layout Side Panel (No modal backdrop, table resizes smoothly) */}
        {sidePanelMode !== "none" && (
          <div className="wm-side-panel">
            {/* Panel Mode: Task Details */}
            {sidePanelMode === "details" && selectedTask && (
              <>
                {/* Header */}
                <div className="wm-panel-header">
                  <div style={{ paddingRight: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <StatusBadge status={selectedTask.status} />
                      <span
                        className={`wm-priority-badge ${
                          selectedTask.priority === "CRITICAL"
                            ? "wm-priority-critical"
                            : selectedTask.priority === "HIGH"
                            ? "wm-priority-high"
                            : selectedTask.priority === "LOW"
                            ? "wm-priority-low"
                            : "wm-priority-medium"
                        }`}
                      >
                        {selectedTask.priority}
                      </span>
                    </div>
                    <h3 className="wm-panel-header-title">
                      {selectedTask.title}
                    </h3>
                  </div>
                  <button
                    type="button"
                    className="wm-panel-close-btn"
                    onClick={() => setSidePanelMode("none")}
                    aria-label="Close details"
                  >
                    <IconClose size={16} />
                  </button>
                </div>

                {/* Scrollable Content */}
                <div className="wm-panel-body">
                  {/* Section 1: Assignment & Timeline Details */}
                  <div style={{ background: "#f8fafc", borderRadius: 10, padding: "14px 16px", border: "1px solid #e2e8f0" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, fontSize: 12 }}>
                      <div>
                        <div style={{ color: "#64748b", fontWeight: 600 }}>Assignee</div>
                        <div style={{ fontWeight: 700, color: "#0f172a", marginTop: 2 }}>
                          {selectedTask.assigneeSnapshot?.fullName || "Unassigned"}
                        </div>
                        <div style={{ color: "#64748b" }}>
                          {selectedTask.assigneeSnapshot?.employeeCode} • {selectedTask.assigneeSnapshot?.department || selectedTask.department || "General"}
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

                  {/* Section 2: Description & Criteria */}
                  <div>
                    <div className="wm-section-divider">
                      Description
                    </div>
                    <div style={{ fontSize: 13, color: "#334155", lineHeight: 1.5, whiteSpace: "pre-wrap", marginTop: 8 }}>
                      {selectedTask.description}
                    </div>
                  </div>

                  {selectedTask.acceptanceCriteria?.length > 0 && (
                    <div>
                      <div className="wm-section-divider">
                        Acceptance Criteria
                      </div>
                      <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 13, color: "#334155" }}>
                        {selectedTask.acceptanceCriteria.map((c, idx) => (
                          <li key={idx} style={{ marginBottom: 4 }}>
                            {c}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Section 3: Submitted Deliverables & Evidence */}
                  {selectedTask.deliverables?.length > 0 && (
                    <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 14 }}>
                      <div className="wm-section-divider">
                        Submitted Deliverables
                      </div>
                      {selectedTask.submissionNotes && (
                        <div style={{ fontStyle: "italic", fontSize: 12, color: "#475569", margin: "8px 0", background: "#f8fafc", padding: "10px 12px", borderRadius: 8, border: "1px solid #e2e8f0" }}>
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

                  {/* Section 4: Review Feedback */}
                  {selectedTask.review?.decision && (
                    <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 14 }}>
                      <div className="wm-section-divider">
                        Review Decision: {selectedTask.review.decision}
                      </div>
                      <div style={{ fontSize: 11, color: "#64748b", margin: "6px 0" }}>
                        By {selectedTask.review.reviewerSnapshot?.fullName} on {new Date(selectedTask.review.reviewedAt).toLocaleDateString()}
                      </div>
                      {selectedTask.review.comments && (
                        <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "10px 12px", fontSize: 12, color: "#92400e" }}>
                          {selectedTask.review.comments}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Section 5: Inline Review Form (Toggled when reviewing a submitted task) */}
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
                        <label className="wm-form-label">
                          Decision
                        </label>
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
                        <label className="wm-form-label">
                          Review Feedback / Comments
                        </label>
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
                        <button
                          type="submit"
                          className="wm-btn-primary"
                          disabled={submittingReview}
                        >
                          {submittingReview ? "Submitting..." : "Submit Review"}
                        </button>
                      </div>
                    </form>
                  )}
                </div>

                {/* Panel Footer */}
                <div className="wm-panel-footer">
                  <button
                    type="button"
                    className="wm-btn-secondary"
                    onClick={() => setSidePanelMode("none")}
                  >
                    Close Panel
                  </button>

                  {selectedTask.status === "SUBMITTED" && !showReviewForm && (
                    <button
                      type="button"
                      className="wm-btn-primary"
                      onClick={() => setShowReviewForm(true)}
                    >
                      Review Submission
                    </button>
                  )}
                </div>
              </>
            )}

            {/* Panel Mode: Create Task */}
            {sidePanelMode === "create" && (
              <>
                {/* Header */}
                <div className="wm-panel-header">
                  <div>
                    <h3 className="wm-panel-header-title">
                      Create & Assign Task
                    </h3>
                    <p className="wm-panel-header-subtitle">
                      Define objectives and assign to a team member
                    </p>
                  </div>
                  <button
                    type="button"
                    className="wm-panel-close-btn"
                    onClick={() => setSidePanelMode("none")}
                    aria-label="Close form"
                  >
                    <IconClose size={16} />
                  </button>
                </div>

                {createError && (
                  <div className="alert alert-danger" style={{ margin: "12px 20px 0", padding: "8px 12px", fontSize: 12 }}>
                    <IconAlertCircle size={15} />
                    <span>{createError}</span>
                  </div>
                )}

                {/* Form Body - Scrollable */}
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
                        <label className="wm-form-label">
                          <span>Priority <span className="req">*</span></span>
                        </label>
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
                        <label className="wm-form-label">
                          Department
                        </label>
                        <input
                          type="text"
                          className="wm-form-input"
                          placeholder="e.g. Engineering"
                          value={taskForm.department}
                          onChange={(e) => setTaskForm({ ...taskForm, department: e.target.value })}
                        />
                      </div>
                      <div className="wm-form-group">
                        <label className="wm-form-label">
                          Project
                        </label>
                        <input
                          type="text"
                          className="wm-form-input"
                          placeholder="e.g. Q4 Migration"
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
                      <label className="wm-form-label">
                        Acceptance Criteria (one per line)
                      </label>
                      <textarea
                        rows={3}
                        className="wm-form-textarea"
                        placeholder="E.g.&#10;Unit tests passing&#10;Code reviewed"
                        value={taskForm.acceptanceCriteria}
                        onChange={(e) => setTaskForm({ ...taskForm, acceptanceCriteria: e.target.value })}
                      />
                    </div>
                  </div>

                  {/* Form Footer */}
                  <div className="wm-panel-footer">
                    <button
                      type="button"
                      className="wm-btn-secondary"
                      onClick={() => setSidePanelMode("none")}
                      disabled={creatingTask}
                    >
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
    </div>
  );
}
