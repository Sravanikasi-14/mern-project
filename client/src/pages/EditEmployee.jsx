import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { IconDocument } from "../components/Icons";
import api from "../services/api";

export default function EditEmployee() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});

  const [formData, setFormData] = useState({
    fullName: "",
    preferredName: "",
    employeeCode: "",
    email: "",
    personalEmail: "",
    phoneNumber: "",
    personalPhone: "",
    city: "",
    residentialAddressCity: "",
    emergencyContactName: "",
    emergencyContactRelationship: "",
    emergencyContactPhone: "",
    jobTitle: "",
    department: "",
    jobGrade: "",
    employmentType: "Full-time Permanent",
    workLocation: "",
    status: "ACTIVE",
    projectName: "",
    projectType: "MANDATE",
    monthlySalary: "",
    bankName: "",
    accountNumber: "",
    ifscCode: "",
    panNumber: "",
    taxRegime: "New Regime (Sec 115BAC)",
  });

  const [documents, setDocuments] = useState([]);
  const [uploadCategory, setUploadCategory] = useState("OFFER_LETTER");
  const [uploadTitle, setUploadTitle] = useState("");
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [docError, setDocError] = useState("");
  const [docSuccess, setDocSuccess] = useState("");
  const [downloadingDocId, setDownloadingDocId] = useState(null);

  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const fetchEmployee = async () => {
      setLoading(true);
      setError("");
      try {
        const res = await api.get(`/employees/${id}`);
        if (!cancelled && res.data) {
          const emp = res.data;
          setFormData({
            fullName: emp.fullName || "",
            preferredName: emp.preferredName || "",
            employeeCode: emp.employeeCode || "",
            email: emp.email || "",
            personalEmail: emp.personalEmail || "",
            phoneNumber: emp.phoneNumber || "",
            personalPhone: emp.personalPhone || "",
            city: emp.city || "",
            residentialAddressCity: emp.residentialAddress?.city || emp.city || "",
            emergencyContactName: emp.emergencyContact?.name || "",
            emergencyContactRelationship: emp.emergencyContact?.relationship || "",
            emergencyContactPhone: emp.emergencyContact?.phone || "",
            jobTitle: emp.job?.jobTitle || "",
            department: emp.job?.department || "",
            jobGrade: emp.job?.jobGrade || "",
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
            taxRegime: emp.taxDetails?.taxRegime || "New Regime (Sec 115BAC)",
          });
          setDocuments(emp.documents || []);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.response?.data?.message || "Failed to load employee for editing.");
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

  const handleChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setIsDirty(true);
    if (fieldErrors[field]) {
      setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
    }
    if (error) setError("");
  };

  const handleCancel = () => {
    if (isDirty) {
      const confirmLeave = window.confirm(
        "You have unsaved changes. Are you sure you want to discard them and return to the profile?"
      );
      if (!confirmLeave) return;
    }
    navigate(`/admin/employees/${id}`);
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

      const res = await api.post(`/employees/${id}/documents`, {
        documentType: uploadCategory,
        title: uploadTitle.trim() || selectedFile.name,
        fileData,
        fileName: selectedFile.name,
        mimeType: selectedFile.type || "application/octet-stream",
      });

      if (res.data?.document) {
        setDocuments((prev) => [res.data.document, ...prev]);
        setDocSuccess("Document uploaded and attached successfully!");
        setUploadTitle("");
        setSelectedFile(null);
        const fileInput = document.getElementById("edit-emp-file-input");
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

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setFieldErrors({});

    const errors = {};
    if (!formData.fullName.trim()) {
      errors.fullName = "Full name is required.";
    }

    if (formData.monthlySalary) {
      const salNum = parseFloat(formData.monthlySalary);
      if (isNaN(salNum) || salNum < 0) {
        errors.monthlySalary = "Please enter a valid non-negative monthly salary.";
      }
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setSaving(true);
    try {
      await api.patch(`/employees/${id}`, {
        fullName: formData.fullName.trim(),
        preferredName: formData.preferredName.trim(),
        personalEmail: formData.personalEmail.trim(),
        personalPhone: formData.personalPhone.trim(),
        phoneNumber: formData.phoneNumber.trim(),
        city: formData.city.trim(),
        jobTitle: formData.jobTitle.trim(),
        department: formData.department.trim(),
        jobGrade: formData.jobGrade.trim(),
        employmentType: formData.employmentType.trim(),
        workLocation: formData.workLocation.trim(),
        status: formData.status,
        projectName: formData.projectName.trim(),
        projectType: formData.projectType,
        emergencyContact: {
          name: formData.emergencyContactName.trim(),
          relationship: formData.emergencyContactRelationship.trim(),
          phone: formData.emergencyContactPhone.trim(),
        },
        residentialAddress: {
          city: formData.residentialAddressCity.trim(),
          country: "India",
        },
        bankDetails: {
          accountHolderName: formData.fullName.trim(),
          bankName: formData.bankName.trim(),
          accountNumber: formData.accountNumber.trim(),
          ifscCode: formData.ifscCode.trim(),
          accountType: "SAVINGS",
        },
        taxDetails: {
          panNumber: formData.panNumber.trim(),
          taxRegime: formData.taxRegime,
        },
        monthlySalary: formData.monthlySalary ? parseFloat(formData.monthlySalary) : undefined,
      });

      setSuccessMsg("Employee updated successfully! Redirecting...");
      setIsDirty(false);
      setTimeout(() => {
        navigate(`/admin/employees/${id}`);
      }, 900);
    } catch (err) {
      setError(err.response?.data?.message || "Unable to update employee. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <main className="container-wide">
        <div className="profile-loading-box">
          <div className="profile-spinner" aria-hidden="true" />
          <p>Loading employee details for editing...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="container-wide profile-page-container">
      {/* Breadcrumb Bar */}
      <nav className="breadcrumb-bar" aria-label="Breadcrumb">
        <Link to="/admin" className="breadcrumb-link">People Management</Link>
        <span className="breadcrumb-separator">/</span>
        <Link to="/admin" className="breadcrumb-link">Employees</Link>
        <span className="breadcrumb-separator">/</span>
        <Link to={`/admin/employees/${id}`} className="breadcrumb-link">
          {formData.fullName || "Profile"}
        </Link>
        <span className="breadcrumb-separator">/</span>
        <span className="breadcrumb-current">Edit Employee</span>
      </nav>

      {/* Top Action Header */}
      <div className="profile-top-actions">
        <button
          type="button"
          className="btn-secondary btn-sm back-btn"
          onClick={handleCancel}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          Cancel & Return to Profile
        </button>
      </div>

      <div className="edit-form-header-banner">
        <div>
          <h1 style={{ margin: "0 0 6px", fontSize: "22px", color: "#09090b" }}>
            Edit Employee: {formData.fullName}
          </h1>
          <p className="subtitle">
            Update employee personal records, job assignments, compensation, or account status.
          </p>
        </div>
        <span className="meta-tag">Code: {formData.employeeCode}</span>
      </div>

      {successMsg && <div className="success-alert">{successMsg}</div>}
      {error && <div className="error">{error}</div>}

      <form onSubmit={handleSubmit} noValidate>
        {/* Card 1: Personal & Contact Information */}
        <section className="profile-card" style={{ marginBottom: "20px" }}>
          <div className="profile-card-header">
            <div className="card-header-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </div>
            <div>
              <h2>Personal & Contact Information</h2>
              <span className="card-subtitle">Employee personal details and emergency contacts</span>
            </div>
          </div>
          <div className="profile-card-body edit-form-grid">
            <label className="form-group">
              Full Legal Name *
              <input
                type="text"
                className={fieldErrors.fullName ? "has-error" : ""}
                value={formData.fullName}
                onChange={(e) => handleChange("fullName", e.target.value)}
                placeholder="e.g. Maya Rao"
                required
              />
              {fieldErrors.fullName && (
                <span className="field-error">{fieldErrors.fullName}</span>
              )}
            </label>

            <label className="form-group">
              Preferred Name
              <input
                type="text"
                value={formData.preferredName}
                onChange={(e) => handleChange("preferredName", e.target.value)}
                placeholder="e.g. Maya"
              />
            </label>

            <label className="form-group">
              Official Work Email (System Identity)
              <input
                type="email"
                value={formData.email}
                disabled
                title="Employee work email is connected to system identity and cannot be edited directly."
                style={{ background: "#f4f4f5", cursor: "not-allowed", color: "#71717a" }}
              />
            </label>

            <label className="form-group">
              Personal Email
              <input
                type="email"
                value={formData.personalEmail}
                onChange={(e) => handleChange("personalEmail", e.target.value)}
                placeholder="e.g. personal@example.com"
              />
            </label>

            <label className="form-group">
              Official Work Phone
              <input
                type="tel"
                value={formData.phoneNumber}
                onChange={(e) => handleChange("phoneNumber", e.target.value)}
                placeholder="+91 98765 00000"
              />
            </label>

            <label className="form-group">
              Personal Phone
              <input
                type="tel"
                value={formData.personalPhone}
                onChange={(e) => handleChange("personalPhone", e.target.value)}
                placeholder="+91 98765 11111"
              />
            </label>

            <label className="form-group">
              City / Location
              <input
                type="text"
                value={formData.city}
                onChange={(e) => handleChange("city", e.target.value)}
                placeholder="e.g. Bengaluru, Karnataka"
              />
            </label>

            <label className="form-group">
              Residential City
              <input
                type="text"
                value={formData.residentialAddressCity}
                onChange={(e) => handleChange("residentialAddressCity", e.target.value)}
                placeholder="e.g. Bengaluru"
              />
            </label>

            <label className="form-group">
              Emergency Contact Name
              <input
                type="text"
                value={formData.emergencyContactName}
                onChange={(e) => handleChange("emergencyContactName", e.target.value)}
                placeholder="e.g. Rajesh Rao"
              />
            </label>

            <label className="form-group">
              Emergency Contact Relationship & Phone
              <input
                type="text"
                value={formData.emergencyContactRelationship}
                onChange={(e) => handleChange("emergencyContactRelationship", e.target.value)}
                placeholder="e.g. Spouse (+91 98765 22222)"
              />
            </label>
          </div>
        </section>

        {/* Card 2: Employment & Job Details */}
        <section className="profile-card" style={{ marginBottom: "20px" }}>
          <div className="profile-card-header">
            <div className="card-header-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
                <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
              </svg>
            </div>
            <div>
              <h2>Employment & Job Details</h2>
              <span className="card-subtitle">Role title, department, grade, and project assignment</span>
            </div>
          </div>
          <div className="profile-card-body edit-form-grid">
            <label className="form-group">
              Job Title / Designation
              <input
                type="text"
                value={formData.jobTitle}
                onChange={(e) => handleChange("jobTitle", e.target.value)}
                placeholder="e.g. Lead Frontend Engineer"
              />
            </label>

            <label className="form-group">
              Department
              <input
                type="text"
                value={formData.department}
                onChange={(e) => handleChange("department", e.target.value)}
                placeholder="e.g. Product Engineering"
              />
            </label>

            <label className="form-group">
              Job Grade
              <input
                type="text"
                value={formData.jobGrade}
                onChange={(e) => handleChange("jobGrade", e.target.value)}
                placeholder="e.g. Level L4"
              />
            </label>

            <label className="form-group">
              Employment Type
              <select
                value={formData.employmentType}
                onChange={(e) => handleChange("employmentType", e.target.value)}
                className="filter-select"
              >
                <option value="Full-time Permanent">Full-time Permanent</option>
                <option value="Contract">Contract</option>
                <option value="Internship">Internship</option>
                <option value="Part-time">Part-time</option>
              </select>
            </label>

            <label className="form-group">
              Work Location
              <input
                type="text"
                value={formData.workLocation}
                onChange={(e) => handleChange("workLocation", e.target.value)}
                placeholder="e.g. Tech Park SEZ, Bengaluru"
              />
            </label>

            <label className="form-group">
              Employment Status
              <select
                value={formData.status}
                onChange={(e) => handleChange("status", e.target.value)}
                className="filter-select"
              >
                <option value="ACTIVE">ACTIVE</option>
                <option value="INACTIVE">INACTIVE</option>
              </select>
            </label>

            <label className="form-group">
              Assigned Project Name
              <input
                type="text"
                value={formData.projectName}
                onChange={(e) => handleChange("projectName", e.target.value)}
                placeholder="e.g. Platform Modernization"
              />
            </label>

            <label className="form-group">
              Project Type
              <select
                value={formData.projectType}
                onChange={(e) => handleChange("projectType", e.target.value)}
                className="filter-select"
              >
                <option value="MANDATE">MANDATE (Dedicated Client Project)</option>
                <option value="BENCH">BENCH (Internal Reserve)</option>
                <option value="INTERNAL">INTERNAL (Internal Operations)</option>
              </select>
            </label>
          </div>
        </section>

        {/* Card 3: Compensation & Banking Details */}
        <section className="profile-card" style={{ marginBottom: "24px" }}>
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
              <h2>Compensation & Banking</h2>
              <span className="card-subtitle">Monthly salary revision and payroll disbursement accounts</span>
            </div>
          </div>
          <div className="profile-card-body edit-form-grid">
            <label className="form-group">
              Monthly CTC (₹)
              <input
                type="number"
                min="0"
                step="500"
                className={fieldErrors.monthlySalary ? "has-error" : ""}
                value={formData.monthlySalary}
                onChange={(e) => handleChange("monthlySalary", e.target.value)}
                placeholder="e.g. 85000"
              />
              {fieldErrors.monthlySalary && (
                <span className="field-error">{fieldErrors.monthlySalary}</span>
              )}
            </label>

            <label className="form-group">
              Bank Name
              <input
                type="text"
                value={formData.bankName}
                onChange={(e) => handleChange("bankName", e.target.value)}
                placeholder="e.g. HDFC Bank"
              />
            </label>

            <label className="form-group">
              Account Number
              <input
                type="text"
                value={formData.accountNumber}
                onChange={(e) => handleChange("accountNumber", e.target.value)}
                placeholder="e.g. 50100234567890"
              />
            </label>

            <label className="form-group">
              IFSC Code
              <input
                type="text"
                value={formData.ifscCode}
                onChange={(e) => handleChange("ifscCode", e.target.value)}
                placeholder="e.g. HDFC0001024"
              />
            </label>

            <label className="form-group">
              PAN Number
              <input
                type="text"
                value={formData.panNumber}
                onChange={(e) => handleChange("panNumber", e.target.value)}
                placeholder="e.g. ABCDE1234F"
              />
            </label>

            <label className="form-group">
              Tax Regime
              <select
                value={formData.taxRegime}
                onChange={(e) => handleChange("taxRegime", e.target.value)}
                className="filter-select"
              >
                <option value="New Regime (Sec 115BAC)">New Tax Regime (Sec 115BAC)</option>
                <option value="Old Regime">Old Tax Regime</option>
              </select>
            </label>
          </div>
        </section>

        {/* Card 4: Employee Documents Management */}
        <section className="profile-card" style={{ marginBottom: "24px" }}>
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
              <h2>Employee Documents Management</h2>
              <span className="card-subtitle">Upload and maintain official employment contracts, offer letters, or compliance files</span>
            </div>
          </div>
          <div className="profile-card-body">
            {/* Upload Sub-panel */}
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
                Upload Additional Document
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
                    Category *
                  </span>
                  <select
                    value={uploadCategory}
                    onChange={(e) => setUploadCategory(e.target.value)}
                    className="filter-select"
                    style={{ width: "100%", height: "38px" }}
                  >
                    <option value="OFFER_LETTER">Offer Letter</option>
                    <option value="EMPLOYMENT_CONTRACT">Employment Contract</option>
                    <option value="ID_PROOF">ID Proof / Aadhaar / PAN</option>
                    <option value="RESUME">Resume / CV</option>
                    <option value="TAX_DOCUMENT">Tax Document / Form 16</option>
                    <option value="OTHER">Other Official Document</option>
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
                    placeholder="e.g. Signed Offer Letter 2026"
                    style={{ width: "100%", height: "38px" }}
                  />
                </label>

                <label className="form-group" style={{ margin: 0 }}>
                  <span style={{ fontSize: "12px", color: "#64748b", textTransform: "uppercase", fontWeight: "600", display: "block", marginBottom: "4px" }}>
                    File (PDF, PNG, JPG, DOC up to 10MB) *
                  </span>
                  <input
                    id="edit-emp-file-input"
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

            {/* Existing Documents List */}
            <div>
              <h3 style={{ margin: "0 0 10px", fontSize: "13px", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                Current Documents on File ({documents.length})
              </h3>

              {documents.length === 0 ? (
                <p style={{ margin: 0, fontSize: "13px", color: "#94a3b8", fontStyle: "italic" }}>
                  No additional documents have been uploaded for this employee yet.
                </p>
              ) : (
                <div className="documents-list">
                  {documents.map((doc, idx) => (
                    <div key={doc._id || idx} className="document-row" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px", borderBottom: "1px solid #f1f5f9" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                        <div className="doc-icon" aria-hidden="true" style={{ display: "flex", alignItems: "center" }}>
                          <IconDocument size={20} />
                        </div>
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

        {/* Form Action Buttons */}
        <div className="edit-form-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={handleCancel}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn-primary"
            disabled={saving}
          >
            {saving ? "Saving Changes..." : "Save Changes"}
          </button>
        </div>
      </form>
    </main>
  );
}
