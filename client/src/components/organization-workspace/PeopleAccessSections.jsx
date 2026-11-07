import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import CompanyHrAccessModal from "../CompanyHrAccessModal";
import StatusBadge from "../StatusBadge";
import { useAuth } from "../../context/AuthContext";

const SYSTEM_ROLES = [
  { role: "Company Admin", detail: "Full access to this company." },
  { role: "HR Admin", detail: "Access set by the Company Admin." },
  { role: "Employee", detail: "Access to their own records." },
  { role: "Candidate", detail: "Hiring access until they join." },
];

function apiMessage(err, fallback) {
  return err?.response?.data?.message || fallback;
}

export function RolesSection({ hrQuery, embedded = false }) {
  const { user, company } = useAuth();
  const isCompanyAdmin = user?.role === "COMPANY_ADMIN";
  const [accessAdmin, setAccessAdmin] = useState(null);
  const items = hrQuery?.data?.items || [];
  const enforcementOn = company?.hrAccessEnforcement?.mode === "ENFORCED";

  const rows = useMemo(
    () =>
      items.map((hr) => ({
        ...hr,
        permissionCount: Array.isArray(hr.hrAccess?.permissions)
          ? hr.hrAccess.permissions.length
          : hr.accessSummary?.permissionCount,
      })),
    [items]
  );

  return (
    <section className={embedded ? "ow-embedded" : "ow-panel"} aria-label="User roles and permissions">
      {!embedded ? (
        <div className="ow-section-head">
          <div>
            <h2>User roles and permissions</h2>
            <p>These four roles are fixed. Job titles and reporting lines are separate.</p>
          </div>
        </div>
      ) : null}

      <div className="ow-role-grid">
        {SYSTEM_ROLES.map((item) => (
          <article key={item.role} className="ow-role-card">
            <h3>{item.role}</h3>
            <p>{item.detail}</p>
          </article>
        ))}
      </div>

      {isCompanyAdmin ? (
        <>
          <div className="ow-section-head">
            <div>
              <h3>HR Admin permissions</h3>
              <p>
                Permission checks are {enforcementOn ? "on" : "off"}. Changing a person’s access does not turn checks on or off.
              </p>
            </div>
            <Link className="btn-secondary" to="/admin/hr-management">Open HR Management</Link>
          </div>
          {hrQuery?.isLoading ? <p className="ow-muted">Loading HR Admins…</p> : null}
          {hrQuery?.isError ? (
            <p className="ow-error" role="alert">{apiMessage(hrQuery.error, "HR Admin access could not be loaded.")}</p>
          ) : null}
          {!hrQuery?.isLoading && rows.length === 0 ? (
            <div className="ow-empty">
              <p>No HR Admins yet.</p>
            </div>
          ) : null}
          {rows.length > 0 ? (
            <div className="data-table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>HR Admin</th>
                    <th>Who they can see</th>
                    <th>Permissions</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((hr) => (
                    <tr key={hr.id}>
                      <td>
                        <strong>{hr.fullName || hr.email}</strong>
                        <div className="ow-muted">{hr.email}</div>
                      </td>
                      <td>
                        {hr.accessConfigured ? (
                          <StatusBadge status="ACTIVE" label={hr.accessSummary?.scopeLabel || "Configured"} />
                        ) : (
                          <StatusBadge status="PENDING" label="Not set" />
                        )}
                      </td>
                      <td>
                        {typeof hr.accessSummary?.permissionCount === "number"
                          ? hr.accessSummary.permissionCount
                          : hr.permissionCount ?? "—"}
                      </td>
                      <td>
                        <button type="button" className="btn-secondary btn-sm" onClick={() => setAccessAdmin(hr)}>
                          Review access
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <CompanyHrAccessModal
            open={Boolean(accessAdmin)}
            hrAdmin={accessAdmin}
            onClose={() => setAccessAdmin(null)}
            onSaved={() => {
              setAccessAdmin(null);
              hrQuery?.refetch();
            }}
          />
        </>
      ) : (
        <p className="ow-muted">
          Your access is set by the Company Admin. You can use the areas included in that access.
        </p>
      )}
    </section>
  );
}
