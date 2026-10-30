import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import PageHeader from "../../components/PageHeader";
import StatusBadge from "../../components/StatusBadge";
import SegmentedTabs from "../../components/SegmentedTabs";
import EmptyState, { ErrorState, Skeleton } from "../../components/EmptyState";
import SoftRefresh from "../../components/SoftRefresh";
import Modal from "../../components/Modal";
import Icon from "../../components/Icon";
import { useToast } from "../../components/Toast";
import api from "../../services/api";
import { formatDisplayDate, parseCivilDate, toDateOnlyString } from "../../utils/dateUtils";
import { useDashboardQuery } from "../../hooks/useEmployeeQueries";
import { invalidateLeave } from "../../app/queryKeys";

const emptyForm = { leaveType: "CASUAL", startDate: "", endDate: "", reason: "" };
const FALLBACK_TYPES = [{ code: "CASUAL", name: "Casual" }];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatLeaveType(code, types = []) {
  const raw = String(code || "").trim();
  if (!raw) return "Leave";
  const upper = raw.toUpperCase();
  const match = types.find((type) => {
    const typeCode = String(type.code || "").toUpperCase();
    const typeName = String(type.name || "").toUpperCase();
    return typeCode === upper || typeName === upper;
  });
  if (match?.name) return match.name;
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase().replace(/_/g, " ");
}

function typeValue(type) {
  return type?.code || type?.name || "";
}

function balanceTiles(leave) {
  const detailed = Array.isArray(leave?.detailed)
    ? leave.detailed.filter((type) => type && (type.code || type.name))
    : [];
  return detailed.map((type) => ({
    key: typeValue(type),
    label: type.name || formatLeaveType(type.code),
    value: Number.isFinite(Number(type.available)) ? Number(type.available) : null,
  })).filter((tile) => tile.value != null);
}

function dateRangeLabel(start, end) {
  const startParts = parseCivilDate(toDateOnlyString(start));
  const endParts = parseCivilDate(toDateOnlyString(end));
  if (!startParts) return "";
  if (
    !endParts
    || (startParts.year === endParts.year && startParts.month === endParts.month && startParts.day === endParts.day)
  ) {
    return formatDisplayDate(start);
  }
  if (startParts.year === endParts.year && startParts.month === endParts.month) {
    return `${startParts.day} – ${endParts.day} ${MONTHS[startParts.month - 1]} ${startParts.year}`;
  }
  if (startParts.year === endParts.year) {
    return `${startParts.day} ${MONTHS[startParts.month - 1]} – ${endParts.day} ${MONTHS[endParts.month - 1]} ${startParts.year}`;
  }
  return `${formatDisplayDate(start)} – ${formatDisplayDate(end)}`;
}

function durationLabel(req) {
  const days = Number(req?.days ?? req?.daysCount);
  if (!Number.isFinite(days) || days <= 0) return "";
  return days === 1 ? "1 day" : `${days} days`;
}

function requestSubtitle(req) {
  const range = dateRangeLabel(req.startDate, req.endDate);
  const duration = durationLabel(req);
  return [range, duration].filter(Boolean).join(" · ");
}

function getLeaveOverlapConflict(startDate, endDate, scheduledRanges) {
  if (!startDate || !endDate || !Array.isArray(scheduledRanges) || scheduledRanges.length === 0) {
    return null;
  }
  for (const item of scheduledRanges) {
    const status = String(item.status || "").toUpperCase();
    if (status !== "PENDING" && status !== "APPROVED") continue;
    const itemStart = item.startDate || item.fromDate;
    const itemEnd = item.endDate || item.toDate;
    if (!itemStart || !itemEnd) continue;
    if (startDate <= itemEnd && endDate >= itemStart) {
      const conflictStart = startDate > itemStart ? startDate : itemStart;
      const conflictEnd = endDate < itemEnd ? endDate : itemEnd;
      return {
        ...item,
        formattedConflict: conflictStart === conflictEnd ? conflictStart : `${conflictStart} to ${conflictEnd}`,
      };
    }
  }
  return null;
}

export default function EmployeeLeavePage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const composing = params.get("apply") === "1";
  const dashQuery = useDashboardQuery();
  const data = dashQuery.data || null;
  const loading = dashQuery.isLoading && !data;
  const error = dashQuery.error?.response?.data?.message || dashQuery.error?.message || "";
  const [form, setForm] = useState(emptyForm);
  const [fieldErrors, setFieldErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("ALL");
  const [selected, setSelected] = useState(null);

  const load = () => dashQuery.refetch();

  const leave = data?.leave;
  const requests = leave?.recentRequests || leave?.requests || leave?.history || [];
  const types = leave?.detailed?.length ? leave.detailed : FALLBACK_TYPES;
  const tiles = balanceTiles(leave);
  const config = leave?.config || {};
  const minDate = config.earliestEligibleDate || "";
  const selectedType = types.find((type) => typeValue(type) === form.leaveType);
  const selectedAvailable = Number.isFinite(Number(selectedType?.available))
    ? Number(selectedType.available)
    : null;

  const typeKey = types.map((type) => typeValue(type)).join("|");
  useEffect(() => {
    if (!types.length) return;
    setForm((prev) => {
      const exists = types.some((type) => typeValue(type) === prev.leaveType);
      if (exists) return prev;
      return { ...prev, leaveType: typeValue(types[0]) || "CASUAL" };
    });
  }, [typeKey]);

  const visible = useMemo(
    () => (tab === "ALL" ? requests : requests.filter((req) => String(req.status || "").toUpperCase() === tab)),
    [requests, tab]
  );

  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    const errors = {};
    if (!form.leaveType) errors.leaveType = "Select a leave type.";
    if (!form.startDate) errors.startDate = "Choose a from date.";
    if (!form.endDate) errors.endDate = "Choose a to date.";
    if (form.startDate && form.endDate && form.endDate < form.startDate) {
      errors.endDate = "To date cannot be before from date.";
    }
    if (minDate && form.startDate && form.startDate < minDate) {
      errors.startDate = `Earliest eligible date is ${minDate}.`;
    }
    const conflict = getLeaveOverlapConflict(form.startDate, form.endDate, leave?.scheduledRanges || []);
    if (conflict) {
      errors.form = `Cannot apply: the selected dates overlap with an existing ${conflict.status} ${conflict.leaveType} leave request (${conflict.formattedConflict}).`;
    }
    if (!form.reason.trim()) errors.reason = "Enter a reason for leave.";
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;
    try {
      setBusy(true);
      await api.post("/employees/me/leave-requests", {
        leaveType: form.leaveType,
        startDate: form.startDate,
        endDate: form.endDate,
        reason: form.reason.trim(),
      });
      toast.push("Leave request submitted.");
      setForm(emptyForm);
      setParams({}, { replace: true });
      await invalidateLeave(queryClient);
    } catch (err) {
      setFieldErrors({ form: err.response?.data?.message || "Could not submit leave." });
    } finally {
      setBusy(false);
    }
  };

  const openApply = () => setParams({ apply: "1" });

  if (loading) {
    return (
      <>
        <PageHeader title={composing ? "Leave Request" : "My Leave"} back={composing} />
        <Skeleton />
      </>
    );
  }
  if (error && !data) {
    return (
      <>
        <PageHeader title="My Leave" />
        <ErrorState message={error} onRetry={load} />
      </>
    );
  }

  if (composing) {
    return (
      <>
        <PageHeader title="Leave Request" back />
        <form className="form-grid lv-form" onSubmit={submit} noValidate>
          {fieldErrors.form ? <div className="alert alert-error">{fieldErrors.form}</div> : null}
          <div>
            <span className="lv-field-label">Leave Type</span>
            <div className="lv-type-grid">
              {types.map((type) => {
                const value = typeValue(type);
                return (
                  <button
                    key={value}
                    type="button"
                    className={form.leaveType === value ? "is-active" : ""}
                    onClick={() => setForm((prev) => ({ ...prev, leaveType: value }))}
                  >
                    {type.name || formatLeaveType(type.code)}
                  </button>
                );
              })}
            </div>
            {selectedAvailable != null ? (
              <p className="caption">{selectedAvailable} days available</p>
            ) : null}
            {fieldErrors.leaveType ? <span className="field-error">{fieldErrors.leaveType}</span> : null}
          </div>
          <div className="leave-date-pair">
            <label>
              From date
              <input
                type="date"
                min={minDate || undefined}
                value={form.startDate}
                onChange={(event) => {
                  const startDate = event.target.value;
                  setForm((prev) => ({
                    ...prev,
                    startDate,
                    endDate: prev.endDate && prev.endDate < startDate ? startDate : prev.endDate,
                  }));
                }}
              />
              {fieldErrors.startDate ? <span className="field-error">{fieldErrors.startDate}</span> : null}
            </label>
            <label>
              To date
              <input
                type="date"
                min={form.startDate || minDate || undefined}
                value={form.endDate}
                onChange={(event) => setForm((prev) => ({ ...prev, endDate: event.target.value }))}
              />
              {fieldErrors.endDate ? <span className="field-error">{fieldErrors.endDate}</span> : null}
            </label>
          </div>
          {config.cutoffTime ? (
            <p className="caption">
              Same-day cutoff: {config.cutoffTime}
              {config.timezone ? ` (${config.timezone})` : ""}. Earliest eligible date: {minDate || "today"}.
            </p>
          ) : null}
          <label>
            Reason for leave
            <textarea
              placeholder="Enter reason for leave"
              value={form.reason}
              onChange={(event) => setForm((prev) => ({ ...prev, reason: event.target.value }))}
            />
            {fieldErrors.reason ? <span className="field-error">{fieldErrors.reason}</span> : null}
          </label>
          <div className="leave-submit-bar">
            <button type="submit" className="btn-primary btn-block" disabled={busy}>
              {busy ? "Submitting..." : "Submit Request"}
            </button>
          </div>
        </form>
      </>
    );
  }

  return (
    <div className="lv-page">
      <PageHeader title="My Leave" />
      {dashQuery.isFetching && data ? (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
          <SoftRefresh active />
        </div>
      ) : null}
      <div className="lv-toolbar">
        <p className="lv-kicker">Balance &amp; history</p>
        <button type="button" className="lv-apply" onClick={openApply}>
          <span aria-hidden="true">+</span>
          Apply Leave
        </button>
      </div>

      {tiles.length ? (
        <div className="lv-balances">
          {tiles.map((tile) => (
            <div key={tile.key} className="lv-tile">
              <div className="lv-tile-icon">
                <Icon name="leave" size={16} />
              </div>
              <strong>{tile.value}</strong>
              <span>{tile.label}</span>
            </div>
          ))}
        </div>
      ) : null}

      <SegmentedTabs
        value={tab}
        onChange={setTab}
        options={[
          { value: "ALL", label: "All" },
          { value: "PENDING", label: "Pending" },
          { value: "APPROVED", label: "Approved" },
          { value: "REJECTED", label: "Rejected" },
        ]}
      />

      <section>
        <div className="lv-section-head">
          <h2>Recent Requests</h2>
        </div>
        {visible.length === 0 ? (
          <EmptyState
            message="You have no leave requests in this view."
            actionLabel={tab === "ALL" ? "Apply Leave" : undefined}
            onAction={tab === "ALL" ? openApply : undefined}
          />
        ) : (
          <div className="lv-list">
            {visible.map((req) => {
              const status = String(req.status || "").toUpperCase();
              return (
                <button
                  key={req._id || req.id}
                  type="button"
                  className={`lv-row${status === "REJECTED" ? " is-rejected" : ""}`}
                  onClick={() => setSelected(req)}
                >
                  <span className="lv-row-icon">
                    <Icon name="documents" size={18} />
                  </span>
                  <span className="lv-row-body">
                    <span className="lv-row-title">
                      {formatLeaveType(req.leaveTypeCode || req.leaveType, types)}
                    </span>
                    <span className="lv-row-sub">{requestSubtitle(req) || "Dates unavailable"}</span>
                  </span>
                  <StatusBadge status={req.status} />
                  <span className="chevron" aria-hidden="true" />
                </button>
              );
            })}
          </div>
        )}
      </section>

      <Modal open={Boolean(selected)} onClose={() => setSelected(null)} title="Leave request">
        {selected ? (
          <dl className="lv-detail">
            <div>
              <dt>Type</dt>
              <dd>{formatLeaveType(selected.leaveTypeCode || selected.leaveType, types)}</dd>
            </div>
            <div>
              <dt>Dates</dt>
              <dd>{dateRangeLabel(selected.startDate, selected.endDate) || "—"}</dd>
            </div>
            {durationLabel(selected) ? (
              <div>
                <dt>Duration</dt>
                <dd>{durationLabel(selected)}</dd>
              </div>
            ) : null}
            <div>
              <dt>Status</dt>
              <dd><StatusBadge status={selected.status} /></dd>
            </div>
            {selected.reason ? (
              <div>
                <dt>Reason</dt>
                <dd>{selected.reason}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}
      </Modal>
    </div>
  );
}
