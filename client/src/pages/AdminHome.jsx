import { useEffect, useState } from "react";
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
  { id: "salary", label: "Monthly Salary" },
  { id: "joiningDate", label: "Joining Date" },
];

export default function AdminHome() {
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
    salary: true,
    joiningDate: true,
  });
  const [showColumnPicker, setShowColumnPicker] = useState(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // Modals state
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [savingAdd, setSavingAdd] = useState(false);
  const [addError, setAddError] = useState("");
  const [addFieldErrors, setAddFieldErrors] = useState({});
  const [showNewEmpPassword, setShowNewEmpPassword] = useState(false);

  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const [newEmployee, setNewEmployee] = useState({
    fullName: "",
    employeeCode: "",
    email: "",
    phoneNumber: "",
    jobTitle: "",
    joiningDate: "",
    projectName: "",
    monthlySalary: "",
    password: "",
  });

  const [showEditModal, setShowEditModal] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState("");
  const [editingEmployee, setEditingEmployee] = useState(null);

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

  const handleViewDetails = async (empId) => {
    setLoadingDetails(true);
    try {
      const res = await api.get(`/employees/${empId}`);
      setSelectedEmployee(res.data);
    } catch {
      setError("Unable to load full employee details.");
    } finally {
      setLoadingDetails(false);
    }
  };

  const handleOpenEdit = (emp) => {
    setEditingEmployee({
      _id: emp._id,
      fullName: emp.fullName || "",
      phoneNumber: emp.phoneNumber || "",
      city: emp.city || "",
      status: emp.status || "ACTIVE",
      jobTitle: emp.job?.jobTitle || "",
      projectName: emp.job?.project?.projectName || "",
      projectType: emp.job?.project?.projectType || "MANDATE",
    });
    setEditError("");
    setShowEditModal(true);
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
      await api.post("/employees", {
        ...newEmployee,
        fullName: newEmployee.fullName.trim(),
        employeeCode: newEmployee.employeeCode.trim(),
        email: newEmployee.email.trim(),
      });
      setShowAddModal(false);
      setSuccessMsg("Employee created successfully!");
      setNewEmployee({
        fullName: "",
        employeeCode: "",
        email: "",
        phoneNumber: "",
        jobTitle: "",
        joiningDate: "",
        projectName: "",
        monthlySalary: "",
        password: "",
      });
      setShowNewEmpPassword(false);
      setAddFieldErrors({});
      setRefreshTrigger((prev) => prev + 1);
      setTimeout(() => setSuccessMsg(""), 4000);
    } catch (err) {
      // Form values are safely preserved in newEmployee state!
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

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    setEditError("");
    setSavingEdit(true);

    try {
      await api.patch(`/employees/${editingEmployee._id}`, editingEmployee);
      setShowEditModal(false);
      setSuccessMsg("Employee updated successfully!");
      setRefreshTrigger((prev) => prev + 1);
      setTimeout(() => setSuccessMsg(""), 4000);
    } catch (err) {
      setEditError(err.response?.data?.message || "Unable to update employee.");
    } finally {
      setSavingEdit(false);
    }
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
          <span className="stat-value" style={{ color: "#16a34a" }}>
            {summary ? summary.activeEmployees : "—"}
          </span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Inactive Employees</span>
          <span className="stat-value" style={{ color: "#ea580c" }}>
            {summary ? summary.inactiveEmployees : "—"}
          </span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Assigned to Projects</span>
          <span className="stat-value" style={{ color: "#2563eb" }}>
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
                          disabled={loadingDetails}
                          onClick={() => handleViewDetails(emp._id)}
                        >
                          {loadingDetails ? "Loading..." : "Details"}
                        </button>
                        <button
                          type="button"
                          className="btn-secondary btn-sm"
                          onClick={() => handleOpenEdit(emp)}
                        >
                          Edit
                        </button>
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

      {/* Details Modal */}
      {selectedEmployee && (
        <div className="modal-overlay" onClick={() => setSelectedEmployee(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Employee Details</h2>
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => setSelectedEmployee(null)}
              >
                ✕
              </button>
            </div>

            <div className="detail-grid">
              <div className="detail-item">
                <strong>Employee Code</strong>
                <span>{selectedEmployee.employeeCode}</span>
              </div>
              <div className="detail-item">
                <strong>Status</strong>
                <span
                  className={`badge ${
                    selectedEmployee.status === "ACTIVE"
                      ? "badge-active"
                      : "badge-inactive"
                  }`}
                >
                  {selectedEmployee.status}
                </span>
              </div>
              <div className="detail-item">
                <strong>Full Name</strong>
                <span>{selectedEmployee.fullName}</span>
              </div>
              <div className="detail-item">
                <strong>Email</strong>
                <span>{selectedEmployee.email}</span>
              </div>
              <div className="detail-item">
                <strong>Phone Number</strong>
                <span>{selectedEmployee.phoneNumber || "—"}</span>
              </div>
              <div className="detail-item">
                <strong>City</strong>
                <span>{selectedEmployee.city || "—"}</span>
              </div>
              <div className="detail-item">
                <strong>Job Title</strong>
                <span>{selectedEmployee.job?.jobTitle || "—"}</span>
              </div>
              <div className="detail-item">
                <strong>Joining Date</strong>
                <span>{formatDate(selectedEmployee.job?.joiningDate)}</span>
              </div>
              <div className="detail-item">
                <strong>Assigned Project</strong>
                <span>
                  {selectedEmployee.job?.project?.projectName
                    ? `${selectedEmployee.job.project.projectName} (${selectedEmployee.job.project.projectType})`
                    : "—"}
                </span>
              </div>
              <div className="detail-item">
                <strong>Reporting Manager</strong>
                <span>
                  {selectedEmployee.job?.reportingManagerId
                    ? `${selectedEmployee.job.reportingManagerId.fullName} (${selectedEmployee.job.reportingManagerId.employeeCode})`
                    : "—"}
                </span>
              </div>
            </div>

            <h3 style={{ margin: "20px 0 10px", fontSize: "16px", color: "#334155" }}>
              Compensation (HR Confidential)
            </h3>
            <div className="detail-grid">
              <div className="detail-item">
                <strong>Monthly CTC</strong>
                <span style={{ fontSize: "16px", fontWeight: "600", color: "#4338ca" }}>
                  {formatCurrency(selectedEmployee.currentMonthlySalary)}
                </span>
              </div>
              {selectedEmployee.salaryComponents && (
                <>
                  <div className="detail-item">
                    <strong>Basic Salary</strong>
                    <span>{formatCurrency(selectedEmployee.salaryComponents.basicSalary)}</span>
                  </div>
                  <div className="detail-item">
                    <strong>HRA</strong>
                    <span>{formatCurrency(selectedEmployee.salaryComponents.houseRentAllowance)}</span>
                  </div>
                  <div className="detail-item">
                    <strong>Conveyance</strong>
                    <span>{formatCurrency(selectedEmployee.salaryComponents.conveyanceAllowance)}</span>
                  </div>
                  <div className="detail-item">
                    <strong>Special Allowance</strong>
                    <span>{formatCurrency(selectedEmployee.salaryComponents.specialAllowance)}</span>
                  </div>
                </>
              )}
            </div>

            <div style={{ marginTop: "24px", textAlign: "right" }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setSelectedEmployee(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Employee Modal (Functional HR Creation Workflow) */}
      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Add New Employee</h2>
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => setShowAddModal(false)}
              >
                ✕
              </button>
            </div>

            {addError && <div className="error">{addError}</div>}

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
                  Employee Code *
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
                  Email *
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
                  Phone Number
                  <input
                    value={newEmployee.phoneNumber}
                    onChange={(e) =>
                      setNewEmployee({ ...newEmployee, phoneNumber: e.target.value })
                    }
                    placeholder="+91 98765 00000"
                  />
                </label>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <label>
                  Job Title
                  <input
                    value={newEmployee.jobTitle}
                    onChange={(e) =>
                      setNewEmployee({ ...newEmployee, jobTitle: e.target.value })
                    }
                    placeholder="e.g. Software Engineer"
                  />
                </label>
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
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <label>
                  Assigned Project Name
                  <input
                    value={newEmployee.projectName}
                    onChange={(e) =>
                      setNewEmployee({ ...newEmployee, projectName: e.target.value })
                    }
                    placeholder="e.g. Titan Platform"
                  />
                </label>
                <label>
                  Monthly Salary (CTC)
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

              <label>
                Initial Login Password (optional, default: Welcome123!)
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
                    placeholder="Min 8 characters"
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

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "12px" }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowAddModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" disabled={savingAdd}>
                  {savingAdd ? "Adding employee..." : "Add Employee"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Employee Modal */}
      {showEditModal && editingEmployee && (
        <div className="modal-overlay" onClick={() => setShowEditModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Edit Employee</h2>
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => setShowEditModal(false)}
              >
                ✕
              </button>
            </div>

            {editError && <div className="error">{editError}</div>}

            <form onSubmit={handleSaveEdit} className="auth-form">
              <label>
                Full Name
                <input
                  value={editingEmployee.fullName}
                  onChange={(e) =>
                    setEditingEmployee({ ...editingEmployee, fullName: e.target.value })
                  }
                  required
                />
              </label>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <label>
                  Phone Number
                  <input
                    value={editingEmployee.phoneNumber}
                    onChange={(e) =>
                      setEditingEmployee({ ...editingEmployee, phoneNumber: e.target.value })
                    }
                  />
                </label>
                <label>
                  City
                  <input
                    value={editingEmployee.city}
                    onChange={(e) =>
                      setEditingEmployee({ ...editingEmployee, city: e.target.value })
                    }
                  />
                </label>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <label>
                  Job Title
                  <input
                    value={editingEmployee.jobTitle}
                    onChange={(e) =>
                      setEditingEmployee({ ...editingEmployee, jobTitle: e.target.value })
                    }
                  />
                </label>
                <label>
                  Status
                  <select
                    value={editingEmployee.status}
                    onChange={(e) =>
                      setEditingEmployee({ ...editingEmployee, status: e.target.value })
                    }
                    className="filter-select"
                  >
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="INACTIVE">INACTIVE</option>
                  </select>
                </label>
              </div>

              <label>
                Project Name
                <input
                  value={editingEmployee.projectName}
                  onChange={(e) =>
                    setEditingEmployee({ ...editingEmployee, projectName: e.target.value })
                  }
                />
              </label>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "12px" }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowEditModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" disabled={savingEdit}>
                  {savingEdit ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
