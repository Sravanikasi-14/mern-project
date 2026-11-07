import { useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useCompanyHrAdminsQuery } from "../../hooks/useCompanyAdminQueries";
import HrReportingView from "../organization-explorer/HrReportingView";
import DesignationsSection from "./DesignationsSection";
import StructureSection from "./StructureSection";
import { RolesSection } from "./PeopleAccessSections";

const PAGES = [
  { id: "reporting", label: "Who reports to whom" },
  { id: "company", label: "Company structure" },
];

const COMPANY_PARTS = [
  { id: "departments", label: "Departments and teams", hint: "Group people into departments and teams." },
  { id: "titles", label: "Job titles", hint: "Keep the titles and levels people can choose from." },
  { id: "roles", label: "User roles", hint: "Review the four fixed roles and HR Admin access." },
];

export default function OrganizationWorkspace() {
  const { user } = useAuth();
  const isCompanyAdmin = user?.role === "COMPANY_ADMIN";
  const [page, setPage] = useState("reporting");
  const [part, setPart] = useState("departments");
  const hrQuery = useCompanyHrAdminsQuery(
    { page: 1, limit: 50, status: "ALL" },
    { enabled: isCompanyAdmin && page === "company" && part === "roles" }
  );

  return (
    <div className="ow-workspace">
      <div className="ow-tabs" role="tablist" aria-label="Organization">
        {PAGES.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={page === item.id}
            className={page === item.id ? "is-active" : ""}
            onClick={() => setPage(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {page === "reporting" ? (
        <section className="ow-panel ow-reporting" aria-label="Who reports to whom">
          <HrReportingView />
        </section>
      ) : (
        <section className="ow-panel" aria-label="Company structure">
          <div className="ow-subtabs" role="tablist" aria-label="Company structure">
            {COMPANY_PARTS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={part === item.id}
                className={part === item.id ? "is-active" : ""}
                onClick={() => setPart(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <p className="ow-hint">{COMPANY_PARTS.find((item) => item.id === part)?.hint}</p>
          {part === "departments" ? <StructureSection embedded /> : null}
          {part === "titles" ? <DesignationsSection embedded /> : null}
          {part === "roles" ? <RolesSection hrQuery={hrQuery} embedded /> : null}
        </section>
      )}
    </div>
  );
}
