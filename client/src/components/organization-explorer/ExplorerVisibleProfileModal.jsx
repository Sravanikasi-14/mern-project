import AppModal from "../AppModal";
import { useVisibleEmployeeProfileQuery } from "../../hooks/useEmployeeQueries";
import VisibleEmployeeProfilePanel from "./VisibleEmployeeProfilePanel";

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
      <VisibleEmployeeProfilePanel
        employee={profileEmployee}
        loading={profileLoading}
        error={profileError}
        errorStatus={profileStatus}
        accessLevel={profileQuery.data?.accessLevel}
        onRetry={() => profileQuery.refetch()}
        onDismissError={onClose}
      />
    </AppModal>
  );
}
