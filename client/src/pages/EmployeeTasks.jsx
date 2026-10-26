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

const EMPLOYEE_TABS = {
  ALL: "ALL",
  TODO: "ASSIGNED",
  IN_PROGRESS: "IN_PROGRESS",
  SUBMITTED: "SUBMITTED",
  COMPLETED: "APPROVED",
  TEAM_QUEUE: "TEAM_QUEUE",
};

export default function EmployeeTasks() {
  const [activeTab, setActiveTab] = useState(EMPLOYEE_TABS.ALL);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // Filters
  const [priorityFilter, setPriorityFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, pages: 1 });

  // Metadata
  const [meta, setMeta] = useState({
    userRole: "",
    isManager: false,
    directReportsCount: 0,
    assignableEmployees: [],
    departments: [],
  });

  // In-layout Right Side Panel
  const [sidePanelMode, setSidePanelMode] = useState("none"); // 'none' | 'details'
  const [selectedTask, setSelectedTask] = useState(null);

  // Task Execution & Submission State (Inline in panel)
  const [startingTaskId, setStartingTaskId] = useState(null);
  const [showSubmitForm, setShowSubmitForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitForm, setSubmitForm] = useState({
    notes: "",
    links: [""],
    files: [],
  });
  const [uploadingFile, setUploadingFile] = useState(false);

  // Manager Review State (Inline in panel for managers reviewing subordinates)
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const [reviewDecision, setReviewDecision] = useState("APPROVED");
  const [reviewComments, setReviewComments] = useState("");

  // Load Metadata
  useEffect(() => {
    let cancelled = false;
    async function fetchMeta() {
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
      } catch (err) {
        console.error("Failed to fetch task metadata:", err);
      }
    }
    fetchMeta();
    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch Tasks
  const fetchTasks = async (page = 1) => {
    try {
      setLoading(true);
      setError("");

      const params = {
        page,
        limit: pagination.limit,
      };

      if (activeTab === EMPLOYEE_TABS.TEAM_QUEUE) {
        params.scope = "team_tasks";
        params.status = "SUBMITTED";
      } else {
        params.scope = "my_tasks";
        if (activeTab !== EMPLOYEE_TABS.ALL) {
          params.status = activeTab;
        }
      }

      if (priorityFilter !== "ALL") {
        params.priority = priorityFilter;
      }
      if (search.trim()) {
        params.search = search.trim();
      }

      const res = await api.get("/tasks", { params });
      if (res.data?.success) {
        const taskList = res.data?.tasks || res.data?.data?.tasks || [];
        const pag = res.data?.pagination || res.data?.data?.pagination || {
          page: 1,
          limit: 20,
          total: taskList.length,
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
    fetchTasks(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, priorityFilter]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    fetchTasks(1);
  };

  // Metrics calculated from loaded dataset
  const metrics = useMemo(() => {
    const list = tasks || [];
    return {
      total: pagination.total || list.length,
      todo: list.filter((t) => t.status === "ASSIGNED").length,
      inProgress: list.filter((t) => t.status === "IN_PROGRESS").length,
      submitted: list.filter((t) => t.status === "SUBMITTED").length,
      completed: list.filter((t) => t.status === "APPROVED").length,
    };
  }, [tasks, pagination.total]);

  // Start Task
  const handleStartTask = async (task) => {
    try {
      setStartingTaskId(task._id);
      setError("");
      const res = await api.post(`/tasks/${task._id}/start`);
      if (res.data?.success) {
        const updatedTask = res.data.task || res.data.data || {
          ...task,
          status: "IN_PROGRESS",
          startDate: new Date().toISOString(),
        };
        setSuccessMsg(`Task "${task.title}" is now In Progress.`);
        setTasks((prev) => prev.map((t) => (t._id === updatedTask._id ? updatedTask : t)));
        selectTask(updatedTask);
        fetchTasks(pagination.page);
      }
    } catch (err) {
      setError(err.response?.data?.message || "Failed to start task");
    } finally {
      setStartingTaskId(null);
    }
  };

  // Submit Evidence Handler
  const handleLinkChange = (index, val) => {
    const updated = [...submitForm.links];
    updated[index] = val;
    setSubmitForm({ ...submitForm, links: updated });
  };

  const addLinkField = () => {
    setSubmitForm({ ...submitForm, links: [...submitForm.links, ""] });
  };

  const removeLinkField = (index) => {
    const updated = submitForm.links.filter((_, i) => i !== index);
    setSubmitForm({ ...submitForm, links: updated.length ? updated : [""] });
  };

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
      }
    } catch (err) {
      setSubmitError(err.response?.data?.message || "File upload failed");
    } finally {
      setUploadingFile(false);
      e.target.value = "";
    }
  };

  const removeUploadedFile = (index) => {
    setSubmitForm((prev) => ({
      ...prev,
      files: prev.files.filter((_, i) => i !== index),
    }));
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
      setSubmitError("Please provide submission notes or attach deliverables/links before submitting.");
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
        setTasks((prev) => prev.map((t) => (t._id === updatedTask._id ? updatedTask : t)));
        setMetrics((prev) => ({
          ...prev,
          inProgress: Math.max(0, prev.inProgress - 1),
          submitted: prev.submitted + 1,
        }));
        setSuccessMsg(`Task "${selectedTask.title}" submitted successfully for verification.`);
        setSubmitForm({ notes: "", links: [""], files: [] });
        fetchTasks(pagination.page);
      }
    } catch (err) {
      setSubmitError(err.response?.data?.message || "Failed to submit deliverables for verification");
    } finally {
      setSubmitting(false);
    }
  };

  // Manager Review Submit
  const handleReviewSubmit = async (e) => {
    e.preventDefault();
    if (!selectedTask) return;

    try {
      setReviewing(true);
      setReviewError("");
      const res = await api.post(`/tasks/${selectedTask._id}/review`, {
        decision: reviewDecision,
        comments: reviewComments.trim(),
      });

      if (res.data?.success) {
        setShowReviewForm(false);
        setReviewComments("");
        setSuccessMsg(res.data.message || `Review submitted: ${reviewDecision}.`);
        fetchTasks(pagination.page);
      }
    } catch (err) {
      setReviewError(err.response?.data?.message || "Failed to review task");
    } finally {
      setReviewing(false);
    }
  };

  const selectTask = (task) => {
    setSelectedTask(task);
    setShowReviewForm(false);
    setSubmitError("");
    setReviewError("");
    setSidePanelMode("details");

    if (task.submissionNotes || task.deliverables?.length) {
      const existingNotes = task.submissionNotes || "";
      const existingLinks = [];
      const existingFiles = [];
      (task.deliverables || []).forEach((d) => {
        if (d.links?.length) existingLinks.push(...d.links);
        if (d.fileName || d.documentUrl) existingFiles.push(d);
      });
      setSubmitForm({
        notes: existingNotes,
        links: existingLinks.length ? existingLinks : [""],
        files: existingFiles,
      });
    } else {
      setSubmitForm({ notes: "", links: [""], files: [] });
    }
  };

  return (
    <div className="container-wide split-page-container wm-page-container">
      {/* Header */}
      <AppHeader
        title="My Tasks"
        subtitle="Execute assigned initiatives, submit deliverables for review, and earn Impact Points"
        hideLogout={true}
      />

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

      {/* Balanced 4-Column Metric Cards */}
      <div className="wm-kpi-grid">
        <div className="wm-kpi-card accent-slate">
          <div className="wm-kpi-header">
            <span className="wm-kpi-label">To Do / Assigned</span>
          </div>
          <div className="wm-kpi-value">{metrics.todo}</div>
          <div className="wm-kpi-subtext">Ready to commence</div>
        </div>

        <div className="wm-kpi-card accent-blue">
          <div className="wm-kpi-header">
            <span className="wm-kpi-label" style={{ color: "#2563eb" }}>In Progress</span>
          </div>
          <div className="wm-kpi-value" style={{ color: "#2563eb" }}>{metrics.inProgress}</div>
          <div className="wm-kpi-subtext">Actively working</div>
        </div>

        <div className="wm-kpi-card accent-amber">
          <div className="wm-kpi-header">
            <span className="wm-kpi-label" style={{ color: "#d97706" }}>Under Review</span>
          </div>
          <div className="wm-kpi-value" style={{ color: "#d97706" }}>{metrics.submitted}</div>
          <div className="wm-kpi-subtext">Submitted deliverables</div>
        </div>

        <div className="wm-kpi-card accent-emerald">
          <div className="wm-kpi-header">
            <span className="wm-kpi-label" style={{ color: "#059669" }}>Completed</span>
          </div>
          <div className="wm-kpi-value" style={{ color: "#059669" }}>{metrics.completed}</div>
          <div className="wm-kpi-subtext">Approved & points credited</div>
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
          {/* Navigation & Filters Toolbar Card */}
          <div className="wm-toolbar-card">
            {/* Tab Selection Row */}
            <div className="wm-tab-strip">
              <div className="wm-tab-group">
                <button
                  type="button"
                  onClick={() => setActiveTab(EMPLOYEE_TABS.ALL)}
                  className={`wm-tab-btn ${activeTab === EMPLOYEE_TABS.ALL ? "active" : ""}`}
                >
                  All Tasks
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab(EMPLOYEE_TABS.TODO)}
                  className={`wm-tab-btn ${activeTab === EMPLOYEE_TABS.TODO ? "active" : ""}`}
                >
                  To Do
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab(EMPLOYEE_TABS.IN_PROGRESS)}
                  className={`wm-tab-btn ${activeTab === EMPLOYEE_TABS.IN_PROGRESS ? "active" : ""}`}
                >
                  In Progress
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab(EMPLOYEE_TABS.SUBMITTED)}
                  className={`wm-tab-btn ${activeTab === EMPLOYEE_TABS.SUBMITTED ? "active" : ""}`}
                >
                  Under Review
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab(EMPLOYEE_TABS.COMPLETED)}
                  className={`wm-tab-btn ${activeTab === EMPLOYEE_TABS.COMPLETED ? "active" : ""}`}
                >
                  Completed
                </button>
                {meta.isManager && (
                  <button
                    type="button"
                    onClick={() => setActiveTab(EMPLOYEE_TABS.TEAM_QUEUE)}
                    className={`wm-tab-btn ${activeTab === EMPLOYEE_TABS.TEAM_QUEUE ? "active" : ""}`}
                  >
                    Direct Reports Queue
                  </button>
                )}
              </div>

              <div style={{ fontSize: 12, color: "#64748b", fontWeight: 500 }}>
                {pagination.total} task{pagination.total === 1 ? "" : "s"}
              </div>
            </div>

            {/* Filters Row */}
            <div className="wm-filter-row">
              <form onSubmit={handleSearchSubmit} style={{ flex: 1, minWidth: 200, maxWidth: 360 }}>
                <div className="wm-search-wrapper">
                  <span className="wm-search-icon">
                    <IconSearch size={15} />
                  </span>
                  <input
                    type="text"
                    className="wm-input-search"
                    placeholder="Search my tasks..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </form>

              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <select
                  className="wm-select"
                  value={priorityFilter}
                  onChange={(e) => setPriorityFilter(e.target.value)}
                  style={{ width: "auto" }}
                >
                  <option value="ALL">Priority: All</option>
                  <option value="LOW">Low</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="HIGH">High (+Bonus points)</option>
                  <option value="CRITICAL">Critical (+Bonus points)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Table Card */}
          <div className="wm-table-card">
            <div className="wm-table-container">
              <table className="wm-table">
                <thead>
                  <tr>
                    <th>Task Title</th>
                    <th style={{ width: 110 }}>Priority</th>
                    <th style={{ width: 120 }}>Deadline</th>
                    <th style={{ width: 130 }}>Status</th>
                    <th style={{ width: 110, textAlign: "right" }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <TableSkeletonRows cols={5} rows={5} />
                  ) : tasks.length === 0 ? (
                    <tr>
                      <td colSpan={5}>
                        <div className="wm-empty-state">
                          <div className="wm-empty-icon">
                            <IconInfo size={22} />
                          </div>
                          <div className="wm-empty-title">No tasks found</div>
                          <p className="wm-empty-desc">
                            {activeTab === EMPLOYEE_TABS.TODO
                              ? "You have no pending tasks waiting to start."
                              : activeTab === EMPLOYEE_TABS.IN_PROGRESS
                              ? "No active tasks in progress."
                              : "No tasks match the selected view."}
                          </p>
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
                          onClick={() => selectTask(task)}
                          className={isSelected ? "selected-row" : ""}
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
                            <span
                              className={`wm-priority-badge ${
                                task.priority === "HIGH" || task.priority === "CRITICAL"
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
                            <div style={{ display: "inline-flex", gap: 6 }}>
                              {task.status === "ASSIGNED" ? (
                                <button
                                  className="wm-btn-table-action"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleStartTask(task);
                                  }}
                                  disabled={startingTaskId === task._id}
                                  style={{
                                    background: "#2563eb",
                                    color: "#ffffff",
                                    borderColor: "#2563eb",
                                  }}
                                >
                                  {startingTaskId === task._id ? "Starting..." : "Start"}
                                </button>
                              ) : (
                                <button
                                  className={`wm-btn-table-action ${isSelected ? "active" : ""}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    selectTask(task);
                                  }}
                                >
                                  {isSelected ? "Viewing" : "View Details"}
                                </button>
                              )}
                            </div>
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
                  padding: "12px 20px",
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
                    className="wm-btn-secondary"
                    style={{ height: 32, padding: "0 12px", fontSize: 12 }}
                  >
                    Previous
                  </button>
                  <button
                    disabled={pagination.page >= pagination.pages}
                    onClick={() => setPagination((prev) => ({ ...prev, page: prev.page + 1 }))}
                    className="wm-btn-secondary"
                    style={{ height: 32, padding: "0 12px", fontSize: 12 }}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Persistent In-Layout Side Panel (No modal backdrop) */}
        {sidePanelMode === "details" && selectedTask && (
          <div className="split-page-panel wm-side-panel">
            {/* Header */}
            <div className="wm-panel-header">
              <div style={{ paddingRight: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <StatusBadge status={selectedTask.status} />
                  <span
                    className={`wm-priority-badge ${
                      selectedTask.priority === "HIGH" || selectedTask.priority === "CRITICAL"
                        ? "wm-priority-high"
                        : selectedTask.priority === "LOW"
                        ? "wm-priority-low"
                        : "wm-priority-medium"
                    }`}
                  >
                    {selectedTask.priority}
                  </span>
                </div>
                <h3 className="wm-panel-title">
                  {selectedTask.title}
                </h3>
              </div>
              <button
                className="wm-panel-close-btn"
                onClick={() => setSidePanelMode("none")}
                aria-label="Close details"
              >
                <IconClose size={16} />
              </button>
            </div>

            {/* Scrollable Body */}
            <div className="wm-panel-body">
              {/* Metadata Card */}
              <div style={{ background: "#f8fafc", borderRadius: 8, padding: 14, border: "1px solid #e2e8f0" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, fontSize: 12 }}>
                  <div>
                    <div style={{ color: "#64748b", fontWeight: 600 }}>Deadline</div>
                    <div style={{ fontWeight: 700, color: "#0f172a", marginTop: 2 }}>
                      {selectedTask.deadline ? new Date(selectedTask.deadline).toLocaleDateString() : "—"}
                    </div>
                  </div>
                  <div>
                    <div style={{ color: "#64748b", fontWeight: 600 }}>Assigned By</div>
                    <div style={{ fontWeight: 600, color: "#0f172a", marginTop: 2 }}>
                      {selectedTask.assignedBySnapshot?.fullName || "Supervisor / HR"}
                    </div>
                  </div>
                  <div>
                    <div style={{ color: "#64748b", fontWeight: 600 }}>Project</div>
                    <div style={{ fontWeight: 600, color: "#0f172a", marginTop: 2 }}>
                      {selectedTask.projectName || "General Initiative"}
                    </div>
                  </div>
                  <div>
                    <div style={{ color: "#64748b", fontWeight: 600 }}>Potential Points</div>
                    <div style={{ fontWeight: 700, color: "#059669", marginTop: 2 }}>
                      {selectedTask.priority === "HIGH" || selectedTask.priority === "CRITICAL" ? "+20 pts" : "+10 pts"}
                    </div>
                  </div>
                </div>
              </div>

              {/* Description */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
                  Task Description
                </div>
                <div style={{ fontSize: 13, color: "#334155", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                  {selectedTask.description}
                </div>
              </div>

              {/* Criteria */}
              {selectedTask.acceptanceCriteria?.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
                    Success Criteria
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "#334155" }}>
                    {selectedTask.acceptanceCriteria.map((c, idx) => (
                      <li key={idx} style={{ marginBottom: 4 }}>
                        {c}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Reviewer Feedback / Changes Requested */}
              {selectedTask.review?.decision && (
                <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
                    Review Decision: {selectedTask.review.decision}
                  </div>
                  <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>
                    Reviewed by {selectedTask.review.reviewerSnapshot?.fullName} on {new Date(selectedTask.review.reviewedAt).toLocaleDateString()}
                  </div>
                  {selectedTask.review.comments && (
                    <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: 10, fontSize: 12, color: "#92400e" }}>
                      {selectedTask.review.comments}
                    </div>
                  )}
                </div>
              )}

              {/* Submitted Deliverables On Record (Visible when submitted or approved) */}
              {(selectedTask.status === "SUBMITTED" || selectedTask.status === "APPROVED") && (
                <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
                    {selectedTask.status === "APPROVED" ? "Completed Deliverables On Record" : "Submitted Deliverables (Under Verification)"}
                  </div>
                  {selectedTask.submissionNotes && (
                    <div style={{ fontStyle: "italic", fontSize: 12, color: "#475569", marginBottom: 8, background: "#f8fafc", padding: 10, borderRadius: 8, border: "1px solid #e2e8f0" }}>
                      &ldquo;{selectedTask.submissionNotes}&rdquo;
                    </div>
                  )}
                  {selectedTask.deliverables?.map((deliv, idx) => (
                    <div key={idx} style={{ background: "#f8fafc", padding: "10px 12px", borderRadius: 8, border: "1px solid #e2e8f0", marginBottom: 6, fontSize: 12 }}>
                      {deliv.description && <div style={{ fontWeight: 600 }}>{deliv.description}</div>}
                      {deliv.links?.map((link, lIdx) => (
                        <div key={lIdx} style={{ marginTop: 2 }}>
                          <a href={link} target="_blank" rel="noopener noreferrer" style={{ color: "#2563eb", textDecoration: "underline" }}>
                            {link}
                          </a>
                        </div>
                      ))}
                      {deliv.fileName && (
                        <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 6, color: "#475569" }}>
                          <IconDocument size={14} />
                          <span>{deliv.fileName}</span>
                        </div>
                      )}
                    </div>
                  ))}
                  {selectedTask.status === "APPROVED" && (
                    <div style={{ marginTop: 8, padding: "10px 14px", borderRadius: 8, background: "#ecfdf5", border: "1px solid #a7f3d0", color: "#065f46", fontSize: 12, fontWeight: 600 }}>
                      {selectedTask.pointsAwarded > 0
                        ? `Task approved. ${selectedTask.pointsAwarded} Impact Points credited to your balance.`
                        : "Task approved."}
                    </div>
                  )}
                </div>
              )}

              {/* Work Deliverable Submission Section (Always open when IN_PROGRESS or CHANGES_REQUESTED) */}
              {(selectedTask.status === "IN_PROGRESS" || selectedTask.status === "CHANGES_REQUESTED") && (
                <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", marginBottom: 4 }}>
                    Submit Work for Verification
                  </div>
                  <p style={{ margin: "0 0 12px", fontSize: 12, color: "#64748b" }}>
                    Provide notes, deliverables, and PR links for verification. Points are awarded upon approval.
                  </p>

                  {submitError && (
                    <div className="alert alert-danger" style={{ marginBottom: 12, padding: "10px 14px", fontSize: 13 }}>
                      <IconAlertCircle size={16} />
                      <span>{submitError}</span>
                    </div>
                  )}

                  <div className="wm-form-group">
                    <label className="wm-form-label">
                      Submission Notes <span style={{ color: "#64748b", fontWeight: 400 }}>(Summary of work completed)</span>
                    </label>
                    <textarea
                      rows={3}
                      className="wm-form-textarea"
                      placeholder="Summarize the implementation, outcomes, or notes for the reviewer..."
                      value={submitForm.notes}
                      onChange={(e) => setSubmitForm({ ...submitForm, notes: e.target.value })}
                    />
                  </div>

                  <div className="wm-form-group">
                    <label className="wm-form-label">
                      Deliverable Links <span style={{ color: "#64748b", fontWeight: 400 }}>(GitHub PR, Figma, Documents)</span>
                    </label>
                    {submitForm.links.map((link, idx) => (
                      <div key={idx} style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                        <input
                          type="text"
                          className="wm-form-input"
                          placeholder="e.g. github.com/org/repo/pull/101 or https://..."
                          value={link}
                          onChange={(e) => handleLinkChange(idx, e.target.value)}
                          style={{ flex: 1 }}
                        />
                        {submitForm.links.length > 1 && (
                          <button
                            type="button"
                            className="wm-btn-secondary"
                            onClick={() => removeLinkField(idx)}
                            style={{ height: 38, padding: "0 10px" }}
                          >
                            <IconClose size={14} />
                          </button>
                        )}
                      </div>
                    ))}
                    <button
                      type="button"
                      className="wm-btn-secondary"
                      onClick={addLinkField}
                      style={{ height: 30, fontSize: 11, marginTop: 4 }}
                    >
                      + Add Another Link
                    </button>
                  </div>

                  <div className="wm-form-group">
                    <label className="wm-form-label">
                      Attach Evidence Document / File
                    </label>
                    <input
                      type="file"
                      onChange={handleFileUpload}
                      disabled={uploadingFile}
                      style={{ fontSize: 12 }}
                    />
                    {uploadingFile && <div style={{ fontSize: 11, color: "#2563eb", marginTop: 4 }}>Uploading evidence file...</div>}

                    {submitForm.files.map((f, idx) => (
                      <div key={idx} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#f1f5f9", padding: "6px 10px", borderRadius: 6, marginTop: 6, fontSize: 12 }}>
                        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <IconDocument size={14} /> {f.fileName}
                        </span>
                        <button type="button" onClick={() => removeUploadedFile(idx)} style={{ background: "none", border: "none", color: "#dc2626", cursor: "pointer", padding: 0 }}>
                          <IconClose size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Inline Manager Review Form (When manager reviews team member) */}
              {showReviewForm && selectedTask.status === "SUBMITTED" && (
                <form onSubmit={handleReviewSubmit} style={{ borderTop: "1px solid #e2e8f0", paddingTop: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", marginBottom: 10 }}>
                    Team Submission Review
                  </div>
                  {reviewError && (
                    <div className="alert alert-danger" style={{ marginBottom: 12, padding: "10px 14px", fontSize: 12 }}>
                      <span>{reviewError}</span>
                    </div>
                  )}
                  <div className="wm-form-group">
                    <label className="wm-form-label">
                      Decision
                    </label>
                    <select
                      className="wm-select"
                      value={reviewDecision}
                      onChange={(e) => setReviewDecision(e.target.value)}
                    >
                      <option value="APPROVED">Approve (Award Points)</option>
                      <option value="CHANGES_REQUESTED">Request Changes</option>
                      <option value="REJECTED">Reject Submission</option>
                    </select>
                  </div>
                  <div className="wm-form-group">
                    <label className="wm-form-label">
                      Comments / Feedback
                    </label>
                    <textarea
                      rows={3}
                      className="wm-form-textarea"
                      placeholder="Provide review notes..."
                      value={reviewComments}
                      onChange={(e) => setReviewComments(e.target.value)}
                    />
                  </div>
                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <button
                      type="button"
                      className="wm-btn-secondary"
                      onClick={() => setShowReviewForm(false)}
                      disabled={reviewing}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="wm-btn-primary"
                      disabled={reviewing}
                    >
                      {reviewing ? "Submitting..." : "Submit Review"}
                    </button>
                  </div>
                </form>
              )}
            </div>

            {/* Panel Footer */}
            <div className="wm-panel-footer" style={{ justifyContent: "space-between" }}>
              <button
                className="wm-btn-secondary"
                onClick={() => setSidePanelMode("none")}
              >
                Close Panel
              </button>

              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {selectedTask.status === "ASSIGNED" && (
                  <button
                    className="wm-btn-primary"
                    onClick={() => handleStartTask(selectedTask)}
                    disabled={startingTaskId === selectedTask._id}
                  >
                    {startingTaskId === selectedTask._id ? "Starting..." : "Start Task"}
                  </button>
                )}

                {(selectedTask.status === "IN_PROGRESS" || selectedTask.status === "CHANGES_REQUESTED") && (
                  <button
                    type="button"
                    className="wm-btn-primary"
                    onClick={handleSubmitEvidence}
                    disabled={submitting || uploadingFile}
                  >
                    {submitting ? "Submitting..." : "Submit for Verification"}
                  </button>
                )}

                {selectedTask.status === "SUBMITTED" && !showReviewForm && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        padding: "4px 10px",
                        borderRadius: 12,
                        background: "#fef3c7",
                        color: "#92400e",
                      }}
                    >
                      Awaiting Review
                    </span>
                    {meta.isManager && (
                      <button
                        className="wm-btn-primary"
                        onClick={() => setShowReviewForm(true)}
                      >
                        Review Team Task
                      </button>
                    )}
                  </div>
                )}

                {selectedTask.status === "APPROVED" && (
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      padding: "4px 10px",
                      borderRadius: 12,
                      background: "#dcfce7",
                      color: "#166534",
                    }}
                  >
                    Completed
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
