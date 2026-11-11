import { useState } from "react";
import HrReportingView from "../organization-explorer/HrReportingView";
import DesignationsSection from "./DesignationsSection";
import StructureSection from "./StructureSection";

const PAGES = [
  { id: "reporting", label: "Who reports to whom" },
  { id: "company", label: "Company structure" },
];

const COMPANY_PARTS = [
  { id: "departments", label: "Departments", hint: "Group people into departments." },
  { id: "teams", label: "Teams", hint: "Create teams, assign members, and link them to departments." },
  { id: "titles", label: "Job titles", hint: "Keep the titles and levels people can choose from." },
];

export default function OrganizationWorkspace() {
  const [page, setPage] = useState("reporting");
  const [part, setPart] = useState("departments");

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
          {part === "departments" ? <StructureSection embedded mode="departments" /> : null}
          {part === "teams" ? <StructureSection embedded mode="teams" /> : null}
          {part === "titles" ? <DesignationsSection embedded /> : null}
        </section>
      )}
    </div>
  );
}
