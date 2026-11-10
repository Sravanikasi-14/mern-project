import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import Modal from "../../components/Modal";
import ConfirmDialog from "../../components/ConfirmDialog";
import { ErrorState, Skeleton } from "../../components/EmptyState";
import { useToast } from "../../components/Toast";
import { useAuth } from "../../app/AuthContext";
import { hrPortalAllows } from "../../utils/hrPortalAccess";
import api from "../../services/api";

const EMPTY = { title: "", grade: "", description: "" };

function apiMessage(err, fallback) {
  return err?.response?.data?.message || fallback;
}

export default function DesignationsPanel() {
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
      const res = await api.get("/designations", { params: { status: "all" } });
      setRows(res.data?.designations || []);
    } catch (err) {
      setRows([]);
      setError(apiMessage(err, "Job titles could not be loaded."));
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
      return [row.title, row.grade, row.description].some((value) =>
        String(value || "").toLowerCase().includes(needle)
      );
    });
  }, [rows, query]);

  const save = async (event) => {
    event.preventDefault();
    const title = form.title.trim();
    if (!title) {
      setFormError("Job title is required.");
      return;
    }
    setSaving(true);
    setFormError("");
    const payload = {
      title,
      grade: form.grade.trim(),
      description: form.description.trim(),
      ...(form.id ? { isActive: form.isActive !== false } : {}),
    };
    try {
      if (form.id) {
        await api.patch(`/designations/${form.id}`, payload);
        toast.push("Job title saved.");
      } else {
        await api.post("/designations", payload);
        toast.push("Job title added.");
      }
      setForm(null);
      await load();
    } catch (err) {
      setFormError(apiMessage(err, "The job title could not be saved."));
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async () => {
    if (!confirm) return;
    setSaving(true);
    try {
      await api.post(`/designations/${confirm.id}/deactivate`);
      toast.push("Job title deactivated.");
      setConfirm(null);
      await load();
    } catch (err) {
      toast.push(apiMessage(err, "Could not deactivate job title."));
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
          placeholder="Search job titles"
          aria-label="Search job titles"
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
              setForm({ ...EMPTY, isActive: true });
            }}
          >
            <Plus size={14} style={{ marginRight: 4 }} />
            Add
          </button>
        ) : null}
      </div>

      {visible.length === 0 ? <p className="caption">No job titles match.</p> : null}
      <ul className="org-list">
        {visible.map((row) => (
          <li key={row.id || row._id} className="org-list-item">
            <div>
              <strong>{row.title}</strong>
              <p className="caption" style={{ margin: "2px 0 0" }}>
                {[row.grade, row.isActive === false ? "Inactive" : "Active", row.description]
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
                      title: row.title || "",
                      grade: row.grade || "",
                      description: row.description || "",
                      isActive: row.isActive !== false,
                    });
                  }}
                >
                  Edit
                </button>
                {row.isActive !== false ? (
                  <button type="button" className="btn-secondary" onClick={() => setConfirm({ id: row.id || row._id, title: row.title })}>
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
        title={form?.id ? "Edit job title" : "New job title"}
        locked={saving}
        footer={
          <>
            <button type="button" className="btn-secondary" disabled={saving} onClick={() => setForm(null)}>
              Cancel
            </button>
            <button type="submit" form="title-form" className="btn-primary" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
          </>
        }
      >
        {form ? (
          <form id="title-form" className="stack" onSubmit={save} style={{ gap: 10 }}>
            <label className="caption">
              Title
              <input
                value={form.title}
                onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
                required
                style={{ display: "block", width: "100%", marginTop: 4, height: 40, borderRadius: 10, border: "1px solid var(--hair)", padding: "0 10px" }}
              />
            </label>
            <label className="caption">
              Grade / level
              <input
                value={form.grade}
                onChange={(e) => setForm((prev) => ({ ...prev, grade: e.target.value }))}
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
        title="Deactivate job title?"
        message={`“${confirm?.title || ""}” will be deactivated. Employee titles stay as they are.`}
        confirmLabel="Deactivate"
        danger
        busy={saving}
        onConfirm={deactivate}
      />
    </section>
  );
}
