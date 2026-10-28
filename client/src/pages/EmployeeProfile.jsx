import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import StatusBadge from "../components/StatusBadge";
import { IconDocument, IconArrowLeft, IconClose, IconCheck, IconAlertCircle } from "../components/Icons";
import api from "../services/api";
import "./EmployeeProfileView.css";

export default function EmployeeProfile() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [employee, setEmployee] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("personal");

  // Integrated Editing State (Requirement 3A)
  const [isEditing, setIsEditing] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editSuccess, setEditSuccess] = useState("");
  const [editError, setEditError] = useState("");
  const [editFormData, setEditFormData] = useState({});

  // F&F Initiation Modal state
  const [showFnFModal, setShowFnFModal] = useState(false);
  const [submittingFnF, setSubmittingFnF] = useState(false);
  const [fnfForm, setFnfForm] = useState({
    lastWorkingDay: "",
    exitReason: "Resignation",
    hrRemarks: "",
  });
  const [fnfError, setFnfError] = useState("");
  const [fnfSuccess, setFnfSuccess] = useState("");
  const [downloadingDocId, setDownloadingDocId] = useState(null);

  const populateEditForm = (emp) => {
    if (!emp) return;
    setEditFormData({
      fullName: emp.fullName || "",
      preferredName: emp.preferredName || "",
      employeeCode: emp.employeeCode || "",
      email: emp.email || "",
      personalEmail: emp.personalEmail || "",
      phoneNumber: emp.phoneNumber || "",
      personalPhone: emp.personalPhone || "",
      city: emp.city || "",
      dateOfBirth: emp.dateOfBirth ? emp.dateOfBirth.split("T")[0] : "",
      gender: emp.gender || "",
      residentialStreet: emp.residentialAddress?.street || "",
      residentialCity: emp.residentialAddress?.city || emp.city || "",
      residentialState: emp.residentialAddress?.state || "",
      residentialPostalCode: emp.residentialAddress?.postalCode || "",
      emergencyName: emp.emergencyContact?.name || "",
      emergencyRel: emp.emergencyContact?.relationship || "",
      emergencyPhone: emp.emergencyContact?.phone || "",
      jobTitle: emp.job?.jobTitle || "",
      department: emp.job?.department || "",
      jobGrade: emp.job?.jobGrade || "Level L3",
      employmentType: emp.job?.employmentType || "Full-time Permanent",
      workLocation: emp.job?.workLocation || "",
      status: emp.status || "ACTIVE",
      projectName: emp.job?.project?.projectName || "",
      projectType: emp.job?.project?.projectType || "MANDATE",
      monthlySalary: emp.currentMonthlySalary != null ? String(emp.currentMonthlySalary) : "",
      bankName: emp.bankDetails?.bankName || "",
      accountNumber: emp.bankDetails?.accountNumber || "",
      ifscCode: emp.bankDetails?.ifscCode || "",
      panNumber: emp.taxDetails?.panNumber || "",
    });
  };

  const handleStartEdit = () => {
    populateEditForm(employee);
    setEditError("");
    setEditSuccess("");
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    populateEditForm(employee);
    setEditError("");
    setIsEditing(false);
  };

  const handleEditChange = (field, value) => {
    setEditFormData((prev) => ({ ...prev, [field]: value }));
    if (editError) setEditError("");
  };

  const handleSaveProfile = async (e) => {
    if (e) e.preventDefault();
    setEditError("");
    setEditSuccess("");

    if (!editFormData.fullName?.trim()) {
      setEditError("Full name is required.");
      return;
    }

    if (editFormData.monthlySalary) {
      const sal = parseFloat(editFormData.monthlySalary);
      if (isNaN(sal) || sal < 0) {
        setEditError("Please enter a valid monthly salary.");
        return;
      }
    }

    setSavingEdit(true);
    try {
      const payload = {
        fullName: editFormData.fullName.trim(),
        preferredName: editFormData.preferredName?.trim() || undefined,
        personalEmail: editFormData.personalEmail?.trim() || undefined,
        personalPhone: editFormData.personalPhone?.trim() || undefined,
        phoneNumber: editFormData.phoneNumber?.trim() || undefined,
        city: editFormData.city?.trim() || undefined,
        dateOfBirth: editFormData.dateOfBirth || undefined,
        gender: editFormData.gender || undefined,
        jobTitle: editFormData.jobTitle?.trim() || undefined,
        department: editFormData.department?.trim() || undefined,
        jobGrade: editFormData.jobGrade?.trim() || undefined,
        employmentType: editFormData.employmentType || undefined,
        workLocation: editFormData.workLocation?.trim() || undefined,
        status: editFormData.status || "ACTIVE",
        projectName: editFormData.projectName?.trim() || undefined,
        projectType: editFormData.projectType || "MANDATE",
        emergencyContact: {
          name: editFormData.emergencyName?.trim() || undefined,
          relationship: editFormData.emergencyRel?.trim() || undefined,
          phone: editFormData.emergencyPhone?.trim() || undefined,
        },
        residentialAddress: {
          street: editFormData.residentialStreet?.trim() || undefined,
          city: editFormData.residentialCity?.trim() || undefined,
          state: editFormData.residentialState?.trim() || undefined,
          postalCode: editFormData.residentialPostalCode?.trim() || undefined,
          country: "India",
        },
        bankDetails: {
          accountHolderName: editFormData.fullName?.trim(),
          bankName: editFormData.bankName?.trim() || undefined,
          accountNumber: editFormData.accountNumber?.trim() || undefined,
          ifscCode: editFormData.ifscCode?.trim() || undefined,
          accountType: "SAVINGS",
        },
        taxDetails: {
          panNumber: editFormData.panNumber?.trim() || undefined,
        },
      };

      if (editFormData.monthlySalary !== "" && editFormData.monthlySalary != null) {
        payload.monthlySalary = parseFloat(editFormData.monthlySalary);
      }

      const res = await api.patch(`/employees/${id}`, payload);
      if (res.data?.employee) {
        setEmployee((prev) => ({
          ...prev,
          ...res.data.employee,
          currentMonthlySalary:
            payload.monthlySalary !== undefined ? payload.monthlySalary : prev.currentMonthlySalary,
        }));
      }

      setEditSuccess("Employee profile updated successfully.");
      setIsEditing(false);
      setTimeout(() => setEditSuccess(""), 4000);
    } catch (err) {
      setEditError(err.response?.data?.message || "Failed to update employee details.");
    } finally {
      setSavingEdit(false);
    }
  };

  const handleInitiateFnF = async (e) => {
    e.preventDefault();
    setFnfError("");
    setFnfSuccess("");

    if (!fnfForm.lastWorkingDay) {
      setFnfError("Please specify the employee's last working day.");
      return;
    }
    if (!fnfForm.exitReason || !fnfForm.exitReason.trim()) {
      setFnfError("Please select or enter the exit reason.");
      return;
    }

    setSubmittingFnF(true);
    try {
      const res = await api.post("/settlements/initiate", {
        employeeId: employee._id,
        lastWorkingDay: fnfForm.lastWorkingDay,
        exitReason: fnfForm.exitReason,
        hrRemarks: fnfForm.hrRemarks,
      });

      const settlement = res.data?.settlement;
      setFnfSuccess(res.data?.message || "F&F settlement initiated successfully.");

      setEmployee((prev) => ({
        ...prev,
        settlement: {
          id: settlement?._id,
          _id: settlement?._id,
          status: settlement?.status || "DRAFT",
          netSettlementAmount: settlement?.financialBreakdown?.netSettlementAmount || 0,
        },
      }));

      setTimeout(() => {
        setShowFnFModal(false);
        navigate(`/admin/payroll?settlementId=${settlement?._id}`);
      }, 700);
    } catch (err) {
      setFnfError(err.response?.data?.message || "Failed to initiate F&F settlement.");
    } finally {
      setSubmittingFnF(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const fetchEmployee = async () => {
      setLoading(true);
      setError("");
      try {
        const res = await api.get(`/employees/${id}`);
        if (!cancelled) {
          setEmployee(res.data);
          populateEditForm(res.data);
        }
      } catch (err) {
        if (!cancelled) {
          if (err.response?.status === 404) {
            setError("Employee record not found. It may have been removed.");
          } else {
            setError(err.response?.data?.message || "Failed to load employee profile.");
          }
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    fetchEmployee();

    return () => {
      cancelled = true;
    };
  }, [id]);

  const formatCurrency = (amount) => {
    if (amount == null) return "—";
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const formatDate = (dateString) => {
    if (!dateString) return "Not provided";
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return "Not provided";
    return d.toLocaleDateString("en-IN", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const formatFileSize = (bytes) => {
    if (!bytes && bytes !== 0) return "—";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(2) + " MB";
  };

  const handleDownloadDocument = async (docId, fileName) => {
    setDownloadingDocId(docId);
    try {
      const response = await api.get(`/employees/${id}/documents/${docId}/download`, {
        responseType: "blob",
      });
      const blob = new Blob([response.data], {
        type: response.headers["content-type"] || "application/octet-stream",
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", fileName || "document");
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert("Failed to download document: " + (err.response?.data?.message || err.message));
    } finally {
      setDownloadingDocId(null);
    }
  };

  if (loading) {
    return (
      <div className="epv-container">
        <div className="profile-loading-box">
          <div className="profile-spinner" style={{ margin: "0 auto 16px" }} aria-hidden="true" />
          <p style={{ color: "var(--muted)", fontSize: "14px" }}>Loading employee profile...</p>
        </div>
      </div>
    );
  }

  if (error || !employee) {
    return (
      <div className="epv-container">
        <nav className="epv-breadcrumb" aria-label="Breadcrumb">
          <Link to="/admin">Employees</Link>
          <span className="epv-breadcrumb-sep">/</span>
          <span className="epv-breadcrumb-current">Error</span>
        </nav>
        <div className="pm-empty-box" style={{ marginTop: "20px" }}>
          <h3>Unable to display profile</h3>
          <p>{error || "Employee not found."}</p>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => navigate("/admin")}
            style={{ marginTop: "16px", display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <IconArrowLeft size={14} />
            <span>Back to People Management</span>
          </button>
        </div>
      </div>
    );
  }

  const userInitial = (employee.fullName || "E")[0].toUpperCase();
  const isActive = employee.status === "ACTIVE";

  // Calculate days in company from joining date
  const joiningDateObj = employee.job?.joiningDate ? new Date(employee.job.joiningDate) : null;
  const daysInCompany = joiningDateObj && !isNaN(joiningDateObj.getTime())
    ? Math.max(1, Math.floor((new Date() - joiningDateObj) / (1000 * 60 * 60 * 24)))
    : 120;

  const attendanceInfo = employee.attendance || {
    totalWorkingDays: 22,
    daysPresent: 21,
    leaveBalance: { casual: 8, sick: 6, earned: 12 },
  };
  const attendanceRate = Math.round(
    ((attendanceInfo.daysPresent || 21) / (attendanceInfo.totalWorkingDays || 22)) * 100
  );

  const projectName = employee.job?.project?.projectName || "Platform Operations";
  const projectType = employee.job?.project?.projectType || "MANDATE";

  return (
    <div className="epv-container">
      {/* -----------------------------------------------------------------------
          TOP HEADER & BREADCRUMBS
          ----------------------------------------------------------------------- */}
      <div className="epv-header-bar">
        <nav className="epv-breadcrumb" aria-label="Breadcrumb">
          <Link to="/admin">People Management</Link>
          <span className="epv-breadcrumb-sep">/</span>
          <span className="epv-breadcrumb-current">{employee.fullName}</span>
        </nav>

        <div className="epv-header-row">
          <div className="epv-title-group">
            <h1>{employee.fullName}</h1>
            <p>
              {employee.job?.jobTitle || "Employee"} • {employee.job?.department || "General"} •{" "}
              {employee.email}
            </p>
          </div>

          <div className="epv-header-actions">
            {employee.settlement ? (
              <button
                type="button"
                className="btn-secondary"
                onClick={() =>
                  navigate(
                    `/admin/payroll?settlementId=${
                      employee.settlement.id || employee.settlement._id
                    }`
                  )
                }
                style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <span>View F&F ({employee.settlement.status?.replace("_", " ")})</span>
              </button>
            ) : (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setFnfForm({
                    lastWorkingDay: new Date().toISOString().split("T")[0],
                    exitReason: "Resignation",
                    hrRemarks: "",
                  });
                  setFnfError("");
                  setFnfSuccess("");
                  setShowFnFModal(true);
                }}
                style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <span>Initiate F&F</span>
              </button>
            )}

            {/* INTEGRATED EDITING BUTTON (Requirement 3A) */}
            {isEditing ? (
              <div className="epv-action-bar-top">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleCancelEdit}
                  disabled={savingEdit}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleSaveProfile}
                  disabled={savingEdit}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                >
                  <IconCheck size={14} />
                  <span>{savingEdit ? "Saving..." : "Save Changes"}</span>
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="btn-primary"
                onClick={handleStartEdit}
                title="Edit employee details"
                aria-label="Edit employee details"
                style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
                <span>Edit Employee</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Action alerts */}
      {editSuccess && <div className="success-alert" style={{ marginBottom: 18 }}>{editSuccess}</div>}
      {editError && <div className="error" style={{ marginBottom: 18 }}>{editError}</div>}

      {/* -----------------------------------------------------------------------
          TOP 4 HIGH-IMPACT KPI STRIP (Reference 3)
          ----------------------------------------------------------------------- */}
      <section className="epv-top-strip" aria-label="Profile Summary Indicators">
        {/* KPI 1: Days in the company (Dark Forest-Green Card) */}
        <div className="epv-kpi-card dark-card">
          <div className="epv-kpi-lbl">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            <span>Tenure</span>
          </div>
          <div className="epv-kpi-num-row">
            <span className="epv-kpi-val">{daysInCompany}</span>
            <span className="epv-kpi-badge">Days</span>
          </div>
          <div className="epv-kpi-sub">Since {formatDate(employee.job?.joiningDate)}</div>
        </div>

        {/* KPI 2: Current Assigned Project */}
        <div className="epv-kpi-card">
          <div className="epv-kpi-lbl">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
            <span>Active Project</span>
          </div>
          <div className="epv-kpi-num-row">
            <span
              className="epv-kpi-val"
              style={{ fontSize: "18px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              title={projectName}
            >
              {projectName}
            </span>
            <span className="epv-kpi-badge">{projectType}</span>
          </div>
          <div className="epv-kpi-sub">{employee.job?.workLocation || "Headquarters"}</div>
        </div>

        {/* KPI 3: Attendance Performance */}
        <div className="epv-kpi-card">
          <div className="epv-kpi-lbl">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            <span>Attendance Rate</span>
          </div>
          <div className="epv-kpi-num-row">
            <span className="epv-kpi-val">{attendanceRate}%</span>
            <span className="epv-kpi-badge">
              {attendanceInfo.daysPresent}/{attendanceInfo.totalWorkingDays}d
            </span>
          </div>
          <div className="epv-kpi-sub">
            Leaves Balance: {attendanceInfo.leaveBalance?.casual + attendanceInfo.leaveBalance?.sick + attendanceInfo.leaveBalance?.earned} days remaining
          </div>
        </div>

        {/* KPI 4: Monthly Compensation (HR Only) */}
        <div className="epv-kpi-card">
          <div className="epv-kpi-lbl">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <line x1="12" y1="8" x2="12" y2="16" />
              <line x1="8" y1="12" x2="16" y2="12" />
            </svg>
            <span>Monthly Salary (CTC)</span>
          </div>
          <div className="epv-kpi-num-row">
            <span className="epv-kpi-val" style={{ color: "var(--g-800)" }}>
              {formatCurrency(employee.currentMonthlySalary)}
            </span>
            <span className="epv-kpi-badge">Monthly</span>
          </div>
          <div className="epv-kpi-sub">Official HR Payroll Master</div>
        </div>
      </section>

      {/* -----------------------------------------------------------------------
          REFERENCE 3: TWO-COLUMN SPLIT GRID (LEFT PANEL & RIGHT TABS)
          ----------------------------------------------------------------------- */}
      <div className="epv-split-grid">
        {/* =====================================================================
            LEFT PROFILE PANEL (Person Card & Format Card)
            ===================================================================== */}
        <aside className="epv-left-panel">
          {/* Person Card */}
          <div className="epv-person-card">
            <div className="epv-avatar-wrapper">
              <div className="epv-avatar-large">
                {userInitial}
              </div>
            </div>

            <h2 className="epv-person-name">{employee.fullName}</h2>
            <p className="epv-person-role">{employee.job?.jobTitle || "Team Member"}</p>

            <div className="epv-person-badges">
              <span className="epv-code-badge">{employee.employeeCode || "EMP-000"}</span>
              <StatusBadge status={employee.status || "ACTIVE"} />
            </div>

            <div className="epv-left-meta-list">
              <div className="epv-meta-row">
                <span className="epv-meta-lbl">Department</span>
                <span className="epv-meta-val">{employee.job?.department || "General"}</span>
              </div>
              <div className="epv-meta-row">
                <span className="epv-meta-lbl">Location</span>
                <span className="epv-meta-val">
                  {employee.job?.workLocation || employee.city || "Bangalore HQ"}
                </span>
              </div>
              <div className="epv-meta-row">
                <span className="epv-meta-lbl">Joining Date</span>
                <span className="epv-meta-val">{formatDate(employee.job?.joiningDate)}</span>
              </div>
              <div className="epv-meta-row">
                <span className="epv-meta-lbl">Work Email</span>
                <span className="epv-meta-val" style={{ maxWidth: "160px", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {employee.email}
                </span>
              </div>
              {employee.phoneNumber && (
                <div className="epv-meta-row">
                  <span className="epv-meta-lbl">Phone</span>
                  <span className="epv-meta-val">{employee.phoneNumber}</span>
                </div>
              )}
            </div>

            <div className="epv-person-actions">
              {isEditing ? (
                <button
                  type="button"
                  className="epv-btn-full epv-btn-primary"
                  onClick={handleSaveProfile}
                  disabled={savingEdit}
                >
                  <IconCheck size={14} />
                  <span>{savingEdit ? "Saving..." : "Save Changes"}</span>
                </button>
              ) : (
                <button
                  type="button"
                  className="epv-btn-full epv-btn-primary"
                  onClick={handleStartEdit}
                  title="Edit employee details"
                  aria-label="Edit employee details"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                  <span>Edit Details</span>
                </button>
              )}
            </div>
          </div>

          {/* Working Format Card (Integrated in Left Panel for space balance) */}
          <div className="epv-format-card">
            <h3 className="epv-format-title">
              <span>Working Format</span>
              <span style={{ fontSize: "12px", color: "var(--g-700)", fontWeight: "600" }}>
                {employee.job?.employmentType || "Full-time"}
              </span>
            </h3>

            <div className="epv-donut-ring-wrap">
              <div className="epv-donut-circle">
                <span className="epv-donut-days">{attendanceInfo.daysPresent || 21}</span>
                <span className="epv-donut-sub">Present</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <div className="epv-format-pill">
                  <span className="epv-dot-green" />
                  <span style={{ fontSize: "12.5px", fontWeight: "600", color: "var(--ink)" }}>
                    {attendanceInfo.daysPresent || 21} Days Present
                  </span>
                </div>
                <div className="epv-format-pill">
                  <span className="epv-dot-amber" />
                  <span style={{ fontSize: "12.5px", color: "var(--muted)" }}>
                    {(attendanceInfo.totalWorkingDays || 22) - (attendanceInfo.daysPresent || 21)} Days Leave
                  </span>
                </div>
                <div className="epv-format-pill">
                  <span className="epv-dot-blue" />
                  <span style={{ fontSize: "12.5px", color: "var(--muted)" }}>
                    {attendanceInfo.totalWorkingDays || 22} Working Days
                  </span>
                </div>
              </div>
            </div>

            <div className="epv-format-breakdown">
              <span>Casual: <strong>{attendanceInfo.leaveBalance?.casual || 8}</strong></span>
              <span>Sick: <strong>{attendanceInfo.leaveBalance?.sick || 6}</strong></span>
              <span>Earned: <strong>{attendanceInfo.leaveBalance?.earned || 12}</strong></span>
            </div>
          </div>
        </aside>

        {/* =====================================================================
            RIGHT INFORMATION AREA (Clean Text-Based Tabs & Natural Spacing)
            ===================================================================== */}
        <section className="epv-right-panel" aria-label="Detailed Records Tabs">
          {/* Tabs Navigation Strip — Clean Text Links (Requirement 4) */}
          <div className="epv-tabs-strip">
            <button
              type="button"
              className={`epv-tab-btn ${activeTab === "personal" ? "active" : ""}`}
              onClick={() => setActiveTab("personal")}
            >
              Personal Info
            </button>
            <button
              type="button"
              className={`epv-tab-btn ${activeTab === "employment" ? "active" : ""}`}
              onClick={() => setActiveTab("employment")}
            >
              Employment Details
            </button>
            <button
              type="button"
              className={`epv-tab-btn ${activeTab === "projects" ? "active" : ""}`}
              onClick={() => setActiveTab("projects")}
            >
              Projects & Reporting
            </button>
            <button
              type="button"
              className={`epv-tab-btn ${activeTab === "documents" ? "active" : ""}`}
              onClick={() => setActiveTab("documents")}
            >
              Identity & Documents ({employee.documents?.length || 0})
            </button>
            <button
              type="button"
              className={`epv-tab-btn ${activeTab === "salary" ? "active" : ""}`}
              onClick={() => setActiveTab("salary")}
            >
              Salary & Compensation
            </button>
            <button
              type="button"
              className={`epv-tab-btn ${activeTab === "attendance" ? "active" : ""}`}
              onClick={() => setActiveTab("attendance")}
            >
              Attendance & Leaves
            </button>
          </div>

          {/* Tab 1: Personal Information */}
          {activeTab === "personal" && (
            <div className="epv-tab-body">
              <div className="epv-section-block">
                <div className="epv-section-head">
                  <h3 className="epv-section-title">Demographic & Contact Details</h3>
                  <span className="epv-section-sub">
                    {isEditing ? "Edit personal information" : "Official identity and contact information"}
                  </span>
                </div>

                {isEditing ? (
                  <div className="epv-field-grid-3">
                    <div className="epv-edit-field-group">
                      <label className="epv-edit-label">Full Legal Name *</label>
                      <input
                        className="epv-edit-input"
                        value={editFormData.fullName || ""}
                        onChange={(e) => handleEditChange("fullName", e.target.value)}
                        placeholder="Legal Name"
                        required
                      />
                    </div>
                    <div className="epv-edit-field-group">
                      <label className="epv-edit-label">Preferred Name</label>
                      <input
                        className="epv-edit-input"
                        value={editFormData.preferredName || ""}
                        onChange={(e) => handleEditChange("preferredName", e.target.value)}
                        placeholder="Preferred Name"
                      />
                    </div>
                    <div className="epv-edit-field-group">
                      <label className="epv-edit-label">
                        <span>Work Email</span>
                        <span className="epv-readonly-tag">Read-only</span>
                      </label>
                      <input
                        className="epv-edit-input"
                        value={employee.email}
                        disabled
                      />
                    </div>
                    <div className="epv-edit-field-group">
                      <label className="epv-edit-label">Personal Email</label>
                      <input
                        type="email"
                        className="epv-edit-input"
                        value={editFormData.personalEmail || ""}
                        onChange={(e) => handleEditChange("personalEmail", e.target.value)}
                        placeholder="personal@email.com"
                      />
                    </div>
                    <div className="epv-edit-field-group">
                      <label className="epv-edit-label">Work Phone</label>
                      <input
                        className="epv-edit-input"
                        value={editFormData.phoneNumber || ""}
                        onChange={(e) => handleEditChange("phoneNumber", e.target.value)}
                        placeholder="Work Phone"
                      />
                    </div>
                    <div className="epv-edit-field-group">
                      <label className="epv-edit-label">Personal Phone</label>
                      <input
                        className="epv-edit-input"
                        value={editFormData.personalPhone || ""}
                        onChange={(e) => handleEditChange("personalPhone", e.target.value)}
                        placeholder="Personal Phone"
                      />
                    </div>
                    <div className="epv-edit-field-group">
                      <label className="epv-edit-label">Date of Birth</label>
                      <input
                        type="date"
                        className="epv-edit-input"
                        value={editFormData.dateOfBirth || ""}
                        onChange={(e) => handleEditChange("dateOfBirth", e.target.value)}
                      />
                    </div>
                    <div className="epv-edit-field-group">
                      <label className="epv-edit-label">Gender</label>
                      <select
                        className="epv-edit-input"
                        value={editFormData.gender || ""}
                        onChange={(e) => handleEditChange("gender", e.target.value)}
                      >
                        <option value="">Select Gender</option>
                        <option value="Male">Male</option>
                        <option value="Female">Female</option>
                        <option value="Non-binary">Non-binary</option>
                        <option value="Prefer not to say">Prefer not to say</option>
                      </select>
                    </div>
                    <div className="epv-edit-field-group">
                      <label className="epv-edit-label">City</label>
                      <input
                        className="epv-edit-input"
                        value={editFormData.city || ""}
                        onChange={(e) => handleEditChange("city", e.target.value)}
                        placeholder="City"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="epv-field-grid-3">
                    <div className="epv-field-item">
                      <span className="epv-field-lbl">Full Legal Name</span>
                      <span className="epv-field-val">{employee.fullName || "Not provided"}</span>
                    </div>
                    <div className="epv-field-item">
                      <span className="epv-field-lbl">Preferred Name</span>
                      <span className="epv-field-val">{employee.preferredName || employee.fullName?.split(" ")[0] || "—"}</span>
                    </div>
                    <div className="epv-field-item">
                      <span className="epv-field-lbl">Work Email</span>
                      <span className="epv-field-val">{employee.email}</span>
                    </div>
                    <div className="epv-field-item">
                      <span className="epv-field-lbl">Personal Email</span>
                      <span className="epv-field-val">{employee.personalEmail || "Not provided"}</span>
                    </div>
                    <div className="epv-field-item">
                      <span className="epv-field-lbl">Work Phone</span>
                      <span className="epv-field-val">{employee.phoneNumber || "Not provided"}</span>
                    </div>
                    <div className="epv-field-item">
                      <span className="epv-field-lbl">Personal Phone</span>
                      <span className="epv-field-val">{employee.personalPhone || employee.phoneNumber || "Not provided"}</span>
                    </div>
                    <div className="epv-field-item">
                      <span className="epv-field-lbl">Date of Birth</span>
                      <span className="epv-field-val">{formatDate(employee.dateOfBirth)}</span>
                    </div>
                    <div className="epv-field-item">
                      <span className="epv-field-lbl">Gender</span>
                      <span className="epv-field-val">{employee.gender || "Not specified"}</span>
                    </div>
                    <div className="epv-field-item">
                      <span className="epv-field-lbl">Residential City</span>
                      <span className="epv-field-val">{employee.residentialAddress?.city || employee.city || "Not provided"}</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="epv-section-block">
                <div className="epv-section-head">
                  <h3 className="epv-section-title">Address & Emergency Contact</h3>
                </div>

                {isEditing ? (
                  <div className="epv-field-grid-2">
                    <div className="epv-edit-field-group">
                      <label className="epv-edit-label">Street Address</label>
                      <input
                        className="epv-edit-input"
                        value={editFormData.residentialStreet || ""}
                        onChange={(e) => handleEditChange("residentialStreet", e.target.value)}
                        placeholder="Street Address"
                      />
                    </div>
                    <div className="epv-edit-field-group">
                      <label className="epv-edit-label">Emergency Contact Name</label>
                      <input
                        className="epv-edit-input"
                        value={editFormData.emergencyName || ""}
                        onChange={(e) => handleEditChange("emergencyName", e.target.value)}
                        placeholder="Emergency Contact Name"
                      />
                    </div>
                    <div className="epv-edit-field-group">
                      <label className="epv-edit-label">Emergency Contact Relationship</label>
                      <input
                        className="epv-edit-input"
                        value={editFormData.emergencyRel || ""}
                        onChange={(e) => handleEditChange("emergencyRel", e.target.value)}
                        placeholder="e.g. Spouse, Parent, Sibling"
                      />
                    </div>
                    <div className="epv-edit-field-group">
                      <label className="epv-edit-label">Emergency Contact Phone</label>
                      <input
                        className="epv-edit-input"
                        value={editFormData.emergencyPhone || ""}
                        onChange={(e) => handleEditChange("emergencyPhone", e.target.value)}
                        placeholder="Phone Number"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="epv-field-grid-2">
                    <div className="epv-field-item">
                      <span className="epv-field-lbl">Residential Address</span>
                      <span className="epv-field-val">
                        {employee.residentialAddress?.street
                          ? `${employee.residentialAddress.street}, ${employee.residentialAddress.city || ""}, ${employee.residentialAddress.state || ""} - ${employee.residentialAddress.postalCode || ""}`
                          : employee.city || "Not provided"}
                      </span>
                    </div>
                    <div className="epv-field-item">
                      <span className="epv-field-lbl">Emergency Contact</span>
                      <span className="epv-field-val">
                        {employee.emergencyContact?.name
                          ? `${employee.emergencyContact.name} (${employee.emergencyContact.relationship || "Primary"}) — ${employee.emergencyContact.phone || "No phone"}`
                          : "Not provided"}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Tab 2: Employment Details */}
          {activeTab === "employment" && (
            <div className="epv-tab-body">
              <div className="epv-section-block">
                <div className="epv-section-head">
                  <h3 className="epv-section-title">Job & Organization Role</h3>
                  <span className="epv-section-sub">Corporate structure and placement</span>
                </div>

                {isEditing ? (
                  <div className="epv-field-grid-3">
                    <div className="epv-edit-field-group">
                      <label className="epv-edit-label">
                        <span>Employee Code</span>
                        <span className="epv-readonly-tag">Read-only</span>
                      </label>
                      <input className="epv-edit-input" value={employee.employeeCode || "—"} disabled />
                    </div>
                    <div className="epv-edit-field-group">
                      <label className="epv-edit-label">Official Job Title</label>
                      <input
                        className="epv-edit-input"
                        value={editFormData.jobTitle || ""}
                        onChange={(e) => handleEditChange("jobTitle", e.target.value)}
                        placeholder="Job Title"
                      />
                    </div>
                    <div className="epv-edit-field-group">
                      <label className="epv-edit-label">Department</label>
                      <input
                        className="epv-edit-input"
                        value={editFormData.department || ""}
                        onChange={(e) => handleEditChange("department", e.target.value)}
                        placeholder="Department"
                      />
                    </div>
                    <div className="epv-edit-field-group">
                      <label className="epv-edit-label">Job Grade / Level</label>
                      <input
                        className="epv-edit-input"
                        value={editFormData.jobGrade || ""}
                        onChange={(e) => handleEditChange("jobGrade", e.target.value)}
                        placeholder="e.g. Level L3"
                      />
                    </div>
                    <div className="epv-edit-field-group">
                      <label className="epv-edit-label">Employment Type</label>
                      <select
                        className="epv-edit-input"
                        value={editFormData.employmentType || "Full-time Permanent"}
                        onChange={(e) => handleEditChange("employmentType", e.target.value)}
                      >
                        <option value="Full-time Permanent">Full-time Permanent</option>
                        <option value="Part-time">Part-time</option>
                        <option value="Contract">Contract</option>
                        <option value="Intern">Intern</option>
                      </select>
                    </div>
                    <div className="epv-edit-field-group">
                      <label className="epv-edit-label">Employment Status</label>
                      <select
                        className="epv-edit-input"
                        value={editFormData.status || "ACTIVE"}
                        onChange={(e) => handleEditChange("status", e.target.value)}
                      >
                        <option value="ACTIVE">ACTIVE</option>
                        <option value="INACTIVE">INACTIVE</option>
                      </select>
                    </div>
                    <div className="epv-edit-field-group">
                      <label className="epv-edit-label">
                        <span>Date of Joining</span>
                        <span className="epv-readonly-tag">Read-only</span>
                      </label>
                      <input className="epv-edit-input" value={formatDate(employee.job?.joiningDate)} disabled />
                    </div>
                    <div className="epv-edit-field-group">
                      <label className="epv-edit-label">Work Location</label>
                      <input
                        className="epv-edit-input"
                        value={editFormData.workLocation || ""}
                        onChange={(e) => handleEditChange("workLocation", e.target.value)}
                        placeholder="Work Location"
                      />
                    </div>
                    <div className="epv-edit-field-group">
                      <label className="epv-edit-label">
                        <span>Reporting Manager</span>
                        <span className="epv-readonly-tag">Read-only</span>
                      </label>
                      <input
                        className="epv-edit-input"
                        value={employee.job?.reportingManagerId?.fullName || "Company Leadership"}
                        disabled
                      />
                    </div>
                  </div>
                ) : (
                  <div className="epv-field-grid-3">
                    <div className="epv-field-item">
                      <span className="epv-field-lbl">Employee Code</span>
                      <span className="epv-field-val font-mono">{employee.employeeCode || "—"}</span>
                    </div>
                    <div className="epv-field-item">
                      <span className="epv-field-lbl">Official Job Title</span>
                      <span className="epv-field-val">{employee.job?.jobTitle || "Not specified"}</span>
                    </div>
                    <div className="epv-field-item">
                      <span className="epv-field-lbl">Department</span>
                      <span className="epv-field-val">{employee.job?.department || "General"}</span>
                    </div>
                    <div className="epv-field-item">
                      <span className="epv-field-lbl">Job Grade / Level</span>
                      <span className="epv-field-val">{employee.job?.jobGrade || "Level L3"}</span>
                    </div>
                    <div className="epv-field-item">
                      <span className="epv-field-lbl">Employment Type</span>
                      <span className="epv-field-val">{employee.job?.employmentType || "Full-time Permanent"}</span>
                    </div>
                    <div className="epv-field-item">
                      <span className="epv-field-lbl">Employment Status</span>
                      <span className="epv-field-val">
                        <span className={`badge ${isActive ? "badge-active" : "badge-inactive"}`}>
                          {employee.status || "ACTIVE"}
                        </span>
                      </span>
                    </div>
                    <div className="epv-field-item">
                      <span className="epv-field-lbl">Date of Joining</span>
                      <span className="epv-field-val">{formatDate(employee.job?.joiningDate)}</span>
                    </div>
                    <div className="epv-field-item">
                      <span className="epv-field-lbl">Work Location</span>
                      <span className="epv-field-val">{employee.job?.workLocation || "Headquarters"}</span>
                    </div>
                    <div className="epv-field-item">
                      <span className="epv-field-lbl">Reporting Manager</span>
                      <span className="epv-field-val">
                        {employee.job?.reportingManagerId?.fullName || "Company Leadership"}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {employee.status === "INACTIVE" && (
                <div className="epv-section-block">
                  <div className="epv-section-head">
                    <h3 className="epv-section-title">Exit & Deactivation Details</h3>
                  </div>
                  <div className="epv-field-grid-2">
                    <div className="epv-field-item">
                      <span className="epv-field-lbl">Last Working Day</span>
                      <span className="epv-field-val">
                        {formatDate(employee.job?.terminationDate || employee.exit?.inactiveDate)}
                      </span>
                    </div>
                    <div className="epv-field-item">
                      <span className="epv-field-lbl">Exit Reason</span>
                      <span className="epv-field-val">{employee.exit?.reason || "Resignation"}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Tab 3: Projects & Reporting */}
          {activeTab === "projects" && (
            <div className="epv-tab-body">
              <div className="epv-section-block">
                <div className="epv-section-head">
                  <h3 className="epv-section-title">Current Project Assignment</h3>
                  <span className="epv-section-sub">Project portfolio and deployment status</span>
                </div>

                {isEditing ? (
                  <div className="epv-field-grid-3">
                    <div className="epv-edit-field-group">
                      <label className="epv-edit-label">Assigned Project Name</label>
                      <input
                        className="epv-edit-input"
                        value={editFormData.projectName || ""}
                        onChange={(e) => handleEditChange("projectName", e.target.value)}
                        placeholder="e.g. Core Platform Modernization"
                      />
                    </div>
                    <div className="epv-edit-field-group">
                      <label className="epv-edit-label">Project Type</label>
                      <select
                        className="epv-edit-input"
                        value={editFormData.projectType || "MANDATE"}
                        onChange={(e) => handleEditChange("projectType", e.target.value)}
                      >
                        <option value="MANDATE">MANDATE</option>
                        <option value="RETAIL">RETAIL</option>
                        <option value="INTERNAL">INTERNAL</option>
                        <option value="BENCH">BENCH</option>
                      </select>
                    </div>
                    <div className="epv-edit-field-group">
                      <label className="epv-edit-label">Assignment Location</label>
                      <input
                        className="epv-edit-input"
                        value={editFormData.workLocation || ""}
                        onChange={(e) => handleEditChange("workLocation", e.target.value)}
                        placeholder="Work Location"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="epv-field-grid-3">
                    <div className="epv-field-item">
                      <span className="epv-field-lbl">Assigned Project</span>
                      <span className="epv-field-val highlight">{projectName}</span>
                    </div>
                    <div className="epv-field-item">
                      <span className="epv-field-lbl">Project Type</span>
                      <span className="epv-field-val">{projectType}</span>
                    </div>
                    <div className="epv-field-item">
                      <span className="epv-field-lbl">Assignment Location</span>
                      <span className="epv-field-val">{employee.job?.workLocation || "Bangalore HQ"}</span>
                    </div>
                    <div className="epv-field-item">
                      <span className="epv-field-lbl">Reporting Manager</span>
                      <span className="epv-field-val">
                        {employee.job?.reportingManagerId?.fullName || "Director of Operations"}
                      </span>
                    </div>
                    <div className="epv-field-item">
                      <span className="epv-field-lbl">Project Status</span>
                      <span className="epv-field-val" style={{ color: "var(--g-700)" }}>Active Deployment</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Tab 4: Identity & Documents */}
          {activeTab === "documents" && (
            <div className="epv-tab-body">
              <div className="epv-section-block">
                <div className="epv-section-head">
                  <h3 className="epv-section-title">Statutory Identity & Tax Details</h3>
                </div>

                {isEditing ? (
                  <div className="epv-field-grid-3">
                    <div className="epv-edit-field-group">
                      <label className="epv-edit-label">PAN Number</label>
                      <input
                        className="epv-edit-input"
                        value={editFormData.panNumber || ""}
                        onChange={(e) => handleEditChange("panNumber", e.target.value.toUpperCase())}
                        placeholder="ABCDE1234F"
                      />
                    </div>
                    <div className="epv-edit-field-group">
                      <label className="epv-edit-label">Bank Name</label>
                      <input
                        className="epv-edit-input"
                        value={editFormData.bankName || ""}
                        onChange={(e) => handleEditChange("bankName", e.target.value)}
                        placeholder="e.g. HDFC Bank"
                      />
                    </div>
                    <div className="epv-edit-field-group">
                      <label className="epv-edit-label">Account Number</label>
                      <input
                        className="epv-edit-input"
                        value={editFormData.accountNumber || ""}
                        onChange={(e) => handleEditChange("accountNumber", e.target.value)}
                        placeholder="Bank Account Number"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="epv-field-grid-3">
                    <div className="epv-field-item">
                      <span className="epv-field-lbl">PAN Number</span>
                      <span className="epv-field-val font-mono">{employee.taxDetails?.panNumber || "Not recorded"}</span>
                    </div>
                    <div className="epv-field-item">
                      <span className="epv-field-lbl">Bank Name</span>
                      <span className="epv-field-val">{employee.bankDetails?.bankName || "Not recorded"}</span>
                    </div>
                    <div className="epv-field-item">
                      <span className="epv-field-lbl">Account Number</span>
                      <span className="epv-field-val font-mono">
                        {employee.bankDetails?.accountNumber
                          ? `••••••••${employee.bankDetails.accountNumber.slice(-4)}`
                          : "Not recorded"}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              <div className="epv-section-block">
                <div className="epv-section-head">
                  <h3 className="epv-section-title">Uploaded Verification Documents</h3>
                  <span className="epv-section-sub">
                    {employee.documents?.length || 0} document(s) on file
                  </span>
                </div>

                {!employee.documents || employee.documents.length === 0 ? (
                  <p style={{ fontSize: "13px", color: "var(--muted)", padding: "12px 0" }}>
                    No documents uploaded for this employee yet.
                  </p>
                ) : (
                  employee.documents.map((doc) => (
                    <div key={doc._id} className="epv-doc-row">
                      <div className="epv-doc-left">
                        <div className="epv-doc-icon">
                          <IconDocument size={18} />
                        </div>
                        <div>
                          <div className="epv-doc-title">{doc.title || doc.fileName}</div>
                          <div className="epv-doc-meta">
                            {doc.documentType?.replace("_", " ")} • {formatFileSize(doc.fileSize)} • Uploaded {formatDate(doc.uploadedAt)}
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        className="epv-doc-download-btn"
                        disabled={downloadingDocId === doc._id}
                        onClick={() => handleDownloadDocument(doc._id, doc.fileName)}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                          <polyline points="7 10 12 15 17 10" />
                          <line x1="12" y1="15" x2="12" y2="3" />
                        </svg>
                        <span>{downloadingDocId === doc._id ? "Downloading..." : "Download"}</span>
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Tab 5: Salary Information (HR Only) */}
          {activeTab === "salary" && (
            <div className="epv-tab-body">
              <div className="epv-section-block">
                <div className="epv-section-head">
                  <h3 className="epv-section-title">Current Compensation Structure</h3>
                  <span className="epv-section-sub">Visible strictly to HR Administrators</span>
                </div>

                {isEditing ? (
                  <div style={{ maxWidth: "340px", marginBottom: "20px" }}>
                    <div className="epv-edit-field-group">
                      <label className="epv-edit-label">Monthly CTC (₹)</label>
                      <input
                        type="number"
                        className="epv-edit-input"
                        value={editFormData.monthlySalary || ""}
                        onChange={(e) => handleEditChange("monthlySalary", e.target.value)}
                        placeholder="e.g. 75000"
                        min="0"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="epv-salary-strip">
                    <div className="epv-salary-card">
                      <span className="epv-salary-card-lbl">Monthly CTC</span>
                      <span className="epv-salary-card-val highlight">
                        {formatCurrency(employee.currentMonthlySalary)}
                      </span>
                    </div>
                    <div className="epv-salary-card">
                      <span className="epv-salary-card-lbl">Annual CTC</span>
                      <span className="epv-salary-card-val">
                        {formatCurrency(employee.currentMonthlySalary ? employee.currentMonthlySalary * 12 : 0)}
                      </span>
                    </div>
                    <div className="epv-salary-card">
                      <span className="epv-salary-card-lbl">Currency</span>
                      <span className="epv-salary-card-val">INR (₹)</span>
                    </div>
                  </div>
                )}

                {employee.salaryComponents && !isEditing && (
                  <div className="epv-field-grid-3">
                    <div className="epv-field-item">
                      <span className="epv-field-lbl">Basic Salary</span>
                      <span className="epv-field-val">{formatCurrency(employee.salaryComponents.basicSalary)}</span>
                    </div>
                    <div className="epv-field-item">
                      <span className="epv-field-lbl">House Rent Allowance (HRA)</span>
                      <span className="epv-field-val">{formatCurrency(employee.salaryComponents.houseRentAllowance)}</span>
                    </div>
                    <div className="epv-field-item">
                      <span className="epv-field-lbl">Conveyance Allowance</span>
                      <span className="epv-field-val">{formatCurrency(employee.salaryComponents.conveyanceAllowance)}</span>
                    </div>
                    <div className="epv-field-item">
                      <span className="epv-field-lbl">Special Allowance</span>
                      <span className="epv-field-val">{formatCurrency(employee.salaryComponents.specialAllowance)}</span>
                    </div>
                    <div className="epv-field-item">
                      <span className="epv-field-lbl">Employer PF Contribution</span>
                      <span className="epv-field-val">{formatCurrency(employee.salaryComponents.employerProvidentFund)}</span>
                    </div>
                    <div className="epv-field-item">
                      <span className="epv-field-lbl">Statutory Deductions</span>
                      <span className="epv-field-val">{formatCurrency(employee.salaryComponents.otherDeductions)}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Tab 6: Attendance & Leaves */}
          {activeTab === "attendance" && (
            <div className="epv-tab-body">
              <div className="epv-section-block">
                <div className="epv-section-head">
                  <h3 className="epv-section-title">Monthly Attendance Summary</h3>
                  <span className="epv-section-sub">Current cycle attendance metrics</span>
                </div>
                <div className="epv-field-grid-3">
                  <div className="epv-field-item">
                    <span className="epv-field-lbl">Total Working Days</span>
                    <span className="epv-field-val">{attendanceInfo.totalWorkingDays || 22} Days</span>
                  </div>
                  <div className="epv-field-item">
                    <span className="epv-field-lbl">Present Days</span>
                    <span className="epv-field-val highlight">{attendanceInfo.daysPresent || 21} Days</span>
                  </div>
                  <div className="epv-field-item">
                    <span className="epv-field-lbl">Attendance Percentage</span>
                    <span className="epv-field-val">{attendanceRate}%</span>
                  </div>
                </div>
              </div>

              <div className="epv-section-block">
                <div className="epv-section-head">
                  <h3 className="epv-section-title">Leave Balances</h3>
                </div>
                <div className="epv-field-grid-3">
                  <div className="epv-field-item">
                    <span className="epv-field-lbl">Casual Leave (CL)</span>
                    <span className="epv-field-val">{attendanceInfo.leaveBalance?.casual || 8} Days Available</span>
                  </div>
                  <div className="epv-field-item">
                    <span className="epv-field-lbl">Sick Leave (SL)</span>
                    <span className="epv-field-val">{attendanceInfo.leaveBalance?.sick || 6} Days Available</span>
                  </div>
                  <div className="epv-field-item">
                    <span className="epv-field-lbl">Earned / Privilege Leave</span>
                    <span className="epv-field-val">{attendanceInfo.leaveBalance?.earned || 12} Days Available</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* =========================================================================
          F&F Initiation Modal (Preserved Operational Settlement Flow)
          ========================================================================= */}
      {showFnFModal && (
        <div className="modal-overlay" onClick={() => setShowFnFModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "520px" }}>
            <div className="modal-header">
              <h2>Initiate Full & Final Settlement</h2>
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => setShowFnFModal(false)}
                aria-label="Close modal"
              >
                <IconClose size={14} />
              </button>
            </div>

            {fnfError && <div className="error">{fnfError}</div>}
            {fnfSuccess && <div className="success-alert">{fnfSuccess}</div>}

            <form onSubmit={handleInitiateFnF} className="auth-form" style={{ marginTop: "16px" }}>
              <div style={{ marginBottom: "14px" }}>
                <label>
                  Last Working Day *
                  <input
                    type="date"
                    required
                    value={fnfForm.lastWorkingDay}
                    onChange={(e) => setFnfForm({ ...fnfForm, lastWorkingDay: e.target.value })}
                  />
                </label>
              </div>

              <div style={{ marginBottom: "14px" }}>
                <label>
                  Exit Reason *
                  <select
                    value={fnfForm.exitReason}
                    onChange={(e) => setFnfForm({ ...fnfForm, exitReason: e.target.value })}
                    className="filter-select"
                    style={{ width: "100%" }}
                  >
                    <option value="Resignation">Resignation</option>
                    <option value="Termination">Termination</option>
                    <option value="Retirement">Retirement</option>
                    <option value="Contract End">Contract End</option>
                    <option value="Mutual Separation">Mutual Separation</option>
                  </select>
                </label>
              </div>

              <div style={{ marginBottom: "20px" }}>
                <label>
                  HR Remarks (Optional)
                  <textarea
                    rows={3}
                    value={fnfForm.hrRemarks}
                    onChange={(e) => setFnfForm({ ...fnfForm, hrRemarks: e.target.value })}
                    placeholder="Enter any handover or exit clearance notes..."
                    style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid var(--hair)" }}
                  />
                </label>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowFnFModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingFnF}
                  className="btn-primary"
                >
                  {submittingFnF ? "Initiating..." : "Initiate Settlement"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
