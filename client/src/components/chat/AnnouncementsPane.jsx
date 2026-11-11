import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Megaphone } from "lucide-react";
import AppModal from "../AppModal";
import { qk } from "../../lib/queryKeys";
import api from "../../services/api";
import {
  PRIORITY_LABEL,
  STATUS_LABEL,
  announcementTiming,
  audienceLabelFor,
  formatAnnouncementDate,
  timingPrefix,
} from "./announcementDisplay";

function apiMessage(error, fallback) {
  return error?.response?.data?.message || fallback;
}

function emptyForm() {
  return {
    title: "",
    body: "",
    priority: "NORMAL",
    audience: "COMPANY",
    departmentIds: [],
    when: "now",
    scheduledAt: "",
  };
}

export default function AnnouncementsPane({ narrow }) {
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("a") || "";
  const [status, setStatus] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [readsOpen, setReadsOpen] = useState(false);
  const [readSearch, setReadSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);

  const listQuery = useQuery({
    queryKey: qk.announcements({ status }),
    queryFn: async () => {
      const res = await api.get("/announcements", { params: { status: status || undefined, limit: 30 } });
      return res.data;
    },
  });
  const access = listQuery.data?.access || { canPublish: false, companyWide: true };
  const departments = listQuery.data?.departments || [];
  const announcements = listQuery.data?.announcements || [];
  const selectedSummary = announcements.find((item) => item.id === selectedId) || null;

  const detailQuery = useQuery({
    queryKey: qk.announcement(selectedId),
    enabled: Boolean(selectedId),
    queryFn: async () => {
      const res = await api.get(`/announcements/${selectedId}`);
      return res.data?.announcement;
    },
  });
  const detail = detailQuery.data || selectedSummary;
  const detailTiming = announcementTiming(detail);
  const audienceLabel = audienceLabelFor(detail);

  const readsQuery = useQuery({
    queryKey: qk.announcementReads(selectedId, readSearch.trim()),
    enabled: Boolean(selectedId) && readsOpen && access.canPublish,
    queryFn: async () => {
      const res = await api.get(`/announcements/${selectedId}/read-status`, { params: { search: readSearch.trim() } });
      return res.data;
    },
  });

  useEffect(() => {
    if (!selectedId || detail?.status !== "PUBLISHED") return undefined;
    let cancelled = false;
    api.post(`/announcements/${selectedId}/read`).then(() => {
      if (cancelled) return;
      queryClient.invalidateQueries({ queryKey: ["announcements"] });
      queryClient.invalidateQueries({ queryKey: qk.notifications() });
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selectedId, detail?.status, queryClient]);

  function selectAnnouncement(id) {
    const next = new URLSearchParams(params);
    next.set("view", "announcements");
    if (id) next.set("a", id);
    else next.delete("a");
    setParams(next, { replace: true });
    setReadsOpen(false);
    setConfirmWithdraw(false);
    setError("");
  }

  function openCreate() {
    setEditingId("");
    setForm({
      ...emptyForm(),
      audience: access.companyWide ? "COMPANY" : "DEPARTMENTS",
    });
    setError("");
    setEditorOpen(true);
  }

  function openEdit() {
    if (!detail) return;
    const scheduled = detail.scheduledAt ? new Date(detail.scheduledAt) : null;
    const local = scheduled && !Number.isNaN(scheduled.getTime())
      ? new Date(scheduled.getTime() - scheduled.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
      : "";
    setEditingId(detail.id);
    setForm({
      title: detail.title || "",
      body: detail.body || "",
      priority: detail.priority || "NORMAL",
      audience: detail.audience || "COMPANY",
      departmentIds: detail.departmentIds || [],
      when: detail.status === "SCHEDULED" ? "later" : "now",
      scheduledAt: local,
    });
    setError("");
    setEditorOpen(true);
  }

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["announcements"] });
  }

  async function save(event) {
    event.preventDefault();
    if (busy) return;
    const title = form.title.trim();
    const body = form.body.trim();
    if (!title) return setError("Enter a title.");
    if (!body) return setError("Write the announcement.");
    if (form.audience === "DEPARTMENTS" && form.departmentIds.length === 0) {
      return setError("Choose at least one department.");
    }
    const payload = {
      title,
      body,
      priority: form.priority,
    };
    const canRetarget = !editingId || detail?.status === "DRAFT" || detail?.status === "SCHEDULED";
    if (canRetarget) {
      payload.audience = form.audience;
      payload.departmentIds = form.audience === "DEPARTMENTS" ? form.departmentIds : [];
    }
    if (canRetarget) {
      if (form.when === "later") {
        if (!form.scheduledAt) return setError("Choose a date and time.");
        payload.scheduledAt = new Date(form.scheduledAt).toISOString();
        payload.publish = true;
      } else if (form.when === "draft") {
        payload.publish = false;
      } else {
        payload.publish = true;
      }
    }
    setBusy(true);
    setError("");
    try {
      const res = editingId
        ? await api.patch(`/announcements/${editingId}`, payload)
        : await api.post("/announcements", payload);
      const id = res.data?.announcement?.id;
      setEditorOpen(false);
      await refresh();
      if (id) selectAnnouncement(id);
    } catch (err) {
      setError(apiMessage(err, "The announcement could not be saved."));
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    if (!detail || busy) return;
    setBusy(true);
    setError("");
    try {
      await api.post(`/announcements/${detail.id}/withdraw`);
      setConfirmWithdraw(false);
      await refresh();
    } catch (err) {
      setError(apiMessage(err, "The announcement could not be withdrawn."));
    } finally {
      setBusy(false);
    }
  }

  const showList = !narrow || !selectedId;
  const showDetail = !narrow || Boolean(selectedId);

  return (
    <div className={`msg-announce${showList && showDetail ? "" : showList ? " is-list" : " is-thread"}`}>
      {showList ? (
        <aside className="msg-list" aria-label="Announcements">
          <div className="msg-list-tools">
            {access.canPublish ? (
              <label className="msg-field">
                Status
                <select value={status} onChange={(event) => setStatus(event.target.value)}>
                  <option value="">All</option>
                  <option value="PUBLISHED">Published</option>
                  <option value="SCHEDULED">Scheduled</option>
                  <option value="DRAFT">Drafts</option>
                  <option value="WITHDRAWN">Archived</option>
                </select>
              </label>
            ) : null}
            {access.canPublish ? (
              <button type="button" className="btn-primary" onClick={openCreate}>
                <Megaphone size={16} aria-hidden="true" />
                New announcement
              </button>
            ) : null}
          </div>
          {listQuery.isLoading ? <p className="msg-muted msg-announce-state">Loading announcements…</p> : null}
          {listQuery.isError ? (
            <p className="msg-banner" role="alert">{apiMessage(listQuery.error, "Announcements could not be loaded.")}</p>
          ) : null}
          {!listQuery.isLoading && !listQuery.isError && announcements.length === 0 ? (
            <div className="msg-empty msg-announce-empty">
              <p>{access.canPublish ? "No announcements yet." : "No announcements for you yet."}</p>
              {access.canPublish ? (
                <p className="msg-muted">Create one to share updates with the company or selected departments.</p>
              ) : null}
            </div>
          ) : null}
          {!listQuery.isLoading && announcements.length > 0 ? (
            <ul className="msg-people msg-announce-list">
              {announcements.map((item) => {
                const timing = announcementTiming(item);
                const selected = item.id === selectedId;
                const author = item.publishedByName || "";
                const preview = item.preview || "";
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={`msg-announce-item${selected ? " is-active" : ""}${item.isRead === false ? " is-unread" : ""}`}
                      onClick={() => selectAnnouncement(item.id)}
                      aria-current={selected ? "true" : undefined}
                    >
                      <span className="msg-announce-item-main">
                        <span className="msg-announce-item-top">
                          <strong className="msg-announce-item-title">{item.title}</strong>
                          {timing.iso ? (
                            <time dateTime={timing.iso} className="msg-announce-item-when">
                              {timing.label}
                            </time>
                          ) : null}
                        </span>
                        <span className="msg-announce-meta">
                          <span className={`msg-priority is-${String(item.priority || "normal").toLowerCase()}`}>
                            {PRIORITY_LABEL[item.priority] || item.priority || "Normal"}
                          </span>
                          {access.canPublish && item.status ? (
                            <span className={`msg-status is-${String(item.status).toLowerCase()}`}>
                              {STATUS_LABEL[item.status] || item.status}
                            </span>
                          ) : null}
                          <span className="msg-announce-audience">{audienceLabelFor(item)}</span>
                        </span>
                        {author ? <span className="msg-announce-author">By {author}</span> : null}
                        {preview ? <span className="msg-announce-preview">{preview}</span> : null}
                      </span>
                      {item.status === "PUBLISHED" && item.isRead === false ? (
                        <span className="msg-unread" aria-label="Unread">New</span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </aside>
      ) : null}

      {showDetail ? (
        <section
          className={`msg-thread msg-announce-thread${selectedId ? " has-selection" : ""}`}
          aria-label={detail?.title || "Announcement"}
        >
          {!selectedId ? (
            <div className="msg-empty msg-thread-empty msg-announce-empty">
              <p>Select an announcement to read it.</p>
            </div>
          ) : (
            <>
              <header className="msg-thread-head msg-announce-head">
                {narrow ? (
                  <button type="button" className="msg-back" onClick={() => selectAnnouncement("")} aria-label="Back to announcements">
                    <ArrowLeft size={18} />
                  </button>
                ) : null}
                <div className="msg-head-text">
                  <h2>{detail?.title || "Announcement"}</h2>
                  <div className="msg-announce-meta msg-announce-meta-detail">
                    <span className={`msg-priority is-${String(detail?.priority || "normal").toLowerCase()}`}>
                      {PRIORITY_LABEL[detail?.priority] || "Normal"}
                    </span>
                    {access.canPublish && detail?.status ? (
                      <span className={`msg-status is-${String(detail.status).toLowerCase()}`}>
                        {STATUS_LABEL[detail.status] || detail.status}
                      </span>
                    ) : null}
                    <span className="msg-announce-audience">{audienceLabel}</span>
                    {detailTiming.label ? (
                      <span>
                        {timingPrefix(detailTiming.kind)} {detailTiming.label}
                      </span>
                    ) : null}
                    {detail?.publishedByName ? <span className="msg-announce-author">By {detail.publishedByName}</span> : null}
                  </div>
                </div>
              </header>
              <div className="msg-history msg-announce-history">
                {detailQuery.isLoading && !detail?.body ? (
                  <p className="msg-muted msg-announce-state">Loading announcement…</p>
                ) : null}
                {detailQuery.isError ? (
                  <p className="msg-banner" role="alert">{apiMessage(detailQuery.error, "This announcement could not be opened.")}</p>
                ) : null}
                {detail?.body ? (
                  <article className="msg-announcement-body">
                    <div className="msg-announcement-text">{detail.body}</div>
                  </article>
                ) : null}
                {!detailQuery.isLoading && !detailQuery.isError && selectedId && !detail?.body ? (
                  <p className="msg-muted">This announcement has no body text.</p>
                ) : null}
                {error ? <p className="msg-banner" role="alert">{error}</p> : null}
                {access.canPublish && detail ? (
                  <div className="msg-dialog-actions">
                    {detail.status !== "WITHDRAWN" ? (
                      <button type="button" className="btn-secondary" onClick={openEdit} disabled={busy}>Edit</button>
                    ) : null}
                    {detail.status === "PUBLISHED" || detail.status === "SCHEDULED" ? (
                      confirmWithdraw ? (
                        <>
                          <button type="button" className="btn-secondary" onClick={() => setConfirmWithdraw(false)} disabled={busy}>Keep</button>
                          <button type="button" className="msg-danger" onClick={withdraw} disabled={busy}>{busy ? "Withdrawing…" : "Confirm withdraw"}</button>
                        </>
                      ) : (
                        <button type="button" className="msg-danger" onClick={() => setConfirmWithdraw(true)}>Withdraw</button>
                      )
                    ) : null}
                    <button type="button" className="btn-secondary" onClick={() => setReadsOpen(true)}>Read status</button>
                  </div>
                ) : null}
                {readsOpen && access.canPublish ? (
                  <div className="msg-reads">
                    <label className="msg-search msg-search-block">
                      <input
                        type="search"
                        value={readSearch}
                        onChange={(event) => setReadSearch(event.target.value)}
                        placeholder="Search people"
                        aria-label="Search read status"
                      />
                    </label>
                    {readsQuery.isLoading ? <p className="msg-muted">Loading read status…</p> : null}
                    {readsQuery.data ? (
                      <p className="msg-note">
                        {readsQuery.data.readCount} of {readsQuery.data.audienceSize} read · {readsQuery.data.percentage}%
                      </p>
                    ) : null}
                    <ul className="msg-directory">
                      {(readsQuery.data?.people || []).map((person) => (
                        <li key={person.userId} className="msg-member">
                          <span className="msg-person-body">
                            <strong>{person.displayName}</strong>
                            <span className="msg-preview">
                              {[person.department, person.employeeCode].filter(Boolean).join(" · ") || "Colleague"}
                              {" · "}
                              {person.readAt ? `Read ${formatAnnouncementDate(person.readAt)}` : "Not read"}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </>
          )}
        </section>
      ) : null}

      <AppModal open={editorOpen} onClose={() => { if (!busy) setEditorOpen(false); }} title={editingId ? "Edit announcement" : "New announcement"} locked={busy} size="lg">
        <form onSubmit={save}>
          {error ? <p className="msg-banner" role="alert">{error}</p> : null}
          <label className="msg-field">
            Title
            <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} maxLength={160} required />
          </label>
          <label className="msg-field">
            Announcement
            <textarea value={form.body} onChange={(event) => setForm({ ...form, body: event.target.value })} maxLength={8000} rows={8} required />
          </label>
          <label className="msg-field">
            Priority
            <select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })}>
              <option value="NORMAL">Normal</option>
              <option value="IMPORTANT">Important</option>
              <option value="URGENT">Urgent</option>
            </select>
          </label>
          {!editingId || detail?.status !== "PUBLISHED" ? (
            <>
              <fieldset className="msg-field">
                <legend>Audience</legend>
                {access.companyWide ? (
                  <label className="msg-check">
                    <input type="radio" name="audience" checked={form.audience === "COMPANY"} onChange={() => setForm({ ...form, audience: "COMPANY", departmentIds: [] })} />
                    Entire company
                  </label>
                ) : null}
                <label className="msg-check">
                  <input type="radio" name="audience" checked={form.audience === "DEPARTMENTS"} onChange={() => setForm({ ...form, audience: "DEPARTMENTS" })} />
                  Selected departments
                </label>
              </fieldset>
              {form.audience === "DEPARTMENTS" ? (
                <div className="msg-checks">
                  {departments.map((department) => (
                    <label key={department.id} className="msg-check">
                      <input
                        type="checkbox"
                        checked={form.departmentIds.includes(department.id)}
                        onChange={() => setForm((current) => ({
                          ...current,
                          departmentIds: current.departmentIds.includes(department.id)
                            ? current.departmentIds.filter((id) => id !== department.id)
                            : [...current.departmentIds, department.id],
                        }))}
                      />
                      {department.name}
                    </label>
                  ))}
                </div>
              ) : null}
              <fieldset className="msg-field">
                <legend>When</legend>
                <label className="msg-check">
                  <input type="radio" name="when" checked={form.when === "now"} onChange={() => setForm({ ...form, when: "now" })} />
                  Publish now
                </label>
                <label className="msg-check">
                  <input type="radio" name="when" checked={form.when === "later"} onChange={() => setForm({ ...form, when: "later" })} />
                  Schedule
                </label>
                <label className="msg-check">
                  <input type="radio" name="when" checked={form.when === "draft"} onChange={() => setForm({ ...form, when: "draft" })} />
                  Save as draft
                </label>
              </fieldset>
              {form.when === "later" ? (
                <label className="msg-field">
                  Date and time
                  <input type="datetime-local" value={form.scheduledAt} onChange={(event) => setForm({ ...form, scheduledAt: event.target.value })} required />
                </label>
              ) : null}
            </>
          ) : null}
          <div className="msg-dialog-actions">
            <button type="button" className="btn-secondary" onClick={() => setEditorOpen(false)} disabled={busy}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={busy}>{busy ? "Saving…" : editingId ? "Save" : "Save announcement"}</button>
          </div>
        </form>
      </AppModal>
    </div>
  );
}
