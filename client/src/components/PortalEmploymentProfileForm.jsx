import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import api from "../services/api";
import DepartmentSelect from "./DepartmentSelect";
import { departmentPayload } from "./departmentAssignment";
import ReportingManagerSelect from "./ReportingManagerSelect";
import DesignationFields from "./organization-workspace/DesignationFields";

function dateInputValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function emptyForm(profile, fallbackName) {
  return {
    employeeCode: profile?.employeeCode || "",
    fullName: profile?.fullName || fallbackName || "",
    jobTitle: profile?.jobTitle || "",
    departmentId: profile?.departmentId || "",
    departmentName: profile?.department || "",
    clearDepartment: false,
    departmentTouched: false,
    jobGrade: profile?.jobGrade || "",
    joiningDate: dateInputValue(profile?.joiningDate),
    reportingManagerId: profile?.reportingManagerId || null,
    status: profile?.status || "ACTIVE",
  };
}

/**
 * Employment details for a Company Admin or HR Admin.
 * The login role is fixed. This form never collects a password or invitation token.
 */
export default function PortalEmploymentProfileForm({
  loginEmail,
  roleLabel,
  fallbackName = "",
  initialProfile = null,
  excludeEmployeeId = null,
  submitting = false,
  error = "",
  onSubmit,
}) {
  const [form, setForm] = useState(() => emptyForm(initialProfile, fallbackName));

  useEffect(() => {
    setForm(emptyForm(initialProfile, fallbackName));
  }, [initialProfile, fallbackName]);

  function setField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <form
      className="auth-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({
          fullName: form.fullName.trim(),
          jobTitle: form.jobTitle.trim(),
          ...departmentPayload({
            clearDepartment: form.departmentTouched && form.clearDepartment,
            departmentId: form.departmentTouched && !form.clearDepartment ? form.departmentId : "",
          }),
          jobGrade: form.jobGrade.trim(),
          joiningDate: form.joiningDate || null,
          reportingManagerId: form.reportingManagerId || null,
          status: form.status,
          ...(form.employeeCode.trim() ? { employeeCode: form.employeeCode.trim() } : {}),
        });
      }}
    >
      <p style={{ marginTop: 0 }}>
        This employment profile is linked to the existing {roleLabel} login. Saving it does not
        create another account or change that role.
      </p>
      {error ? (
        <div className="error" role="alert">
          {error}
        </div>
      ) : null}
      <div className="form-group">
        <label htmlFor="portal-emp-code">Employee ID</label>
        <input
          id="portal-emp-code"
          className="form-input"
          value={form.employeeCode}
          onChange={(event) => setField("employeeCode", event.target.value)}
          placeholder="Leave blank to generate one"
          autoComplete="off"
        />
      </div>
      <div className="form-group">
        <label htmlFor="portal-emp-name">Name</label>
        <input
          id="portal-emp-name"
          className="form-input"
          value={form.fullName}
          onChange={(event) => setField("fullName", event.target.value)}
          required
        />
      </div>
      <div className="form-group">
        <label htmlFor="portal-emp-email">Email</label>
        <input id="portal-emp-email" className="form-input" value={loginEmail || ""} readOnly />
      </div>
      <DesignationFields
        jobTitle={form.jobTitle}
        jobGrade={form.jobGrade}
        inputClassName="form-input"
        titleLabel="Designation"
        gradeLabel="Job level"
        disabled={submitting}
        onJobTitleChange={(value) => setField("jobTitle", value)}
        onJobGradeChange={(value) => setField("jobGrade", value)}
      />
      <DepartmentSelect
        departmentId={form.clearDepartment ? "" : form.departmentId}
        departmentName={form.clearDepartment ? "" : form.departmentName}
        linked={Boolean(form.departmentId) && !form.clearDepartment}
        disabled={submitting}
        onChange={(next) => setForm((prev) => ({
          ...prev,
          departmentId: next.departmentId,
          departmentName: next.departmentName,
          clearDepartment: next.clearDepartment && !next.departmentId,
          departmentTouched: true,
        }))}
      />
      <div className="form-group">
        <label htmlFor="portal-emp-joined">Joining date</label>
        <input
          id="portal-emp-joined"
          type="date"
          className="form-input"
          value={form.joiningDate}
          onChange={(event) => setField("joiningDate", event.target.value)}
        />
      </div>
      <ReportingManagerSelect
        value={form.reportingManagerId}
        onChange={(managerId) => setField("reportingManagerId", managerId)}
        excludeEmployeeId={excludeEmployeeId}
        description="Leave empty when this person is at the top of the reporting line."
      />
      <div className="form-group">
        <label htmlFor="portal-emp-status">Employment status</label>
        <select
          id="portal-emp-status"
          className="form-input"
          value={form.status}
          onChange={(event) => setField("status", event.target.value)}
        >
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
        </select>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? "Saving…" : "Save employment profile"}
        </button>
      </div>
    </form>
  );
}

/** Company Admin employment profile on the existing Settings → Profile tab. */
export function CompanyAdminEmploymentCard() {
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  useEffect(() => {
    let cancelled = false;
    api
      .get("/company-admin/me/employee-profile")
      .then((res) => {
        if (cancelled) return;
        setProfile(res.data?.employeeProfile || null);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.response?.data?.message || "The employment profile could not be loaded.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section
      style={{
        marginTop: 28,
        paddingTop: 20,
        borderTop: "1px solid var(--hair, #e6ede8)",
      }}
    >
      <h3 style={{ margin: "0 0 8px", fontSize: 15 }}>Employment profile</h3>
      {loading ? <p>Loading employment profile…</p> : null}
      {!loading ? (
        <>
          {profile?.id ? (
            <p style={{ marginTop: 0 }}>
              <Link to={`/admin/employees/${profile.id}`}>View employee profile</Link>
            </p>
          ) : (
            <p style={{ marginTop: 0 }}>
              No employee profile is linked yet. Saving creates one for this Company Admin login.
            </p>
          )}
          {saved ? <div className="success-alert">{saved}</div> : null}
          <PortalEmploymentProfileForm
            loginEmail={user?.email || ""}
            roleLabel="Company Admin"
            fallbackName={profile?.fullName || user?.fullName || ""}
            initialProfile={profile}
            excludeEmployeeId={profile?.id || null}
            submitting={submitting}
            error={error}
            onSubmit={async (payload) => {
              setSubmitting(true);
              setError("");
              setSaved("");
              try {
                const res = await api.put("/company-admin/me/employee-profile", payload);
                setProfile(res.data?.employeeProfile || null);
                setSaved("Employment profile saved. Your Company Admin login was not changed.");
              } catch (err) {
                setError(err.response?.data?.message || "The employment profile could not be saved.");
              } finally {
                setSubmitting(false);
              }
            }}
          />
        </>
      ) : null}
    </section>
  );
}
