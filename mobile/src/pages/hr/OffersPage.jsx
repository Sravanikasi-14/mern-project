import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ChevronLeft,
  Clock3,
  Download,
  Eye,
  FileText,
  MoreVertical,
  Plus,
  Search,
  Send,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import ConfirmDialog from "../../components/ConfirmDialog";
import Modal from "../../components/Modal";
import StatusBadge from "../../components/StatusBadge";
import EmptyState, { ErrorState, Skeleton } from "../../components/EmptyState";
import ProfileAvatar from "../../components/ProfileAvatar";
import Pagination from "../../components/Pagination";
import { useAuth } from "../../app/AuthContext";
import { useNotify } from "../../app/notifyContext";
import { useToast } from "../../components/Toast";
import api from "../../services/api";

const OFFER_STATUSES = ["ALL", "DRAFT", "SENT", "ACCEPTED", "REJECTED"];
const OFFER_PAGE_SIZE = 20;

const emptyForm = {
  fullName: "",
  email: "",
  position: "",
  department: "",
  employmentType: "Full-time Permanent",
  workLocation: "",
  joiningDate: "",
  reportingManager: "",
  monthlySalary: "",
};

function offerName(offer) {
  return offer?.candidate?.fullName || offer?.candidateName || offer?.fullName || "Candidate";
}

function offerEmail(offer) {
  return offer?.candidate?.email || offer?.candidateEmail || offer?.email || "";
}

function offerPosition(offer) {
  return offer?.position || offer?.jobTitle || offer?.designation || "";
}

function formatMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `₹${n.toLocaleString("en-IN")}`;
}

function relativePrepared(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  const diff = Date.now() - d.getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return "Prepared just now";
  if (hours < 24) return `Prepared ${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Prepared yesterday";
  return `Prepared ${days}d ago`;
}

function stageHint(status) {
  switch (status) {
    case "DRAFT":
      return "Draft offer ready";
    case "SENT":
      return "Offer extended";
    case "ACCEPTED":
      return "Offer accepted";
    case "REJECTED":
      return "Offer declined";
    default:
      return "In pipeline";
  }
}

export default function HrOffersPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const notify = useNotify();
  const toast = useToast();

  const initialSeg = searchParams.get("view") === "offers" ? "offers" : "candidates";
  const [segment, setSegment] = useState(initialSeg);
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState({ total: 0, draft: 0, sent: 0, accepted: 0, rejected: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [statusFilter, setStatusFilter] = useState(
    () => {
      const s = (searchParams.get("status") || "ALL").toUpperCase();
      return OFFER_STATUSES.includes(s) ? s : "ALL";
    }
  );
  const [positionFilter, setPositionFilter] = useState("");

  const [selected, setSelected] = useState(null);
  const [sheet, setSheet] = useState(null); // detail | actions | create | filter
  const [send, setSend] = useState(null);
  const [remove, setRemove] = useState(null);
  const [statusConfirm, setStatusConfirm] = useState(null);

  const [createStep, setCreateStep] = useState(1);
  const [form, setForm] = useState(emptyForm);
  const [formErrors, setFormErrors] = useState({});
  const [clauses, setClauses] = useState([]);
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [downloadingId, setDownloadingId] = useState(null);
  const previewReq = useRef(0);
  const submitLock = useRef(false);

  const load = async () => {
    try {
      setLoading(true);
      setError("");
      const query = new URLSearchParams({
        limit: String(OFFER_PAGE_SIZE),
        page: String(page),
      });
      if (statusFilter !== "ALL") query.set("status", statusFilter);
      if (search.trim()) query.set("search", search.trim());

      const [listRes, summaryRes, clausesRes] = await Promise.all([
        api.get(`/offer-letters?${query.toString()}`),
        api.get("/offer-letters/summary").catch(() => null),
        api.get("/offer-letters/clauses").catch(() => null),
      ]);

      const list = listRes.data?.offerLetters;
      if (!Array.isArray(list)) {
        setError("Offers could not be read from the server response.");
        setItems([]);
        return;
      }
      setItems(list);
      const pagination = listRes.data?.pagination || {};
      setTotalItems(pagination.total ?? list.length);
      setTotalPages(pagination.totalPages ?? 1);
      if (summaryRes?.data) {
        const s = summaryRes.data.summary || summaryRes.data;
        setSummary({
          total: s.total ?? 0,
          draft: s.draft ?? 0,
          sent: s.sent ?? 0,
          accepted: s.accepted ?? 0,
          rejected: s.rejected ?? 0,
        });
      }
      if (Array.isArray(clausesRes?.data?.clauses)) {
        setClauses(clausesRes.data.clauses);
      }
    } catch (err) {
      setError(err.response?.data?.message || "Could not load recruitment data.");
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setPage(1);
  }, [statusFilter, search]);

  useEffect(() => {
    const t = setTimeout(() => load(), search ? 280 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, search, page]);

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (segment === "offers") next.set("view", "offers");
    else next.delete("view");
    if (statusFilter !== "ALL") next.set("status", statusFilter);
    else next.delete("status");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segment, statusFilter]);

  const positions = useMemo(() => {
    const set = new Set();
    items.forEach((o) => {
      const p = offerPosition(o);
      if (p) set.add(p);
    });
    return [...set].sort();
  }, [items]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((offer) => {
      if (positionFilter && offerPosition(offer) !== positionFilter) return false;
      if (!q) return true;
      const hay = `${offerName(offer)} ${offerPosition(offer)} ${offerEmail(offer)} ${offer.status || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [items, search, positionFilter]);

  const statusChips = useMemo(() => {
    const counts = {
      ALL: summary.total || items.length,
      DRAFT: summary.draft,
      SENT: summary.sent,
      ACCEPTED: summary.accepted,
      REJECTED: summary.rejected,
    };
    return OFFER_STATUSES.map((value) => ({
      value,
      label: value === "ALL" ? "All" : value.charAt(0) + value.slice(1).toLowerCase(),
      count: counts[value] ?? 0,
    }));
  }, [summary, items.length]);

  const offerTabPills = [
    { value: "DRAFT", label: "Drafts", count: summary.draft },
    { value: "SENT", label: "Sent", count: summary.sent },
    { value: "ACCEPTED", label: "Accepted", count: summary.accepted },
  ];

  const switchSegment = (next) => {
    setSegment(next);
    if (next === "offers" && statusFilter === "ALL") setStatusFilter("DRAFT");
    if (next === "candidates" && ["DRAFT", "SENT", "ACCEPTED"].includes(statusFilter)) {
      /* keep */
    }
  };

  const openCreate = (prefill) => {
    const fromOffer = Boolean(prefill?._id || prefill?.candidate);
    setForm({
      ...emptyForm,
      fullName: fromOffer ? offerName(prefill) : "",
      email: fromOffer ? offerEmail(prefill) : "",
      position: fromOffer ? offerPosition(prefill) : "",
      department: fromOffer ? prefill.department || "" : "",
      monthlySalary: fromOffer && prefill?.monthlySalary != null ? String(prefill.monthlySalary) : "",
      joiningDate:
        fromOffer && prefill?.joiningDate
          ? new Date(prefill.joiningDate).toISOString().slice(0, 10)
          : "",
      workLocation: fromOffer ? prefill.workLocation || "" : "",
      reportingManager: fromOffer ? prefill.reportingManager || "" : "",
      employmentType: fromOffer
        ? prefill.employmentType || emptyForm.employmentType
        : emptyForm.employmentType,
    });
    setFormErrors({});
    setPreviewHtml("");
    setCreateStep(1);
    setSelected(fromOffer ? prefill : null);
    setSheet("create");
  };

  const validateForm = () => {
    const errors = {};
    if (!form.fullName.trim()) errors.fullName = "Candidate name is required.";
    if (!form.email.trim()) errors.email = "Email is required.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      errors.email = "Enter a valid email.";
    }
    if (!form.position.trim()) errors.position = "Position is required.";
    if (!form.joiningDate) errors.joiningDate = "Joining date is required.";
    const salary = parseFloat(form.monthlySalary);
    if (!form.monthlySalary || Number.isNaN(salary) || salary <= 0) {
      errors.monthlySalary = "Monthly salary must be a positive amount.";
    }
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const buildPayload = () => ({
    candidate: {
      fullName: form.fullName.trim(),
      email: form.email.trim().toLowerCase(),
    },
    position: form.position.trim(),
    department: form.department.trim(),
    employmentType: form.employmentType,
    workLocation: form.workLocation.trim(),
    joiningDate: form.joiningDate,
    reportingManager: form.reportingManager.trim(),
    monthlySalary: parseFloat(form.monthlySalary),
    clauses: (clauses.length ? clauses : []).map((c, i) => ({
      ...c,
      isIncluded: c.enabled !== false && c.isIncluded !== false,
      enabled: c.enabled !== false && c.isIncluded !== false,
      order: typeof c.order === "number" ? c.order : i,
    })),
  });

  const loadPreview = async () => {
    if (!validateForm()) {
      setCreateStep(1);
      return;
    }
    const requestId = ++previewReq.current;
    setPreviewLoading(true);
    setCreateStep(2);
    try {
      const res = await api.post("/offer-letters/preview", buildPayload());
      if (requestId !== previewReq.current) return;
      if (res.data?.success && res.data.html) setPreviewHtml(res.data.html);
      else setPreviewHtml("<p>Preview unavailable.</p>");
    } catch {
      if (requestId === previewReq.current) {
        setPreviewHtml("<p>Could not generate preview. You can still save the draft.</p>");
      }
    } finally {
      if (requestId === previewReq.current) setPreviewLoading(false);
    }
  };

  const saveOffer = async (mode = "draft") => {
    if (!validateForm() || submitLock.current) return;
    submitLock.current = true;
    try {
      setBusy(true);
      setError("");
      const res = await api.post("/offer-letters", buildPayload());
      const saved = res.data?.offerLetter;
      if (mode === "send" && saved?._id) {
        try {
          await api.post(`/offer-letters/${saved._id}/send`);
          toast.push(`Offer sent to ${saved.candidate?.email || form.email}.`);
        } catch (sendErr) {
          setError(sendErr.response?.data?.message || "Offer saved, but email delivery failed.");
          toast.push("Offer saved as draft; send failed.");
        }
      } else if (mode === "download" && saved?._id) {
        toast.push("Offer letter created.");
        await downloadPdf(saved._id, saved.candidate?.fullName || form.fullName);
      } else {
        toast.push("Offer letter draft created.");
      }
      setSheet(null);
      setCreateStep(1);
      await load();
      setSegment("offers");
      setStatusFilter(mode === "send" ? "SENT" : "DRAFT");
    } catch (err) {
      setError(err.response?.data?.message || "Could not create this offer.");
      const backendErrors = err.response?.data?.errors;
      if (backendErrors && typeof backendErrors === "object") setFormErrors(backendErrors);
    } finally {
      setBusy(false);
      submitLock.current = false;
    }
  };

  const downloadPdf = async (offerId, candidateName) => {
    try {
      setDownloadingId(offerId);
      const response = await api.get(`/offer-letters/${offerId}/pdf`, { responseType: "blob" });
      const blob = new Blob([response.data], { type: "application/pdf" });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      const safe = (candidateName || "Candidate").replace(/[^a-zA-Z0-9_-]/g, "_");
      link.href = url;
      link.download = `Offer_Letter_${safe}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      toast.push("Offer letter PDF downloaded.");
    } catch (err) {
      setError(err.response?.data?.message || "Could not download PDF.");
    } finally {
      setDownloadingId(null);
    }
  };

  const openOfferDetail = async (offer) => {
    setSelected(offer);
    setSheet("detail");
    try {
      const res = await api.get(`/offer-letters/${offer._id}`);
      setSelected(res.data?.offerLetter || offer);
    } catch {
      setSelected(offer);
    }
  };

  const sendOffer = async () => {
    if (!send?._id || submitLock.current) return;
    submitLock.current = true;
    try {
      await api.post(`/offer-letters/${send._id}/send`);
      toast.push("Offer sent.");
      setSend(null);
      setSheet(null);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "Could not send this offer.");
      setSend(null);
    } finally {
      submitLock.current = false;
    }
  };

  const deleteOffer = async () => {
    if (!remove?._id || submitLock.current) return;
    submitLock.current = true;
    try {
      await api.delete(`/offer-letters/${remove._id}`);
      toast.push("Offer deleted.");
      setRemove(null);
      setSheet(null);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "Could not delete this offer.");
      setRemove(null);
    } finally {
      submitLock.current = false;
    }
  };

  const updateStatus = async () => {
    if (!statusConfirm?.offer?._id || !statusConfirm.status || submitLock.current) return;
    submitLock.current = true;
    try {
      await api.patch(`/offer-letters/${statusConfirm.offer._id}/status`, {
        status: statusConfirm.status,
      });
      toast.push(`Marked as ${statusConfirm.status.toLowerCase()}.`);
      setStatusConfirm(null);
      setSheet(null);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || "Could not update offer status.");
      setStatusConfirm(null);
    } finally {
      submitLock.current = false;
    }
  };

  const bannerCopy =
    statusFilter === "DRAFT"
      ? { title: `${summary.draft} Pending Drafts`, sub: "Ready for review and send" }
      : statusFilter === "SENT"
        ? { title: `${summary.sent} Sent Offers`, sub: "Awaiting candidate response" }
        : statusFilter === "ACCEPTED"
          ? { title: `${summary.accepted} Accepted`, sub: "Ready for onboarding handoff" }
          : { title: `${summary.total} Total Offers`, sub: "Draft · Sent · Accepted · Rejected" };

  if (loading && items.length === 0 && !error) {
    return (
      <div className="st-rec">
        <header className="st-subhead">
          <button type="button" className="icon-btn" aria-label="Go back" onClick={() => navigate(-1)}>
            <ChevronLeft size={22} strokeWidth={1.85} />
          </button>
          <h1>{segment === "offers" ? "Offer Letters" : "Recruitment"}</h1>
        </header>
        <Skeleton />
      </div>
    );
  }

  if (error && items.length === 0 && !loading) {
    return (
      <div className="st-rec">
        <header className="st-subhead">
          <button type="button" className="icon-btn" aria-label="Go back" onClick={() => navigate(-1)}>
            <ChevronLeft size={22} strokeWidth={1.85} />
          </button>
          <h1>Recruitment</h1>
        </header>
        <ErrorState message={error} onRetry={load} />
      </div>
    );
  }

  return (
    <div className="st-rec">
      <header className="st-subhead">
        <button type="button" className="icon-btn" aria-label="Go back" onClick={() => navigate(-1)}>
          <ChevronLeft size={22} strokeWidth={1.85} />
        </button>
        <h1>{segment === "offers" ? "Offer Letters" : "Recruitment"}</h1>
        <div className="st-subhead-actions">
          <button type="button" className="icon-btn" aria-label="Notifications" onClick={() => notify()}>
            <MoreVertical size={20} strokeWidth={1.85} />
          </button>
          <span className="hr-portal-avatar">{initialsFrom(user?.name || user?.email || "HR")}</span>
        </div>
      </header>

      {error ? <div className="alert alert-error">{error}</div> : null}

      <div className="st-rec-seg" role="tablist" aria-label="Recruitment views">
        <button
          type="button"
          className={segment === "candidates" ? "is-active" : ""}
          onClick={() => switchSegment("candidates")}
        >
          Candidates
        </button>
        <button
          type="button"
          className={segment === "offers" ? "is-active" : ""}
          onClick={() => switchSegment("offers")}
        >
          Offers
        </button>
      </div>

      {segment === "candidates" ? (
        <div className="st-rec-metrics">
          <div>
            <span>Active Pipeline</span>
            <strong>{summary.total}</strong>
            <em>{summary.draft} draft</em>
          </div>
          <div>
            <span>Awaiting Reply</span>
            <strong>{summary.sent}</strong>
            <em>Sent offers</em>
          </div>
          <div>
            <span>Accepted</span>
            <strong>{String(summary.accepted).padStart(2, "0")}</strong>
            <em>{summary.rejected} declined</em>
          </div>
        </div>
      ) : (
        <>
          <div className="st-rec-offer-tabs" role="tablist" aria-label="Offer status">
            {offerTabPills.map((pill) => (
              <button
                key={pill.value}
                type="button"
                className={statusFilter === pill.value ? "is-active" : ""}
                onClick={() => setStatusFilter(pill.value)}
              >
                {pill.label} ({pill.count})
              </button>
            ))}
          </div>
          <section className="st-rec-banner">
            <div className="st-rec-banner-ico">
              <FileText size={18} strokeWidth={1.85} aria-hidden="true" />
            </div>
            <div>
              <strong>{bannerCopy.title}</strong>
              <span>{bannerCopy.sub}</span>
            </div>
          </section>
        </>
      )}

      <div className="st-ast-search-row">
        <div className="st-att-search">
          <Search size={18} strokeWidth={1.85} aria-hidden="true" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={
              segment === "offers" ? "Search candidates or role..." : "Search candidates, roles..."
            }
            aria-label="Search"
          />
        </div>
        <button
          type="button"
          className={`st-ast-filter-btn${positionFilter ? " is-active" : ""}`}
          aria-label="Filter"
          onClick={() => setSheet("filter")}
        >
          <SlidersHorizontal size={18} strokeWidth={1.85} />
        </button>
      </div>

      {segment === "candidates" ? (
        <div className="st-pill-row" role="tablist" aria-label="Pipeline status">
          {statusChips.map((chip) => (
            <button
              key={chip.value}
              type="button"
              className={`st-pill${statusFilter === chip.value ? " is-active" : ""}`}
              onClick={() => setStatusFilter(chip.value)}
            >
              {chip.label} ({chip.count})
            </button>
          ))}
        </div>
      ) : (
        <div className="st-pay-list-head">
          <h2>Ready for Finalization</h2>
          <span>{filtered.length} shown</span>
        </div>
      )}

      {loading ? (
        <Skeleton />
      ) : filtered.length === 0 ? (
        <EmptyState
          message={
            segment === "offers"
              ? "No offer letters in this view."
              : "No candidates match criteria."
          }
          actionLabel={segment === "offers" ? "Generate offer" : "Add candidate"}
          onAction={() => openCreate()}
        />
      ) : (
        <div className="st-rec-list">
          {filtered.map((offer) => {
            const name = offerName(offer);
            const position = offerPosition(offer);
            return (
              <article key={offer._id} className="st-rec-card">
                <button type="button" className="st-rec-card-main" onClick={() => openOfferDetail(offer)}>
                  <ProfileAvatar name={name} size={44} className="st-rec-avatar" />
                  <span className="st-rec-copy">
                    <strong>
                      {name}
                      {segment === "offers" ? (
                        <StatusBadge status={offer.status} />
                      ) : null}
                    </strong>
                    <span>{position || "Role TBD"}</span>
                    <em>
                      {segment === "offers" ? (
                        <>
                          <Clock3 size={12} strokeWidth={2} aria-hidden="true" />
                          {relativePrepared(offer.updatedAt || offer.createdAt)}
                          {offer.monthlySalary != null ? ` · ${formatMoney(offer.monthlySalary)}` : ""}
                        </>
                      ) : (
                        <>
                          {stageHint(offer.status)}
                          {offer.joiningDate
                            ? ` · Join ${new Date(offer.joiningDate).toLocaleDateString()}`
                            : ""}
                        </>
                      )}
                    </em>
                  </span>
                </button>
                <div className="st-rec-card-side">
                  {segment === "candidates" ? <StatusBadge status={offer.status} /> : null}
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`${name} actions`}
                    onClick={() => {
                      setSelected(offer);
                      setSheet("actions");
                    }}
                  >
                    <MoreVertical size={18} strokeWidth={1.85} />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <Pagination
        page={page}
        totalPages={totalPages}
        totalItems={totalItems}
        pageSize={OFFER_PAGE_SIZE}
        onPageChange={setPage}
        itemLabel="offers"
      />

      <button type="button" className="st-pay-fab" onClick={() => openCreate()}>
        <Plus size={18} strokeWidth={2} aria-hidden="true" />
        {segment === "offers" ? "Generate Offer" : "Add Candidate"}
      </button>

      <Modal
        open={Boolean(sheet)}
        onClose={() => {
          if (busy && sheet === "create") return;
          setSheet(null);
        }}
        size={sheet === "actions" || sheet === "filter" ? "sm" : "md"}
        title={
          sheet === "create"
            ? createStep === 1
              ? "Create offer letter"
              : "Preview offer letter"
            : sheet === "filter"
              ? "Filters"
              : sheet === "actions"
                ? selected
                  ? offerName(selected)
                  : "Actions"
                : selected
                  ? offerName(selected)
                  : "Candidate"
        }
        footer={
          sheet === "detail" && selected ? (
            <>
              <button
                type="button"
                className="btn-secondary"
                disabled={downloadingId === selected._id}
                onClick={() => downloadPdf(selected._id, offerName(selected))}
              >
                <Download size={14} strokeWidth={2} aria-hidden="true" />
                {downloadingId === selected._id ? "…" : "PDF"}
              </button>
              {selected.status === "DRAFT" ? (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => {
                    setSend(selected);
                    setSheet(null);
                  }}
                >
                  Send offer
                </button>
              ) : null}
              {selected.status === "SENT" ? (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => {
                    setStatusConfirm({ offer: selected, status: "ACCEPTED" });
                    setSheet(null);
                  }}
                >
                  Mark accepted
                </button>
              ) : null}
            </>
          ) : sheet === "create" ? (
            createStep === 1 ? (
              <>
                <button type="button" className="btn-secondary" onClick={() => setSheet(null)} disabled={busy}>
                  Cancel
                </button>
                <button type="button" className="btn-primary" onClick={loadPreview} disabled={busy}>
                  Preview
                </button>
              </>
            ) : (
              <>
                <button type="button" className="btn-secondary" onClick={() => setCreateStep(1)} disabled={busy}>
                  Back
                </button>
                <button type="button" className="btn-secondary" onClick={() => saveOffer("draft")} disabled={busy}>
                  {busy ? "…" : "Save draft"}
                </button>
                <button type="button" className="btn-primary" onClick={() => saveOffer("send")} disabled={busy}>
                  {busy ? "…" : "Save & send"}
                </button>
              </>
            )
          ) : sheet === "filter" ? (
            <>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setPositionFilter("");
                  setStatusFilter("ALL");
                  setSheet(null);
                }}
              >
                Reset
              </button>
              <button type="button" className="btn-primary" onClick={() => setSheet(null)}>
                Apply
              </button>
            </>
          ) : null
        }
      >
        {sheet === "actions" && selected ? (
          <div className="st-rec-actions">
            <button type="button" onClick={() => setSheet("detail")}>
              <Eye size={18} strokeWidth={1.85} />
              <span>
                <strong>View details</strong>
                <em>Contact and offer information</em>
              </span>
            </button>
            <button type="button" onClick={() => openCreate(selected)}>
              <FileText size={18} strokeWidth={1.85} />
              <span>
                <strong>Generate Offer</strong>
                <em>Review compensation & clauses</em>
              </span>
            </button>
            {selected.status === "DRAFT" ? (
              <button
                type="button"
                onClick={() => {
                  setSend(selected);
                  setSheet(null);
                }}
              >
                <Send size={18} strokeWidth={1.85} />
                <span>
                  <strong>Send offer</strong>
                  <em>Email via existing integration</em>
                </span>
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                downloadPdf(selected._id, offerName(selected));
                setSheet(null);
              }}
            >
              <Download size={18} strokeWidth={1.85} />
              <span>
                <strong>Download PDF</strong>
                <em>Generated offer letter</em>
              </span>
            </button>
            {selected.status === "DRAFT" ? (
              <button
                type="button"
                className="is-danger"
                onClick={() => {
                  setRemove(selected);
                  setSheet(null);
                }}
              >
                <Trash2 size={18} strokeWidth={1.85} />
                <span>
                  <strong>Delete draft</strong>
                  <em>Cannot be undone</em>
                </span>
              </button>
            ) : null}
          </div>
        ) : null}

        {sheet === "detail" && selected ? (
          <div className="st-ast-detail">
            <StatusBadge status={selected.status} />
            <div className="st-detail-card" style={{ marginTop: 12 }}>
              <div className="st-detail-row">
                <span>Email</span>
                <strong>{offerEmail(selected) || "—"}</strong>
              </div>
              <div className="st-detail-row">
                <span>Position</span>
                <strong>{offerPosition(selected) || "—"}</strong>
              </div>
              <div className="st-detail-row">
                <span>Department</span>
                <strong>{selected.department || "—"}</strong>
              </div>
              <div className="st-detail-row">
                <span>Monthly salary</span>
                <strong>{formatMoney(selected.monthlySalary)}</strong>
              </div>
              <div className="st-detail-row">
                <span>Joining date</span>
                <strong>
                  {selected.joiningDate
                    ? new Date(selected.joiningDate).toLocaleDateString()
                    : "—"}
                </strong>
              </div>
              <div className="st-detail-row">
                <span>Work location</span>
                <strong>{selected.workLocation || "—"}</strong>
              </div>
            </div>
            {selected.status === "DRAFT" ? (
              <div className="st-rec-detail-actions">
                <button type="button" className="btn-secondary btn-block" onClick={() => openCreate(selected)}>
                  Create related offer
                </button>
                <button
                  type="button"
                  className="btn-danger btn-block"
                  onClick={() => {
                    setRemove(selected);
                    setSheet(null);
                  }}
                >
                  Delete draft
                </button>
              </div>
            ) : null}
            {selected.status === "SENT" ? (
              <button
                type="button"
                className="btn-secondary btn-block"
                style={{ marginTop: 12 }}
                onClick={() => {
                  setStatusConfirm({ offer: selected, status: "REJECTED" });
                  setSheet(null);
                }}
              >
                Mark declined
              </button>
            ) : null}
          </div>
        ) : null}

        {sheet === "create" ? (
          createStep === 1 ? (
            <form
              className="form-grid"
              onSubmit={(e) => {
                e.preventDefault();
                loadPreview();
              }}
            >
              <p className="caption">Step 1 of 2 — Candidate & offer details. Clauses use the company template library.</p>
              <label>
                Candidate name *
                <input
                  value={form.fullName}
                  onChange={(e) => setForm((p) => ({ ...p, fullName: e.target.value }))}
                />
                {formErrors.fullName ? <em className="field-error">{formErrors.fullName}</em> : null}
              </label>
              <label>
                Email *
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                />
                {formErrors.email ? <em className="field-error">{formErrors.email}</em> : null}
              </label>
              <label>
                Position *
                <input
                  value={form.position}
                  onChange={(e) => setForm((p) => ({ ...p, position: e.target.value }))}
                />
                {formErrors.position ? <em className="field-error">{formErrors.position}</em> : null}
              </label>
              <label>
                Department
                <input
                  value={form.department}
                  onChange={(e) => setForm((p) => ({ ...p, department: e.target.value }))}
                />
              </label>
              <label>
                Monthly salary *
                <input
                  type="number"
                  min="1"
                  value={form.monthlySalary}
                  onChange={(e) => setForm((p) => ({ ...p, monthlySalary: e.target.value }))}
                />
                {formErrors.monthlySalary ? <em className="field-error">{formErrors.monthlySalary}</em> : null}
              </label>
              <label>
                Joining date *
                <input
                  type="date"
                  value={form.joiningDate}
                  onChange={(e) => setForm((p) => ({ ...p, joiningDate: e.target.value }))}
                />
                {formErrors.joiningDate ? <em className="field-error">{formErrors.joiningDate}</em> : null}
              </label>
              <label>
                Work location
                <input
                  value={form.workLocation}
                  onChange={(e) => setForm((p) => ({ ...p, workLocation: e.target.value }))}
                />
              </label>
              <label>
                Reporting manager
                <input
                  value={form.reportingManager}
                  onChange={(e) => setForm((p) => ({ ...p, reportingManager: e.target.value }))}
                />
              </label>
              <label>
                Employment type
                <select
                  value={form.employmentType}
                  onChange={(e) => setForm((p) => ({ ...p, employmentType: e.target.value }))}
                >
                  <option>Full-time Permanent</option>
                  <option>Full-time Contract</option>
                  <option>Part-time</option>
                  <option>Intern</option>
                </select>
              </label>
              <p className="caption">
                Template: {clauses.length ? `${clauses.length} standard clauses` : "Server defaults on save"}
              </p>
            </form>
          ) : (
            <div className="st-rec-preview">
              <p className="caption">Step 2 of 2 — Live preview from `/offer-letters/preview`.</p>
              {previewLoading ? (
                <Skeleton />
              ) : (
                <iframe title="Offer letter preview" className="st-rec-preview-frame" srcDoc={previewHtml} />
              )}
              <button
                type="button"
                className="btn-secondary btn-block"
                disabled={busy}
                onClick={() => saveOffer("download")}
              >
                Save & download PDF
              </button>
            </div>
          )
        ) : null}

        {sheet === "filter" ? (
          <div className="form-grid">
            <label>
              Position
              <select value={positionFilter} onChange={(e) => setPositionFilter(e.target.value)}>
                <option value="">All positions</option>
                {positions.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Status
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                {OFFER_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s === "ALL" ? "All" : s}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={Boolean(send)}
        onClose={() => setSend(null)}
        title="Send offer"
        message={`Send the offer letter to ${offerName(send) || "this candidate"} (${offerEmail(send) || "email"})?`}
        confirmLabel="Send offer"
        onConfirm={sendOffer}
      />
      <ConfirmDialog
        open={Boolean(remove)}
        onClose={() => setRemove(null)}
        title="Delete offer"
        message="This cannot be undone. Only draft offers can be deleted."
        confirmLabel="Delete offer"
        danger
        onConfirm={deleteOffer}
      />
      <ConfirmDialog
        open={Boolean(statusConfirm)}
        onClose={() => setStatusConfirm(null)}
        title={statusConfirm?.status === "ACCEPTED" ? "Mark accepted" : "Mark declined"}
        message={`Update ${offerName(statusConfirm?.offer)} to ${statusConfirm?.status}?`}
        confirmLabel="Confirm"
        onConfirm={updateStatus}
      />
    </div>
  );
}
