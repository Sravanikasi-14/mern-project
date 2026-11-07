import { useEffect, useMemo, useState } from "react";
import AppModal from "../AppModal";
import api from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import { hrPortalAllows } from "../../utils/hrPortalAccess";

const EMPTY = { title: "", grade: "", description: "" };

function apiMessage(err, fallback) {
  return err?.response?.data?.message || fallback;
}

export default function DesignationsSection({ embedded = false }) {
  const { user, company } = useAuth();
  const canManage = hrPortalAllows(user, company, "organization.manage");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("active");
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [confirm, setConfirm] = useState(null);

  const load = async () => {
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
  };

  useEffect(() => {
    load();
  }, []);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (status === "active" && !row.isActive) return false;
      if (status === "inactive" && row.isActive) return false;
      if (!needle) return true;
      return [row.title, row.grade, row.description].some((value) =>
        String(value || "").toLowerCase().includes(needle)
      );
    });
  }, [rows, query, status]);

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
        setNotice("Job title saved. Current employees were not changed.");
      } else {
        await api.post("/designations", payload);
        setNotice("Job title added. Current employees were not changed.");
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
    setFormError("");
    try {
      await api.post(`/designations/${confirm.id}/deactivate`);
      setNotice("Designation deactivated. Employee job titles were left as they are.");
      setConfirm(null);
      await load();
    } catch (err) {
      setFormError(apiMessage(err, "The job title could not be deactivated."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={embedded ? "ow-embedded" : "ow-panel"} aria-label="Job titles">
      <div className="ow-section-head">
        {!embedded ? (
          <div>
            <h2>Job titles</h2>
            <p>Keep a list of titles and levels people can choose from.</p>
          </div>
        ) : null}
        <div className="ow-inline-actions">
          <button type="button" className="btn-secondary" onClick={load} disabled={loading}>Refresh</button>
          {canManage ? (
            <button type="button" className="btn-primary" onClick={() => { setFormError(""); setForm({ ...EMPTY, isActive: true }); }}>
              Add job title
            </button>
          ) : null}
        </div>
      </div>

      <div className="org-stats" aria-label="Designation summary">
        <span>Active: <strong>{loading ? "…" : rows.filter((row) => row.isActive).length}</strong></span>
        <span>Inactive: <strong>{loading ? "…" : rows.filter((row) => !row.isActive).length}</strong></span>
      </div>

      <div className="ow-toolbar">
        <input className="org-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search job titles" aria-label="Search job titles" />
        <select className="filter-select" value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Job title status">
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="all">All</option>
        </select>
      </div>

      {notice ? <p className="ow-feedback" role="status">{notice}</p> : null}
      {error ? (
        <p className="ow-error" role="alert">
          {error} <button type="button" className="btn-secondary btn-sm" onClick={load}>Retry</button>
        </p>
      ) : null}
      {!canManage ? <p className="ow-muted">You can view job titles. Adding or editing them needs organization management access.</p> : null}

      {loading ? <p className="ow-muted">Loading job titles…</p> : visible.length === 0 ? (
        <div className="ow-empty">
          <p>{rows.length === 0 ? "No job titles yet. Employees can still have a title typed on their profile." : "No job titles match this search."}</p>
        </div>
      ) : (
        <div className="data-table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Job title</th>
                <th>Level</th>
                <th>Description</th>
                <th>People</th>
                <th>Status</th>
                {canManage ? <th></th> : null}
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.id}>
                  <td><strong>{row.title}</strong></td>
                  <td>{row.grade || "—"}</td>
                  <td>{row.description || "—"}</td>
                  <td>{row.usageCount ?? 0}</td>
                  <td>{row.isActive ? "Active" : "Inactive"}</td>
                  {canManage ? (
                    <td className="ow-row-actions">
                      <button
                        type="button"
                        className="btn-secondary btn-sm"
                        onClick={() => {
                          setFormError("");
                          setForm({
                            id: row.id,
                            title: row.title || "",
                            grade: row.grade || "",
                            description: row.description || "",
                            isActive: row.isActive !== false,
                          });
                        }}
                      >
                        Edit
                      </button>
                      {row.isActive ? (
                        <button type="button" className="btn-secondary btn-sm" onClick={() => { setFormError(""); setConfirm(row); }}>
                          Deactivate
                        </button>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AppModal
        open={Boolean(form)}
        onClose={() => { if (!saving) setForm(null); }}
        title={form?.id ? "Edit job title" : "Add job title"}
        subtitle="This does not change titles already saved on employee profiles."
        locked={saving}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setForm(null)} disabled={saving}>Cancel</button>
            <button type="submit" form="designation-form" className="btn-primary" disabled={saving}>{saving ? "Saving…" : "Save job title"}</button>
          </>
        }
      >
        {form ? (
          <form id="designation-form" onSubmit={save} className="ow-form">
            {formError ? <p className="ow-error" role="alert">{formError}</p> : null}
            <label>
              Job title
              <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} required maxLength={200} />
            </label>
            <label>
              Job level
              <input value={form.grade} onChange={(event) => setForm({ ...form, grade: event.target.value })} maxLength={80} />
            </label>
            <label>
              Description
              <textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} maxLength={1000} rows={3} />
            </label>
            {form.id ? (
              <label className="ow-check">
                <input type="checkbox" checked={form.isActive !== false} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} />
                <span>Active</span>
              </label>
            ) : null}
          </form>
        ) : null}
      </AppModal>

      <AppModal
        open={Boolean(confirm)}
        onClose={() => { if (!saving) setConfirm(null); }}
        title={`Deactivate ${confirm?.title || "job title"}`}
        locked={saving}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setConfirm(null)} disabled={saving}>Cancel</button>
            <button type="button" className="btn-danger" onClick={deactivate} disabled={saving}>{saving ? "Working…" : "Deactivate"}</button>
          </>
        }
      >
        {formError ? <p className="ow-error" role="alert">{formError}</p> : null}
        <p>This title will no longer appear as a suggestion. People who already have it keep their saved title and level.</p>
      </AppModal>
    </section>
  );
}
