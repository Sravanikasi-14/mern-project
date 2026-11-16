import AppModal from "./AppModal";
import VisibleEmployeeProfilePanel from "./organization-explorer/VisibleEmployeeProfilePanel";
import { usePeopleDiscoveryProfileQuery } from "../hooks/useEmployeeQueries";

/**
 * Employee Portal colleague detail popup (people-profile API).
 * Shows only server-authorized fields for the selected employee.
 */
export default function ColleagueProfileModal({ employeeId, open, onClose }) {
  const id = open && employeeId ? String(employeeId) : "";
  const profileQuery = usePeopleDiscoveryProfileQuery(id, { enabled: Boolean(id) });
  const employee = profileQuery.data?.employee || null;
  const accessLevel = profileQuery.data?.accessLevel || null;
  const loading = profileQuery.isLoading || (profileQuery.isFetching && !employee);
  const status = profileQuery.error?.response?.status;
  const error =
    id && profileQuery.isError
      ? status === 404
        ? "This employee could not be found."
        : profileQuery.error?.response?.data?.message || "Failed to load employee details."
      : "";

  const title = employee?.fullName || "Employee details";
  const subtitle =
    accessLevel === "BASIC"
      ? "Basic professional information"
      : "Details available based on your reporting relationship";

  return (
    <AppModal
      open={Boolean(open && id)}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      size="md"
      className="colleague-profile-modal"
    >
      <VisibleEmployeeProfilePanel
        employee={employee}
        loading={loading}
        error={error}
        errorStatus={status}
        accessLevel={accessLevel}
        onRetry={() => profileQuery.refetch()}
        onDismissError={onClose}
      />
    </AppModal>
  );
}
