import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import SegmentedTabs from "../../components/SegmentedTabs";
import Toggle from "../../components/Toggle";
import Modal from "../../components/Modal";
import EmptyState, { ErrorState, Skeleton } from "../../components/EmptyState";
import { useToast } from "../../components/Toast";
import { loadActivePolicy, savePolicy } from "../../services/policy.js";

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

  const load = async () => {
    try {
      setLoading(true);
      setError("");
      setPolicy(await loadActivePolicy());
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
      const saved = await savePolicy(next);
      setPolicy(saved?._id ? saved : next);
      toast.push("Saved changes.");
    } catch (err) {
      setError(err.response?.data?.message || "Could not save this policy.");
    } finally {
      setSaving(false);
    }
  };

  const head = (
    <header className="st-subhead">
      <button type="button" className="icon-btn" aria-label="Go back" onClick={() => navigate(-1)}>
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
        <ErrorState message={error} onRetry={load} />
      </div>
    );
  }

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
        <p className="st-pol-edit-hint">Editable policy template — changes save to the active company policy.</p>
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
