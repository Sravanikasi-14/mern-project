import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import api from "../services/api";

const DOCUMENT_TYPES = [
  { value: "ID_PROOF", label: "Government ID Proof (PAN / Aadhaar / Passport)" },
  { value: "ADDRESS_PROOF", label: "Address Proof" },
  { value: "EDUCATION_CERTIFICATE", label: "Highest Degree / Education Certificate" },
  { value: "PREVIOUS_RELIEVING", label: "Previous Relieving Letter / Experience" },
  { value: "OTHER", label: "Other Verification Document" },
];

export default function CandidateOnboardingPage() {
  const { token } = useParams();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);

  // Form fields
  const [personalDetails, setPersonalDetails] = useState({
    fullName: "",
    preferredName: "",
    phoneNumber: "",
    personalPhone: "",
    dateOfBirth: "",
    gender: "",
    city: "",
  });

  const [residentialAddress, setResidentialAddress] = useState({
    street: "",
    city: "",
    state: "",
    postalCode: "",
    country: "India",
  });

  const [emergencyContact, setEmergencyContact] = useState({
    name: "",
    relationship: "",
    phone: "",
  });

  const [bankDetails, setBankDetails] = useState({
    accountHolderName: "",
    bankName: "",
    accountNumber: "",
    ifscCode: "",
    accountType: "Salary Account",
  });

  const [taxDetails, setTaxDetails] = useState({
    panNumber: "",
    taxRegime: "New Tax Regime (Sec 115BAC)",
  });

  const [documents, setDocuments] = useState([]);

  // Upload modal / state
  const [selectedDocType, setSelectedDocType] = useState("ID_PROOF");
  const [docTitle, setDocTitle] = useState("");
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  // Save / Submit states
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [actionSuccess, setActionSuccess] = useState("");
  const [validationErrors, setValidationErrors] = useState({});

  useEffect(() => {
    let cancelled = false;

    const fetchOnboarding = async () => {
      try {
        setLoading(true);
        setError("");
        const res = await api.get(`/candidate/onboarding/${encodeURIComponent(token)}`);
        if (!cancelled) {
          const fetched = res.data;
          setData(fetched);
          const ob = fetched.onboarding || {};

          setPersonalDetails({
            fullName: ob.personalDetails?.fullName || fetched.offerDetails?.candidate?.fullName || "",
            preferredName: ob.personalDetails?.preferredName || "",
            phoneNumber:
              ob.personalDetails?.phoneNumber ||
              ob.personalDetails?.phone ||
              fetched.offerDetails?.candidate?.phoneNumber ||
              ob.candidate?.phoneNumber ||
              "",
            personalPhone: ob.personalDetails?.personalPhone || "",
            dateOfBirth: ob.personalDetails?.dateOfBirth ? ob.personalDetails.dateOfBirth.substring(0, 10) : "",
            gender: ob.personalDetails?.gender || "",
            city: ob.personalDetails?.city || fetched.offerDetails?.workLocation || "",
          });

          setResidentialAddress({
            street: ob.residentialAddress?.street || ob.residentialAddress?.addressLine1 || "",
            city: ob.residentialAddress?.city || "",
            state: ob.residentialAddress?.state || "",
            postalCode: ob.residentialAddress?.postalCode || "",
            country: ob.residentialAddress?.country || "India",
          });

          setEmergencyContact({
            name: ob.emergencyContact?.name || "",
            relationship: ob.emergencyContact?.relationship || "",
            phone: ob.emergencyContact?.phone || "",
          });

          setBankDetails({
            accountHolderName: ob.bankDetails?.accountHolderName || ob.personalDetails?.fullName || fetched.offerDetails?.candidate?.fullName || "",
            bankName: ob.bankDetails?.bankName || "",
            accountNumber: ob.bankDetails?.accountNumber || "",
            ifscCode: ob.bankDetails?.ifscCode || "",
            accountType: ob.bankDetails?.accountType || "Salary Account",
          });

          setTaxDetails({
            panNumber:
              ob.taxDetails?.panNumber ||
              ob.identityDetails?.panNumber ||
              ob.identityDetails?.idNumber ||
              "",
            taxRegime: ob.taxDetails?.taxRegime || "New Tax Regime (Sec 115BAC)",
          });

          setDocuments(ob.documents || []);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err.response?.data?.message ||
              "This onboarding link is invalid or has expired. Please contact HR."
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    if (token) {
      fetchOnboarding();
    } else {
      setError("No onboarding token provided.");
      setLoading(false);
    }

    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleSaveDraft = async () => {
    try {
      setSaving(true);
      setActionSuccess("");
      setValidationErrors({});

      const res = await api.put(`/candidate/onboarding/${encodeURIComponent(token)}/draft`, {
        personalDetails,
        residentialAddress,
        emergencyContact,
        bankDetails,
        taxDetails,
      });

      setActionSuccess("Draft saved successfully. You can return to complete the form anytime.");
      if (res.data.onboarding) {
        setData((prev) => ({ ...prev, onboarding: res.data.onboarding }));
      }
    } catch (err) {
      setValidationErrors({ general: err.response?.data?.message || "Failed to save draft." });
    } finally {
      setSaving(false);
    }
  };

  const handleFileUpload = async (e) => {
    e.preventDefault();
    setUploadError("");

    if (!selectedFile) {
      setUploadError("Please select a file to upload.");
      return;
    }

    if (selectedFile.size > 10 * 1024 * 1024) {
      setUploadError("File size exceeds the 10 MB limit.");
      return;
    }

    try {
      setUploading(true);

      // Convert file to base64
      const reader = new FileReader();
      const base64Promise = new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
      });
      reader.readAsDataURL(selectedFile);
      const fileData = await base64Promise;

      const res = await api.post(`/candidate/onboarding/${encodeURIComponent(token)}/documents`, {
        documentType: selectedDocType,
        title: docTitle.trim() || selectedFile.name,
        fileName: selectedFile.name,
        fileData,
        mimeType: selectedFile.type,
      });

      setDocuments(res.data.documents || []);
      setSelectedFile(null);
      setDocTitle("");
      setActionSuccess("Document uploaded successfully.");
    } catch (err) {
      setUploadError(err.response?.data?.message || "Failed to upload document.");
    } finally {
      setUploading(false);
    }
  };

  const [downloadingDocId, setDownloadingDocId] = useState(null);

  const handleViewDocument = async (doc) => {
    const docId = doc._id || doc.id || doc.storageKey;
    if (!docId) return;
    setDownloadingDocId(docId);
    try {
      const response = await api.get(
        `/candidate/onboarding/${encodeURIComponent(token)}/documents/${encodeURIComponent(docId)}/download`,
        { responseType: "blob" }
      );
      const mimeType = response.headers["content-type"] || "application/pdf";
      const blob = new Blob([response.data], { type: mimeType });
      const url = window.URL.createObjectURL(blob);
      const win = window.open(url, "_blank");
      if (!win) {
        const link = document.createElement("a");
        link.href = url;
        link.setAttribute("download", doc.fileName || doc.title || "document");
        document.body.appendChild(link);
        link.click();
        link.remove();
      }
      setTimeout(() => window.URL.revokeObjectURL(url), 60000);
    } catch (err) {
      alert("Failed to view document: " + (err.response?.data?.message || err.message));
    } finally {
      setDownloadingDocId(null);
    }
  };

  const handleDeleteDocument = async (docId) => {
    try {
      const res = await api.delete(`/candidate/onboarding/${encodeURIComponent(token)}/documents/${docId}`);
      setDocuments(res.data.documents || []);
      setActionSuccess("Document removed.");
    } catch (err) {
      setValidationErrors({ general: err.response?.data?.message || "Failed to remove document." });
    }
  };

  const handleSubmitOnboarding = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setActionSuccess("");
    setValidationErrors({});

    try {
      const res = await api.post(`/candidate/onboarding/${encodeURIComponent(token)}/submit`, {
        personalDetails,
        residentialAddress,
        emergencyContact,
        bankDetails,
        taxDetails,
      });

      setData((prev) => ({
        ...prev,
        onboarding: res.data.onboarding,
      }));
      setActionSuccess("Your onboarding information has been submitted successfully for HR review!");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      const errData = err.response?.data;
      if (errData?.errors) {
        setValidationErrors(errData.errors);
      } else {
        setValidationErrors({ general: errData?.message || "Validation failed. Please fill all required fields." });
      }
      window.scrollTo({ top: 0, behavior: "smooth" });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8fafc" }}>
        <div style={{ textAlign: "center" }}>
          <div className="spinner" style={{ width: 40, height: 40, margin: "0 auto 16px" }} />
          <p style={{ color: "#64748b", fontSize: "14px" }}>Loading onboarding portal...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8fafc", padding: "20px" }}>
        <div style={{ maxWidth: "480px", width: "100%", background: "#ffffff", padding: "36px", borderRadius: "12px", border: "1px solid #e2e8f0", textAlign: "center" }}>
          <h2 style={{ fontSize: "18px", fontWeight: "700", color: "#0f172a", margin: "0 0 8px" }}>Onboarding Link Expired or Invalid</h2>
          <p style={{ fontSize: "14px", color: "#64748b", lineHeight: "1.5", margin: "0 0 20px" }}>{error}</p>
        </div>
      </div>
    );
  }

  const { onboarding, offerDetails, company } = data;
  const isReadOnly = onboarding.status === "SUBMITTED" || onboarding.status === "APPROVED";

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", padding: "32px 16px" }}>
      <div style={{ maxWidth: "860px", margin: "0 auto" }}>
        {/* Header Banner */}
        <div style={{ background: "#ffffff", padding: "24px 32px", borderRadius: "12px", border: "1px solid #e2e8f0", marginBottom: "20px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px" }}>
          <div>
            <span style={{ fontSize: "11px", fontWeight: "700", letterSpacing: "0.5px", color: "#2563eb", textTransform: "uppercase" }}>Employee Onboarding Portal</span>
            <h1 style={{ fontSize: "22px", fontWeight: "700", color: "#0f172a", margin: "4px 0 0" }}>{company?.name || "Company"}</h1>
          </div>

          <div>
            {onboarding.status === "DRAFT" && (
              <span style={{ padding: "6px 14px", borderRadius: "20px", background: "#f1f5f9", color: "#475569", fontSize: "13px", fontWeight: "600" }}>
                Draft in Progress
              </span>
            )}
            {onboarding.status === "SUBMITTED" && (
              <span style={{ padding: "6px 14px", borderRadius: "20px", background: "#eff6ff", color: "#1d4ed8", fontSize: "13px", fontWeight: "600" }}>
                Under HR Review
              </span>
            )}
            {onboarding.status === "CHANGES_REQUESTED" && (
              <span style={{ padding: "6px 14px", borderRadius: "20px", background: "#fffbeb", color: "#b45309", fontSize: "13px", fontWeight: "600" }}>
                Updates Requested by HR
              </span>
            )}
            {onboarding.status === "APPROVED" && (
              <span style={{ padding: "6px 14px", borderRadius: "20px", background: "#ecfdf5", color: "#047857", fontSize: "13px", fontWeight: "600" }}>
                Onboarding Approved
              </span>
            )}
          </div>
        </div>

        {/* Changes Requested Callout */}
        {onboarding.status === "CHANGES_REQUESTED" && (
          <div style={{ background: "#fffbeb", border: "1px solid #fef3c7", padding: "18px 24px", borderRadius: "10px", marginBottom: "20px" }}>
            <h3 style={{ fontSize: "14px", fontWeight: "700", color: "#92400e", margin: "0 0 6px" }}>Updates Requested by HR</h3>
            <p style={{ fontSize: "13px", color: "#78350f", margin: "0 0 10px", lineHeight: "1.5" }}>
              {onboarding.correctionReason || "Please review the highlighted details or uploaded documents and resubmit."}
            </p>
            <span style={{ fontSize: "12px", color: "#b45309" }}>Please update the required fields below and click "Resubmit for Review".</span>
          </div>
        )}

        {/* Submitted Callout */}
        {onboarding.status === "SUBMITTED" && (
          <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", padding: "18px 24px", borderRadius: "10px", marginBottom: "20px" }}>
            <h3 style={{ fontSize: "14px", fontWeight: "700", color: "#1e40af", margin: "0 0 6px" }}>Submission Under Review</h3>
            <p style={{ fontSize: "13px", color: "#1e3a8a", margin: 0, lineHeight: "1.5" }}>
              Your onboarding information has been submitted. Our HR team is reviewing your details and documents. You will receive an email once your profile is approved.
            </p>
          </div>
        )}

        {/* Approved Callout */}
        {onboarding.status === "APPROVED" && (
          <div style={{ background: "#ecfdf5", border: "1px solid #a7f3d0", padding: "18px 24px", borderRadius: "10px", marginBottom: "20px" }}>
            <h3 style={{ fontSize: "14px", fontWeight: "700", color: "#065f46", margin: "0 0 6px" }}>Onboarding Approved</h3>
            <p style={{ fontSize: "13px", color: "#047857", margin: 0, lineHeight: "1.5" }}>
              Your employee record has been created! Please check your email inbox for your portal account activation link.
            </p>
          </div>
        )}

        {/* Read-Only Offer Terms */}
        <div style={{ background: "#ffffff", padding: "20px 28px", borderRadius: "10px", border: "1px solid #e2e8f0", marginBottom: "20px" }}>
          <h3 style={{ fontSize: "13px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.5px", color: "#64748b", margin: "0 0 12px" }}>
            Confirmed Employment Offer Terms (Read-Only)
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "14px", fontSize: "13px" }}>
            <div>
              <span style={{ color: "#94a3b8", display: "block", fontSize: "11px" }}>Position</span>
              <strong style={{ color: "#0f172a" }}>{offerDetails?.position}</strong>
            </div>
            <div>
              <span style={{ color: "#94a3b8", display: "block", fontSize: "11px" }}>Department</span>
              <strong style={{ color: "#0f172a" }}>{offerDetails?.department || "Core Team"}</strong>
            </div>
            <div>
              <span style={{ color: "#94a3b8", display: "block", fontSize: "11px" }}>Gross Compensation</span>
              <strong style={{ color: "#0f172a" }}>₹{Number(offerDetails?.monthlySalary || 0).toLocaleString("en-IN")} / mo</strong>
            </div>
            <div>
              <span style={{ color: "#94a3b8", display: "block", fontSize: "11px" }}>Joining Date</span>
              <strong style={{ color: "#0f172a" }}>
                {offerDetails?.joiningDate ? new Date(offerDetails.joiningDate).toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric" }) : "Scheduled"}
              </strong>
            </div>
          </div>
        </div>

        {actionSuccess && (
          <div style={{ background: "#ecfdf5", border: "1px solid #a7f3d0", padding: "12px 18px", borderRadius: "6px", color: "#065f46", fontSize: "13px", marginBottom: "20px" }}>
            {actionSuccess}
          </div>
        )}

        {validationErrors.general && (
          <div style={{ background: "#fef2f2", border: "1px solid #fecaca", padding: "12px 18px", borderRadius: "6px", color: "#b91c1c", fontSize: "13px", marginBottom: "20px" }}>
            {validationErrors.general}
          </div>
        )}

        <form onSubmit={handleSubmitOnboarding}>
          {/* Section 1: Personal Details */}
          <div style={{ background: "#ffffff", padding: "24px 28px", borderRadius: "10px", border: "1px solid #e2e8f0", marginBottom: "20px" }}>
            <h3 style={{ fontSize: "15px", fontWeight: "700", color: "#0f172a", margin: "0 0 16px" }}>1. Personal & Contact Details</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px" }}>
              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: "600", color: "#334155", marginBottom: "4px" }}>
                  Full Legal Name <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <input
                  type="text"
                  disabled={isReadOnly}
                  value={personalDetails.fullName}
                  onChange={(e) => setPersonalDetails({ ...personalDetails, fullName: e.target.value })}
                  style={{ width: "100%", padding: "8px 12px", fontSize: "13px", border: "1px solid #cbd5e1", borderRadius: "6px" }}
                />
                {validationErrors["personalDetails.fullName"] && (
                  <span style={{ color: "#dc2626", fontSize: "11px" }}>{validationErrors["personalDetails.fullName"]}</span>
                )}
              </div>

              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: "600", color: "#334155", marginBottom: "4px" }}>
                  Primary Phone Number <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <input
                  type="tel"
                  disabled={isReadOnly}
                  value={personalDetails.phoneNumber}
                  onChange={(e) => setPersonalDetails({ ...personalDetails, phoneNumber: e.target.value })}
                  placeholder="+91 98765 43210"
                  style={{ width: "100%", padding: "8px 12px", fontSize: "13px", border: "1px solid #cbd5e1", borderRadius: "6px" }}
                />
                {validationErrors["personalDetails.phoneNumber"] && (
                  <span style={{ color: "#dc2626", fontSize: "11px" }}>{validationErrors["personalDetails.phoneNumber"]}</span>
                )}
              </div>

              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: "600", color: "#334155", marginBottom: "4px" }}>
                  Date of Birth <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <input
                  type="date"
                  disabled={isReadOnly}
                  value={personalDetails.dateOfBirth}
                  onChange={(e) => setPersonalDetails({ ...personalDetails, dateOfBirth: e.target.value })}
                  style={{ width: "100%", padding: "8px 12px", fontSize: "13px", border: "1px solid #cbd5e1", borderRadius: "6px" }}
                />
                {validationErrors["personalDetails.dateOfBirth"] && (
                  <span style={{ color: "#dc2626", fontSize: "11px" }}>{validationErrors["personalDetails.dateOfBirth"]}</span>
                )}
              </div>

              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: "600", color: "#334155", marginBottom: "4px" }}>
                  Gender <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <select
                  disabled={isReadOnly}
                  value={personalDetails.gender}
                  onChange={(e) => setPersonalDetails({ ...personalDetails, gender: e.target.value })}
                  style={{ width: "100%", padding: "8px 12px", fontSize: "13px", border: "1px solid #cbd5e1", borderRadius: "6px" }}
                >
                  <option value="">Select Gender</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Non-binary">Non-binary</option>
                  <option value="Prefer not to say">Prefer not to say</option>
                </select>
                {validationErrors["personalDetails.gender"] && (
                  <span style={{ color: "#dc2626", fontSize: "11px" }}>{validationErrors["personalDetails.gender"]}</span>
                )}
              </div>
            </div>
          </div>

          {/* Section 2: Residential Address & Emergency Contact */}
          <div style={{ background: "#ffffff", padding: "24px 28px", borderRadius: "10px", border: "1px solid #e2e8f0", marginBottom: "20px" }}>
            <h3 style={{ fontSize: "15px", fontWeight: "700", color: "#0f172a", margin: "0 0 16px" }}>2. Address & Emergency Contact</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px", marginBottom: "16px" }}>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={{ display: "block", fontSize: "12px", fontWeight: "600", color: "#334155", marginBottom: "4px" }}>
                  Street Address <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <input
                  type="text"
                  disabled={isReadOnly}
                  value={residentialAddress.street}
                  onChange={(e) => setResidentialAddress({ ...residentialAddress, street: e.target.value })}
                  placeholder="Flat/House No., Street Name, Area"
                  style={{ width: "100%", padding: "8px 12px", fontSize: "13px", border: "1px solid #cbd5e1", borderRadius: "6px" }}
                />
                {validationErrors["residentialAddress.street"] && (
                  <span style={{ color: "#dc2626", fontSize: "11px" }}>{validationErrors["residentialAddress.street"]}</span>
                )}
              </div>

              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: "600", color: "#334155", marginBottom: "4px" }}>
                  City <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <input
                  type="text"
                  disabled={isReadOnly}
                  value={residentialAddress.city}
                  onChange={(e) => setResidentialAddress({ ...residentialAddress, city: e.target.value })}
                  style={{ width: "100%", padding: "8px 12px", fontSize: "13px", border: "1px solid #cbd5e1", borderRadius: "6px" }}
                />
                {validationErrors["residentialAddress.city"] && (
                  <span style={{ color: "#dc2626", fontSize: "11px" }}>{validationErrors["residentialAddress.city"]}</span>
                )}
              </div>

              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: "600", color: "#334155", marginBottom: "4px" }}>
                  State <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <input
                  type="text"
                  disabled={isReadOnly}
                  value={residentialAddress.state}
                  onChange={(e) => setResidentialAddress({ ...residentialAddress, state: e.target.value })}
                  style={{ width: "100%", padding: "8px 12px", fontSize: "13px", border: "1px solid #cbd5e1", borderRadius: "6px" }}
                />
                {validationErrors["residentialAddress.state"] && (
                  <span style={{ color: "#dc2626", fontSize: "11px" }}>{validationErrors["residentialAddress.state"]}</span>
                )}
              </div>

              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: "600", color: "#334155", marginBottom: "4px" }}>
                  Postal Code <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <input
                  type="text"
                  disabled={isReadOnly}
                  value={residentialAddress.postalCode}
                  onChange={(e) => setResidentialAddress({ ...residentialAddress, postalCode: e.target.value })}
                  style={{ width: "100%", padding: "8px 12px", fontSize: "13px", border: "1px solid #cbd5e1", borderRadius: "6px" }}
                />
                {validationErrors["residentialAddress.postalCode"] && (
                  <span style={{ color: "#dc2626", fontSize: "11px" }}>{validationErrors["residentialAddress.postalCode"]}</span>
                )}
              </div>
            </div>

            <div style={{ borderTop: "1px solid #f1f5f9", paddingTop: "16px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px" }}>
              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: "600", color: "#334155", marginBottom: "4px" }}>
                  Emergency Contact Name <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <input
                  type="text"
                  disabled={isReadOnly}
                  value={emergencyContact.name}
                  onChange={(e) => setEmergencyContact({ ...emergencyContact, name: e.target.value })}
                  style={{ width: "100%", padding: "8px 12px", fontSize: "13px", border: "1px solid #cbd5e1", borderRadius: "6px" }}
                />
                {validationErrors["emergencyContact.name"] && (
                  <span style={{ color: "#dc2626", fontSize: "11px" }}>{validationErrors["emergencyContact.name"]}</span>
                )}
              </div>

              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: "600", color: "#334155", marginBottom: "4px" }}>
                  Relationship
                </label>
                <input
                  type="text"
                  disabled={isReadOnly}
                  value={emergencyContact.relationship}
                  onChange={(e) => setEmergencyContact({ ...emergencyContact, relationship: e.target.value })}
                  placeholder="e.g. Spouse / Parent / Sibling"
                  style={{ width: "100%", padding: "8px 12px", fontSize: "13px", border: "1px solid #cbd5e1", borderRadius: "6px" }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: "600", color: "#334155", marginBottom: "4px" }}>
                  Emergency Contact Phone <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <input
                  type="tel"
                  disabled={isReadOnly}
                  value={emergencyContact.phone}
                  onChange={(e) => setEmergencyContact({ ...emergencyContact, phone: e.target.value })}
                  style={{ width: "100%", padding: "8px 12px", fontSize: "13px", border: "1px solid #cbd5e1", borderRadius: "6px" }}
                />
                {validationErrors["emergencyContact.phone"] && (
                  <span style={{ color: "#dc2626", fontSize: "11px" }}>{validationErrors["emergencyContact.phone"]}</span>
                )}
              </div>
            </div>
          </div>

          {/* Section 3: Bank & Tax Information */}
          <div style={{ background: "#ffffff", padding: "24px 28px", borderRadius: "10px", border: "1px solid #e2e8f0", marginBottom: "20px" }}>
            <h3 style={{ fontSize: "15px", fontWeight: "700", color: "#0f172a", margin: "0 0 16px" }}>3. Bank & Tax Information</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px" }}>
              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: "600", color: "#334155", marginBottom: "4px" }}>
                  Account Holder Name <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <input
                  type="text"
                  disabled={isReadOnly}
                  value={bankDetails.accountHolderName}
                  onChange={(e) => setBankDetails({ ...bankDetails, accountHolderName: e.target.value })}
                  style={{ width: "100%", padding: "8px 12px", fontSize: "13px", border: "1px solid #cbd5e1", borderRadius: "6px" }}
                />
                {validationErrors["bankDetails.accountHolderName"] && (
                  <span style={{ color: "#dc2626", fontSize: "11px" }}>{validationErrors["bankDetails.accountHolderName"]}</span>
                )}
              </div>

              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: "600", color: "#334155", marginBottom: "4px" }}>
                  Bank Name <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <input
                  type="text"
                  disabled={isReadOnly}
                  value={bankDetails.bankName}
                  onChange={(e) => setBankDetails({ ...bankDetails, bankName: e.target.value })}
                  placeholder="e.g. HDFC Bank, ICICI Bank"
                  style={{ width: "100%", padding: "8px 12px", fontSize: "13px", border: "1px solid #cbd5e1", borderRadius: "6px" }}
                />
                {validationErrors["bankDetails.bankName"] && (
                  <span style={{ color: "#dc2626", fontSize: "11px" }}>{validationErrors["bankDetails.bankName"]}</span>
                )}
              </div>

              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: "600", color: "#334155", marginBottom: "4px" }}>
                  Account Number <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <input
                  type="text"
                  disabled={isReadOnly}
                  value={bankDetails.accountNumber}
                  onChange={(e) => setBankDetails({ ...bankDetails, accountNumber: e.target.value })}
                  style={{ width: "100%", padding: "8px 12px", fontSize: "13px", border: "1px solid #cbd5e1", borderRadius: "6px" }}
                />
                {validationErrors["bankDetails.accountNumber"] && (
                  <span style={{ color: "#dc2626", fontSize: "11px" }}>{validationErrors["bankDetails.accountNumber"]}</span>
                )}
              </div>

              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: "600", color: "#334155", marginBottom: "4px" }}>
                  IFSC Code <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <input
                  type="text"
                  disabled={isReadOnly}
                  value={bankDetails.ifscCode}
                  onChange={(e) => setBankDetails({ ...bankDetails, ifscCode: e.target.value.toUpperCase() })}
                  placeholder="e.g. HDFC0001234"
                  style={{ width: "100%", padding: "8px 12px", fontSize: "13px", border: "1px solid #cbd5e1", borderRadius: "6px" }}
                />
                {validationErrors["bankDetails.ifscCode"] && (
                  <span style={{ color: "#dc2626", fontSize: "11px" }}>{validationErrors["bankDetails.ifscCode"]}</span>
                )}
              </div>

              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: "600", color: "#334155", marginBottom: "4px" }}>
                  PAN or National Tax ID <span style={{ color: "#ef4444" }}>*</span>
                </label>
                <input
                  type="text"
                  disabled={isReadOnly}
                  value={taxDetails.panNumber}
                  onChange={(e) => setTaxDetails({ ...taxDetails, panNumber: e.target.value.toUpperCase() })}
                  placeholder="e.g. ABCDE1234F"
                  style={{ width: "100%", padding: "8px 12px", fontSize: "13px", border: "1px solid #cbd5e1", borderRadius: "6px" }}
                />
                {validationErrors["taxDetails.panNumber"] && (
                  <span style={{ color: "#dc2626", fontSize: "11px" }}>{validationErrors["taxDetails.panNumber"]}</span>
                )}
              </div>
            </div>
          </div>

          {/* Section 4: Required Documents */}
          <div style={{ background: "#ffffff", padding: "24px 28px", borderRadius: "10px", border: "1px solid #e2e8f0", marginBottom: "24px" }}>
            <h3 style={{ fontSize: "15px", fontWeight: "700", color: "#0f172a", margin: "0 0 8px" }}>4. Required Verification Documents</h3>
            <p style={{ fontSize: "13px", color: "#64748b", margin: "0 0 16px" }}>
              Please upload clear copies of your ID proof, address proof, and educational/experience documents (PDF, PNG, JPG under 10 MB).
            </p>

            {validationErrors.documents && (
              <div style={{ color: "#dc2626", fontSize: "12px", marginBottom: "12px" }}>
                {validationErrors.documents}
              </div>
            )}

            {/* Document List */}
            <div style={{ marginBottom: "20px" }}>
              {documents.length === 0 ? (
                <div style={{ padding: "16px", background: "#f8fafc", borderRadius: "6px", border: "1px dashed #cbd5e1", textAlign: "center", color: "#94a3b8", fontSize: "13px" }}>
                  No documents uploaded yet. Please upload at least one required document below.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  {documents.map((doc) => {
                    const docId = doc._id || doc.id || doc.storageKey;
                    const isProcessing = downloadingDocId === docId;
                    return (
                      <div
                        key={docId}
                        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px" }}
                      >
                        <div>
                          <strong style={{ fontSize: "13px", color: "#0f172a", display: "block" }}>{doc.title || doc.fileName}</strong>
                          <span style={{ fontSize: "11px", color: "#64748b" }}>
                            {doc.documentType} • {(doc.fileSize / 1024).toFixed(1)} KB
                          </span>
                        </div>
                        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                          <button
                            type="button"
                            onClick={() => handleViewDocument(doc)}
                            disabled={isProcessing}
                            style={{
                              background: "none",
                              border: "none",
                              padding: 0,
                              fontSize: "12px",
                              color: "#2563eb",
                              textDecoration: "underline",
                              fontWeight: "500",
                              cursor: isProcessing ? "not-allowed" : "pointer",
                            }}
                          >
                            {isProcessing ? "Opening..." : "View"}
                          </button>
                          {!isReadOnly && (
                            <button
                              type="button"
                              onClick={() => handleDeleteDocument(docId)}
                              style={{ background: "transparent", border: "none", color: "#ef4444", fontSize: "12px", cursor: "pointer" }}
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Document Upload Sub-form */}
            {!isReadOnly && (
              <div style={{ background: "#f8fafc", padding: "16px 20px", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
                <h4 style={{ fontSize: "13px", fontWeight: "600", color: "#334155", margin: "0 0 12px" }}>Upload New Document</h4>
                {uploadError && (
                  <div style={{ color: "#dc2626", fontSize: "12px", marginBottom: "10px" }}>{uploadError}</div>
                )}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "12px", marginBottom: "12px" }}>
                  <div>
                    <label style={{ display: "block", fontSize: "11px", color: "#64748b", marginBottom: "4px" }}>Document Category</label>
                    <select
                      value={selectedDocType}
                      onChange={(e) => setSelectedDocType(e.target.value)}
                      style={{ width: "100%", padding: "7px 10px", fontSize: "12px", border: "1px solid #cbd5e1", borderRadius: "6px" }}
                    >
                      {DOCUMENT_TYPES.map((dt) => (
                        <option key={dt.value} value={dt.value}>{dt.label}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label style={{ display: "block", fontSize: "11px", color: "#64748b", marginBottom: "4px" }}>Document Title (Optional)</label>
                    <input
                      type="text"
                      value={docTitle}
                      onChange={(e) => setDocTitle(e.target.value)}
                      placeholder="e.g. Passport Copy, Degree Certificate"
                      style={{ width: "100%", padding: "7px 10px", fontSize: "12px", border: "1px solid #cbd5e1", borderRadius: "6px" }}
                    />
                  </div>

                  <div>
                    <label style={{ display: "block", fontSize: "11px", color: "#64748b", marginBottom: "4px" }}>File (PDF / Image / Word)</label>
                    <input
                      type="file"
                      onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                      accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
                      style={{ width: "100%", fontSize: "12px" }}
                    />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleFileUpload}
                  disabled={uploading || !selectedFile}
                  style={{ padding: "7px 16px", background: "#334155", color: "#ffffff", border: "none", borderRadius: "6px", fontSize: "12px", fontWeight: "600", cursor: uploading || !selectedFile ? "not-allowed" : "pointer" }}
                >
                  {uploading ? "Uploading..." : "Add Document"}
                </button>
              </div>
            )}
          </div>

          {/* Form Action Controls */}
          {!isReadOnly && (
            <div>
              {validationErrors.general && (
                <div style={{ background: "#fef2f2", border: "1px solid #fecaca", padding: "12px 18px", borderRadius: "6px", color: "#b91c1c", fontSize: "13px", marginBottom: "16px" }}>
                  {validationErrors.general}
                </div>
              )}
              {Object.keys(validationErrors).filter((k) => k !== "general").length > 0 && (
                <div style={{ background: "#fef2f2", border: "1px solid #fecaca", padding: "12px 18px", borderRadius: "6px", color: "#b91c1c", fontSize: "13px", marginBottom: "16px" }}>
                  Please complete all required fields highlighted in red before submitting.
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
                <button
                  type="button"
                  onClick={handleSaveDraft}
                  disabled={saving}
                  style={{ padding: "10px 20px", background: "#f8fafc", border: "1px solid #cbd5e1", borderRadius: "6px", color: "#334155", fontSize: "13px", fontWeight: "600", cursor: saving ? "not-allowed" : "pointer" }}
                >
                  {saving ? "Saving..." : "Save Progress"}
                </button>

                <button
                  type="submit"
                  disabled={submitting}
                  style={{ padding: "11px 28px", background: "#2563eb", color: "#ffffff", border: "none", borderRadius: "6px", fontSize: "14px", fontWeight: "600", cursor: submitting ? "not-allowed" : "pointer" }}
                >
                  {submitting ? "Submitting for Review..." : "Submit Onboarding for Review"}
                </button>
              </div>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
