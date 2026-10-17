import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppHeader from "../components/AppHeader";
import api from "../services/api";

const PAGE_SIZE_OPTIONS = [10, 50, 100, 200, 300];

const AVAILABLE_COLUMNS = [
  { id: "employeeCode", label: "Code" },
  { id: "fullName", label: "Full Name" },
  { id: "email", label: "Email" },
  { id: "phoneNumber", label: "Phone" },
  { id: "jobTitle", label: "Job Title" },
  { id: "project", label: "Project" },
  { id: "status", label: "Status" },
  { id: "invitation", label: "Invitation" },
  { id: "salary", label: "Monthly Salary" },
  { id: "joiningDate", label: "Joining Date" },
];

export default function AdminHome() {
  const navigate = useNavigate();

  const [summary, setSummary] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 10,
    totalEmployees: 0,
    totalPages: 1,
  });

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);

  const [visibleColumns, setVisibleColumns] = useState({
    employeeCode: true,
    fullName: true,
    email: true,
    phoneNumber: false,
    jobTitle: true,
    project: true,
    status: true,
    invitation: true,
    salary: true,
    joiningDate: true,
  });
  const [showColumnPicker, setShowColumnPicker] = useState(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // Add Employee Modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [savingAdd, setSavingAdd] = useState(false);
  const [addError, setAddError] = useState("");
  const [addFieldErrors, setAddFieldErrors] = useState({});
  const [showNewEmpPassword, setShowNewEmpPassword] = useState(false);
  const [createdInvitationInfo, setCreatedInvitationInfo] = useState(null);
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [resendingId, setResendingId] = useState(null);

  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const [newEmployee, setNewEmployee] = useState({
    fullName: "",
    employeeCode: "",
    email: "",
    jobTitle: "",
    department: "",
    employmentType: "Full-time",
    joiningDate: "",
    projectName: "",
    monthlySalary: "",
    password: "",
  });

  // Debounce search
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(search);
      setCurrentPage(1);
    }, 300);
    return () => clearTimeout(handler);
  }, [search]);

  // Load summary and list
  useEffect(() => {
    let cancelled = false;

    const fetchData = async () => {
      try {
        const queryParams = new URLSearchParams({
          page: String(currentPage),
          limit: String(pageSize),
        });

        if (debouncedSearch.trim()) {
          queryParams.set("search", debouncedSearch.trim());
        }

        if (statusFilter !== "ALL") {
          queryParams.set("status", statusFilter);
        }

        const [summaryRes, employeesRes] = await Promise.all([
          api.get("/employees/summary"),
          api.get(`/employees?${queryParams.toString()}`),
        ]);

        if (!cancelled) {
          setSummary(summaryRes.data);
          setEmployees(employeesRes.data.employees || []);
          setPagination(employeesRes.data.pagination);
          setError("");
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.response?.data?.message || "Failed to load employee records.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    fetchData();

    return () => {
      cancelled = true;
    };
  }, [currentPage, pageSize, debouncedSearch, statusFilter, refreshTrigger]);

  const toggleColumn = (columnId) => {
    setVisibleColumns((prev) => ({
      ...prev,
      [columnId]: !prev[columnId],
    }));
  };

  const handleViewDetails = (empId) => {
    navigate(`/admin/employees/${empId}`);
  };

  const handleOpenEdit = (emp) => {
    navigate(`/admin/employees/${emp._id}/edit`);
  };

  const handleCreateEmployee = async (e) => {
    e.preventDefault();
    setAddError("");
    const errors = {};

    if (!newEmployee.fullName.trim()) {
      errors.fullName = "Full name is required.";
    }
    if (!newEmployee.employeeCode.trim()) {
      errors.employeeCode = "Employee code is required.";
    }
    if (!newEmployee.email.trim()) {
      errors.email = "Email is required.";
    } else {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(newEmployee.email.trim())) {
        errors.email = "Please enter a valid email address.";
      }
    }

    if (newEmployee.monthlySalary !== "" && newEmployee.monthlySalary != null) {
      const salaryNum = parseFloat(newEmployee.monthlySalary);
      if (isNaN(salaryNum) || salaryNum < 0) {
        errors.monthlySalary = "Please enter a valid non-negative salary amount.";
      }
    }

    if (newEmployee.joiningDate) {
      const d = new Date(newEmployee.joiningDate);
      if (isNaN(d.getTime())) {
        errors.joiningDate = "Please enter a valid date.";
      }
    }

    if (newEmployee.password && newEmployee.password.length < 8) {
      errors.password = "Initial password must be at least 8 characters long.";
    }

    if (Object.keys(errors).length > 0) {
      setAddFieldErrors(errors);
      return;
    }

    setSavingAdd(true);

    try {
      const response = await api.post("/employees", {
        ...newEmployee,
        fullName: newEmployee.fullName.trim(),
        employeeCode: newEmployee.employeeCode.trim(),
        email: newEmployee.email.trim(),
      });

      setSuccessMsg("Employee created successfully! Onboarding invitation generated.");
      setCreatedInvitationInfo({
        employee: response.data?.employee,
        invitation: response.data?.invitation,
      });
      setRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      if (!err.response || err.code === "ERR_NETWORK" || err.response.status >= 500) {
        setAddError("We're unable to connect right now. Please try again in a moment.");
      } else if (err.response.status === 403) {
        setAddError("Account creation blocked: you lack permission or the company workspace is unavailable.");
      } else {
        const backendMessage = err.response.data?.message || "Unable to create employee.";
        const backendErrors = err.response.data?.errors || {};
        setAddError(backendMessage);
        if (Object.keys(backendErrors).length > 0) {
          setAddFieldErrors((prev) => ({ ...prev, ...backendErrors }));
        }
      }
    } finally {
      setSavingAdd(false);
    }
  };

  const handleResendInvite = async (empId) => {
    try {
      setResendingId(empId);
      const res = await api.post(`/employees/${empId}/resend-invite`);
      setSuccessMsg(res.data?.message || "Invitation resent successfully!");
      if (res.data?.invitation?.inviteLink) {
        navigator.clipboard?.writeText(res.data.invitation.inviteLink);
        setSuccessMsg("Invitation resent! Link copied to clipboard.");
      }
      setRefreshTrigger((prev) => prev + 1);
      setTimeout(() => setSuccessMsg(""), 5000);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to resend onboarding invitation.");
      setTimeout(() => setError(""), 5000);
    } finally {
      setResendingId(null);
    }
  };

  const handleCloseAddModal = () => {
    setShowAddModal(false);
    setCreatedInvitationInfo(null);
    setNewEmployee({
      fullName: "",
      employeeCode: "",
      email: "",
      jobTitle: "",
      department: "",
      employmentType: "Full-time",
      joiningDate: "",
      projectName: "",
      monthlySalary: "",
      password: "",
    });
    setShowNewEmpPassword(false);
    setAddFieldErrors({});
    setAddError("");
    setCopiedInvite(false);
  };

  const formatCurrency = (amount) => {
    if (amount == null) return "—";
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const formatDate = (dateString) => {
    if (!dateString) return "—";
    return new Date(dateString).toLocaleDateString("en-IN", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  return (
    <main className="container-wide">
      <AppHeader title="Employee Management" />

      {/* Summary Cards */}
      <div className="stats-grid">
        <div className="stat-card">
          <span className="stat-label">Total Employees</span>
          <span className="stat-value">{summary ? summary.totalEmployees : "—"}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Active Employees</span>
          <span className="stat-value" style={{ color: "#09090b" }}>
            {summary ? summary.activeEmployees : "—"}
          </span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Inactive Employees</span>
          <span className="stat-value" style={{ color: "#71717a" }}>
            {summary ? summary.inactiveEmployees : "—"}
          </span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Assigned to Projects</span>
          <span className="stat-value" style={{ color: "#27272a" }}>
            {summary ? summary.assignedEmployees : "—"}
          </span>
        </div>
        <div className="stat-card highlight">
          <span className="stat-label">Total Monthly Salary</span>
          <span className="stat-value">
            {summary ? formatCurrency(summary.totalMonthlySalary) : "—"}
          </span>
        </div>
      </div>

      {successMsg && <div className="success-alert">{successMsg}</div>}
      {error && <div className="error">{error}</div>}

      {/* Toolbar */}
      <div className="toolbar">
        <div className="toolbar-left">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email, or code..."
            className="search-input"
          />

          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setCurrentPage(1);
            }}
            className="filter-select"
          >
            <option value="ALL">All Statuses</option>
            <option value="ACTIVE">Active Only</option>
            <option value="INACTIVE">Inactive Only</option>
          </select>

          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setCurrentPage(1);
            }}
            className="filter-select"
          >
            {PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size} per page
              </option>
            ))}
          </select>
        </div>

        <div className="toolbar-right">
          <div className="column-visibility-container">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setShowColumnPicker((prev) => !prev)}
            >
              Columns ▾
            </button>
            {showColumnPicker && (
              <div className="column-visibility-popover">
                <strong style={{ fontSize: "12px", color: "#64748b" }}>Toggle Columns</strong>
                {AVAILABLE_COLUMNS.map((col) => (
                  <label key={col.id} className="column-checkbox-label">
                    <input
                      type="checkbox"
                      checked={visibleColumns[col.id]}
                      onChange={() => toggleColumn(col.id)}
                    />
                    {col.label}
                  </label>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            style={{ display: "flex", alignItems: "center", gap: "6px" }}
          >
            <span>+</span> Add Employee
          </button>
        </div>
      </div>

      {/* Table & States */}
      {loading ? (
        <div className="state-box">
          <p>Loading employee records...</p>
        </div>
      ) : employees.length === 0 ? (
        <div className="state-box">
          <h3>No employees found</h3>
          <p className="subtitle">
            {debouncedSearch || statusFilter !== "ALL"
              ? "Try adjusting your search terms or status filters."
              : "There are no employee records registered in this company database yet."}
          </p>
        </div>
      ) : (
        <>
          <div className="data-table-container">
            <table className="data-table">
              <thead>
                <tr>
                  {visibleColumns.employeeCode && <th>Code</th>}
                  {visibleColumns.fullName && <th>Full Name</th>}
                  {visibleColumns.email && <th>Email</th>}
                  {visibleColumns.phoneNumber && <th>Phone</th>}
                  {visibleColumns.jobTitle && <th>Job Title</th>}
                  {visibleColumns.project && <th>Project</th>}
                  {visibleColumns.status && <th>Status</th>}
                  {visibleColumns.invitation && <th>Invitation</th>}
                  {visibleColumns.salary && <th>Monthly Salary</th>}
                  {visibleColumns.joiningDate && <th>Joining Date</th>}
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((emp) => (
                  <tr key={emp._id}>
                    {visibleColumns.employeeCode && (
                      <td>
                        <strong>{emp.employeeCode}</strong>
                      </td>
                    )}
                    {visibleColumns.fullName && <td>{emp.fullName}</td>}
                    {visibleColumns.email && <td>{emp.email}</td>}
                    {visibleColumns.phoneNumber && <td>{emp.phoneNumber || "—"}</td>}
                    {visibleColumns.jobTitle && <td>{emp.job?.jobTitle || "—"}</td>}
                    {visibleColumns.project && (
                      <td>{emp.job?.project?.projectName || "—"}</td>
                    )}
                    {visibleColumns.status && (
                      <td>
                        <span
                          className={`badge ${
                            emp.status === "ACTIVE" ? "badge-active" : "badge-inactive"
                          }`}
                        >
                          {emp.status}
                        </span>
                      </td>
                    )}
                    {visibleColumns.invitation && (
                      <td>
                        {emp.invitation?.status === "ACCEPTED" ? (
                          <span className="badge badge-active">Accepted</span>
                        ) : emp.invitation?.status === "DELIVERY_FAILED" ? (
                          <span className="badge" style={{ background: "#7f1d1d", color: "#fecaca" }}>Delivery Failed</span>
                        ) : (
                          <span className="badge" style={{ background: "#27272a", color: "#e4e4e7", border: "1px solid #3f3f46" }}>Invite Pending</span>
                        )}
                      </td>
                    )}
                    {visibleColumns.salary && (
                      <td>
                        <span style={{ fontWeight: "500" }}>
                          {formatCurrency(emp.currentMonthlySalary)}
                        </span>
                      </td>
                    )}
                    {visibleColumns.joiningDate && (
                      <td>{formatDate(emp.job?.joiningDate)}</td>
                    )}
                    <td>
                      <div className="row-actions">
                        <button
                          type="button"
                          className="btn-secondary btn-sm"
                          onClick={() => handleViewDetails(emp._id)}
                        >
                          Details
                        </button>
                        <button
                          type="button"
                          className="btn-secondary btn-sm"
                          onClick={() => handleOpenEdit(emp)}
                        >
                          Edit
                        </button>
                        {emp.invitation?.status !== "ACCEPTED" && (
                          <button
                            type="button"
                            className="btn-secondary btn-sm"
                            disabled={resendingId === emp._id}
                            onClick={() => handleResendInvite(emp._id)}
                            title="Resend onboarding invitation"
                          >
                            {resendingId === emp._id ? "Sending..." : "Resend"}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="pagination-bar">
            <span className="subtitle">
              Showing {(pagination.page - 1) * pagination.limit + 1} to{" "}
              {Math.min(pagination.page * pagination.limit, pagination.totalEmployees)} of{" "}
              {pagination.totalEmployees} employees
            </span>

            <div className="page-controls">
              <button
                type="button"
                className="btn-secondary btn-sm"
                disabled={pagination.page <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </button>
              <span style={{ fontSize: "13px", padding: "0 6px" }}>
                Page {pagination.page} of {pagination.totalPages}
              </span>
              <button
                type="button"
                className="btn-secondary btn-sm"
                disabled={pagination.page >= pagination.totalPages}
                onClick={() => setCurrentPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}

      {/* Add Employee Modal (Simplified HR Creation & Invitation Workflow) */}
      {showAddModal && (
        <div className="modal-overlay" onClick={handleCloseAddModal}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "620px" }}>
            <div className="modal-header">
              <h2>{createdInvitationInfo ? "Employee Onboarding Invitation" : "Add New Employee"}</h2>
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={handleCloseAddModal}
              >
                ✕
              </button>
            </div>

            {addError && <div className="error">{addError}</div>}

            {createdInvitationInfo ? (
              <div style={{ padding: "8px 0" }}>
                <div style={{ textAlign: "center", marginBottom: "20px" }}>
                  <div
                    style={{
                      width: "48px",
                      height: "48px",
                      borderRadius: "50%",
                      background: "#27272a",
                      color: "#fafafa",
                      border: "1px solid #3f3f46",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "20px",
                      marginBottom: "12px",
                    }}
                  >
                    ✓
                  </div>
                  <h3 style={{ margin: "0 0 6px", fontSize: "18px", color: "#f4f4f5" }}>
                    Official Employee Record Created
                  </h3>
                  <p style={{ margin: 0, fontSize: "14px", color: "#a1a1aa" }}>
                    {createdInvitationInfo.employee?.fullName} ({createdInvitationInfo.employee?.employeeCode}) has been created.
                  </p>
                </div>

                <div
                  style={{
                    background: "#18181b",
                    border: "1px solid #27272a",
                    borderRadius: "8px",
                    padding: "16px",
                    marginBottom: "18px",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "10px", fontSize: "13px" }}>
                    <span style={{ color: "#a1a1aa" }}>Registered Work Email</span>
                    <strong style={{ color: "#f4f4f5" }}>{createdInvitationInfo.employee?.email}</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "14px", fontSize: "13px" }}>
                    <span style={{ color: "#a1a1aa" }}>Invitation Delivery Status</span>
                    <span className="badge" style={{ background: "#27272a", color: "#e4e4e7", border: "1px solid #3f3f46" }}>
                      {createdInvitationInfo.invitation?.status || "PENDING"}
                    </span>
                  </div>

                  <label style={{ fontSize: "12px", color: "#a1a1aa", display: "block", marginBottom: "6px" }}>
                    Secure Employee Onboarding Link (Single-use, 7 days validity)
                  </label>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <input
                      readOnly
                      value={createdInvitationInfo.invitation?.inviteLink || ""}
                      style={{
                        background: "#09090b",
                        border: "1px solid #3f3f46",
                        color: "#e4e4e7",
                        fontSize: "12px",
                        padding: "8px 10px",
                        flex: 1,
                        borderRadius: "6px",
                      }}
                    />
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => {
                        if (createdInvitationInfo.invitation?.inviteLink) {
                          navigator.clipboard?.writeText(createdInvitationInfo.invitation.inviteLink);
                          setCopiedInvite(true);
                          setTimeout(() => setCopiedInvite(false), 3000);
                        }
                      }}
                      style={{ whiteSpace: "nowrap" }}
                    >
                      {copiedInvite ? "Copied!" : "Copy Link"}
                    </button>
                  </div>
                  <p style={{ margin: "10px 0 0", fontSize: "12px", color: "#71717a" }}>
                    {createdInvitationInfo.invitation?.emailSent
                      ? "✓ An invitation email was dispatched to the employee's work address."
                      : "Note: In test or offline environment, copy and provide this secure link directly to the employee."}
                  </p>
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                  <button type="button" className="btn-primary" onClick={handleCloseAddModal}>
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleCreateEmployee} className="auth-form" noValidate>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                  <label>
                    Full Name *
                    <input
                      className={addFieldErrors.fullName ? "has-error" : ""}
                      value={newEmployee.fullName}
                      onChange={(e) => {
                        setNewEmployee({ ...newEmployee, fullName: e.target.value });
                        if (addFieldErrors.fullName) setAddFieldErrors((prev) => ({ ...prev, fullName: "" }));
                        if (addError) setAddError("");
                      }}
                      placeholder="e.g. Maya Rao"
                      required
                    />
                    {addFieldErrors.fullName && (
                      <span className="field-error">{addFieldErrors.fullName}</span>
                    )}
                  </label>
                  <label>
                    Employee ID / Code *
                    <input
                      className={addFieldErrors.employeeCode ? "has-error" : ""}
                      value={newEmployee.employeeCode}
                      onChange={(e) => {
                        setNewEmployee({ ...newEmployee, employeeCode: e.target.value });
                        if (addFieldErrors.employeeCode) setAddFieldErrors((prev) => ({ ...prev, employeeCode: "" }));
                        if (addError) setAddError("");
                      }}
                      placeholder="e.g. EMP-004"
                      required
                    />
                    {addFieldErrors.employeeCode && (
                      <span className="field-error">{addFieldErrors.employeeCode}</span>
                    )}
                  </label>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                  <label>
                    Work Email *
                    <input
                      type="email"
                      className={addFieldErrors.email ? "has-error" : ""}
                      value={newEmployee.email}
                      onChange={(e) => {
                        setNewEmployee({ ...newEmployee, email: e.target.value });
                        if (addFieldErrors.email) setAddFieldErrors((prev) => ({ ...prev, email: "" }));
                        if (addError) setAddError("");
                      }}
                      placeholder="maya@company.com"
                      required
                    />
                    {addFieldErrors.email && (
                      <span className="field-error">{addFieldErrors.email}</span>
                    )}
                  </label>
                  <label>
                    Designation / Job Title
                    <input
                      value={newEmployee.jobTitle}
                      onChange={(e) =>
                        setNewEmployee({ ...newEmployee, jobTitle: e.target.value })
                      }
                      placeholder="e.g. Senior Software Engineer"
                    />
                  </label>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                  <label>
                    Department
                    <input
                      value={newEmployee.department}
                      onChange={(e) =>
                        setNewEmployee({ ...newEmployee, department: e.target.value })
                      }
                      placeholder="e.g. Engineering"
                    />
                  </label>
                  <label>
                    Employment Type
                    <select
                      value={newEmployee.employmentType}
                      onChange={(e) =>
                        setNewEmployee({ ...newEmployee, employmentType: e.target.value })
                      }
                      className="filter-select"
                    >
                      <option value="Full-time">Full-time</option>
                      <option value="Part-time">Part-time</option>
                      <option value="Contract">Contract</option>
                      <option value="Intern">Intern</option>
                    </select>
                  </label>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                  <label>
                    Joining Date
                    <input
                      type="date"
                      className={addFieldErrors.joiningDate ? "has-error" : ""}
                      value={newEmployee.joiningDate}
                      onChange={(e) => {
                        setNewEmployee({ ...newEmployee, joiningDate: e.target.value });
                        if (addFieldErrors.joiningDate) setAddFieldErrors((prev) => ({ ...prev, joiningDate: "" }));
                        if (addError) setAddError("");
                      }}
                    />
                    {addFieldErrors.joiningDate && (
                      <span className="field-error">{addFieldErrors.joiningDate}</span>
                    )}
                  </label>
                  <label>
                    Approved Monthly CTC (₹)
                    <input
                      type="number"
                      className={addFieldErrors.monthlySalary ? "has-error" : ""}
                      value={newEmployee.monthlySalary}
                      onChange={(e) => {
                        setNewEmployee({ ...newEmployee, monthlySalary: e.target.value });
                        if (addFieldErrors.monthlySalary) setAddFieldErrors((prev) => ({ ...prev, monthlySalary: "" }));
                        if (addError) setAddError("");
                      }}
                      placeholder="e.g. 75000"
                      min="0"
                    />
                    {addFieldErrors.monthlySalary && (
                      <span className="field-error">{addFieldErrors.monthlySalary}</span>
                    )}
                  </label>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                  <label>
                    Project Assignment
                    <input
                      value={newEmployee.projectName}
                      onChange={(e) =>
                        setNewEmployee({ ...newEmployee, projectName: e.target.value })
                      }
                      placeholder="e.g. Core Banking Platform"
                    />
                  </label>
                  <label>
                    Initial Password (Optional)
                    <div className="password-input-wrapper">
                      <input
                        type={showNewEmpPassword ? "text" : "password"}
                        className={addFieldErrors.password ? "has-error" : ""}
                        value={newEmployee.password}
                        onChange={(e) => {
                          setNewEmployee({ ...newEmployee, password: e.target.value });
                          if (addFieldErrors.password) setAddFieldErrors((prev) => ({ ...prev, password: "" }));
                          if (addError) setAddError("");
                        }}
                        placeholder="Leave blank for self-service"
                      />
                      <button
                        type="button"
                        className="password-toggle-btn"
                        onClick={() => setShowNewEmpPassword((prev) => !prev)}
                        title={showNewEmpPassword ? "Hide password" : "Show password"}
                        aria-label={showNewEmpPassword ? "Hide password" : "Show password"}
                      >
                        {showNewEmpPassword ? (
                          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                          </svg>
                        ) : (
                          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                        )}
                      </button>
                    </div>
                    {addFieldErrors.password && (
                      <span className="field-error">{addFieldErrors.password}</span>
                    )}
                  </label>
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "16px" }}>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={handleCloseAddModal}
                  >
                    Cancel
                  </button>
                  <button type="submit" disabled={savingAdd} className="btn-primary">
                    {savingAdd ? "Creating..." : "Create & Send Invite"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

    </main>
  );
}
