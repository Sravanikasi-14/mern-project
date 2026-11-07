import AppModal from "../AppModal";
import { IconMail, IconRefresh } from "../EmployeeIcon";
import { useVisibleEmployeeProfileQuery } from "../../hooks/useEmployeeQueries";
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
 * Relationship-scoped profile modal (visible-profile API).
 * Used by Departments / Projects / Teams and employee Reporting.
 */
export default function ExplorerVisibleProfileModal({ employeeId, open, onClose }) {
  const id = open && employeeId ? String(employeeId) : "";
  const profileQuery = useVisibleEmployeeProfileQuery(id, { enabled: Boolean(id) });
  const profileEmployee = profileQuery.data?.employee || null;
  const profileLoading = profileQuery.isLoading || (profileQuery.isFetching && !profileEmployee);
  const profileStatus = profileQuery.error?.response?.status;
  const profileError =
    id && profileQuery.isError
      ? profileStatus === 404
        ? "This employee is not available in your organisation view."
        : profileQuery.error?.response?.data?.message || "Failed to load employee profile."
      : "";

  return (
    <AppModal
      open={Boolean(open && id)}
      onClose={onClose}
      title="Employee profile"
      subtitle="Details available based on your reporting relationship"
      size="md"
    >
      {profileLoading && !profileEmployee ? (
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
      ) : null}

      {profileError ? (
        <div className="pd-profile-error" role="alert">
          <p>{profileError}</p>
          {profileStatus === 404 ? (
            <button type="button" className="btn-secondary" onClick={onClose}>
              Close
            </button>
          ) : (
            <button type="button" className="btn-secondary" onClick={() => profileQuery.refetch()}>
              <IconRefresh size={16} /> Retry
            </button>
          )}
        </div>
      ) : null}

      {!profileError && profileEmployee ? (
        <div className="pd-profile">
          <div className="pd-profile-hero">
            <div className="pd-avatar pd-avatar-lg" aria-hidden="true">
              {initials(profileEmployee.fullName)}
            </div>
            <div className="pd-profile-hero-text">
              <h3>{profileEmployee.fullName || "—"}</h3>
              <p>{profileEmployee.employeeCode || "—"}</p>
            </div>
          </div>

          <div className="pd-profile-grid">
            <ProfileField label="Designation">{profileEmployee.job?.jobTitle || ""}</ProfileField>
            <ProfileField label="Department">{profileEmployee.job?.department || ""}</ProfileField>
            <ProfileField label="Work location">{profileEmployee.job?.workLocation || ""}</ProfileField>
            <ProfileField label="Reporting manager">
              {managerLabel(
                profileEmployee.job?.reportingManagerId ?? profileEmployee.reportingManagerId
              )}
            </ProfileField>
            <ProfileField label="Official email" span2>
              {profileEmployee.email ? (
                <a href={`mailto:${profileEmployee.email}`}>
                  <IconMail size={14} /> {profileEmployee.email}
                </a>
              ) : (
                ""
              )}
            </ProfileField>
            <ProfileField label="Official phone">{profileEmployee.phoneNumber || ""}</ProfileField>
            <ProfileField label="Employment type">
              {profileEmployee.job?.employmentType || ""}
            </ProfileField>
            <ProfileField label="Joining date">
              {formatJoiningDate(profileEmployee.job?.joiningDate)}
            </ProfileField>
          </div>
        </div>
      ) : null}
    </AppModal>
  );
}
