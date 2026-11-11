import AuthedAvatar from "../AuthedAvatar";
import { departmentAccent, initials } from "./explorerDisplayUtils";

/** Compact employee card for department / project / team member lists. */
export default function ExplorerEmployeeCard({ employee, selected = false, onSelect }) {
  if (!employee) return null;
  const accent = departmentAccent(employee.department);
  return (
    <button
      type="button"
      className={`oe-person-card${selected ? " is-selected" : ""}`}
      style={{ "--dept-accent": accent }}
      onClick={() => onSelect?.(employee.id)}
    >
      <AuthedAvatar
        className="org-chart-avatar"
        employee={employee}
        avatar={employee.avatar}
        name={employee.fullName}
        initials={initials(employee.fullName)}
        alt={employee.fullName || "Employee"}
      />
      <span className="oe-person-body">
        <strong>{employee.fullName || "—"}</strong>
        <span>{employee.jobTitle || "Team member"}</span>
        <span>
          {[employee.employeeCode, employee.department].filter(Boolean).join(" · ") || "—"}
        </span>
      </span>
    </button>
  );
}
