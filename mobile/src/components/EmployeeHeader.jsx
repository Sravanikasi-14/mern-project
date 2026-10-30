import { useNavigate } from "react-router-dom";
import { useNotify } from "../app/notifyContext";
import { useAuth } from "../app/AuthContext";
import { initialsFrom } from "./SummaryRow";
import Icon from "./Icon";

export default function EmployeeHeader({
  name,
  employeeCode,
  avatarName,
  action = "notify",
  onAction,
  actionLabel,
}) {
  const navigate = useNavigate();
  const notify = useNotify();
  const { logout } = useAuth();

  const handleAction = async () => {
    if (onAction) {
      onAction();
      return;
    }
    if (action === "notify") {
      notify();
      return;
    }
    if (action === "logout") {
      try {
        const res = await logout();
        navigate("/login", {
          replace: true,
          state: res?.serverRevoked ? undefined : { logoutWarning: "You have been signed out." },
        });
      } catch {
        navigate("/login", { replace: true });
      }
    }
  };

  const label =
    actionLabel ||
    (action === "refresh" ? "Refresh" : action === "logout" ? "Sign out" : "Notifications");

  return (
    <header className="emp-id-header">
      <button type="button" className="emp-id-person" onClick={() => navigate("/app/profile")} aria-label="Open profile">
        <span className="summary-avatar emp-id-avatar">{initialsFrom(avatarName || name)}</span>
        <span className="summary-body">
          <span className="emp-id-name">{name}</span>
          {employeeCode ? <span className="summary-sub">{employeeCode}</span> : null}
        </span>
      </button>
      <button
        type="button"
        className="icon-btn emp-id-action"
        onClick={handleAction}
        aria-label={label}
      >
        <Icon
          name={action === "refresh" ? "refresh" : action === "logout" ? "logout" : "bell"}
          size={20}
        />
      </button>
    </header>
  );
}
