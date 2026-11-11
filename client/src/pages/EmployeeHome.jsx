import EmployeeProfile from "./EmployeeProfile";

/**
 * Employee Portal profile entry — same shared EmployeeProfile UI as HR,
 * restricted to self-service APIs and field permissions via mode="self".
 */
export default function EmployeeHome({ defaultTab = "overview" }) {
  return <EmployeeProfile mode="self" defaultTab={defaultTab} />;
}
