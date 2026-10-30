import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import PageHeader from "../../components/PageHeader";
import StatusBadge from "../../components/StatusBadge";
import SegmentedTabs from "../../components/SegmentedTabs";
import EmptyState, { ErrorState, Skeleton } from "../../components/EmptyState";
import SoftRefresh from "../../components/SoftRefresh";
import Icon from "../../components/Icon";
import { useToast } from "../../components/Toast";
import { initialsFrom } from "../../components/SummaryRow";
import api from "../../services/api";
import { formatDisplayDate } from "../../utils/dateUtils";
import { useProfileQuery } from "../../hooks/useEmployeeQueries";
import { invalidateProfile } from "../../app/queryKeys";

const emptyForm = {
  preferredName: "",
  personalEmail: "",
  phoneNumber: "",
  personalPhone: "",
  dateOfBirth: "",
  gender: "",
  city: "",
  street: "",
  state: "",
  postalCode: "",
};

function toDateInput(value) {
  if (!value) return "";
  const text = String(value);
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : "";
}

function addressLine(emp) {
  const parts = [
    emp?.residentialAddress?.street,
    emp?.residentialAddress?.city || emp?.city,
    emp?.residentialAddress?.state,
    emp?.residentialAddress?.postalCode,
  ].filter(Boolean);
  return parts.join(", ");
}

function formFromProfile(emp) {
  return {
    preferredName: emp?.preferredName || "",
    personalEmail: emp?.personalEmail || "",
    phoneNumber: emp?.phoneNumber || "",
    personalPhone: emp?.personalPhone || "",
    dateOfBirth: toDateInput(emp?.dateOfBirth),
    gender: emp?.gender && emp.gender !== "Not specified" ? emp.gender : "",
    city: emp?.residentialAddress?.city || emp?.city || "",
    street: emp?.residentialAddress?.street || "",
    state: emp?.residentialAddress?.state || "",
    postalCode: emp?.residentialAddress?.postalCode || "",
  };
}

function isValidEmail(value) {
  if (!value) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export default function EmployeeProfilePage({ documentsOnly = false }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const editing = params.get("edit") === "1";
  const profileQuery = useProfileQuery();
  const profile = useMemo(() => {
    const emp = profileQuery.data?.profile || null;
    if (!emp) return null;
    const docs = profileQuery.data?.documents;
    if (Array.isArray(docs) && docs.length && !emp.documents?.length) {
      return { ...emp, documents: docs };
    }
    return emp;
  }, [profileQuery.data]);
  const attendance = profileQuery.data?.dashboard?.attendance || null;
  const loading = profileQuery.isLoading && !profile;
  const error = profileQuery.error?.response?.data?.message || profileQuery.error?.message || "";
  const [form, setForm] = useState(emptyForm);
  const [fieldErrors, setFieldErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState("");
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadCategory, setUploadCategory] = useState("ID_PROOF");
  const [uploadFile, setUploadFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const requestedTab = documentsOnly ? "documents" : (params.get("tab") || "overview");
  const [tab, setTab] = useState(requestedTab);

  const load = () => profileQuery.refetch();

  useEffect(() => {
    if (profile) setForm(formFromProfile(profile));
  }, [profile]);

  useEffect(() => {
    setTab(documentsOnly ? "documents" : (params.get("tab") || "overview"));
  }, [documentsOnly, params]);

  const docs = useMemo(() => (Array.isArray(profile?.documents) ? profile.documents : []), [profile]);
  const job = profile?.job || {};
  const manager = job.reportingManagerId;
  const managerName = typeof manager === "object" ? manager?.fullName : "";

  const setTabAndUrl = (next) => {
    setTab(next);
    if (documentsOnly) {
      if (next !== "documents") navigate(next === "overview" ? "/app/profile" : `/app/profile?tab=${next}`);
      return;
    }
    const nextParams = new URLSearchParams(params);
    if (next === "overview") nextParams.delete("tab");
    else nextParams.set("tab", next);
    nextParams.delete("edit");
    setParams(nextParams, { replace: true });
  };

  const openEdit = () => setParams({ edit: "1" });
  const closeEdit = () => {
    setForm(formFromProfile(profile));
    setFieldErrors({});
    setParams({}, { replace: true });
  };

  const save = async (event) => {
    event.preventDefault();
    if (saving) return;
    const errors = {};
    if (form.personalEmail && !isValidEmail(form.personalEmail.trim())) {
      errors.personalEmail = "Enter a valid email address.";
    }
    if (form.phoneNumber && !/\d{6,}/.test(form.phoneNumber)) {
      errors.phoneNumber = "Enter a valid phone number.";
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;
    try {
      setSaving(true);
      setError("");
      await api.patch("/employees/me", {
        preferredName: form.preferredName.trim(),
        personalEmail: form.personalEmail.trim(),
        phoneNumber: form.phoneNumber.trim(),
        personalPhone: form.personalPhone.trim(),
        dateOfBirth: form.dateOfBirth || null,
        gender: form.gender,
        city: form.city.trim(),
        residentialAddress: {
          street: form.street.trim(),
          city: form.city.trim(),
          state: form.state.trim(),
          postalCode: form.postalCode.trim(),
          country: "India",
        },
      });
      toast.push("Profile saved.");
      closeEdit();
      await invalidateProfile(queryClient);
    } catch (err) {
      setFieldErrors({ form: err.response?.data?.message || "Could not save profile." });
    } finally {
      setSaving(false);
    }
  };

  const uploadDoc = async (event) => {
    event.preventDefault();
    if (uploading) return;
    if (!uploadFile) {
      setUploadError("Please select a file to upload.");
      return;
    }
    if (uploadFile.size > 10 * 1024 * 1024) {
      setUploadError("File size exceeds 10MB limit.");
      return;
    }
    try {
      setUploading(true);
      setUploadError("");
      const fileData = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(uploadFile);
      });
      await api.post("/employees/me/documents", {
        documentType: uploadCategory,
        title: uploadTitle.trim() || uploadFile.name,
        fileData,
        fileName: uploadFile.name,
        mimeType: uploadFile.type || "application/octet-stream",
      });
      toast.push("Document uploaded.");
      setUploadTitle("");
      setUploadFile(null);
      event.target.reset?.();
      await invalidateProfile(queryClient);
    } catch (err) {
      setUploadError(err.response?.data?.message || "Failed to upload document.");
    } finally {
      setUploading(false);
    }
  };

  const downloadDoc = async (doc) => {
    const id = doc._id || doc.id;
    if (!id) return;
    try {
      setDownloading(id);
      const response = await api.get(`/employees/me/documents/${id}/download`, { responseType: "blob" });
      const type = response.headers["content-type"] || "";
      if (type.includes("application/json")) {
        throw new Error("Could not download this document.");
      }
      const url = URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = doc.fileName || doc.title || "document";
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Could not download this document.");
    } finally {
      setDownloading("");
    }
  };

  const title = editing ? "Edit Profile" : documentsOnly && tab === "documents" ? "Documents" : "My Profile";
  if (loading) return <><PageHeader title={title} back /><Skeleton /></>;
  if (error && !profile) return <><PageHeader title="My Profile" back /><ErrorState message={error} onRetry={load} /></>;
  const refreshing = profileQuery.isFetching && Boolean(profile);
  if (!profile) return <><PageHeader title="My Profile" back /><ErrorState message="Employee record not found." onRetry={load} /></>;

  if (editing) {
    return (
      <>
        <PageHeader title="Edit Profile" back />
        <form className="form-grid pf-form" onSubmit={save} noValidate>
          {fieldErrors.form ? <div className="alert alert-error">{fieldErrors.form}</div> : null}
          <section className="pf-card pf-edit-hero">
            <span className="pf-avatar">{initialsFrom(profile.fullName)}</span>
            <span>
              <strong>{profile.fullName}</strong>
              <em>{profile.employeeCode}{job.jobTitle ? ` · ${job.jobTitle}` : ""}</em>
            </span>
          </section>
          <label>
            Preferred name
            <input
              value={form.preferredName}
              onChange={(event) => setForm((prev) => ({ ...prev, preferredName: event.target.value }))}
            />
          </label>
          <label>
            Phone number
            <input
              type="tel"
              value={form.phoneNumber}
              onChange={(event) => setForm((prev) => ({ ...prev, phoneNumber: event.target.value }))}
            />
            {fieldErrors.phoneNumber ? <span className="field-error">{fieldErrors.phoneNumber}</span> : null}
          </label>
          <label>
            Personal phone
            <input
              type="tel"
              value={form.personalPhone}
              onChange={(event) => setForm((prev) => ({ ...prev, personalPhone: event.target.value }))}
            />
          </label>
          <label>
            Personal email
            <input
              type="email"
              value={form.personalEmail}
              onChange={(event) => setForm((prev) => ({ ...prev, personalEmail: event.target.value }))}
            />
            {fieldErrors.personalEmail ? <span className="field-error">{fieldErrors.personalEmail}</span> : null}
          </label>
          <label>
            Date of birth
            <input
              type="date"
              value={form.dateOfBirth}
              onChange={(event) => setForm((prev) => ({ ...prev, dateOfBirth: event.target.value }))}
            />
          </label>
          <label>
            Gender
            <select value={form.gender} onChange={(event) => setForm((prev) => ({ ...prev, gender: event.target.value }))}>
              <option value="">Select</option>
              <option value="Female">Female</option>
              <option value="Male">Male</option>
              <option value="Non-binary">Non-binary</option>
              <option value="Prefer not to say">Prefer not to say</option>
            </select>
          </label>
          <label>
            Street
            <input value={form.street} onChange={(event) => setForm((prev) => ({ ...prev, street: event.target.value }))} />
          </label>
          <label>
            City
            <input value={form.city} onChange={(event) => setForm((prev) => ({ ...prev, city: event.target.value }))} />
          </label>
          <div className="leave-date-pair">
            <label>
              State
              <input value={form.state} onChange={(event) => setForm((prev) => ({ ...prev, state: event.target.value }))} />
            </label>
            <label>
              Postal code
              <input value={form.postalCode} onChange={(event) => setForm((prev) => ({ ...prev, postalCode: event.target.value }))} />
            </label>
          </div>
          <button type="submit" className="btn-primary btn-block" disabled={saving}>
            {saving ? "Saving..." : "Save Changes"}
          </button>
          <button type="button" className="btn-secondary btn-block" onClick={closeEdit}>Cancel</button>
        </form>
      </>
    );
  }

  const today = attendance?.today || {};
  const summary = attendance?.summary || {};

  return (
    <div className="pf-page">
      <PageHeader title={title} back />
      {refreshing ? (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
          <SoftRefresh active />
        </div>
      ) : null}
      {error ? <div className="alert alert-error">{error}</div> : null}

      <section className="pf-card pf-hero">
        <span className="pf-avatar">{initialsFrom(profile.fullName)}</span>
        <span className="pf-hero-body">
          <strong>{profile.preferredName || profile.fullName}</strong>
          <em>
            {[profile.employeeCode, job.jobTitle].filter(Boolean).join(" · ") || "Team member"}
          </em>
          {profile.status ? <StatusBadge status={profile.status} /> : null}
        </span>
        <button type="button" className="icon-btn" aria-label="Edit Profile" onClick={openEdit}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
          </svg>
        </button>
      </section>

      <SegmentedTabs
        value={tab}
        onChange={setTabAndUrl}
        options={[
          { value: "overview", label: "Overview" },
          { value: "documents", label: "Documents" },
          { value: "attendance", label: "Attendance" },
        ]}
      />

      {tab === "overview" ? (
        <>
          <div className="pf-section-head">
            <h2>Personal information</h2>
          </div>
          <div className="pf-list">
            <div className="pf-row">
              <span className="pf-row-icon"><Icon name="profile" size={16} /></span>
              <span>
                <small>Work email</small>
                <strong>{profile.email || "—"}</strong>
              </span>
            </div>
            {profile.personalEmail ? (
              <div className="pf-row">
                <span className="pf-row-icon"><Icon name="profile" size={16} /></span>
                <span>
                  <small>Personal email</small>
                  <strong>{profile.personalEmail}</strong>
                </span>
              </div>
            ) : null}
            <div className="pf-row">
              <span className="pf-row-icon"><Icon name="clock" size={16} /></span>
              <span>
                <small>Phone number</small>
                <strong>{profile.phoneNumber || "—"}</strong>
              </span>
            </div>
            {profile.dateOfBirth ? (
              <div className="pf-row">
                <span className="pf-row-icon"><Icon name="leave" size={16} /></span>
                <span>
                  <small>Date of birth</small>
                  <strong>{formatDisplayDate(profile.dateOfBirth)}</strong>
                </span>
              </div>
            ) : null}
            {addressLine(profile) ? (
              <div className="pf-row">
                <span className="pf-row-icon"><Icon name="location" size={16} /></span>
                <span>
                  <small>Location</small>
                  <strong>{addressLine(profile)}</strong>
                </span>
              </div>
            ) : null}
          </div>

          <div className="pf-section-head">
            <h2>Employment details</h2>
            {job.employmentType ? <span>{job.employmentType}</span> : null}
          </div>
          <div className="pf-list">
            {job.department ? (
              <div className="pf-row">
                <span className="pf-row-icon"><Icon name="work" size={16} /></span>
                <span>
                  <small>Department</small>
                  <strong>{job.department}</strong>
                </span>
              </div>
            ) : null}
            {managerName ? (
              <div className="pf-row">
                <span className="pf-row-icon"><Icon name="profile" size={16} /></span>
                <span>
                  <small>Reporting manager</small>
                  <strong>{managerName}</strong>
                </span>
              </div>
            ) : null}
            {job.joiningDate ? (
              <div className="pf-row">
                <span className="pf-row-icon"><Icon name="leave" size={16} /></span>
                <span>
                  <small>Date of joining</small>
                  <strong>{formatDisplayDate(job.joiningDate)}</strong>
                </span>
              </div>
            ) : null}
            {job.workLocation ? (
              <div className="pf-row">
                <span className="pf-row-icon"><Icon name="location" size={16} /></span>
                <span>
                  <small>Work location</small>
                  <strong>{job.workLocation}</strong>
                </span>
              </div>
            ) : null}
            {job.jobTitle ? (
              <div className="pf-row">
                <span className="pf-row-icon"><Icon name="work" size={16} /></span>
                <span>
                  <small>Job title</small>
                  <strong>{job.jobTitle}</strong>
                </span>
              </div>
            ) : null}
          </div>
        </>
      ) : null}

      {tab === "documents" ? (
        <>
          <form className="form-grid" onSubmit={uploadDoc}>
            {uploadError ? <div className="alert alert-error">{uploadError}</div> : null}
            <label>
              Category
              <select value={uploadCategory} onChange={(event) => setUploadCategory(event.target.value)}>
                <option value="ID_PROOF">ID Proof (PAN, Aadhaar, Passport)</option>
                <option value="ADDRESS_PROOF">Address Proof</option>
                <option value="EDUCATION">Educational Certificate</option>
                <option value="CERTIFICATION">Professional Certification</option>
                <option value="OTHER">Other Official Document</option>
              </select>
            </label>
            <label>
              Document title
              <input
                value={uploadTitle}
                onChange={(event) => setUploadTitle(event.target.value)}
                placeholder="e.g. Updated Aadhaar Card"
              />
            </label>
            <label>
              File (PDF, PNG, JPG — max 10MB)
              <input
                type="file"
                accept=".pdf,.png,.jpg,.jpeg"
                onChange={(event) => setUploadFile(event.target.files?.[0] || null)}
              />
            </label>
            <button type="submit" className="btn-primary" disabled={uploading || !uploadFile}>
              {uploading ? "Uploading..." : "Upload document"}
            </button>
          </form>
          {docs.length === 0 ? (
            <EmptyState message="No documents on file." />
          ) : (
            <div className="pf-list">
              {docs.map((doc) => (
                <button
                  key={doc._id || doc.title}
                  type="button"
                  className="pf-row"
                  onClick={() => downloadDoc(doc)}
                  disabled={Boolean(downloading)}
                >
                  <span className="pf-row-icon"><Icon name="documents" size={16} /></span>
                  <span className="pf-row-body">
                    <strong>{doc.title || doc.fileName || doc.category || "Document"}</strong>
                    <small>{doc.status || doc.category || ""}</small>
                  </span>
                  <em className="pf-download">{downloading === (doc._id || doc.id) ? "..." : "Download"}</em>
                </button>
              ))}
            </div>
          )}
        </>
      ) : null}

      {tab === "attendance" ? (
        <div className="pf-list">
          <div className="pf-row">
            <span className="pf-row-icon"><Icon name="clock" size={16} /></span>
            <span>
              <small>Today</small>
              <strong>{today.status ? <StatusBadge status={today.status} /> : "—"}</strong>
            </span>
          </div>
          {Number.isFinite(Number(summary.daysPresent)) ? (
            <div className="pf-row">
              <span className="pf-row-icon"><Icon name="leave" size={16} /></span>
              <span>
                <small>Days present</small>
                <strong>
                  {summary.daysPresent}
                  {Number.isFinite(Number(summary.totalWorkingDays)) ? ` / ${summary.totalWorkingDays}` : ""}
                </strong>
              </span>
            </div>
          ) : null}
          {Number.isFinite(Number(summary.attendanceRate)) ? (
            <div className="pf-row">
              <span className="pf-row-icon"><Icon name="reports" size={16} /></span>
              <span>
                <small>Attendance rate</small>
                <strong>{Number(summary.attendanceRate)}%</strong>
              </span>
            </div>
          ) : null}
          <button type="button" className="btn-secondary btn-block" onClick={() => navigate("/app/attendance")}>
            Open attendance
          </button>
        </div>
      ) : null}
    </div>
  );
}
