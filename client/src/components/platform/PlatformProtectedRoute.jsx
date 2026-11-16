import { Navigate, useLocation } from "react-router-dom";
import SessionBoot from "../SessionBoot";
import { usePlatformAuth } from "../../context/PlatformAuthContext";

export default function PlatformProtectedRoute({ children }) {
  const { isAuthenticated, loading, mfaChallenge } = usePlatformAuth();
  const location = useLocation();

  if (loading) return <SessionBoot />;

  if (mfaChallenge) {
    return (
      <Navigate
        to={mfaChallenge.requiresMfaSetup ? "/platform/mfa/setup" : "/platform/mfa"}
        replace
        state={{ from: location.pathname }}
      />
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/platform/login" replace state={{ from: location.pathname }} />;
  }

  return children;
}
