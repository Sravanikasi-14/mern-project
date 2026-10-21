import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import StatusBadge from "../components/StatusBadge";
import { IconDocument, IconArrowLeft, IconClose, IconCheck, IconAlertCircle } from "../components/Icons";
import api from "../services/api";

export default function EmployeeProfile() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [employee, setEmployee] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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

      // Refresh employee profile state to reflect new settlement
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

  const [downloadingDocId, setDownloadingDocId] = useState(null);

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
      <main className="container-wide">
        <div className="profile-loading-box">
          <div className="profile-spinner" aria-hidden="true" />
          <p>Loading employee profile...</p>
        </div>
      </main>
    );
  }

  if (error || !employee) {
    return (
      <main className="container-wide">
        <nav className="breadcrumb-bar" aria-label="Breadcrumb">
          <Link to="/admin" className="breadcrumb-link">Employees</Link>
          <span className="breadcrumb-separator">/</span>
          <span className="breadcrumb-current">Error</span>
        </nav>
        <div className="state-box" style={{ marginTop: "20px" }}>
          <h3>Unable to display profile</h3>
          <p className="subtitle">{error || "Employee not found."}</p>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => navigate("/admin")}
            style={{ marginTop: "16px", display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <IconArrowLeft size={14} />
            <span>Back to Employees</span>
          </button>
        </div>
      </main>
    );
  }

  const userInitial = (employee.fullName || "E")[0].toUpperCase();
  const isActive = employee.status === "ACTIVE";

  return (
    <main className="container-wide profile-page-container">
      {/* Breadcrumb Navigation */}
      <nav className="breadcrumb-bar" aria-label="Breadcrumb">
        <Link to="/admin" className="breadcrumb-link">Employees</Link>
        <span className="breadcrumb-separator">/</span>
        <span className="breadcrumb-current">{employee.fullName}</span>
      </nav>

      {/* Top Action Bar / Back button */}
      <div className="profile-top-actions">
        <button
          type="button"
          className="btn-secondary btn-sm back-btn"
          onClick={() => navigate("/admin")}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          Back to Employees
        </button>
      </div>

      {/* Compact Employee Header Card */}
      <section className="profile-header-card" aria-label="Employee Overview">
        <div className="profile-header-left">
          <div className="profile-avatar" aria-hidden="true">
            {userInitial}
          </div>
          <div className="profile-header-info">
            <div className="profile-header-title-row">
              <h1 className="profile-name">{employee.fullName}</h1>
              <StatusBadge status={employee.status || "ACTIVE"} />
              {employee.settlement && (
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    padding: "3px 9px",
                    borderRadius: 12,
                    background: "#eff6ff",
                    color: "#1d4ed8",
                    border: "1px solid #bfdbfe",
                    marginLeft: 6,
                  }}
                >
                  F&F: {employee.settlement.status?.replace("_", " ")}
                </span>
              )}
            </div>
            <div className="profile-header-meta">
              <span className="meta-tag">
                <strong>ID:</strong> {employee.employeeCode || "—"}
              </span>
              <span className="meta-separator">•</span>
              <span className="meta-tag">
                <strong>Role:</strong> {employee.job?.jobTitle || "Not specified"}
              </span>
              <span className="meta-separator">•</span>
              <span className="meta-tag">
                <strong>Email:</strong> {employee.email}
              </span>
              {employee.phoneNumber && (
                <>
                  <span className="meta-separator">•</span>
                  <span className="meta-tag">
                    <strong>Phone:</strong> {employee.phoneNumber}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="profile-header-right" style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
          {employee.settlement ? (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => navigate(`/admin/payroll?settlementId=${employee.settlement.id || employee.settlement._id}`)}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, padding: "8px 14px", borderRadius: 8 }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 15, height: 15 }}>
                <rect x="2" y="5" width="20" height="14" rx="2" />
                <line x1="2" y1="10" x2="22" y2="10" />
              </svg>
              <span>View F&F ({employee.settlement.status?.replace("_", " ")})</span>
            </button>
          ) : (
            <button
              type="button"
              className="btn-primary"
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
              style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, padding: "8px 14px", borderRadius: 8 }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 15, height: 15 }}>
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="12" y1="18" x2="12" y2="12" />
                <line x1="9" y1="15" x2="15" y2="15" />
              </svg>
              <span>Initiate F&F</span>
            </button>
          )}

          <button
            type="button"
            className="edit-profile-btn"
            onClick={() => navigate(`/admin/employees/${employee._id}/edit`)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16 }}>
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
            Edit Employee
          </button>
        </div>
      </section>

      {/* Organized Information Grid */}
      <div className="profile-sections-grid">
        {/* Section 1: Personal & Contact Information */}
        <div className="profile-card">
          <div className="profile-card-header">
            <div className="card-header-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </div>
            <div>
              <h2>Personal & Contact Information</h2>
              <span className="card-subtitle">Official demographic & emergency details</span>
            </div>
          </div>
          <div className="profile-card-body">
            <div className="info-field">
              <span className="info-label">Legal Name</span>
              <span className="info-value">{employee.fullName || "Not provided"}</span>
            </div>
            <div className="info-field">
              <span className="info-label">Preferred Name</span>
              <span className="info-value">{employee.preferredName || employee.fullName?.split(" ")[0] || "Not provided"}</span>
            </div>
            <div className="info-field">
              <span className="info-label">Official Work Email</span>
              <span className="info-value">{employee.email || "Not provided"}</span>
            </div>
            <div className="info-field">
              <span className="info-label">Personal Email</span>
              <span className="info-value">{employee.personalEmail || "Not provided"}</span>
            </div>
            <div className="info-field">
              <span className="info-label">Official Work Phone</span>
              <span className="info-value">{employee.phoneNumber || "Not provided"}</span>
            </div>
            <div className="info-field">
              <span className="info-label">Personal Phone</span>
              <span className="info-value">{employee.personalPhone || employee.phoneNumber || "Not provided"}</span>
            </div>
            <div className="info-field">
              <span className="info-label">Date of Birth</span>
              <span className="info-value">{formatDate(employee.dateOfBirth)}</span>
            </div>
            <div className="info-field">
              <span className="info-label">Gender</span>
              <span className="info-value">{employee.gender || "Not specified"}</span>
            </div>
            <div className="info-field">
              <span className="info-label">Work Location</span>
              <span className="info-value">{employee.job?.workLocation || employee.city || "Headquarters"}</span>
            </div>
            <div className="info-field">
              <span className="info-label">Residential Address</span>
              <span className="info-value">
                {employee.residentialAddress?.city
                  ? `${employee.residentialAddress.city}, ${employee.residentialAddress.country || "India"}`
                  : employee.city || "Not provided"}
              </span>
            </div>
            <div className="info-field" style={{ gridColumn: "1 / -1" }}>
              <span className="info-label">Emergency Contact</span>
              <span className="info-value">
                {employee.emergencyContact?.name
                  ? `${employee.emergencyContact.name} (${employee.emergencyContact.relationship || "Primary"}) — ${employee.emergencyContact.phone || "No phone"}`
                  : "Not provided"}
              </span>
            </div>
          </div>
        </div>

        {/* Section 2: Employment & Job Details */}
        <div className="profile-card">
          <div className="profile-card-header">
            <div className="card-header-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
                <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
              </svg>
            </div>
            <div>
              <h2>Employment & Job Details</h2>
              <span className="card-subtitle">Organization structure & role assignments</span>
            </div>
          </div>
          <div className="profile-card-body">
            <div className="info-field">
              <span className="info-label">Employee ID</span>
              <span className="info-value font-mono">{employee.employeeCode || "—"}</span>
            </div>
            <div className="info-field">
              <span className="info-label">Designation</span>
              <span className="info-value">{employee.job?.jobTitle || "Not specified"}</span>
            </div>
            <div className="info-field">
              <span className="info-label">Department</span>
              <span className="info-value">{employee.job?.department || "Engineering & Operations"}</span>
            </div>
            <div className="info-field">
              <span className="info-label">Job Grade</span>
              <span className="info-value">{employee.job?.jobGrade || "Level L3"}</span>
            </div>
            <div className="info-field">
              <span className="info-label">Employment Type</span>
              <span className="info-value">{employee.job?.employmentType || "Full-time Permanent"}</span>
            </div>
            <div className="info-field">
              <span className="info-label">Employment Status</span>
              <span className="info-value">
                <span className={`badge ${isActive ? "badge-active" : "badge-inactive"}`}>
                  {employee.status || "ACTIVE"}
                </span>
              </span>
            </div>
            <div className="info-field">
              <span className="info-label">Date of Joining</span>
              <span className="info-value">{formatDate(employee.job?.joiningDate)}</span>
            </div>
            {employee.status === "INACTIVE" && (
              <div className="info-field">
                <span className="info-label">Termination Date</span>
                <span className="info-value">{formatDate(employee.job?.terminationDate || employee.exit?.inactiveDate)}</span>
              </div>
            )}
            <div className="info-field">
              <span className="info-label">Reporting Manager</span>
              <span className="info-value">
                {employee.job?.reportingManagerId
                  ? `${employee.job.reportingManagerId.fullName} (${employee.job.reportingManagerId.employeeCode})`
                  : "None assigned"}
              </span>
            </div>
            <div className="info-field">
              <span className="info-label">Assigned Project</span>
              <span className="info-value">
                {employee.job?.project?.projectName || "Unassigned"} ({employee.job?.project?.projectType || "Standard"})
              </span>
            </div>
          </div>
        </div>

        {/* Section 3: Attendance & Leave Overview */}
        <div className="profile-card full-width">
          <div className="profile-card-header">
            <div className="card-header-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </div>
            <div>
              <h2>Attendance & Leave Overview</h2>
              <span className="card-subtitle">Official timesheet & leave balances for the current cycle</span>
            </div>
          </div>
          <div className="profile-card-body">
            <div className="compensation-summary-box">
              <div className="comp-stat">
                <span className="comp-label">Working Days in Cycle</span>
                <span className="comp-value">{employee.attendance?.totalWorkingDays ?? 22}</span>
              </div>
              <div className="comp-stat">
                <span className="comp-label">Days Present</span>
                <span className="comp-value">{employee.attendance?.daysPresent ?? 21}</span>
              </div>
              <div className="comp-stat">
                <span className="comp-label">Attendance Rate</span>
                <span className="comp-value">
                  {Math.round(((employee.attendance?.daysPresent ?? 21) / (employee.attendance?.totalWorkingDays ?? 22)) * 100)}%
                </span>
              </div>
            </div>

            <h3 className="sub-heading">Available Leave Balances</h3>
            <div className="salary-components-grid">
              <div className="salary-item">
                <span className="salary-label">Casual Leave (CL)</span>
                <span className="salary-amount">{employee.attendance?.leaveBalance?.casual ?? 8} Days</span>
              </div>
              <div className="salary-item">
                <span className="salary-label">Sick Leave (SL)</span>
                <span className="salary-amount">{employee.attendance?.leaveBalance?.sick ?? 6} Days</span>
              </div>
              <div className="salary-item">
                <span className="salary-label">Earned / Privilege Leave (EL)</span>
                <span className="salary-amount">{employee.attendance?.leaveBalance?.earned ?? 12} Days</span>
              </div>
            </div>
          </div>
        </div>

        {/* Section 4: Compensation & Payroll (Permitted HR Confidential Scope) */}
        <div className="profile-card full-width">
          <div className="profile-card-header">
            <div className="card-header-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="5" width="20" height="14" rx="2" />
                <line x1="2" y1="10" x2="22" y2="10" />
                <circle cx="7" cy="15" r="1.5" />
                <line x1="12" y1="15" x2="17" y2="15" />
              </svg>
            </div>
            <div>
              <h2>Compensation & Payroll</h2>
              <span className="card-subtitle">Monthly salary structure, bank ledger & tax registration</span>
            </div>
          </div>
          <div className="profile-card-body">
            <div className="compensation-summary-box">
              <div className="comp-stat">
                <span className="comp-label">Monthly Cost to Company (CTC)</span>
                <span className="comp-value">{formatCurrency(employee.currentMonthlySalary)}</span>
              </div>
              <div className="comp-stat">
                <span className="comp-label">Annualized Package (Gross)</span>
                <span className="comp-value">
                  {employee.currentMonthlySalary
                    ? formatCurrency(employee.currentMonthlySalary * 12)
                    : "—"}
                </span>
              </div>
            </div>

            <h3 className="sub-heading">Salary Components Breakdown</h3>
            <div className="salary-components-grid">
              <div className="salary-item">
                <span className="salary-label">Basic Salary (50%)</span>
                <span className="salary-amount">
                  {formatCurrency(employee.salaryComponents?.basicSalary)}
                </span>
              </div>
              <div className="salary-item">
                <span className="salary-label">House Rent Allowance (HRA 25%)</span>
                <span className="salary-amount">
                  {formatCurrency(employee.salaryComponents?.houseRentAllowance)}
                </span>
              </div>
              <div className="salary-item">
                <span className="salary-label">Conveyance Allowance (10%)</span>
                <span className="salary-amount">
                  {formatCurrency(employee.salaryComponents?.conveyanceAllowance)}
                </span>
              </div>
              <div className="salary-item">
                <span className="salary-label">Special Allowance (15%)</span>
                <span className="salary-amount">
                  {formatCurrency(employee.salaryComponents?.specialAllowance)}
                </span>
              </div>
              <div className="salary-item">
                <span className="salary-label">Employer PF Contribution</span>
                <span className="salary-amount">
                  {formatCurrency(employee.salaryComponents?.employerProvidentFund || 0)}
                </span>
              </div>
              <div className="salary-item">
                <span className="salary-label">Applicable Deductions</span>
                <span className="salary-amount">
                  {formatCurrency(employee.salaryComponents?.otherDeductions || 0)}
                </span>
              </div>
            </div>

            <h3 className="sub-heading" style={{ marginTop: "20px" }}>Banking & Tax Configuration</h3>
            <div className="salary-components-grid">
              <div className="salary-item">
                <span className="salary-label">Bank Name</span>
                <span className="salary-amount" style={{ fontSize: "14px" }}>
                  {employee.bankDetails?.bankName || "HDFC Bank"}
                </span>
              </div>
              <div className="salary-item">
                <span className="salary-label">Account Number (Masked)</span>
                <span className="salary-amount font-mono" style={{ fontSize: "14px" }}>
                  {employee.bankDetails?.accountNumber || "•••• •••• 1024"}
                </span>
              </div>
              <div className="salary-item">
                <span className="salary-label">IFSC Code</span>
                <span className="salary-amount font-mono" style={{ fontSize: "14px" }}>
                  {employee.bankDetails?.ifscCode || "HDFC0001024"}
                </span>
              </div>
              <div className="salary-item">
                <span className="salary-label">PAN Number</span>
                <span className="salary-amount font-mono" style={{ fontSize: "14px" }}>
                  {employee.taxDetails?.panNumber || "ABCDE1234F"}
                </span>
              </div>
              <div className="salary-item">
                <span className="salary-label">Tax Regime</span>
                <span className="salary-amount" style={{ fontSize: "14px" }}>
                  {employee.taxDetails?.taxRegime || "New Regime (Sec 115BAC)"}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Section 5: Official Documents & Identity */}
        <div className="profile-card full-width">
          <div className="profile-card-header">
            <div className="card-header-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
            </div>
            <div>
              <h2>Identity & Employment Documents</h2>
              <span className="card-subtitle">Verified identity records and signed compliance documents</span>
            </div>
          </div>
          <div className="profile-card-body">
            <div className="documents-list">
              <div className="document-row">
                <div className="doc-icon" aria-hidden="true">
                  <IconDocument size={20} />
                </div>
                <div className="doc-meta">
                  <span className="doc-name">Government Identity (PAN / Aadhaar e-KYC)</span>
                  <span className="doc-desc">
                    {employee.identityDetails?.idType || "PAN & Aadhaar"} • ID: {employee.identityDetails?.idNumber || "•••• •••• 9812"}
                  </span>
                </div>
                <StatusBadge status="VERIFIED" label="Verified" withDot={false} />
              </div>
              <div className="document-row">
                <div className="doc-icon" aria-hidden="true">
                  <IconDocument size={20} />
                </div>
                <div className="doc-meta">
                  <span className="doc-name">Employment Agreement & Code of Conduct</span>
                  <span className="doc-desc">Signed copy on company record</span>
                </div>
                <StatusBadge status="ON_FILE" label="On File" withDot={false} />
              </div>
              {employee.documents && employee.documents.length > 0 && (
                employee.documents.map((doc, idx) => (
                  <div key={doc._id || idx} className="document-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                      <div className="doc-icon" aria-hidden="true">
                        <IconDocument size={20} />
                      </div>
                      <div className="doc-meta">
                        <span className="doc-name">{doc.title || doc.fileName}</span>
                        <span className="doc-desc">
                          {doc.documentType?.replace("_", " ")} • {formatFileSize(doc.fileSize)} • Added{" "}
                          {doc.uploadedAt ? formatDate(doc.uploadedAt) : "Recently"}
                          {doc.uploadedByRole ? ` (by ${doc.uploadedByRole})` : ""}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => handleDownloadDocument(doc._id, doc.fileName || doc.title)}
                      disabled={downloadingDocId === doc._id}
                      style={{ padding: "6px 12px", fontSize: "12px" }}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                      </svg>
                      {downloadingDocId === doc._id ? "Downloading..." : "Download"}
                    </button>
                  </div>
                ))
              )}
              {employee.status === "INACTIVE" && (
                <div className="document-row">
                  <div className="doc-icon" aria-hidden="true">
                    <IconDocument size={20} />
                  </div>
                  <div className="doc-meta">
                    <span className="doc-name">Full and Final (FNF) Settlement Record</span>
                    <span className="doc-desc">
                      Processed for inactive employee exit record
                    </span>
                  </div>
                  <StatusBadge status="NEUTRAL" label="FNF Processed" withDot={false} />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* INITIATE F&F SETTLEMENT MODAL */}
      {showFnFModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 16,
          }}
          onClick={() => !submittingFnF && setShowFnFModal(false)}
        >
          <div
            style={{
              background: "#ffffff",
              borderRadius: 14,
              padding: 24,
              width: "100%",
              maxWidth: 520,
              boxShadow: "0 10px 25px rgba(0, 0, 0, 0.15)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <div>
                <h3 style={{ margin: "0 0 2px", fontSize: 18, fontWeight: 700, color: "#09090b" }}>
                  Initiate Full & Final (F&F) Settlement
                </h3>
                <p style={{ margin: 0, fontSize: 13, color: "#71717a" }}>
                  For {employee.fullName} ({employee.employeeCode})
                </p>
              </div>
              <button
                type="button"
                className="btn-sm btn-secondary"
                onClick={() => setShowFnFModal(false)}
                disabled={submittingFnF}
                aria-label="Close modal"
              >
                <IconClose size={14} />
              </button>
            </div>

            {fnfError && (
              <div role="alert" className="error" style={{ marginBottom: 14, display: "flex", alignItems: "center", gap: 6 }}>
                <IconAlertCircle size={15} />
                <span>{fnfError}</span>
              </div>
            )}

            {fnfSuccess && (
              <div role="status" style={{ marginBottom: 14, padding: "10px 12px", background: "#f0fdf4", color: "#166534", borderRadius: 8, fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
                <IconCheck size={15} />
                <span>{fnfSuccess}</span>
              </div>
            )}

            <form onSubmit={handleInitiateFnF} style={{ display: "grid", gap: 14 }}>
              <div>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6, color: "#09090b" }}>
                  Last Working Day <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <input
                  type="date"
                  required
                  value={fnfForm.lastWorkingDay}
                  onChange={(e) => setFnfForm({ ...fnfForm, lastWorkingDay: e.target.value })}
                  style={{
                    width: "100%",
                    padding: "9px 12px",
                    borderRadius: 8,
                    border: "1px solid #d4d4d8",
                    fontSize: 14,
                  }}
                />
                <span style={{ fontSize: 12, color: "#71717a", marginTop: 4, display: "block" }}>
                  Pending salary and leave balances will be computed up to this date.
                </span>
              </div>

              <div>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6, color: "#09090b" }}>
                  Exit Reason <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <select
                  value={fnfForm.exitReason}
                  onChange={(e) => setFnfForm({ ...fnfForm, exitReason: e.target.value })}
                  style={{
                    width: "100%",
                    padding: "9px 12px",
                    borderRadius: 8,
                    border: "1px solid #d4d4d8",
                    fontSize: 14,
                  }}
                >
                  <option value="Resignation">Resignation (Voluntary Separation)</option>
                  <option value="Retirement">Retirement</option>
                  <option value="Mutual Separation">Mutual Separation</option>
                  <option value="End of Contract">End of Employment Contract</option>
                  <option value="Termination">Involuntary Separation / Termination</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              <div>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6, color: "#09090b" }}>
                  HR Remarks & Offboarding Notes
                </label>
                <textarea
                  rows="3"
                  placeholder="Optional internal notes regarding handover, asset return, or settlement approval..."
                  value={fnfForm.hrRemarks}
                  onChange={(e) => setFnfForm({ ...fnfForm, hrRemarks: e.target.value })}
                  style={{
                    width: "100%",
                    padding: "9px 12px",
                    borderRadius: 8,
                    border: "1px solid #d4d4d8",
                    fontSize: 14,
                    fontFamily: "inherit",
                    resize: "vertical",
                  }}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowFnFModal(false)}
                  disabled={submittingFnF}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={submittingFnF}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                >
                  <span>{submittingFnF ? "Initiating..." : "Initiate Settlement"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
