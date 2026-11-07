import { useEffect, useMemo, useState } from "react";
import AppModal from "./AppModal";
import StatusBadge from "./StatusBadge";
import api from "../services/api";

const EMPTY_SCOPE = {
  mode: "COMPANY",
  departmentIds: [],
  employeeIds: [],
};

function toggleId(list, id) {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

function togglePermission(list, key) {
  return list.includes(key) ? list.filter((x) => x !== key) : [...list, key];
}

export default function CompanyHrAccessModal({
  open,
  hrAdmin,
  onClose,
  onSaved,
}) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [catalog, setCatalog] = useState(null);
  const [options, setOptions] = useState({ departments: [], employees: [] });
  const [optionSearch, setOptionSearch] = useState("");
  const [configured, setConfigured] = useState(false);
  const [scope, setScope] = useState(EMPTY_SCOPE);
  const [permissions, setPermissions] = useState([]);
  const [reviewOpen, setReviewOpen] = useState(false);

  useEffect(() => {
    if (!open || !hrAdmin?.id) return undefined;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setLoadError("");
      setSaveError("");
      setReviewOpen(false);
      try {
        const [accessRes, optionsRes] = await Promise.all([
          api.get(`/company-admin/hr-admins/${hrAdmin.id}/access`),
          api.get("/company-admin/hr-access/options", { params: { limit: 100 } }),
        ]);
        if (cancelled) return;
        const access = accessRes.data.access;
        setCatalog(accessRes.data.catalog);
        setConfigured(Boolean(access?.configured));
        setScope(
          access?.configured
            ? {
                mode: access.employeeScope.mode,
                departmentIds: [...(access.employeeScope.departmentIds || [])],
                employeeIds: [...(access.employeeScope.employeeIds || [])],
              }
            : { ...EMPTY_SCOPE }
        );
        setPermissions(access?.configured ? [...(access.permissions || [])] : []);
        setOptions({
          departments: optionsRes.data.departments || [],
          employees: optionsRes.data.employees || [],
        });
      } catch (err) {
        if (!cancelled) {
          setLoadError(
            err.response?.data?.message || err.message || "Unable to load access configuration."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [open, hrAdmin?.id]);

  useEffect(() => {
    if (!open) return undefined;
    const handle = setTimeout(async () => {
      try {
        const res = await api.get("/company-admin/hr-access/options", {
          params: { search: optionSearch, limit: 100 },
        });
        setOptions({
          departments: res.data.departments || [],
          employees: res.data.employees || [],
        });
      } catch {
        /* keep previous options */
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [optionSearch, open]);

  const selectedDeptNames = useMemo(() => {
    const map = new Map(options.departments.map((d) => [d.id, d.name]));
    return scope.departmentIds.map((id) => map.get(id) || id);
  }, [options.departments, scope.departmentIds]);

  const selectedEmpNames = useMemo(() => {
    const map = new Map(options.employees.map((e) => [e.id, e.fullName || e.email]));
    return scope.employeeIds.map((id) => map.get(id) || id);
  }, [options.employees, scope.employeeIds]);

  const permissionLabels = useMemo(() => {
    const labels = new Map();
    for (const mod of catalog?.modules || []) {
      for (const action of mod.actions || []) {
        labels.set(action.permissionKey, `${mod.label} · ${action.label}`);
      }
    }
    return permissions.map((key) => labels.get(key) || key);
  }, [catalog, permissions]);

  const validateLocal = () => {
    if (scope.mode === "CUSTOM" && !scope.departmentIds.length && !scope.employeeIds.length) {
      return "Custom scope requires at least one department or employee.";
    }
    return "";
  };

  const openReview = () => {
    const err = validateLocal();
    if (err) {
      setSaveError(err);
      return;
    }
    setSaveError("");
    setReviewOpen(true);
  };

  const save = async () => {
    const err = validateLocal();
    if (err) {
      setSaveError(err);
      return;
    }
    setSaving(true);
    setSaveError("");
    try {
      const payload = {
        employeeScope: {
          mode: scope.mode,
          departmentIds: scope.mode === "COMPANY" ? [] : scope.departmentIds,
          employeeIds: scope.mode === "COMPANY" ? [] : scope.employeeIds,
        },
        permissions,
      };
      const res = await api.put(`/company-admin/hr-admins/${hrAdmin.id}/access`, payload);
      onSaved?.(res.data.access);
      onClose?.();
    } catch (e) {
      setSaveError(e.response?.data?.message || e.message || "Failed to save access configuration.");
      setReviewOpen(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppModal
      open={open}
      onClose={() => (!saving ? onClose?.() : null)}
      title="Configure HR Admin access"
      subtitle={
        hrAdmin
          ? `${hrAdmin.fullName || "HR Admin"} · ${hrAdmin.email || ""}`
          : "Who they can see and what they can do"
      }
      size="lg"
      locked={saving}
      footer={
        reviewOpen ? (
          <>
            <button
              type="button"
              className="btn-secondary"
              disabled={saving}
              onClick={() => setReviewOpen(false)}
            >
              Back
            </button>
            <button type="button" className="btn-primary" disabled={saving} onClick={save}>
              {saving ? "Saving…" : "Confirm & save"}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn-secondary"
              disabled={saving || loading}
              onClick={() => onClose?.()}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={saving || loading || Boolean(loadError)}
              onClick={openReview}
            >
              Review & save
            </button>
          </>
        )
      }
    >
      {loading ? (
        <p className="ca-empty" style={{ margin: 0 }}>
          Loading configuration…
        </p>
      ) : loadError ? (
        <p className="error" role="alert" style={{ margin: 0 }}>
          {loadError}
        </p>
      ) : reviewOpen ? (
        <div className="auth-form">
          <p style={{ marginTop: 0 }}>
            Status:{" "}
            <StatusBadge
              status={configured ? "ACTIVE" : "PENDING"}
              label={configured ? "Updating existing access" : "First-time setup"}
            />
          </p>
          <div className="form-group">
            <label>Who they can see</label>
            <p style={{ margin: 0 }}>
              {scope.mode === "COMPANY"
                ? "Entire company"
                : `${selectedDeptNames.length} department(s), ${selectedEmpNames.length} employee(s)`}
            </p>
            {scope.mode === "CUSTOM" ? (
              <p style={{ margin: "8px 0 0", color: "var(--muted)", fontSize: 13 }}>
                {[...selectedDeptNames, ...selectedEmpNames].slice(0, 12).join(", ") || "—"}
                {selectedDeptNames.length + selectedEmpNames.length > 12 ? "…" : ""}
              </p>
            ) : null}
          </div>
          <div className="form-group">
            <label>What they can do ({permissions.length})</label>
            {permissions.length === 0 ? (
              <p style={{ margin: 0, color: "var(--muted)" }}>No actions selected.</p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                {permissionLabels.slice(0, 20).map((label) => (
                  <li key={label}>{label}</li>
                ))}
                {permissionLabels.length > 20 ? <li>…and {permissionLabels.length - 20} more</li> : null}
              </ul>
            )}
          </div>
          {saveError ? (
            <p className="error" role="alert">
              {saveError}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="auth-form">
          {!configured ? (
            <div className="success-alert" style={{ marginBottom: 12 }}>
              This HR Admin does not have saved access yet. Current access stays until permission
              checks are turned on. Saving here stores who they can see and what they can do.
            </div>
          ) : (
            <div className="pm-results-meta" style={{ marginBottom: 12 }}>
              Access is already set. You can change who they can see and what they can do separately.
            </div>
          )}

          {saveError ? (
            <p className="error" role="alert">
              {saveError}
            </p>
          ) : null}

          <section style={{ marginBottom: 20 }}>
            <h3 style={{ margin: "0 0 10px", fontSize: 15 }}>Who they can see</h3>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 12 }}>
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="radio"
                  name="hr-scope-mode"
                  checked={scope.mode === "COMPANY"}
                  onChange={() =>
                    setScope({ mode: "COMPANY", departmentIds: [], employeeIds: [] })
                  }
                />
                Entire company
              </label>
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="radio"
                  name="hr-scope-mode"
                  checked={scope.mode === "CUSTOM"}
                  onChange={() =>
                    setScope((prev) => ({
                      ...prev,
                      mode: "CUSTOM",
                    }))
                  }
                />
                Custom departments / employees
              </label>
            </div>

            {scope.mode === "CUSTOM" ? (
              <>
                <div className="form-group">
                  <label htmlFor="hr-access-search">Search departments & employees</label>
                  <input
                    id="hr-access-search"
                    className="form-input"
                    value={optionSearch}
                    onChange={(e) => setOptionSearch(e.target.value)}
                    placeholder="Type to filter…"
                  />
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 12,
                  }}
                >
                  <div>
                    <p className="ca-subhead" style={{ marginBottom: 8 }}>
                      Departments
                    </p>
                    <div
                      style={{
                        maxHeight: 180,
                        overflow: "auto",
                        border: "1px solid var(--hair)",
                        borderRadius: 12,
                        padding: 8,
                      }}
                    >
                      {options.departments.length === 0 ? (
                        <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
                          No departments found.
                        </p>
                      ) : (
                        options.departments.map((d) => (
                          <label
                            key={d.id}
                            style={{
                              display: "flex",
                              gap: 8,
                              alignItems: "center",
                              padding: "4px 0",
                              fontSize: 13,
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={scope.departmentIds.includes(d.id)}
                              onChange={() =>
                                setScope((prev) => ({
                                  ...prev,
                                  departmentIds: toggleId(prev.departmentIds, d.id),
                                }))
                              }
                            />
                            {d.name}
                          </label>
                        ))
                      )}
                    </div>
                  </div>
                  <div>
                    <p className="ca-subhead" style={{ marginBottom: 8 }}>
                      Employees
                    </p>
                    <div
                      style={{
                        maxHeight: 180,
                        overflow: "auto",
                        border: "1px solid var(--hair)",
                        borderRadius: 12,
                        padding: 8,
                      }}
                    >
                      {options.employees.length === 0 ? (
                        <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
                          No employees found.
                        </p>
                      ) : (
                        options.employees.map((e) => (
                          <label
                            key={e.id}
                            style={{
                              display: "flex",
                              gap: 8,
                              alignItems: "flex-start",
                              padding: "4px 0",
                              fontSize: 13,
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={scope.employeeIds.includes(e.id)}
                              onChange={() =>
                                setScope((prev) => ({
                                  ...prev,
                                  employeeIds: toggleId(prev.employeeIds, e.id),
                                }))
                              }
                            />
                            <span>
                              <strong>{e.fullName || e.email}</strong>
                              <br />
                              <span style={{ color: "var(--muted)" }}>
                                {[e.employeeCode, e.department || "No department"]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </span>
                            </span>
                          </label>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </>
            ) : null}
          </section>

          <section>
            <h3 style={{ margin: "0 0 10px", fontSize: 15 }}>What they can do</h3>
            <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--muted)" }}>
              This is separate from who they can see. View does not include edit, approve, or pay.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {(catalog?.modules || []).map((mod) => (
                <div
                  key={mod.key}
                  style={{
                    border: "1px solid var(--hair)",
                    borderRadius: 12,
                    padding: "10px 12px",
                  }}
                >
                  <strong style={{ fontSize: 13 }}>{mod.label}</strong>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "8px 14px",
                      marginTop: 8,
                    }}
                  >
                    {mod.actions.map((action) => (
                      <label
                        key={action.permissionKey}
                        style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}
                        title={action.description || ""}
                      >
                        <input
                          type="checkbox"
                          checked={permissions.includes(action.permissionKey)}
                          onChange={() =>
                            setPermissions((prev) =>
                              togglePermission(prev, action.permissionKey)
                            )
                          }
                        />
                        {action.label}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </AppModal>
  );
}
