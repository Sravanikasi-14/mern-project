import { Navigate, useParams } from "react-router-dom";
import ColleagueProfileModal from "../components/ColleagueProfileModal";
import { usePeopleDiscoveryProfileQuery } from "../hooks/useEmployeeQueries";
import { useSmartBack } from "../hooks/useSmartBack";

/**
 * Deep-link / fallback for colleague details.
 * Renders the same AppModal popup used by Global Search (not a full page).
 */
export default function ColleagueProfilePage() {
  const { id } = useParams();
  const goBack = useSmartBack("/app/dashboard");
  const profileQuery = usePeopleDiscoveryProfileQuery(id, { enabled: Boolean(id) });

  if (profileQuery.data?.accessLevel === "SELF") {
    return <Navigate to="/app/profile" replace />;
  }

  return (
    <ColleagueProfileModal
      employeeId={id}
      open={Boolean(id)}
      onClose={goBack}
    />
  );
}
