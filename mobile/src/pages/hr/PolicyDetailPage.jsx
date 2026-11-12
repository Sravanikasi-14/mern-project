import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useSmartBack } from "../../hooks/useSmartBack";
import { CalendarClock, ChevronLeft, History } from "lucide-react";
import SegmentedTabs from "../../components/SegmentedTabs";
import Toggle from "../../components/Toggle";
import Modal from "../../components/Modal";
import EmptyState, { ErrorState, Skeleton } from "../../components/EmptyState";
import { useToast } from "../../components/Toast";
import {
  createPolicyRevision,
  deletePolicyRevision,
  loadActivePolicy,
  loadPolicyById,
  loadPolicyHistory,
  revisionDateKey,
  revisionStatus,
  savePolicy,
  todayKey,
} from "../../services/policy.js";

const STATUS_META = {
  ACTIVE_NOW: { label: "Active now", tone: "is-approved" },
  FUTURE_SCHEDULED: { label: "Scheduled", tone: "is-pending" },
  HISTORICAL: { label: "Historical", tone: "" },
  UNKNOWN: { label: "Unknown", tone: "" },
};

function tomorrowKey() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().split("T")[0];
}

function formatRevisionDate(value) {
  const key = revisionDateKey(value);
  if (!key) return "—";
  return new Date(`${key}T00:00:00Z`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

const TITLES = {
  "work-hours": "Work Hours & Shifts",
  "leave-types": "Leave Types & Rules",
  holidays: "Holidays",
  location: "Location & Tracking Policy",
  payroll: "Payroll & Salary Policy",
  lifecycle: "Employee Lifecycle Policy",
  recruitment: "Recruitment & Offers",
  documents: "Documents & Compliance",
  impact: "Impact Points Rules",
};

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function HrPolicyDetailPage({ readOnly = false }) {
  const navigate = useNavigate();
  const goBack = useSmartBack(readOnly ? "/app/policies" : "/admin/policies");
  const { section } = useParams();
  const toast = useToast();
  const title = TITLES[section] || "Policy";
  const [policy, setPolicy] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState("general");
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveForm, setLeaveForm] = useState({ code: "", name: "", yearlyDays: 10, isPaid: true, isActive: true });
  const [holidayOpen, setHolidayOpen] = useState(false);
  const [holidayForm, setHolidayForm] = useState({ name: "", date: "", type: "Gazetted Holiday" });

  const [revisions, setRevisions] = useState([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [revisionBusy, setRevisionBusy] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [newDate, setNewDate] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [newError, setNewError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);

  const today = todayKey();

  const load = async (preserveRevisionId = null) => {
    try {
      setLoading(true);
      setError("");
      const active = await loadActivePolicy();
      if (readOnly) {
        setPolicy(active);
        return;
      }
      let list = [];
      try {
        list = await loadPolicyHistory();
      } catch {
        list = [];
      }
      setRevisions(list);
      const target =
        (preserveRevisionId && list.find((r) => r._id === preserveRevisionId)) ||
        (active?._id && list.find((r) => r._id === active._id)) ||
        active ||
        list[0] ||
        null;
      setPolicy(target);
    } catch (err) {
      setError(err.response?.data?.message || "Could not load policy.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [section]);

  const persist = async (next) => {
    if (saving) return;
    try {
      setSaving(true);
      setError("");
      // PUT /policies/:id against the selected revision (savePolicy uses next._id).
      const saved = await savePolicy(next);
      const merged = saved?._id ? saved : next;
      setPolicy(merged);
      if (merged?._id) {
        setRevisions((prev) => prev.map((r) => (r._id === merged._id ? { ...r, ...merged } : r)));
      }
      toast.push("Saved changes.");
    } catch (err) {
      setError(err.response?.data?.message || "Could not save this policy.");
    } finally {
      setSaving(false);
    }
  };

  const selectRevision = async (rev) => {
    if (!rev?._id || revisionBusy) return;
    if (rev._id === policy?._id) {
      setHistoryOpen(false);
      return;
    }
    try {
      setRevisionBusy(true);
      setError("");
      const fresh = await loadPolicyById(rev._id);
      setPolicy(fresh || rev);
      setHistoryOpen(false);
    } catch (err) {
      setError(err.response?.data?.message || "Could not load this revision.");
    } finally {
      setRevisionBusy(false);
    }
  };

  const openNewRevision = () => {
    setNewDate("");
    setNewNotes("");
    setNewError("");
    setHistoryOpen(false);
    setNewOpen(true);
  };

  const submitNewRevision = async () => {
    if (revisionBusy) return;
    if (!newDate) {
      setNewError("Pick an effective from date for the new revision.");
      return;
    }
    if (newDate <= today) {
      setNewError("Scheduled revisions need a future effective date.");
      return;
    }
    try {
      setRevisionBusy(true);
      setNewError("");
      const created = await createPolicyRevision(policy, { effectiveFromDate: newDate, notes: newNotes });
      setNewOpen(false);
      toast.push("Scheduled revision created.");
      await load(created?._id || null);
    } catch (err) {
      setNewError(err.response?.data?.message || "Could not create the policy revision.");
    } finally {
      setRevisionBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget || revisionBusy) return;
    try {
      setRevisionBusy(true);
      await deletePolicyRevision(deleteTarget._id);
      const wasSelected = deleteTarget._id === policy?._id;
      setDeleteTarget(null);
      toast.push("Revision deleted.");
      await load(wasSelected ? null : policy?._id);
    } catch (err) {
      setDeleteTarget(null);
      setError(err.response?.data?.message || "Could not delete this revision.");
    } finally {
      setRevisionBusy(false);
    }
  };

  const head = (
    <header className="st-subhead">
      <button type="button" className="icon-btn" aria-label="Go back" onClick={() => goBack()}>
        <ChevronLeft size={22} strokeWidth={1.85} />
      </button>
      <h1>{title}</h1>
    </header>
  );

  if (loading) {
    return (
      <div className="st-pol-detail">
        {head}
        <Skeleton />
      </div>
    );
  }
  if (error && !policy) {
    return (
      <div className="st-pol-detail">
        {head}
        <ErrorState message={error} onRetry={() => load()} />
      </div>
    );
  }

  if (!policy) {
    return (
      <div className="st-pol-detail">
        {head}
        <EmptyState message="No active company policy is available yet." />
      </div>
    );
  }

  if (!TITLES[section]) {
    return (
      <div className="st-pol-detail">
        {head}
        <EmptyState message="This policy section is not available." />
        <button type="button" className="btn-secondary" style={{ marginTop: 12 }} onClick={() => goBack()}>
          Back to policies
        </button>
      </div>
    );
  }

  const selectedStatus = revisionStatus(policy, revisions, today);
  const selectedMeta = STATUS_META[selectedStatus] || STATUS_META.UNKNOWN;

  const ar = policy.attendanceRules || {};
  const wr = policy.workHoursRules || {};
  const weekend = policy.weekendRules || {};
  const location = policy.locationRules || {};
  const leaveTypes = policy.leaveTypes || [];
  const leaveRules = policy.leaveRules || {};
  const holidays = policy.holidays || [];
  const salary = policy.salaryComponentRules || { allowances: [], deductions: [] };
  const life = policy.lifecycleRules || {};
  const docs = policy.documentRules || { mandatoryDocumentTypes: [] };
  const impact = policy.impactPointRules || { rules: [] };
  const rec = policy.recruitmentRules || {};

  const working = (day) => {
    if (day === "Sat") return !weekend.saturdayOff;
    if (day === "Sun") return !weekend.sundayOff;
    return true;
  };

  return (
    <div className="st-pol-detail">
      {head}
      {error ? <div className="alert alert-error">{error}</div> : null}
      {!readOnly ? (
        <>
          <div className="summary-row st-pol-rev-card">
            <span className="summary-body">
              <span className="summary-title">Effective {formatRevisionDate(policy.effectiveFromDate)}</span>
              <span className="summary-sub">
                {revisions.length > 0 ? `${revisions.length} revision${revisions.length === 1 ? "" : "s"}` : "Policy revision"}
                {policy.notes ? ` · ${policy.notes}` : ""}
              </span>
            </span>
            <span className={`hr-status-pill ${selectedMeta.tone}`}>{selectedMeta.label}</span>
          </div>
          <div className="st-pol-rev-actions">
            <button type="button" className="btn-secondary btn-sm" onClick={() => setHistoryOpen(true)}>
              <History size={16} strokeWidth={1.85} aria-hidden="true" /> Revision history
            </button>
            <button type="button" className="btn-secondary btn-sm" disabled={!policy._id} onClick={openNewRevision}>
              <CalendarClock size={16} strokeWidth={1.85} aria-hidden="true" /> Schedule revision
            </button>
          </div>
          <p className="st-pol-edit-hint">
            {selectedStatus === "ACTIVE_NOW"
              ? "Editing the currently active revision — changes save to this revision."
              : selectedStatus === "FUTURE_SCHEDULED"
                ? "Editing a scheduled revision — it takes effect on its effective date."
                : "Editing a historical revision — it does not affect the live policy."}
          </p>
        </>
      ) : null}

      {section === "work-hours" ? (
        <>
          <SegmentedTabs value={tab} onChange={setTab} options={[{ value: "general", label: "General" }, { value: "shifts", label: "Shifts" }]} />
          {tab === "general" ? (
            <form className="form-grid" onSubmit={(event) => { event.preventDefault(); persist({ ...policy }); }}>
              <label>Start time<input type="time" value={ar.officeStartTime || "09:30"} onChange={(event) => setPolicy({ ...policy, attendanceRules: { ...ar, officeStartTime: event.target.value } })} disabled={readOnly} /></label>
              <label>End time<input type="time" value={ar.officeEndTime || "18:30"} onChange={(event) => setPolicy({ ...policy, attendanceRules: { ...ar, officeEndTime: event.target.value } })} disabled={readOnly} /></label>
              <p className="caption">Working days</p>
              <div className="st-pol-days">
                {DAYS.map((day) => (
                  <button
                    key={day}
                    type="button"
                    className={`day-chip${working(day) ? "" : " is-off"}`}
                    disabled={readOnly || (day !== "Sat" && day !== "Sun")}
                    onClick={() => {
                      if (day === "Sat") setPolicy({ ...policy, weekendRules: { ...weekend, saturdayOff: !weekend.saturdayOff } });
                      if (day === "Sun") setPolicy({ ...policy, weekendRules: { ...weekend, sundayOff: !weekend.sundayOff } });
                    }}
                  >
                    {day.slice(0, 1)}
                  </button>
                ))}
              </div>
              <p className="caption">Weekdays are always working days in the current policy model. Saturday and Sunday can be toggled.</p>
              <Toggle
                label="Lunch break"
                description={`${ar.breakDurationMinutes || 60} minutes`}
                checked={(ar.breakDurationMinutes || 0) > 0}
                disabled={readOnly}
                onChange={(on) => setPolicy({ ...policy, attendanceRules: { ...ar, breakDurationMinutes: on ? 60 : 0 } })}
              />
              <label>Grace period (minutes)<input type="number" value={ar.gracePeriodMinutes ?? 15} onChange={(event) => setPolicy({ ...policy, attendanceRules: { ...ar, gracePeriodMinutes: Number(event.target.value) } })} disabled={readOnly} /></label>
              {!readOnly ? <button type="button" className="btn-primary" disabled={saving} onClick={() => persist(policy)}>{saving ? "Saving..." : "Save Changes"}</button> : null}
            </form>
          ) : (
            <form className="form-grid">
              <label>Shift name<input value={wr.shiftName || ""} onChange={(event) => setPolicy({ ...policy, workHoursRules: { ...wr, shiftName: event.target.value } })} disabled={readOnly} /></label>
              <label>Standard daily hours<input type="number" value={wr.standardDailyHours ?? 8} onChange={(event) => setPolicy({ ...policy, workHoursRules: { ...wr, standardDailyHours: Number(event.target.value) } })} disabled={readOnly} /></label>
              <Toggle label="Overtime allowed" checked={Boolean(wr.overtimeAllowed)} disabled={readOnly} onChange={(on) => setPolicy({ ...policy, workHoursRules: { ...wr, overtimeAllowed: on } })} />
              {!readOnly ? <button type="button" className="btn-primary" disabled={saving} onClick={() => persist(policy)}>{saving ? "Saving..." : "Save Changes"}</button> : null}
            </form>
          )}
        </>
      ) : null}

      {section === "leave-types" ? (
        <>
          <SegmentedTabs value={tab} onChange={setTab} options={[{ value: "general", label: "Leave Types" }, { value: "shifts", label: "General Rules" }]} />
          {tab === "general" ? (
            <>
              {leaveTypes.length === 0 ? <EmptyState message="No leave types yet." /> : leaveTypes.map((type, index) => (
                <div key={type.code || index} className="summary-row">
                  <span className="summary-body">
                    <span className="summary-title">{type.name}</span>
                    <span className="summary-sub">{type.yearlyDays} days · {type.isPaid ? "Paid" : "Unpaid"}</span>
                  </span>
                </div>
              ))}
              {!readOnly ? <button type="button" className="btn-primary btn-block" onClick={() => setLeaveOpen(true)}>+ Add Leave Type</button> : null}
            </>
          ) : (
            <form className="form-grid">
              <label>Probation months<input type="number" value={leaveRules.probationMonths ?? 3} onChange={(event) => setPolicy({ ...policy, leaveRules: { ...leaveRules, probationMonths: Number(event.target.value) } })} disabled={readOnly} /></label>
              <label>Carry forward days<input type="number" value={leaveRules.carryForwardLimitDays ?? 10} onChange={(event) => setPolicy({ ...policy, leaveRules: { ...leaveRules, carryForwardLimitDays: Number(event.target.value) } })} disabled={readOnly} /></label>
              <p className="caption">Leave requests still go through the existing HR approval workflow. That is not a separate policy switch.</p>
              {!readOnly ? <button type="button" className="btn-primary" disabled={saving} onClick={() => persist(policy)}>{saving ? "Saving..." : "Save Changes"}</button> : null}
            </form>
          )}
        </>
      ) : null}

      {section === "holidays" ? (
        <>
          {holidays.length === 0 ? <EmptyState message="No holidays configured." /> : holidays.map((h, index) => (
            <div key={`${h.name}-${index}`} className="summary-row">
              <span className="summary-body">
                <span className="summary-title">{h.name}</span>
                <span className="summary-sub">{h.date ? new Date(h.date).toLocaleDateString("en-IN") : "—"} · {h.type}</span>
              </span>
              {!readOnly ? (
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={() => persist({ ...policy, holidays: holidays.filter((_, i) => i !== index) })}
                >
                  Remove
                </button>
              ) : null}
            </div>
          ))}
          {!readOnly ? <button type="button" className="btn-primary btn-block fab-bar" onClick={() => setHolidayOpen(true)}>+ Add holiday</button> : null}
        </>
      ) : null}

      {section === "location" ? (
        <form className="form-grid">
          <Toggle label="Require location for punch" description="Employees must share GPS to punch in or out." checked={Boolean(location.requireLocationForPunch)} disabled={readOnly} onChange={(on) => setPolicy({ ...policy, locationRules: { ...location, requireLocationForPunch: on } })} />
          <Toggle label="Allow web tracking" checked={Boolean(location.allowWebTracking)} disabled={readOnly} onChange={(on) => setPolicy({ ...policy, locationRules: { ...location, allowWebTracking: on } })} />
          <Toggle label="Geofence" description="Only if coordinates are stored for the office." checked={Boolean(location.geofenceEnabled)} disabled={readOnly} onChange={(on) => setPolicy({ ...policy, locationRules: { ...location, geofenceEnabled: on } })} />
          <label>Office address<input value={location.officeAddress || ""} onChange={(event) => setPolicy({ ...policy, locationRules: { ...location, officeAddress: event.target.value } })} disabled={readOnly} /></label>
          <label>Geofence radius (m)<input type="number" value={location.geofenceRadiusMeters ?? 200} onChange={(event) => setPolicy({ ...policy, locationRules: { ...location, geofenceRadiusMeters: Number(event.target.value) } })} disabled={readOnly} /></label>
          <p className="caption">Coordinates are never invented. Office lat/long stay empty until set from the web policy editor.</p>

          <h3 className="summary-title" style={{ marginTop: 12 }}>Attendance verification</h3>
          <Toggle
            label="Require verification"
            description="When on, enable at least one method below."
            checked={Boolean((policy.attendanceVerification || {}).verificationRequired)}
            disabled={readOnly}
            onChange={(on) =>
              setPolicy({
                ...policy,
                attendanceVerification: {
                  ...(policy.attendanceVerification || {}),
                  verificationRequired: on,
                },
              })
            }
          />
          {["gps", "wifi", "face"].map((key) => {
            const av = policy.attendanceVerification || {};
            const method = av[key] || { enabled: false, mandatory: true };
            const labels = { gps: "GPS geofencing", wifi: "Wi-Fi (Android)", face: "Face recognition" };
            return (
              <div key={key} className="summary-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
                <Toggle
                  label={labels[key]}
                  checked={Boolean(method.enabled)}
                  disabled={readOnly}
                  onChange={(on) =>
                    setPolicy({
                      ...policy,
                      attendanceVerification: {
                        ...av,
                        [key]: { ...method, enabled: on },
                      },
                    })
                  }
                />
                <label>
                  Requirement
                  <select
                    value={method.mandatory !== false ? "mandatory" : "optional"}
                    disabled={readOnly || !method.enabled}
                    onChange={(event) =>
                      setPolicy({
                        ...policy,
                        attendanceVerification: {
                          ...av,
                          [key]: { ...method, mandatory: event.target.value === "mandatory" },
                        },
                      })
                    }
                  >
                    <option value="mandatory">Mandatory</option>
                    <option value="optional">Optional</option>
                  </select>
                </label>
              </div>
            );
          })}
          <p className="caption">Authorized Wi-Fi SSIDs and face thresholds are managed in the desktop policy editor.</p>
          {!readOnly ? <button type="button" className="btn-primary" disabled={saving} onClick={() => persist(policy)}>{saving ? "Saving..." : "Save Changes"}</button> : null}
        </form>
      ) : null}

      {section === "payroll" ? (
        <>
          <SegmentedTabs value={tab} onChange={setTab} options={[{ value: "general", label: "Salary Components" }, { value: "shifts", label: "Deductions" }]} />
          {(tab === "general" ? salary.allowances : salary.deductions || []).map((row, index) => (
            <div key={row.code || index} className="summary-row">
              <span className="summary-body">
                <span className="summary-title">{row.name}</span>
                <span className="summary-sub">{row.percentageOfCtc != null ? `${row.percentageOfCtc}% of CTC` : `${row.ratePercent || 0}%`}</span>
              </span>
            </div>
          ))}
          {!readOnly ? <button type="button" className="btn-primary" disabled={saving} onClick={() => persist(policy)}>{saving ? "Saving..." : "Save Changes"}</button> : null}
        </>
      ) : null}

      {section === "lifecycle" ? (
        <form className="form-grid">
          <label>Probation (months)<input type="number" value={life.probationDurationMonths ?? 3} onChange={(event) => setPolicy({ ...policy, lifecycleRules: { ...life, probationDurationMonths: Number(event.target.value) } })} disabled={readOnly} /></label>
          <label>Notice period (days)<input type="number" value={life.noticePeriodDays ?? 30} onChange={(event) => setPolicy({ ...policy, lifecycleRules: { ...life, noticePeriodDays: Number(event.target.value) } })} disabled={readOnly} /></label>
          <Toggle label="Confirmation review required" checked={Boolean(life.confirmationReviewRequired)} disabled={readOnly} onChange={(on) => setPolicy({ ...policy, lifecycleRules: { ...life, confirmationReviewRequired: on } })} />
          {!readOnly ? <button type="button" className="btn-primary" disabled={saving} onClick={() => persist(policy)}>{saving ? "Saving..." : "Save Changes"}</button> : null}
        </form>
      ) : null}

      {section === "recruitment" ? (
        <form className="form-grid">
          <label>Offer validity (days)<input type="number" value={rec.offerValidityDays ?? 7} onChange={(event) => setPolicy({ ...policy, recruitmentRules: { ...rec, offerValidityDays: Number(event.target.value) } })} disabled={readOnly} /></label>
          <Toggle label="Require candidate signature" checked={Boolean(rec.requireCandidateSignature)} disabled={readOnly} onChange={(on) => setPolicy({ ...policy, recruitmentRules: { ...rec, requireCandidateSignature: on } })} />
          <Toggle label="Auto-expire offers" checked={Boolean(rec.autoExpireOffers)} disabled={readOnly} onChange={(on) => setPolicy({ ...policy, recruitmentRules: { ...rec, autoExpireOffers: on } })} />
          {!readOnly ? <button type="button" className="btn-primary" disabled={saving} onClick={() => persist(policy)}>{saving ? "Saving..." : "Save Changes"}</button> : null}
        </form>
      ) : null}

      {section === "documents" ? (
        (docs.mandatoryDocumentTypes || []).length === 0 ? <EmptyState message="No mandatory document types." /> : docs.mandatoryDocumentTypes.map((id) => (
          <div key={id} className="summary-row">
            <span className="summary-body">
              <span className="summary-title">{String(id).replace(/_/g, " ")}</span>
              <span className="summary-sub">Mandatory</span>
            </span>
          </div>
        ))
      ) : null}

      {section === "impact" ? (
        (impact.rules || []).map((rule) => (
          <div key={rule.ruleCode} className="summary-row">
            <span className="summary-body">
              <span className="summary-title">{rule.name}</span>
              <span className="summary-sub">{rule.points > 0 ? `+${rule.points}` : rule.points} pts · {rule.isEnabled ? "On" : "Off"}</span>
            </span>
          </div>
        ))
      ) : null}

      {!readOnly ? (
        <>
          <Modal
            open={historyOpen}
            onClose={() => setHistoryOpen(false)}
            title="Revision history"
            footer={
              <>
                <button type="button" className="btn-secondary" onClick={() => setHistoryOpen(false)}>Close</button>
                <button type="button" className="btn-primary" onClick={openNewRevision}>Schedule revision</button>
              </>
            }
          >
            {revisions.length === 0 ? (
              <EmptyState message="No revisions found." />
            ) : (
              <div className="st-pol-rev-list">
                {revisions.map((rev) => {
                  const status = revisionStatus(rev, revisions, today);
                  const meta = STATUS_META[status] || STATUS_META.UNKNOWN;
                  const isSelected = rev._id === policy._id;
                  return (
                    <div key={rev._id} className={`summary-row st-pol-rev-row${isSelected ? " is-selected" : ""}`}>
                      <span className="summary-body">
                        <span className="summary-title">{formatRevisionDate(rev.effectiveFromDate)}</span>
                        <span className="summary-sub">{rev.notes || (isSelected ? "Currently editing" : "No notes")}</span>
                        <span className="st-pol-rev-btns">
                          {isSelected ? (
                            <span className="caption">Currently editing</span>
                          ) : (
                            <button type="button" className="btn-secondary btn-sm" disabled={revisionBusy} onClick={() => selectRevision(rev)}>
                              View / Edit
                            </button>
                          )}
                          {revisions.length > 1 && !isSelected ? (
                            <button type="button" className="btn-ghost btn-sm st-pol-rev-del" disabled={revisionBusy} onClick={() => setDeleteTarget(rev)}>
                              Delete
                            </button>
                          ) : null}
                        </span>
                      </span>
                      <span className={`hr-status-pill ${meta.tone}`}>{meta.label}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </Modal>

          <Modal
            open={newOpen}
            onClose={() => setNewOpen(false)}
            title="Schedule policy revision"
            footer={
              <>
                <button type="button" className="btn-secondary" onClick={() => setNewOpen(false)}>Cancel</button>
                <button type="button" className="btn-primary" disabled={revisionBusy} onClick={submitNewRevision}>
                  {revisionBusy ? "Creating..." : "Create revision"}
                </button>
              </>
            }
          >
            <form className="form-grid" onSubmit={(event) => { event.preventDefault(); submitNewRevision(); }}>
              <p className="caption">
                Creates a new revision cloned from the one you are viewing. It takes effect automatically on the selected date; existing revisions stay intact.
              </p>
              {newError ? <div className="alert alert-error">{newError}</div> : null}
              <label>
                Effective from
                <input type="date" min={tomorrowKey()} value={newDate} onChange={(event) => setNewDate(event.target.value)} />
              </label>
              <label>
                Notes (optional)
                <input value={newNotes} onChange={(event) => setNewNotes(event.target.value)} placeholder="e.g. FY27 leave update" />
              </label>
            </form>
          </Modal>

          <Modal
            open={Boolean(deleteTarget)}
            onClose={() => setDeleteTarget(null)}
            title="Delete revision?"
            footer={
              <>
                <button type="button" className="btn-secondary" onClick={() => setDeleteTarget(null)}>Cancel</button>
                <button type="button" className="btn-primary" disabled={revisionBusy} onClick={confirmDelete}>
                  {revisionBusy ? "Deleting..." : "Delete"}
                </button>
              </>
            }
          >
            <p className="caption">
              Delete the policy revision effective {formatRevisionDate(deleteTarget?.effectiveFromDate)}? This cannot be undone.
            </p>
          </Modal>
        </>
      ) : null}

      <Modal
        open={leaveOpen}
        onClose={() => setLeaveOpen(false)}
        title="Add Leave Type"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setLeaveOpen(false)}>Cancel</button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                persist({ ...policy, leaveTypes: [...leaveTypes, { ...leaveForm, yearlyDays: Number(leaveForm.yearlyDays), code: leaveForm.code.toUpperCase() }] });
                setLeaveOpen(false);
              }}
            >
              Save Leave Type
            </button>
          </>
        }
      >
        <form className="form-grid">
          <label>Leave type name<input value={leaveForm.name} onChange={(event) => setLeaveForm((prev) => ({ ...prev, name: event.target.value }))} /></label>
          <label>Code<input value={leaveForm.code} onChange={(event) => setLeaveForm((prev) => ({ ...prev, code: event.target.value }))} /></label>
          <label>Number of days<input type="number" value={leaveForm.yearlyDays} onChange={(event) => setLeaveForm((prev) => ({ ...prev, yearlyDays: event.target.value }))} /></label>
          <Toggle label="Paid" checked={leaveForm.isPaid} onChange={(on) => setLeaveForm((prev) => ({ ...prev, isPaid: on }))} />
        </form>
      </Modal>
      <Modal
        open={holidayOpen}
        onClose={() => setHolidayOpen(false)}
        title="Add holiday"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setHolidayOpen(false)}>Cancel</button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                if (!holidayForm.name.trim() || !holidayForm.date) return;
                persist({ ...policy, holidays: [...holidays, { ...holidayForm, name: holidayForm.name.trim() }] });
                setHolidayForm({ name: "", date: "", type: "Gazetted Holiday" });
                setHolidayOpen(false);
              }}
            >
              Save holiday
            </button>
          </>
        }
      >
        <form className="form-grid">
          <label>Name<input value={holidayForm.name} onChange={(event) => setHolidayForm((prev) => ({ ...prev, name: event.target.value }))} /></label>
          <label>Date<input type="date" value={holidayForm.date} onChange={(event) => setHolidayForm((prev) => ({ ...prev, date: event.target.value }))} /></label>
          <label>
            Type
            <select value={holidayForm.type} onChange={(event) => setHolidayForm((prev) => ({ ...prev, type: event.target.value }))}>
              <option value="Gazetted Holiday">Gazetted Holiday</option>
              <option value="National Holiday">National Holiday</option>
              <option value="Festival Holiday">Festival Holiday</option>
              <option value="Observance">Observance</option>
              <option value="Company Holiday">Company Holiday</option>
            </select>
          </label>
        </form>
      </Modal>
    </div>
  );
}
