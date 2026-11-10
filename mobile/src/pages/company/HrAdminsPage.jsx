import { useCallback, useEffect, useState } from "react";
import PageHeader from "../../components/PageHeader";
import { ErrorState, Skeleton } from "../../components/EmptyState";
import SoftRefresh from "../../components/SoftRefresh";
import StatusBadge from "../../components/StatusBadge";
import { useToast } from "../../components/Toast";
import api from "../../services/api";

function apiMessage(err, fallback) {
  return err?.response?.data?.message || fallback;
}

/**
 * Company Admin — list HR Admins and open access details.
 * Uses existing /company-admin/hr-admins APIs (no new backend).
 */
export default function CompanyHrAdminsPage() {
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [access, setAccess] = useState(null);
  const [accessLoading, setAccessLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get("/company-admin/hr-admins", { params: { page: 1, limit: 50, status: "ALL" } });
      setItems(res.data?.items || res.data?.hrAdmins || []);
    } catch (err) {
      setItems([]);
      setError(apiMessage(err, "HR Admins could not be loaded."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openAccess = async (hr) => {
    setSelected(hr);
    setAccess(null);
    setAccessLoading(true);
    try {
      const res = await api.get(`/company-admin/hr-admins/${hr.id}/access`);
      setAccess(res.data);
    } catch (err) {
      toast.push(apiMessage(err, "Could not load HR access."));
    } finally {
      setAccessLoading(false);
    }
  };

  if (loading && !items.length && !error) {
    return (
      <>
        <PageHeader title="HR Admins" back backFallback="/company" />
        <Skeleton />
      </>
    );
  }

  if (error && !items.length) {
    return (
      <>
        <PageHeader title="HR Admins" back backFallback="/company" />
        <ErrorState message={error} onRetry={load} />
      </>
    );
  }

  return (
    <div className="page-pad">
      <PageHeader title="HR Admins" back backFallback="/company" />
      {loading ? <SoftRefresh active label="Refreshing" /> : null}
      <p className="caption" style={{ margin: "0 0 12px" }}>
        System roles are fixed: Company Admin, HR Admin, Employee, Candidate. Configure each HR Admin&apos;s
        module permissions here.
      </p>
      <button type="button" className="btn-secondary" style={{ marginBottom: 12 }} onClick={load}>
        Refresh
      </button>
      {items.length === 0 ? <p className="caption">No HR Admin accounts yet.</p> : null}
      <ul className="org-list">
        {items.map((hr) => (
          <li key={hr.id} className="org-list-item">
            <div>
              <strong>{hr.fullName || hr.email}</strong>
              <p className="caption" style={{ margin: "2px 0 0" }}>{hr.email}</p>
              <div style={{ marginTop: 6 }}>
                <StatusBadge status={hr.status || (hr.isActive ? "ACTIVE" : "INACTIVE")} />
              </div>
            </div>
            <button type="button" className="btn-secondary" onClick={() => openAccess(hr)}>
              Access
            </button>
          </li>
        ))}
      </ul>

      {selected ? (
        <section className="org-panel" style={{ marginTop: 16 }}>
          <h3 style={{ margin: "0 0 8px", fontSize: 15 }}>
            Access — {selected.fullName || selected.email}
          </h3>
          {accessLoading ? <p className="caption">Loading permissions…</p> : null}
          {!accessLoading && access ? (
            <div className="stack" style={{ gap: 8 }}>
              <p className="caption" style={{ margin: 0 }}>
                Scope:{" "}
                <strong style={{ color: "var(--ink)" }}>
                  {access.accessSummary?.scopeLabel || access.hrAccess?.scope?.type || "Not set"}
                </strong>
              </p>
              <p className="caption" style={{ margin: 0 }}>
                Permissions:{" "}
                <strong style={{ color: "var(--ink)" }}>
                  {(access.hrAccess?.permissions || []).length || access.accessSummary?.permissionCount || 0}
                </strong>
              </p>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {(access.hrAccess?.permissions || []).map((permission) => (
                  <li key={permission} className="caption">
                    {permission}
                  </li>
                ))}
              </ul>
              <p className="caption">
                To invite or change permissions, use the desktop Company Admin HR Management screen for
                full catalog editing. Mobile shows the live permission state.
              </p>
              <button type="button" className="btn-secondary" onClick={() => setSelected(null)}>
                Close
              </button>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
