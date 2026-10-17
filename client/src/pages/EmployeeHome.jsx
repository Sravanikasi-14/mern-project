import { useEffect, useState } from "react";
import AppHeader from "../components/AppHeader";
import { useAuth } from "../context/AuthContext";
import api from "../services/api";

export default function EmployeeHome() {
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [activeTab, setActiveTab] = useState("overview"); // "overview" | "edit_profile" | "documents"

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
        setError("We're unable to connect right now. Please try again in a moment.");
      } else {
        setError(err.response?.data?.message || "Unable to load employee profile.");
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

  return (
    <main className="container-wide" style={{ margin: "20px auto" }}>
      <AppHeader title="Employee Self-Service Portal" />

      {loading && (
        <div style={{ padding: "40px 0", textAlign: "center", color: "#64748b" }}>
          <p>Loading your employee profile...</p>
        </div>
      )}

      {error && (
        <div className="error" style={{ marginBottom: "20px" }}>
          {error}
        </div>
      )}

      {!loading && profile && (
        <>
          {/* Profile Overview Banner */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "16px",
              padding: "20px 24px",
              background: "#ffffff",
              border: "1px solid #e4e4e7",
              borderRadius: "12px",
              marginBottom: "24px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
              <div
                style={{
                  width: "52px",
                  height: "52px",
                  borderRadius: "50%",
                  background: "#18181b",
                  color: "#ffffff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: "700",
                  fontSize: "20px",
                }}
              >
                {(profile.fullName || user?.email || "E")[0].toUpperCase()}
              </div>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <h1 style={{ margin: 0, fontSize: "20px", color: "#09090b" }}>
                    {profile.fullName}
                  </h1>
                  <span className={`status-badge ${profile.status === "ACTIVE" ? "status-active" : "status-inactive"}`}>
                    {profile.status}
                  </span>
                </div>
                <div style={{ fontSize: "13px", color: "#71717a", marginTop: "4px" }}>
                  <span>Code: <strong>{profile.employeeCode}</strong></span> •{" "}
                  <span>{profile.job?.jobTitle || "Employee"}</span> •{" "}
                  <span>{profile.job?.department || "General"}</span> •{" "}
                  <span>{profile.email}</span>
                </div>
              </div>
            </div>

            {/* Navigation Tabs */}
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                type="button"
                className={activeTab === "overview" ? "btn-primary" : "btn-secondary"}
                onClick={() => setActiveTab("overview")}
                style={{ fontSize: "13px", padding: "8px 14px" }}
              >
                Overview & Official Record
              </button>
              <button
                type="button"
                className={activeTab === "edit_profile" ? "btn-primary" : "btn-secondary"}
                onClick={() => setActiveTab("edit_profile")}
                style={{ fontSize: "13px", padding: "8px 14px" }}
              >
                My Profile Details
              </button>
              <button
                type="button"
                className={activeTab === "documents" ? "btn-primary" : "btn-secondary"}
                onClick={() => setActiveTab("documents")}
                style={{ fontSize: "13px", padding: "8px 14px" }}
              >
                My Documents ({documents.length})
              </button>
            </div>
          </div>

          {/* TAB 1: OVERVIEW & OFFICIAL RECORD (READ-ONLY HR DETAILS) */}
          {activeTab === "overview" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "20px" }}>
              <section className="profile-card">
                <div className="profile-card-header">
                  <div className="card-header-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
                      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
                    </svg>
                  </div>
                  <div>
                    <h2>Official Employment Record</h2>
                    <span className="card-subtitle">
                      Company-managed official job assignments, grade, and organizational records (Read-Only)
                    </span>
                  </div>
                </div>
                <div className="profile-card-body">
                  <div
                    style={{
                      background: "#f8fafc",
                      border: "1px solid #e2e8f0",
                      borderRadius: "6px",
                      padding: "10px 14px",
                      marginBottom: "16px",
                      fontSize: "13px",
                      color: "#64748b",
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                    }}
                  >
                    <span style={{ fontWeight: "600", color: "#0f172a" }}>Notice:</span>
                    These official employment details are controlled by HR Administration. To request modifications, contact your HR department.
                  </div>

                  <div className="detail-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px" }}>
                    <div className="detail-item">
                      <strong>Employee Code</strong>
                      <span className="font-mono">{profile.employeeCode}</span>
                    </div>
                    <div className="detail-item">
                      <strong>Official Work Email</strong>
                      <span>{profile.email}</span>
                    </div>
                    <div className="detail-item">
                      <strong>Designation / Job Title</strong>
                      <span>{profile.job?.jobTitle || "—"}</span>
                    </div>
                    <div className="detail-item">
                      <strong>Department</strong>
                      <span>{profile.job?.department || "—"}</span>
                    </div>
                    <div className="detail-item">
                      <strong>Job Grade</strong>
                      <span>{profile.job?.jobGrade || "—"}</span>
                    </div>
                    <div className="detail-item">
                      <strong>Employment Type</strong>
                      <span>{profile.job?.employmentType || "Full-time Permanent"}</span>
                    </div>
                    <div className="detail-item">
                      <strong>Work Location</strong>
                      <span>{profile.job?.workLocation || "—"}</span>
                    </div>
                    <div className="detail-item">
                      <strong>Assigned Project</strong>
                      <span>{profile.job?.project?.projectName || "Unassigned"}</span>
                    </div>
                    <div className="detail-item">
                      <strong>Project Type</strong>
                      <span>{profile.job?.project?.projectType || "MANDATE"}</span>
                    </div>
                    <div className="detail-item">
                      <strong>Date of Joining</strong>
                      <span>
                        {profile.job?.joiningDate
                          ? new Date(profile.job.joiningDate).toLocaleDateString("en-IN", { month: "short", day: "numeric", year: "numeric" })
                          : "Not recorded"}
                      </span>
                    </div>
                  </div>
                </div>
              </section>

              {/* Personal Summary Preview */}
              <section className="profile-card">
                <div className="profile-card-header">
                  <div className="card-header-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
                    <div>
                      <h2>Personal & Contact Summary</h2>
                      <span className="card-subtitle">Your self-service contact details and banking information</span>
                    </div>
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => setActiveTab("edit_profile")}
                      style={{ fontSize: "12px", padding: "6px 12px" }}
                    >
                      Update Profile →
                    </button>
                  </div>
                </div>
                <div className="profile-card-body">
                  <div className="detail-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px" }}>
                    <div className="detail-item">
                      <strong>Preferred Name</strong>
                      <span>{profile.preferredName || "Not set"}</span>
                    </div>
                    <div className="detail-item">
                      <strong>Personal Email</strong>
                      <span>{profile.personalEmail || "Not provided"}</span>
                    </div>
                    <div className="detail-item">
                      <strong>Mobile Number</strong>
                      <span>{profile.phoneNumber || "Not provided"}</span>
                    </div>
                    <div className="detail-item">
                      <strong>Personal Mobile</strong>
                      <span>{profile.personalPhone || "Not provided"}</span>
                    </div>
                    <div className="detail-item">
                      <strong>Residential City</strong>
                      <span>{profile.residentialAddress?.city || profile.city || "Not provided"}</span>
                    </div>
                    <div className="detail-item">
                      <strong>Emergency Contact</strong>
                      <span>
                        {profile.emergencyContact?.name
                          ? `${profile.emergencyContact.name} (${profile.emergencyContact.relationship || "Contact"} - ${profile.emergencyContact.phone || "No phone"})`
                          : "Not provided"}
                      </span>
                    </div>
                    <div className="detail-item">
                      <strong>Bank Account</strong>
                      <span className="font-mono">
                        {profile.bankDetails?.accountNumber
                          ? `${profile.bankDetails.bankName || "Bank"} (•••• ${profile.bankDetails.accountNumber.slice(-4)})`
                          : "Not provided"}
                      </span>
                    </div>
                    <div className="detail-item">
                      <strong>PAN Number</strong>
                      <span className="font-mono">{profile.taxDetails?.panNumber || "Not recorded"}</span>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          )}

          {/* TAB 2: EDIT MY PROFILE (SELF-SERVICE) */}
          {activeTab === "edit_profile" && (
            <form onSubmit={handleProfileSubmit} noValidate>
              <section className="profile-card" style={{ marginBottom: "20px" }}>
                <div className="profile-card-header">
                  <div className="card-header-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </div>
                  <div>
                    <h2>Update My Personal Profile</h2>
                    <span className="card-subtitle">Keep your contact information, residential address, and payroll accounts up to date</span>
                  </div>
                </div>
                <div className="profile-card-body">
                  {saveSuccess && <div className="success-alert" style={{ marginBottom: "16px" }}>{saveSuccess}</div>}
                  {saveError && <div className="error" style={{ marginBottom: "16px" }}>{saveError}</div>}

                  <h3 style={{ margin: "0 0 12px", fontSize: "14px", color: "#0f172a" }}>
                    Personal Details
                  </h3>
                  <div className="edit-form-grid" style={{ marginBottom: "20px" }}>
                    <label className="form-group">
                      Preferred / Nick Name
                      <input
                        type="text"
                        value={formData.preferredName}
                        onChange={(e) => handleInputChange("preferredName", e.target.value)}
                        placeholder="e.g. Maya"
                      />
                    </label>

                    <label className="form-group">
                      Personal Email Address
                      <input
                        type="email"
                        value={formData.personalEmail}
                        onChange={(e) => handleInputChange("personalEmail", e.target.value)}
                        placeholder="e.g. personal@example.com"
                      />
                    </label>

                    <label className="form-group">
                      Work / Primary Mobile Phone
                      <input
                        type="tel"
                        value={formData.phoneNumber}
                        onChange={(e) => handleInputChange("phoneNumber", e.target.value)}
                        placeholder="+91 98765 00000"
                      />
                    </label>

                    <label className="form-group">
                      Personal Mobile Phone
                      <input
                        type="tel"
                        value={formData.personalPhone}
                        onChange={(e) => handleInputChange("personalPhone", e.target.value)}
                        placeholder="+91 98765 11111"
                      />
                    </label>

                    <label className="form-group">
                      Date of Birth
                      <input
                        type="date"
                        value={formData.dateOfBirth}
                        onChange={(e) => handleInputChange("dateOfBirth", e.target.value)}
                      />
                    </label>

                    <label className="form-group">
                      Gender
                      <select
                        value={formData.gender}
                        onChange={(e) => handleInputChange("gender", e.target.value)}
                        className="filter-select"
                      >
                        <option value="">Select gender</option>
                        <option value="Male">Male</option>
                        <option value="Female">Female</option>
                        <option value="Non-Binary">Non-Binary</option>
                        <option value="Prefer not to say">Prefer not to say</option>
                      </select>
                    </label>
                  </div>

                  <h3 style={{ margin: "20px 0 12px", fontSize: "14px", color: "#0f172a", borderTop: "1px solid #f1f5f9", paddingTop: "16px" }}>
                    Residential Address
                  </h3>
                  <div style={{ marginBottom: "12px" }}>
                    <label className="form-group">
                      Street Address
                      <input
                        type="text"
                        value={formData.residentialStreet}
                        onChange={(e) => handleInputChange("residentialStreet", e.target.value)}
                        placeholder="House / Flat No, Street, Landmark"
                      />
                    </label>
                  </div>
                  <div className="edit-form-grid" style={{ marginBottom: "20px" }}>
                    <label className="form-group">
                      City
                      <input
                        type="text"
                        value={formData.residentialCity}
                        onChange={(e) => handleInputChange("residentialCity", e.target.value)}
                        placeholder="e.g. Bengaluru"
                      />
                    </label>

                    <label className="form-group">
                      State
                      <input
                        type="text"
                        value={formData.residentialState}
                        onChange={(e) => handleInputChange("residentialState", e.target.value)}
                        placeholder="e.g. Karnataka"
                      />
                    </label>

                    <label className="form-group">
                      Postal Code / PIN
                      <input
                        type="text"
                        value={formData.residentialPostalCode}
                        onChange={(e) => handleInputChange("residentialPostalCode", e.target.value)}
                        placeholder="e.g. 560001"
                      />
                    </label>
                  </div>

                  <h3 style={{ margin: "20px 0 12px", fontSize: "14px", color: "#0f172a", borderTop: "1px solid #f1f5f9", paddingTop: "16px" }}>
                    Emergency Contact
                  </h3>
                  <div className="edit-form-grid" style={{ marginBottom: "20px" }}>
                    <label className="form-group">
                      Contact Name
                      <input
                        type="text"
                        value={formData.emergencyName}
                        onChange={(e) => handleInputChange("emergencyName", e.target.value)}
                        placeholder="e.g. Rajesh Rao"
                      />
                    </label>

                    <label className="form-group">
                      Relationship
                      <input
                        type="text"
                        value={formData.emergencyRel}
                        onChange={(e) => handleInputChange("emergencyRel", e.target.value)}
                        placeholder="e.g. Spouse / Parent"
                      />
                    </label>

                    <label className="form-group">
                      Emergency Phone
                      <input
                        type="tel"
                        value={formData.emergencyPhone}
                        onChange={(e) => handleInputChange("emergencyPhone", e.target.value)}
                        placeholder="+91 98765 22222"
                      />
                    </label>
                  </div>

                  <h3 style={{ margin: "20px 0 12px", fontSize: "14px", color: "#0f172a", borderTop: "1px solid #f1f5f9", paddingTop: "16px" }}>
                    Payroll Banking & Tax Details
                  </h3>
                  <div className="edit-form-grid" style={{ marginBottom: "24px" }}>
                    <label className="form-group">
                      Account Holder Name
                      <input
                        type="text"
                        value={formData.accountHolderName}
                        onChange={(e) => handleInputChange("accountHolderName", e.target.value)}
                        placeholder="Name as registered with Bank"
                      />
                    </label>

                    <label className="form-group">
                      Bank Name
                      <input
                        type="text"
                        value={formData.bankName}
                        onChange={(e) => handleInputChange("bankName", e.target.value)}
                        placeholder="e.g. HDFC Bank"
                      />
                    </label>

                    <label className="form-group">
                      Account Number
                      <input
                        type="text"
                        value={formData.accountNumber}
                        onChange={(e) => handleInputChange("accountNumber", e.target.value)}
                        placeholder="e.g. 5010012345678"
                      />
                    </label>

                    <label className="form-group">
                      IFSC Code
                      <input
                        type="text"
                        value={formData.ifscCode}
                        onChange={(e) => handleInputChange("ifscCode", e.target.value)}
                        placeholder="e.g. HDFC0001024"
                      />
                    </label>

                    <label className="form-group">
                      Account Type
                      <select
                        value={formData.accountType}
                        onChange={(e) => handleInputChange("accountType", e.target.value)}
                        className="filter-select"
                      >
                        <option value="SAVINGS">Savings Account</option>
                        <option value="CURRENT">Current Account</option>
                        <option value="SALARY">Salary Account</option>
                      </select>
                    </label>

                    <label className="form-group">
                      PAN Number
                      <input
                        type="text"
                        value={formData.panNumber}
                        onChange={(e) => handleInputChange("panNumber", e.target.value.toUpperCase())}
                        placeholder="e.g. ABCDE1234F"
                      />
                    </label>
                  </div>

                  <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px" }}>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => setActiveTab("overview")}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="btn-primary"
                      disabled={savingProfile}
                    >
                      {savingProfile ? "Saving Profile..." : "Save Profile Changes"}
                    </button>
                  </div>
                </div>
              </section>
            </form>
          )}

          {/* TAB 3: MY DOCUMENTS (UPLOAD & DOWNLOAD) */}
          {activeTab === "documents" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "20px" }}>
              <section className="profile-card">
                <div className="profile-card-header">
                  <div className="card-header-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="16" y1="13" x2="8" y2="13" />
                      <line x1="16" y1="17" x2="8" y2="17" />
                      <polyline points="10 9 9 9 8 9" />
                    </svg>
                  </div>
                  <div>
                    <h2>My Documents & Verification Records</h2>
                    <span className="card-subtitle">Upload your identity proofs, tax filings, and certifications</span>
                  </div>
                </div>
                <div className="profile-card-body">
                  {/* Upload panel */}
                  <div
                    style={{
                      background: "#f8fafc",
                      border: "1px solid #e2e8f0",
                      borderRadius: "8px",
                      padding: "16px",
                      marginBottom: "20px",
                    }}
                  >
                    <h3 style={{ margin: "0 0 12px", fontSize: "14px", color: "#0f172a", fontWeight: "600" }}>
                      Upload New Document
                    </h3>

                    {docSuccess && (
                      <div className="success-alert" style={{ marginBottom: "12px", padding: "8px 12px", fontSize: "13px" }}>
                        {docSuccess}
                      </div>
                    )}
                    {docError && (
                      <div className="error" style={{ marginBottom: "12px", padding: "8px 12px", fontSize: "13px" }}>
                        {docError}
                      </div>
                    )}

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "12px", alignItems: "flex-end" }}>
                      <label className="form-group" style={{ margin: 0 }}>
                        <span style={{ fontSize: "12px", color: "#64748b", textTransform: "uppercase", fontWeight: "600", display: "block", marginBottom: "4px" }}>
                          Document Category *
                        </span>
                        <select
                          value={uploadCategory}
                          onChange={(e) => setUploadCategory(e.target.value)}
                          className="filter-select"
                          style={{ width: "100%", height: "38px" }}
                        >
                          <option value="ID_PROOF">ID Proof / Aadhaar / PAN</option>
                          <option value="RESUME">Resume / Updated CV</option>
                          <option value="TAX_DOCUMENT">Tax Document / Form 16</option>
                          <option value="OTHER">Other Personal Document</option>
                        </select>
                      </label>

                      <label className="form-group" style={{ margin: 0 }}>
                        <span style={{ fontSize: "12px", color: "#64748b", textTransform: "uppercase", fontWeight: "600", display: "block", marginBottom: "4px" }}>
                          Document Title
                        </span>
                        <input
                          type="text"
                          value={uploadTitle}
                          onChange={(e) => setUploadTitle(e.target.value)}
                          placeholder="e.g. Aadhaar Card Scan"
                          style={{ width: "100%", height: "38px" }}
                        />
                      </label>

                      <label className="form-group" style={{ margin: 0 }}>
                        <span style={{ fontSize: "12px", color: "#64748b", textTransform: "uppercase", fontWeight: "600", display: "block", marginBottom: "4px" }}>
                          File (PDF, PNG, JPG, DOC up to 10MB) *
                        </span>
                        <input
                          id="emp-self-file-input"
                          type="file"
                          onChange={handleFileChange}
                          accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
                          style={{ width: "100%", padding: "6px 8px", fontSize: "13px", height: "38px" }}
                        />
                      </label>

                      <div>
                        <button
                          type="button"
                          onClick={handleUploadDocument}
                          disabled={uploadingDoc || !selectedFile}
                          style={{ width: "100%", height: "38px" }}
                        >
                          {uploadingDoc ? "Uploading..." : "Upload Document"}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Documents List */}
                  <div>
                    <h3 style={{ margin: "0 0 10px", fontSize: "13px", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                      My Uploaded Documents ({documents.length})
                    </h3>

                    {documents.length === 0 ? (
                      <p style={{ margin: 0, fontSize: "13px", color: "#94a3b8", fontStyle: "italic" }}>
                        You have not uploaded any documents yet.
                      </p>
                    ) : (
                      <div className="documents-list">
                        {documents.map((doc, idx) => (
                          <div key={doc._id || idx} className="document-row" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px", borderBottom: "1px solid #f1f5f9" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                              <div className="doc-icon" aria-hidden="true" style={{ fontSize: "20px" }}>📄</div>
                              <div className="doc-meta">
                                <span className="doc-name" style={{ fontWeight: "600", color: "#0f172a", display: "block" }}>
                                  {doc.title || doc.fileName}
                                </span>
                                <span className="doc-desc" style={{ fontSize: "12px", color: "#64748b" }}>
                                  {doc.documentType?.replace("_", " ")} • {formatFileSize(doc.fileSize)} • Added{" "}
                                  {doc.uploadedAt ? new Date(doc.uploadedAt).toLocaleDateString("en-IN", { month: "short", day: "numeric", year: "numeric" }) : "Recently"}
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
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </section>
            </div>
          )}
        </>
      )}
    </main>
  );
}
