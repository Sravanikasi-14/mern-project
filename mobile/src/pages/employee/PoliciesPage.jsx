import { useNavigate } from "react-router-dom";
import PageHeader from "../../components/PageHeader";
import MoreList from "../../components/MoreList";

const CATEGORIES = [
  { id: "work-hours", title: "Work Hours & Shifts", sub: "Your working hours and breaks", icon: "hours", path: "/app/policies/work-hours" },
  { id: "leave-types", title: "Leave Types & Rules", sub: "Leave types you can apply for", icon: "leave", path: "/app/policies/leave-types" },
  { id: "holidays", title: "Holidays", sub: "Company holiday calendar", icon: "holidays", path: "/app/policies/holidays" },
  { id: "location", title: "Location & Tracking", sub: "How punch location is used", icon: "location", path: "/app/policies/location" },
  { id: "documents", title: "Documents & Compliance", sub: "Required documents", icon: "documents", path: "/app/policies/documents" },
  { id: "impact", title: "Impact Points Rules", sub: "How points are earned", icon: "impact", path: "/app/policies/impact" },
];

export default function EmployeePoliciesPage() {
  const navigate = useNavigate();
  return (
    <>
      <PageHeader title="Company Policies" back />
      <p className="caption" style={{ marginBottom: 12 }}>Read-only view of the active company policy.</p>
      <MoreList items={CATEGORIES} onSelect={(item) => navigate(item.path)} />
    </>
  );
}
