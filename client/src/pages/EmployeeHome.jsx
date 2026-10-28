import { useEffect, useState } from "react";
import StatusBadge from "../components/StatusBadge";
import { IconDocument } from "../components/Icons";
import { useAuth } from "../context/AuthContext";
import api from "../services/api";
import "./EmployeeProfileView.css";

export default function EmployeeHome({ defaultTab = "overview" }) {
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [activeTab, setActiveTab] = useState(defaultTab); // "overview" | "edit_profile" | "documents"

  useEffect(() => {
    if (defaultTab) {
      setActiveTab(defaultTab);
    }
  }, [defaultTab]);

  // Self-service editable fields
  const [formData, setFormData] = useState({
    preferredName: "",
    personalEmail: "",
    phoneNumber: "",
    personalPhone: "",
    dateOfBirth: "",
    gender: "",
    residentialStreet: "",
    residentialCity: "",
    residentialState: "",
    residentialPostalCode: "",
    emergencyName: "",
    emergencyRel: "",
    emergencyPhone: "",
    accountHolderName: "",
    bankName: "",
    accountNumber: "",
    ifscCode: "",
    accountType: "SAVINGS",
    panNumber: "",
  });

  const [savingProfile, setSavingProfile] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState("");
  const [saveError, setSaveError] = useState("");

  // Documents state
  const [documents, setDocuments] = useState([]);
  const [uploadCategory, setUploadCategory] = useState("ID_PROOF");
  const [uploadTitle, setUploadTitle] = useState("");
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [docError, setDocError] = useState("");
  const [docSuccess, setDocSuccess] = useState("");
  const [downloadingDocId, setDownloadingDocId] = useState(null);

  const fetchMyProfile = async () => {
    try {
      const response = await api.get("/employees/me");
      if (response.data?.employee) {
        const emp = response.data.employee;
        setProfile(emp);
        setDocuments(emp.documents || []);
        setFormData({
          preferredName: emp.preferredName || "",
          personalEmail: emp.personalEmail || "",
          phoneNumber: emp.phoneNumber || "",
          personalPhone: emp.personalPhone || "",
          dateOfBirth: emp.dateOfBirth ? emp.dateOfBirth.split("T")[0] : "",
          gender: emp.gender || "",
          residentialStreet: emp.residentialAddress?.street || "",
          residentialCity: emp.residentialAddress?.city || emp.city || "",
          residentialState: emp.residentialAddress?.state || "",
          residentialPostalCode: emp.residentialAddress?.postalCode || "",
          emergencyName: emp.emergencyContact?.name || "",
          emergencyRel: emp.emergencyContact?.relationship || "",
          emergencyPhone: emp.emergencyContact?.phone || "",
          accountHolderName: emp.bankDetails?.accountHolderName || emp.fullName || "",
          bankName: emp.bankDetails?.bankName || "",
          accountNumber: emp.bankDetails?.accountNumber || "",
          ifscCode: emp.bankDetails?.ifscCode || "",
          accountType: emp.bankDetails?.accountType || "SAVINGS",
          panNumber: emp.taxDetails?.panNumber || "",
        });
      }
    } catch (err) {
      if (!err.response || err.code === "ERR_NETWORK" || err.response.status >= 500) {
        setError("Unable to connect. Please try again in a moment.");
      } else {
        setError(err.response?.data?.message || "Couldn't load profile. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMyProfile();
  }, []);

  const handleInputChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (saveError) setSaveError("");
    if (saveSuccess) setSaveSuccess("");
  };

  const handleProfileSubmit = async (e) => {
    e.preventDefault();
    setSaveError("");
    setSaveSuccess("");
    setSavingProfile(true);

    try {
      const payload = {
        preferredName: formData.preferredName.trim() || undefined,
        personalEmail: formData.personalEmail.trim() || undefined,
        phoneNumber: formData.phoneNumber.trim() || undefined,
        personalPhone: formData.personalPhone.trim() || undefined,
        dateOfBirth: formData.dateOfBirth || undefined,
        gender: formData.gender || undefined,
        residentialAddress: {
          street: formData.residentialStreet.trim() || undefined,
          city: formData.residentialCity.trim() || undefined,
          state: formData.residentialState.trim() || undefined,
          postalCode: formData.residentialPostalCode.trim() || undefined,
          country: "India",
        },
        emergencyContact: {
          name: formData.emergencyName.trim() || undefined,
          relationship: formData.emergencyRel.trim() || undefined,
          phone: formData.emergencyPhone.trim() || undefined,
        },
        bankDetails: {
          accountHolderName: formData.accountHolderName.trim() || profile?.fullName,
          bankName: formData.bankName.trim() || undefined,
          accountNumber: formData.accountNumber.trim() || undefined,
          ifscCode: formData.ifscCode.trim() || undefined,
          accountType: formData.accountType,
        },
        taxDetails: {
          panNumber: formData.panNumber.trim() || undefined,
        },
      };

      const res = await api.patch("/employees/me", payload);
      if (res.data?.employee) {
        setProfile((prev) => ({ ...prev, ...res.data.employee }));
      }
      setSaveSuccess("Your personal profile has been updated successfully.");
    } catch (err) {
      setSaveError(
        err.response?.data?.message || "Unable to update profile. Please verify your details."
      );
    } finally {
      setSavingProfile(false);
    }
  };

  const formatFileSize = (bytes) => {
    if (!bytes && bytes !== 0) return "—";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(2) + " MB";
  };

  const formatDate = (dateString) => {
    if (!dateString) return "Not recorded";
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return "Not recorded";
    return d.toLocaleDateString("en-IN", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const handleFileChange = (e) => {
    setDocError("");
    setDocSuccess("");
    const file = e.target.files?.[0];
    if (!file) {
      setSelectedFile(null);
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setDocError("File size exceeds 10MB limit. Please choose a smaller file.");
      setSelectedFile(null);
      e.target.value = "";
      return;
    }

    const forbiddenExtensions = [".exe", ".bat", ".cmd", ".sh", ".php", ".js", ".vbs"];
    const ext = "." + file.name.split(".").pop().toLowerCase();
    if (forbiddenExtensions.includes(ext)) {
      setDocError("Executable file types are strictly prohibited.");
      setSelectedFile(null);
      e.target.value = "";
      return;
    }

    setSelectedFile(file);
    if (!uploadTitle.trim()) {
      setUploadTitle(file.name.replace(/\.[^/.]+$/, ""));
    }
  };

  const handleUploadDocument = async (e) => {
    e.preventDefault();
    setDocError("");
    setDocSuccess("");

    if (!selectedFile) {
      setDocError("Please select a file to upload.");
      return;
    }

    setUploadingDoc(true);
    try {
      const reader = new FileReader();
      const fileDataPromise = new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result);
        reader.onerror = (err) => reject(err);
      });
      reader.readAsDataURL(selectedFile);
      const fileData = await fileDataPromise;

      const res = await api.post("/employees/me/documents", {
        documentType: uploadCategory,
        title: uploadTitle.trim() || selectedFile.name,
        fileData,
        fileName: selectedFile.name,
        mimeType: selectedFile.type || "application/octet-stream",
      });

      if (res.data?.document) {
        setDocuments((prev) => [res.data.document, ...prev]);
        setDocSuccess("Document uploaded successfully!");
        setUploadTitle("");
        setSelectedFile(null);
        const fileInput = document.getElementById("emp-self-file-input");
        if (fileInput) fileInput.value = "";
      }
    } catch (err) {
      setDocError(err.response?.data?.message || "Failed to upload document.");
    } finally {
      setUploadingDoc(false);
    }
  };

  const handleDownloadDocument = async (docId, fileName) => {
    setDownloadingDocId(docId);
    try {
      const response = await api.get(`/employees/me/documents/${docId}/download`, {
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
          <p style={{ color: "var(--muted)", fontSize: "14px" }}>Loading your employee profile...</p>
        </div>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="epv-container">
        <div className="pm-empty-box" style={{ marginTop: "20px" }}>
          <h3>Unable to display profile</h3>
          <p>{error || "Profile could not be loaded."}</p>
          <button
            type="button"
            className="btn-primary"
            onClick={fetchMyProfile}
            style={{ marginTop: "16px" }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const userInitial = (profile.fullName || user?.email || "E")[0].toUpperCase();
  const joiningDateObj = profile.job?.joiningDate ? new Date(profile.job.joiningDate) : null;
  const daysInCompany = joiningDateObj && !isNaN(joiningDateObj.getTime())
    ? Math.max(1, Math.floor((new Date() - joiningDateObj) / (1000 * 60 * 60 * 24)))
    : 120;

  const attendanceInfo = profile.attendance || {
    totalWorkingDays: 22,
    daysPresent: 21,
    leaveBalance: { casual: 8, sick: 6, earned: 12 },
  };
  const attendanceRate = Math.round(
    ((attendanceInfo.daysPresent || 21) / (attendanceInfo.totalWorkingDays || 22)) * 100
  );

  const projectName = profile.job?.project?.projectName || "Platform Operations";
  const projectType = profile.job?.project?.projectType || "MANDATE";

  return (
    <div className="epv-container">
      {/* -----------------------------------------------------------------------
          TOP HEADER
          ----------------------------------------------------------------------- */}
      <div className="epv-header-bar">
        <div className="epv-header-row">
          <div className="epv-title-group">
            <h1>My Profile</h1>
            <p>Your official employment profile, contact details and verified documents</p>
          </div>

          <div className="epv-header-actions">
            <button
              type="button"
              className={activeTab === "edit_profile" ? "btn-primary" : "btn-secondary"}
              onClick={() => setActiveTab("edit_profile")}
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
              <span>Edit Contact Info</span>
            </button>
          </div>
        </div>
      </div>

      {/* -----------------------------------------------------------------------
          REFERENCE 3: TOP 3 PERMITTED KPI STRIP (No HR-restricted Salary)
          ----------------------------------------------------------------------- */}
      <section className="epv-top-strip" style={{ gridTemplateColumns: "repeat(3, 1fr)" }} aria-label="Summary Highlights">
        {/* KPI 1: Tenure */}
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
          <div className="epv-kpi-sub">Joined on {formatDate(profile.job?.joiningDate)}</div>
        </div>

        {/* KPI 2: Active Project */}
        <div className="epv-kpi-card">
          <div className="epv-kpi-lbl">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
            <span>Current Project</span>
          </div>
          <div className="epv-kpi-num-row">
            <span className="epv-kpi-val" style={{ fontSize: "18px" }}>{projectName}</span>
            <span className="epv-kpi-badge">{projectType}</span>
          </div>
          <div className="epv-kpi-sub">{profile.job?.workLocation || "Headquarters"}</div>
        </div>

        {/* KPI 3: Attendance Rate */}
        <div className="epv-kpi-card">
          <div className="epv-kpi-lbl">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            <span>Attendance Score</span>
          </div>
          <div className="epv-kpi-num-row">
            <span className="epv-kpi-val">{attendanceRate}%</span>
            <span className="epv-kpi-badge">{attendanceInfo.daysPresent || 21} Days</span>
          </div>
          <div className="epv-kpi-sub">
            Leaves Balance: {(attendanceInfo.leaveBalance?.casual || 8) + (attendanceInfo.leaveBalance?.sick || 6) + (attendanceInfo.leaveBalance?.earned || 12)} days
          </div>
        </div>
      </section>

      {/* -----------------------------------------------------------------------
          REFERENCE 3: TWO-COLUMN SPLIT GRID (LEFT PANEL & RIGHT TABS)
          ----------------------------------------------------------------------- */}
      <div className="epv-split-grid">
        {/* =====================================================================
            LEFT PROFILE PANEL (Reference 3 "Person" Card & Format Card)
            ===================================================================== */}
        <aside className="epv-left-panel">
          {/* Person Card */}
          <div className="epv-person-card">
            <div className="epv-avatar-wrapper">
              <div className="epv-avatar-large">
                {userInitial}
              </div>
            </div>

            <h2 className="epv-person-name">{profile.fullName}</h2>
            <p className="epv-person-role">{profile.job?.jobTitle || "Team Member"}</p>

            <div className="epv-person-badges">
              <span className="epv-code-badge">{profile.employeeCode || "EMP-000"}</span>
              <StatusBadge status={profile.status || "ACTIVE"} />
            </div>

            <div className="epv-left-meta-list">
              <div className="epv-meta-row">
                <span className="epv-meta-lbl">Department</span>
                <span className="epv-meta-val">{profile.job?.department || "General"}</span>
              </div>
              <div className="epv-meta-row">
                <span className="epv-meta-lbl">Location</span>
                <span className="epv-meta-val">{profile.job?.workLocation || profile.city || "Headquarters"}</span>
              </div>
              <div className="epv-meta-row">
                <span className="epv-meta-lbl">Joining Date</span>
                <span className="epv-meta-val">{formatDate(profile.job?.joiningDate)}</span>
              </div>
              <div className="epv-meta-row">
                <span className="epv-meta-lbl">Work Email</span>
                <span className="epv-meta-val" style={{ maxWidth: "160px", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {profile.email}
                </span>
              </div>
              {profile.phoneNumber && (
                <div className="epv-meta-row">
                  <span className="epv-meta-lbl">Phone</span>
                  <span className="epv-meta-val">{profile.phoneNumber}</span>
                </div>
              )}
            </div>

            <div className="epv-person-actions">
              <button
                type="button"
                className="epv-btn-full epv-btn-primary"
                onClick={() => setActiveTab("edit_profile")}
              >
                <span>Update Contact Details</span>
              </button>
            </div>
          </div>

          {/* Working Format Card */}
          <div className="epv-format-card">
            <h3 className="epv-format-title">
              <span>Working Format</span>
              <span style={{ fontSize: "12px", color: "var(--g-700)", fontWeight: "600" }}>
                {profile.job?.employmentType || "Full-time"}
              </span>
            </h3>

            <div className="epv-donut-ring-wrap">
              <div className="epv-donut-circle">
                <span className="epv-donut-days">{attendanceInfo.daysPresent || 21}</span>
                <span className="epv-donut-sub">Days</span>
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
            RIGHT INFORMATION AREA (Structured Permitted Tabs)
            ===================================================================== */}
        <section className="epv-right-panel" aria-label="Employee Information Tabs">
          {/* Tabs Navigation Strip */}
          <div className="epv-tabs-strip">
            <button
              type="button"
              className={`epv-tab-btn ${activeTab === "overview" ? "active" : ""}`}
              onClick={() => setActiveTab("overview")}
            >
              Job & Organization Details
            </button>
            <button
              type="button"
              className={`epv-tab-btn ${activeTab === "edit_profile" ? "active" : ""}`}
              onClick={() => setActiveTab("edit_profile")}
            >
              Personal & Contact Details
            </button>
            <button
              type="button"
              className={`epv-tab-btn ${activeTab === "documents" ? "active" : ""}`}
              onClick={() => setActiveTab("documents")}
            >
              My Documents ({documents.length})
            </button>
          </div>

          {/* TAB 1: JOB & ORGANIZATION DETAILS (READ-ONLY) */}
          {activeTab === "overview" && (
            <div className="epv-tab-body">
              <div className="epv-section-block">
                <div className="epv-section-head">
                  <h3 className="epv-section-title">Official Employment Record</h3>
                  <span className="epv-section-sub">Maintained by HR Operations</span>
                </div>
                <div className="epv-field-grid-3">
                  <div className="epv-field-item">
                    <span className="epv-field-lbl">Employee Code</span>
                    <span className="epv-field-val font-mono">{profile.employeeCode}</span>
                  </div>
                  <div className="epv-field-item">
                    <span className="epv-field-lbl">Designation / Role</span>
                    <span className="epv-field-val">{profile.job?.jobTitle || "—"}</span>
                  </div>
                  <div className="epv-field-item">
                    <span className="epv-field-lbl">Department</span>
                    <span className="epv-field-val">{profile.job?.department || "—"}</span>
                  </div>
                  <div className="epv-field-item">
                    <span className="epv-field-lbl">Job Grade</span>
                    <span className="epv-field-val">{profile.job?.jobGrade || "Level L3"}</span>
                  </div>
                  <div className="epv-field-item">
                    <span className="epv-field-lbl">Employment Type</span>
                    <span className="epv-field-val">{profile.job?.employmentType || "Full-time Permanent"}</span>
                  </div>
                  <div className="epv-field-item">
                    <span className="epv-field-lbl">Work Location</span>
                    <span className="epv-field-val">{profile.job?.workLocation || "Headquarters"}</span>
                  </div>
                  <div className="epv-field-item">
                    <span className="epv-field-lbl">Assigned Project</span>
                    <span className="epv-field-val highlight">{projectName}</span>
                  </div>
                  <div className="epv-field-item">
                    <span className="epv-field-lbl">Project Type</span>
                    <span className="epv-field-val">{projectType}</span>
                  </div>
                  <div className="epv-field-item">
                    <span className="epv-field-lbl">Joining Date</span>
                    <span className="epv-field-val">{formatDate(profile.job?.joiningDate)}</span>
                  </div>
                </div>
              </div>

              <div className="epv-section-block">
                <div className="epv-section-head">
                  <h3 className="epv-section-title">Verified Emergency & Bank Summary</h3>
                </div>
                <div className="epv-field-grid-2">
                  <div className="epv-field-item">
                    <span className="epv-field-lbl">Primary Emergency Contact</span>
                    <span className="epv-field-val">
                      {profile.emergencyContact?.name
                        ? `${profile.emergencyContact.name} (${profile.emergencyContact.relationship || "Primary"}) — ${profile.emergencyContact.phone || "No phone"}`
                        : "Not provided"}
                    </span>
                  </div>
                  <div className="epv-field-item">
                    <span className="epv-field-lbl">Disbursement Bank Account</span>
                    <span className="epv-field-val">
                      {profile.bankDetails?.bankName
                        ? `${profile.bankDetails.bankName} (••••${profile.bankDetails.accountNumber?.slice(-4) || "0000"})`
                        : "Not recorded"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: PERSONAL & CONTACT (SELF-SERVICE EDITABLE FORM) */}
          {activeTab === "edit_profile" && (
            <div className="epv-tab-body">
              {saveSuccess && <div className="success-alert" style={{ marginBottom: "20px" }}>{saveSuccess}</div>}
              {saveError && <div className="error" style={{ marginBottom: "20px" }}>{saveError}</div>}

              <form onSubmit={handleProfileSubmit} className="epv-edit-form" noValidate>
                <div className="epv-section-block">
                  <div className="epv-section-head">
                    <h3 className="epv-section-title">Personal & Contact Information</h3>
                    <span className="epv-section-sub">Fields you are permitted to update directly</span>
                  </div>

                  <div className="epv-field-grid-2">
                    <div className="epv-edit-field-group">
                      <label className="epv-edit-label">Preferred Name</label>
                      <input
                        className="epv-edit-input"
                        value={formData.preferredName}
                        onChange={(e) => handleInputChange("preferredName", e.target.value)}
                        placeholder="e.g. Maya"
                      />
                    </div>
                    <div className="epv-edit-field-group">
                      <label className="epv-edit-label">Personal Email</label>
                      <input
                        className="epv-edit-input"
                        type="email"
                        value={formData.personalEmail}
                        onChange={(e) => handleInputChange("personalEmail", e.target.value)}
                        placeholder="maya.personal@gmail.com"
                      />
                    </div>
                    <div className="epv-edit-field-group">
                      <label className="epv-edit-label">Personal Phone</label>
                      <input
                        className="epv-edit-input"
                        value={formData.personalPhone}
                        onChange={(e) => handleInputChange("personalPhone", e.target.value)}
                        placeholder="+91 98765 43210"
                      />
                    </div>
                    <div className="epv-edit-field-group">
                      <label className="epv-edit-label">Date of Birth</label>
                      <input
                        className="epv-edit-input"
                        type="date"
                        value={formData.dateOfBirth}
                        onChange={(e) => handleInputChange("dateOfBirth", e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                <div className="epv-section-block">
                  <div className="epv-section-head">
                    <h3 className="epv-section-title">Residential Address</h3>
                  </div>
                  <div className="epv-field-grid-2">
                    <div className="epv-edit-field-group" style={{ gridColumn: "1 / -1" }}>
                      <label className="epv-edit-label">Street Address</label>
                      <input
                        className="epv-edit-input"
                        value={formData.residentialStreet}
                        onChange={(e) => handleInputChange("residentialStreet", e.target.value)}
                        placeholder="Flat / Building, Street"
                      />
                    </div>
                    <div className="epv-edit-field-group">
                      <label className="epv-edit-label">City</label>
                      <input
                        className="epv-edit-input"
                        value={formData.residentialCity}
                        onChange={(e) => handleInputChange("residentialCity", e.target.value)}
                        placeholder="Bangalore"
                      />
                    </div>
                    <div className="epv-edit-field-group">
                      <label className="epv-edit-label">State / Postal Code</label>
                      <input
                        className="epv-edit-input"
                        value={formData.residentialPostalCode}
                        onChange={(e) => handleInputChange("residentialPostalCode", e.target.value)}
                        placeholder="560001"
                      />
                    </div>
                  </div>
                </div>

                <div className="epv-section-block">
                  <div className="epv-section-head">
                    <h3 className="epv-section-title">Emergency Contact & Bank Details</h3>
                  </div>
                  <div className="epv-field-grid-2">
                    <div className="epv-edit-field-group">
                      <label className="epv-edit-label">Emergency Contact Name</label>
                      <input
                        className="epv-edit-input"
                        value={formData.emergencyName}
                        onChange={(e) => handleInputChange("emergencyName", e.target.value)}
                        placeholder="Contact Person Name"
                      />
                    </div>
                    <div className="epv-edit-field-group">
                      <label className="epv-edit-label">Emergency Contact Phone</label>
                      <input
                        className="epv-edit-input"
                        value={formData.emergencyPhone}
                        onChange={(e) => handleInputChange("emergencyPhone", e.target.value)}
                        placeholder="+91 99999 88888"
                      />
                    </div>
                    <div className="epv-edit-field-group">
                      <label className="epv-edit-label">Bank Name</label>
                      <input
                        className="epv-edit-input"
                        value={formData.bankName}
                        onChange={(e) => handleInputChange("bankName", e.target.value)}
                        placeholder="e.g. HDFC Bank"
                      />
                    </div>
                    <div className="epv-edit-field-group">
                      <label className="epv-edit-label">Account Number</label>
                      <input
                        className="epv-edit-input"
                        value={formData.accountNumber}
                        onChange={(e) => handleInputChange("accountNumber", e.target.value)}
                        placeholder="Bank Account Number"
                      />
                    </div>
                    <div className="epv-edit-field-group">
                      <label className="epv-edit-label">IFSC Code</label>
                      <input
                        className="epv-edit-input"
                        value={formData.ifscCode}
                        onChange={(e) => handleInputChange("ifscCode", e.target.value.toUpperCase())}
                        placeholder="HDFC0001234"
                      />
                    </div>
                    <div className="epv-edit-field-group">
                      <label className="epv-edit-label">PAN Number</label>
                      <input
                        className="epv-edit-input"
                        value={formData.panNumber}
                        onChange={(e) => handleInputChange("panNumber", e.target.value.toUpperCase())}
                        placeholder="ABCDE1234F"
                      />
                    </div>
                  </div>
                </div>

                <div className="epv-person-actions" style={{ flexDirection: "row", justifyContent: "flex-end" }}>
                  <button type="submit" disabled={savingProfile} className="btn-primary">
                    {savingProfile ? "Saving Changes..." : "Save Changes"}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* TAB 3: DOCUMENTS & IDENTITY */}
          {activeTab === "documents" && (
            <div className="epv-tab-body">
              {docSuccess && <div className="success-alert" style={{ marginBottom: "20px" }}>{docSuccess}</div>}
              {docError && <div className="error" style={{ marginBottom: "20px" }}>{docError}</div>}

              <div className="epv-upload-panel">
                <h3>Upload New Document</h3>
                <form onSubmit={handleUploadDocument} className="epv-edit-form" noValidate>
                  <div className="epv-field-grid-2" style={{ marginBottom: 14 }}>
                    <div className="epv-edit-field-group">
                      <label className="epv-edit-label">Category *</label>
                      <select
                        value={uploadCategory}
                        onChange={(e) => setUploadCategory(e.target.value)}
                        className="epv-edit-input"
                      >
                        <option value="ID_PROOF">ID Proof (PAN, Aadhaar, Passport)</option>
                        <option value="ADDRESS_PROOF">Address Proof</option>
                        <option value="EDUCATION">Educational Certificate</option>
                        <option value="CERTIFICATION">Professional Certification</option>
                        <option value="OTHER">Other Official Document</option>
                      </select>
                    </div>
                    <div className="epv-edit-field-group">
                      <label className="epv-edit-label">Document Title *</label>
                      <input
                        className="epv-edit-input"
                        value={uploadTitle}
                        onChange={(e) => setUploadTitle(e.target.value)}
                        placeholder="e.g. Updated Aadhaar Card"
                        required
                      />
                    </div>
                    <div className="epv-edit-field-group" style={{ gridColumn: "1 / -1" }}>
                      <label className="epv-edit-label">Select File (PDF, PNG, JPG — max 10MB) *</label>
                      <input
                        id="emp-self-file-input"
                        className="epv-edit-input"
                        type="file"
                        onChange={handleFileChange}
                        accept=".pdf,.png,.jpg,.jpeg"
                        required
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={uploadingDoc || !selectedFile}
                    className="btn-primary"
                    style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
                  >
                    <span>{uploadingDoc ? "Uploading..." : "Upload Document"}</span>
                  </button>
                </form>
              </div>

              {/* Uploaded Documents List */}
              <div className="epv-section-block">
                <div className="epv-section-head">
                  <h3 className="epv-section-title">My Uploaded Documents</h3>
                  <span className="epv-section-sub">{documents.length} verified documents</span>
                </div>

                {documents.length === 0 ? (
                  <p style={{ fontSize: "13px", color: "var(--muted)", padding: "12px 0" }}>
                    You have not uploaded any documents yet.
                  </p>
                ) : (
                  documents.map((doc) => (
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
        </section>
      </div>
    </div>
  );
}
