import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import Modal from "../../components/Modal";
import ConfirmDialog from "../../components/ConfirmDialog";
import { ErrorState, Skeleton } from "../../components/EmptyState";
import { useToast } from "../../components/Toast";
import { useAuth } from "../../app/AuthContext";
import { hrPortalAllows } from "../../utils/hrPortalAccess";
import api from "../../services/api";

const EMPTY = { name: "", code: "", description: "" };

function apiMessage(err, fallback) {
  return err?.response?.data?.message || fallback;
}

export default function DepartmentsPanel() {
  const { user, company } = useAuth();
  const toast = useToast();
  const canManage = hrPortalAllows(user, company, "organization.manage");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [confirm, setConfirm] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get("/departments", { params: { includeInactive: true } });
      setRows(res.data?.departments || []);
    } catch (err) {
      setRows([]);
      setError(apiMessage(err, "Departments could not be loaded."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (!needle) return true;
      return [row.name, row.code, row.description].some((value) =>
        String(value || "").toLowerCase().includes(needle)
      );
    });
  }, [rows, query]);

  const save = async (event) => {
    event.preventDefault();
    const name = form.name.trim();
    if (!name) {
      setFormError("Department name is required.");
      return;
    }
    setSaving(true);
    setFormError("");
    const payload = {
      name,
      code: form.code.trim(),
      description: form.description.trim(),
    };
    try {
      if (form.id) {
        await api.patch(`/departments/${form.id}`, payload);
        toast.push("Department saved.");
      } else {
        await api.post("/departments", payload);
        toast.push("Department created.");
      }
      setForm(null);
      await load();
    } catch (err) {
      setFormError(apiMessage(err, "The department could not be saved."));
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async () => {
    if (!confirm) return;
    setSaving(true);
    try {
      await api.post(`/departments/${confirm.id}/deactivate`);
      toast.push("Department deactivated.");
      setConfirm(null);
      await load();
    } catch (err) {
      toast.push(apiMessage(err, "Could not deactivate department."));
    } finally {
      setSaving(false);
    }
  };

  if (loading && !rows.length && !error) return <Skeleton />;
  if (error && !rows.length) return <ErrorState message={error} onRetry={load} />;

  return (
    <section className="org-panel">
      <div className="row-actions" style={{ gap: 8, marginBottom: 10 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search departments"
          aria-label="Search departments"
          style={{
            flex: 1,
            height: 40,
            borderRadius: 12,
            border: "1px solid var(--hair)",
            padding: "0 12px",
            font: "inherit",
          }}
        />
        <button type="button" className="btn-secondary" onClick={load} disabled={loading} aria-label="Refresh">
          <RefreshCw size={14} />
        </button>
        {canManage ? (
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              setFormError("");
              setForm({ ...EMPTY });
            }}
          >
            <Plus size={14} style={{ marginRight: 4 }} />
            Add
          </button>
        ) : null}
      </div>

      {visible.length === 0 ? <p className="caption">No departments match.</p> : null}
      <ul className="org-list">
        {visible.map((row) => (
          <li key={row.id || row._id} className="org-list-item">
            <div>
              <strong>{row.name}</strong>
              <p className="caption" style={{ margin: "2px 0 0" }}>
                {[row.code, row.isActive === false ? "Inactive" : "Active", row.description]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            {canManage ? (
              <div className="org-list-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setFormError("");
                    setForm({
                      id: row.id || row._id,
                      name: row.name || "",
                      code: row.code || "",
                      description: row.description || "",
                    });
                  }}
                >
                  Edit
                </button>
                {row.isActive !== false ? (
                  <button type="button" className="btn-secondary" onClick={() => setConfirm(row)}>
                    Deactivate
                  </button>
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      <Modal
        open={Boolean(form)}
        onClose={() => !saving && setForm(null)}
        title={form?.id ? "Edit department" : "New department"}
        locked={saving}
        footer={
          <>
            <button type="button" className="btn-secondary" disabled={saving} onClick={() => setForm(null)}>
              Cancel
            </button>
            <button type="submit" form="dept-form" className="btn-primary" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
          </>
        }
      >
        {form ? (
          <form id="dept-form" className="stack" onSubmit={save} style={{ gap: 10 }}>
            <label className="caption">
              Name
              <input
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                required
                style={{ display: "block", width: "100%", marginTop: 4, height: 40, borderRadius: 10, border: "1px solid var(--hair)", padding: "0 10px" }}
              />
            </label>
            <label className="caption">
              Code
              <input
                value={form.code}
                onChange={(e) => setForm((prev) => ({ ...prev, code: e.target.value }))}
                style={{ display: "block", width: "100%", marginTop: 4, height: 40, borderRadius: 10, border: "1px solid var(--hair)", padding: "0 10px" }}
              />
            </label>
            <label className="caption">
              Description
              <textarea
                value={form.description}
                onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                rows={3}
                style={{ display: "block", width: "100%", marginTop: 4, borderRadius: 10, border: "1px solid var(--hair)", padding: 10, font: "inherit" }}
              />
            </label>
            {formError ? <p className="caption" style={{ color: "var(--rose)" }}>{formError}</p> : null}
          </form>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        title="Deactivate department?"
        message={`“${confirm?.name || ""}” will be marked inactive. Employees are not reassigned automatically.`}
        confirmLabel="Deactivate"
        danger
        busy={saving}
        onConfirm={deactivate}
      />
    </section>
  );
}
