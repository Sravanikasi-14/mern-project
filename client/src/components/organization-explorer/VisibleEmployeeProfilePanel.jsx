import AuthedAvatar from "../AuthedAvatar";
import { IconMail, IconRefresh } from "../EmployeeIcon";
import { initials } from "./explorerDisplayUtils";
import "../../pages/PeopleDirectory.css";

function formatJoiningDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function managerLabel(manager) {
  if (!manager || typeof manager !== "object") return "";
  const name = manager.fullName || "";
  const code = manager.employeeCode || "";
  if (name && code) return `${name} (${code})`;
  return name || code || "";
}

function ProfileField({ label, children, span2 = false }) {
  if (children == null || children === "") return null;
  return (
    <div className={`pd-profile-field${span2 ? " span-2" : ""}`}>
      <span className="pd-profile-label">{label}</span>
      <div className="pd-profile-value">{children}</div>
    </div>
  );
}

/**
 * Relationship-scoped employee detail body (visible-profile / people-profile).
 * Renders only fields present on the authorized payload.
 */
export default function VisibleEmployeeProfilePanel({
  employee,
  loading = false,
  error = "",
  errorStatus = null,
  accessLevel = null,
  onRetry,
  onDismissError,
}) {
  if (loading && !employee) {
    return (
      <div className="pd-profile-loading" aria-busy="true">
        <div className="pd-skeleton-row">
          <div className="skeleton-shimmer" style={{ width: 56, height: 56, borderRadius: 14 }} />
          <div style={{ flex: 1 }}>
            <div
              className="skeleton-shimmer"
              style={{ width: "45%", height: 16, borderRadius: 4, marginBottom: 10 }}
            />
            <div className="skeleton-shimmer" style={{ width: "28%", height: 12, borderRadius: 4 }} />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="pd-profile-error" role="alert">
        <p>{error}</p>
        {errorStatus === 404 ? (
          onDismissError ? (
            <button type="button" className="btn-secondary" onClick={onDismissError}>
              Close
            </button>
          ) : null
        ) : onRetry ? (
          <button type="button" className="btn-secondary" onClick={onRetry}>
            <IconRefresh size={16} /> Retry
          </button>
        ) : null}
      </div>
    );
  }

  if (!employee) return null;

  const isBasic = accessLevel === "BASIC";
  const showAvatar = Boolean(employee.avatar) && !isBasic;

  return (
    <div className="pd-profile">
      {isBasic ? (
        <p className="pd-profile-note" role="note">
          Only basic information is available for this colleague based on your reporting
          relationship.
        </p>
      ) : null}

      <div className="pd-profile-hero">
        {showAvatar ? (
          <AuthedAvatar
            className="pd-avatar pd-avatar-lg"
            employee={employee}
            avatar={employee.avatar}
            name={employee.fullName}
            initials={initials(employee.fullName)}
            alt={employee.fullName || "Employee"}
          />
        ) : (
          <span className="pd-avatar pd-avatar-lg" aria-hidden="true">
            {initials(employee.fullName)}
          </span>
        )}
        <div className="pd-profile-hero-text">
          <h3>{employee.fullName || "—"}</h3>
          <p>{employee.job?.jobTitle || employee.employeeCode || "—"}</p>
        </div>
      </div>

      <div className="pd-profile-grid">
        <ProfileField label="Designation">{employee.job?.jobTitle || ""}</ProfileField>
        <ProfileField label="Department">{employee.job?.department || ""}</ProfileField>
        <ProfileField label="Work location">{employee.job?.workLocation || ""}</ProfileField>
        <ProfileField label="Employee ID">{employee.employeeCode || ""}</ProfileField>
        <ProfileField label="Reporting manager">
          {managerLabel(employee.job?.reportingManagerId ?? employee.reportingManagerId)}
        </ProfileField>
        <ProfileField label="Official email" span2>
          {employee.email ? (
            <a href={`mailto:${employee.email}`}>
              <IconMail size={14} /> {employee.email}
            </a>
          ) : (
            ""
          )}
        </ProfileField>
        <ProfileField label="Official phone">{employee.phoneNumber || ""}</ProfileField>
        <ProfileField label="Employment type">
          {employee.job?.employmentType || ""}
        </ProfileField>
        <ProfileField label="Joining date">
          {formatJoiningDate(employee.job?.joiningDate)}
        </ProfileField>
      </div>
    </div>
  );
}
