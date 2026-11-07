import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useSmartBack } from "../../hooks/useSmartBack";
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
import ProfileAvatar, { initialsFrom } from "../../components/ProfileAvatar";
import Pagination from "../../components/Pagination";
import { useAuth } from "../../app/AuthContext";
import { useNotify } from "../../app/notifyContext";
import { useToast } from "../../components/Toast";
import api, {
  isRequestTimeoutError,
  postOfferLetterSend,
} from "../../services/api";
import {
  blobFromAxiosResponse,
  documentErrorMessage,
  openDocument,
  saveDocument,
} from "../../services/documents";

const OFFER_STATUSES = ["ALL", "DRAFT", "SENT", "ACCEPTED", "REJECTED", "WITHDRAWN"];
const OFFER_PAGE_SIZE = 20;
const HR_SIGNATURE_REQUIRED_MESSAGE =
  "Save your electronic signature in Settings before sending offer letters.";

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
    case "WITHDRAWN":
      return "Offer withdrawn";
    default:
      return "In pipeline";
  }
}

export default function HrOffersPage() {
  const navigate = useNavigate();
  const goBack = useSmartBack("/admin/more");
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const notify = useNotify();
  const toast = useToast();

  const initialSeg = searchParams.get("view") === "offers" ? "offers" : "candidates";
  const [segment, setSegment] = useState(initialSeg);
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState({
    total: 0,
    draft: 0,
    sent: 0,
    accepted: 0,
    rejected: 0,
    withdrawn: 0,
  });
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
  const [withdrawConfirm, setWithdrawConfirm] = useState(null); // { offer, reason }

  const [createStep, setCreateStep] = useState(1);
  const [form, setForm] = useState(emptyForm);
  const [formErrors, setFormErrors] = useState({});
  const [clauses, setClauses] = useState([]);
  const [defaultClauses, setDefaultClauses] = useState([]);
  const [recipients, setRecipients] = useState([]);
  const [employeeId, setEmployeeId] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [hrSignatureSaved, setHrSignatureSaved] = useState(null); // null = unknown
  const [busy, setBusy] = useState(false);
  const [downloadingId, setDownloadingId] = useState(null);
  const previewReq = useRef(0);
  const submitLock = useRef(false);
  const createDepsLoadedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get("/settings/company")
      .then((res) => {
        if (cancelled) return;
        const c = res.data?.company || res.data?.data || {};
        setHrSignatureSaved(Boolean(c.letterhead?.hasSignature));
      })
      .catch(() => {
        if (!cancelled) setHrSignatureSaved(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

      // List page: only list + summary. Defer clauses/recipients/templates until create.
      const [listRes, summaryRes] = await Promise.all([
        api.get(`/offer-letters?${query.toString()}`),
        api.get("/offer-letters/summary").catch(() => null),
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
    } catch (err) {
      setError(err.response?.data?.message || "Could not load recruitment data.");
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  const ensureCreateDeps = async () => {
    if (createDepsLoadedRef.current) return;
    try {
      const [clausesRes, recipientsRes] = await Promise.all([
        api.get("/offer-letters/clauses").catch(() => null),
        api.get("/offer-letters/recipients").catch(() => null),
      ]);
      if (Array.isArray(clausesRes?.data?.clauses)) {
        const defs = clausesRes.data.clauses.map((c, i) => ({
          ...c,
          enabled: c.enabled !== false && c.isIncluded !== false,
          isIncluded: c.enabled !== false && c.isIncluded !== false,
          order: typeof c.order === "number" ? c.order : i,
        }));
        setDefaultClauses(defs);
        setClauses((prev) => (editingId && prev.length ? prev : defs));
      }
      if (Array.isArray(recipientsRes?.data?.recipients)) {
        setRecipients(recipientsRes.data.recipients);
      }
      createDepsLoadedRef.current = true;
    } catch {
      // Create sheet can still open; individual actions surface errors.
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
      WITHDRAWN: summary.withdrawn,
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

  const applyRecipient = (recipientId) => {
    setEmployeeId(recipientId || "");
    if (!recipientId) return;
    const r = recipients.find((x) => String(x._id) === String(recipientId));
    if (!r) return;
    setForm((prev) => ({
      ...prev,
      fullName: r.fullName || prev.fullName,
      email: r.email || prev.email,
      position: r.position || prev.position,
      department: r.department || prev.department,
      workLocation: r.workLocation || prev.workLocation,
      employmentType: r.employmentType || prev.employmentType,
      reportingManager: r.reportingManager || prev.reportingManager,
      monthlySalary: r.monthlySalary != null ? String(r.monthlySalary) : prev.monthlySalary,
      joiningDate: r.joiningDate
        ? new Date(r.joiningDate).toISOString().slice(0, 10)
        : prev.joiningDate,
    }));
  };

  const openCreate = async (prefill, { asEdit = false } = {}) => {
    await ensureCreateDeps();
    const fromOffer = Boolean(prefill?._id || prefill?.candidate);
    const isDraftEdit = asEdit && fromOffer && prefill?._id && String(prefill.status || "").toUpperCase() === "DRAFT";
    setEditingId(isDraftEdit ? prefill._id : null);
    setEmployeeId(
      isDraftEdit || fromOffer
        ? prefill?.employeeId?._id || prefill?.employeeId || prefill?.employee?._id || ""
        : ""
    );
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
    if (isDraftEdit && Array.isArray(prefill.clauses) && prefill.clauses.length) {
      setClauses(
        prefill.clauses.map((c, i) => ({
          ...c,
          enabled: c.enabled !== false && c.isIncluded !== false,
          isIncluded: c.enabled !== false && c.isIncluded !== false,
          order: typeof c.order === "number" ? c.order : i,
        }))
      );
    } else if (defaultClauses.length) {
      setClauses(defaultClauses.map((c) => ({ ...c })));
    }
    setFormErrors({});
    setPreviewHtml("");
    setCreateStep(1);
    setSelected(fromOffer ? prefill : null);
    setSheet("create");
  };

  const openEditDraft = async (offer) => {
    if (!offer?._id) return;
    try {
      setBusy(true);
      const res = await api.get(`/offer-letters/${offer._id}`);
      const full = res.data?.offerLetter || offer;
      openCreate(full, { asEdit: true });
    } catch {
      openCreate(offer, { asEdit: true });
    } finally {
      setBusy(false);
    }
  };

  const updateClause = (index, patch) => {
    setClauses((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  };

  const addCustomClause = () => {
    setClauses((prev) => [
      ...prev,
      {
        id: `custom-${Date.now()}`,
        title: "Custom clause",
        body: "",
        enabled: true,
        isIncluded: true,
        isCustom: true,
        order: prev.length,
      },
    ]);
  };

  const resetClauses = () => {
    setClauses(defaultClauses.map((c) => ({ ...c })));
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
    employeeId: employeeId || null,
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
      const payload = buildPayload();
      const res = editingId
        ? await api.put(`/offer-letters/${editingId}`, payload)
        : await api.post("/offer-letters", payload);
      const saved = res.data?.offerLetter;
      if (mode === "send" && saved?._id && hrSignatureSaved !== true) {
        setError(HR_SIGNATURE_REQUIRED_MESSAGE);
        toast.push("Offer saved as a draft. Add an HR signature in Settings to send it.");
      } else if (mode === "send" && saved?._id) {
        try {
          const sendRes = await postOfferLetterSend(saved._id);
          if (!sendRes.data?.success) {
            throw new Error(
              sendRes.data?.message || "Offer saved, but email delivery failed."
            );
          }
          toast.push(`Offer sent to ${saved.candidate?.email || form.email}.`);
        } catch (sendErr) {
          if (isRequestTimeoutError(sendErr)) {
            const msg =
              "Send timed out while waiting for the mail server. The email may still have been sent — check delivery status before retrying.";
            setError(msg);
            toast.push(msg);
          } else {
            const delivery = sendErr.response?.data?.offerLetter?.emailDelivery;
            const msg =
              sendErr.response?.data?.message ||
              delivery?.error ||
              "Offer saved, but email delivery failed.";
            setError(msg);
            toast.push("Offer saved; email delivery failed.");
            if (sendErr.response?.data?.offerLetter) setSelected(sendErr.response.data.offerLetter);
          }
        }
      } else if (mode === "download" && saved?._id) {
        toast.push(editingId ? "Offer letter updated." : "Offer letter created.");
        await downloadPdf(saved._id, saved.candidate?.fullName || form.fullName);
      } else {
        toast.push(editingId ? "Draft updated." : "Offer letter draft created.");
      }
      setSheet(null);
      setCreateStep(1);
      setEditingId(null);
      await load();
      setSegment("offers");
      setStatusFilter(mode === "send" ? "SENT" : "DRAFT");
    } catch (err) {
      setError(err.response?.data?.message || (editingId ? "Could not update this offer." : "Could not create this offer."));
      const backendErrors = err.response?.data?.errors;
      if (backendErrors && typeof backendErrors === "object") setFormErrors(backendErrors);
    } finally {
      setBusy(false);
      submitLock.current = false;
    }
  };

  const downloadPdf = async (offerId, candidateName, mode = "save") => {
    if (downloadingId) return;
    try {
      setDownloadingId(offerId);
      setError("");
      const response = await api.get(`/offer-letters/${offerId}/pdf`, { responseType: "blob" });
      const safe = (candidateName || "Candidate").replace(/[^a-zA-Z0-9_-]/g, "_");
      const file = await blobFromAxiosResponse(response, `Offer_Letter_${safe}.pdf`);
      // Force PDF MIME when the server returns octet-stream
      const payload = {
        ...file,
        mimeType: "application/pdf",
        blob: file.blob.type ? file.blob : new Blob([file.blob], { type: "application/pdf" }),
      };
      if (mode === "open") {
        await openDocument(payload);
      } else {
        await saveDocument(payload);
        toast.push("Offer PDF ready — use Save or Share.");
      }
    } catch (err) {
      setError(documentErrorMessage(err, "Could not download PDF."));
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
    if (hrSignatureSaved !== true) {
      toast.push(HR_SIGNATURE_REQUIRED_MESSAGE);
      setError(HR_SIGNATURE_REQUIRED_MESSAGE);
      setSend(null);
      return;
    }
    submitLock.current = true;
    try {
      setBusy(true);
      const sendRes = await postOfferLetterSend(send._id);
      if (!sendRes.data?.success) {
        throw new Error(sendRes.data?.message || "Could not send this offer.");
      }
      toast.push("Offer sent.");
      setSend(null);
      setSheet(null);
      await load();
    } catch (err) {
      if (isRequestTimeoutError(err)) {
        setError(
          "Send timed out while waiting for the mail server. The email may still have been sent — check delivery status before retrying."
        );
      } else {
        const delivery = err.response?.data?.offerLetter?.emailDelivery;
        const msg =
          err.response?.data?.message ||
          delivery?.error ||
          "Could not send this offer.";
        setError(msg);
        if (err.response?.data?.offerLetter) {
          setSelected(err.response.data.offerLetter);
          setSheet("detail");
        }
      }
      setSend(null);
      await load();
    } finally {
      setBusy(false);
      submitLock.current = false;
    }
  };

  const emailDeliveryLabel = (offer) => {
    const status = String(offer?.emailDelivery?.status || "").toUpperCase();
    if (status === "DELIVERY_FAILED") return "Email failed";
    if (status === "SENT") return "Email delivered";
    if (status === "NOT_SENT") return "Not emailed";
    return "";
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

  const withdrawOffer = async () => {
    if (!withdrawConfirm?.offer?._id || submitLock.current) return;
    const reason = String(withdrawConfirm.reason || "").trim();
    if (reason.length < 3) {
      setError("Enter a withdrawal reason (at least 3 characters).");
      return;
    }
    submitLock.current = true;
    try {
      setBusy(true);
      const res = await api.post(`/offer-letters/${withdrawConfirm.offer._id}/withdraw`, { reason });
      if (!res.data?.success) {
        throw new Error(res.data?.message || "Could not withdraw this offer.");
      }
      toast.push(res.data.message || "Offer withdrawn.");
      setWithdrawConfirm(null);
      setSheet(null);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Could not withdraw this offer.");
      setWithdrawConfirm(null);
    } finally {
      setBusy(false);
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
          <button type="button" className="icon-btn" aria-label="Go back" onClick={() => goBack()}>
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
          <button type="button" className="icon-btn" aria-label="Go back" onClick={() => goBack()}>
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
        <button type="button" className="icon-btn" aria-label="Go back" onClick={() => goBack()}>
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
      {hrSignatureSaved === false ? (
        <div className="alert alert-error" role="alert">
          {HR_SIGNATURE_REQUIRED_MESSAGE} Open Settings → Company profile.
        </div>
      ) : null}

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
                          {String(offer?.emailDelivery?.status || "").toUpperCase() === "DELIVERY_FAILED"
                            ? " · Email failed"
                            : ""}
                        </>
                      ) : (
                        <>
                          {stageHint(offer.status)}
                          {offer.joiningDate
                            ? ` · Join ${new Date(offer.joiningDate).toLocaleDateString()}`
                            : ""}
                          {String(offer?.emailDelivery?.status || "").toUpperCase() === "DELIVERY_FAILED"
                            ? " · Email failed"
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
              ? editingId
                ? "Edit offer draft"
                : "Create offer letter"
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
              {selected.status === "ACCEPTED" && !selected.employeeId ? (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => {
                    setSheet(null);
                    navigate(`/admin/onboarding?offerId=${selected._id}`);
                  }}
                >
                  Onboard
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
                  {busy ? "…" : editingId ? "Update draft" : "Save draft"}
                </button>
                <button type="button" className="btn-primary" onClick={() => saveOffer("send")} disabled={busy}>
                  {busy ? "…" : editingId ? "Update & send" : "Save & send"}
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
            {selected.status === "DRAFT" ? (
              <button type="button" onClick={() => openEditDraft(selected)}>
                <FileText size={18} strokeWidth={1.85} />
                <span>
                  <strong>Edit draft</strong>
                  <em>Update details, recipient & clauses</em>
                </span>
              </button>
            ) : (
              <button type="button" onClick={() => openCreate(selected)}>
                <FileText size={18} strokeWidth={1.85} />
                <span>
                  <strong>Generate related offer</strong>
                  <em>Copy candidate into a new draft</em>
                </span>
              </button>
            )}
            {selected.status === "DRAFT" ||
            selected.status === "SENT" ||
            String(selected?.emailDelivery?.status || "").toUpperCase() === "DELIVERY_FAILED" ? (
              <button
                type="button"
                onClick={() => {
                  setSend(selected);
                  setSheet(null);
                }}
              >
                <Send size={18} strokeWidth={1.85} />
                <span>
                  <strong>
                    {selected.status === "SENT" ||
                    String(selected?.emailDelivery?.status || "").toUpperCase() === "DELIVERY_FAILED"
                      ? "Resend offer"
                      : "Send offer"}
                  </strong>
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
            {selected.status === "SENT" && !selected.employeeId ? (
              <button
                type="button"
                className="is-danger"
                onClick={() => {
                  setWithdrawConfirm({ offer: selected, reason: "" });
                  setSheet(null);
                }}
              >
                <Trash2 size={18} strokeWidth={1.85} />
                <span>
                  <strong>Withdraw offer</strong>
                  <em>Revoke signing — does not delete records</em>
                </span>
              </button>
            ) : null}
            {selected.status === "ACCEPTED" && !selected.employeeId ? (
              <button
                type="button"
                onClick={() => {
                  setSheet(null);
                  navigate(`/admin/onboarding?offerId=${selected._id}`);
                }}
              >
                <FileText size={18} strokeWidth={1.85} />
                <span>
                  <strong>Open onboarding</strong>
                  <em>HR review workspace for this offer</em>
                </span>
              </button>
            ) : null}
          </div>
        ) : null}

        {sheet === "detail" && selected ? (
          <div className="st-ast-detail">
            <StatusBadge status={selected.status} />
            {emailDeliveryLabel(selected) ? (
              <p className="caption" style={{ marginTop: 8 }}>
                {emailDeliveryLabel(selected)}
                {selected.emailDelivery?.sentTo ? ` · ${selected.emailDelivery.sentTo}` : ""}
                {selected.emailDelivery?.attempts
                  ? ` · ${selected.emailDelivery.attempts} attempt(s)`
                  : ""}
              </p>
            ) : null}
            {String(selected?.emailDelivery?.status || "").toUpperCase() === "DELIVERY_FAILED" ? (
              <div className="alert alert-error" style={{ marginTop: 10 }}>
                {selected.emailDelivery?.error || "Email delivery failed. You can resend from actions."}
              </div>
            ) : null}
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
              <div className="st-detail-row">
                <span>Reporting manager</span>
                <strong>{selected.reportingManager || "—"}</strong>
              </div>
              <div className="st-detail-row">
                <span>Employment type</span>
                <strong>{selected.employmentType || "—"}</strong>
              </div>
              <div className="st-detail-row">
                <span>Clauses included</span>
                <strong>
                  {Array.isArray(selected.clauses)
                    ? selected.clauses.filter((c) => c.isIncluded !== false && c.enabled !== false).length
                    : "—"}
                </strong>
              </div>
            </div>
            {selected.status === "DRAFT" ? (
              <div className="st-rec-detail-actions">
                <button type="button" className="btn-primary btn-block" onClick={() => openEditDraft(selected)}>
                  Edit draft
                </button>
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
            {selected.status === "SENT" ||
            String(selected?.emailDelivery?.status || "").toUpperCase() === "DELIVERY_FAILED" ? (
              <button
                type="button"
                className="btn-primary btn-block"
                style={{ marginTop: 12 }}
                onClick={() => {
                  setSend(selected);
                  setSheet(null);
                }}
              >
                Resend offer email
              </button>
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
            {selected.status === "SENT" && !selected.employeeId ? (
              <button
                type="button"
                className="btn-danger btn-block"
                style={{ marginTop: 12 }}
                onClick={() => {
                  setWithdrawConfirm({ offer: selected, reason: "" });
                  setSheet(null);
                }}
              >
                Withdraw offer
              </button>
            ) : null}
            {selected.status === "ACCEPTED" && !selected.employeeId ? (
              <button
                type="button"
                className="btn-primary btn-block"
                style={{ marginTop: 12 }}
                onClick={() => {
                  setSheet(null);
                  navigate(`/admin/onboarding?offerId=${selected._id}`);
                }}
              >
                Open onboarding review
              </button>
            ) : null}
            {selected.status === "WITHDRAWN" && selected.withdrawal?.reason ? (
              <p className="caption" style={{ marginTop: 12 }}>
                Withdrawal reason: {selected.withdrawal.reason}
              </p>
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
              <p className="caption">
                Step 1 of 2 — {editingId ? "Edit draft details" : "Candidate & offer details"}. Toggle and edit
                clauses below.
              </p>
              <label>
                Recipient (optional)
                <select value={employeeId || ""} onChange={(e) => applyRecipient(e.target.value)}>
                  <option value="">External candidate / manual entry</option>
                  {recipients.map((r) => (
                    <option key={r._id} value={r._id}>
                      {r.fullName}
                      {r.employeeCode ? ` · ${r.employeeCode}` : ""}
                      {r.email ? ` · ${r.email}` : ""}
                    </option>
                  ))}
                </select>
              </label>
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
              <div className="st-offer-clauses">
                <div className="st-set-section-head" style={{ marginBottom: 8 }}>
                  <h2 style={{ fontSize: 15, margin: 0 }}>Clauses</h2>
                  <span>{clauses.filter((c) => c.enabled !== false && c.isIncluded !== false).length} included</span>
                </div>
                {clauses.map((clause, index) => {
                  const included = clause.enabled !== false && clause.isIncluded !== false;
                  return (
                    <div key={clause.id || clause.clauseId || index} className="st-set-card st-set-pad" style={{ marginBottom: 8 }}>
                      <label className="st-offer-clause-toggle" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <input
                          type="checkbox"
                          checked={included}
                          disabled={clause.isRequired}
                          onChange={(e) =>
                            updateClause(index, {
                              enabled: e.target.checked,
                              isIncluded: e.target.checked,
                            })
                          }
                        />
                        <strong>{clause.title || `Clause ${index + 1}`}</strong>
                      </label>
                      {included ? (
                        <>
                          <input
                            style={{ marginTop: 8 }}
                            value={clause.title || ""}
                            onChange={(e) => updateClause(index, { title: e.target.value })}
                            placeholder="Clause title"
                          />
                          <textarea
                            rows={3}
                            style={{ marginTop: 8 }}
                            value={clause.body || ""}
                            onChange={(e) => updateClause(index, { body: e.target.value })}
                            placeholder="Clause body"
                          />
                        </>
                      ) : null}
                    </div>
                  );
                })}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button type="button" className="btn-secondary" onClick={addCustomClause}>
                    Add custom clause
                  </button>
                  <button type="button" className="btn-ghost" onClick={resetClauses}>
                    Reset to template
                  </button>
                </div>
              </div>
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
      <ConfirmDialog
        open={Boolean(withdrawConfirm)}
        onClose={() => setWithdrawConfirm(null)}
        title="Withdraw offer"
        message={`Withdraw the offer for ${offerName(withdrawConfirm?.offer)} as ${offerPosition(withdrawConfirm?.offer) || "the listed role"}. The candidate will no longer be able to sign. This does not permanently delete the offer or email history.`}
        confirmLabel="Withdraw"
        danger
        busy={busy}
        onConfirm={withdrawOffer}
      >
        <label className="form-grid" style={{ marginTop: 12 }}>
          Withdrawal reason (required)
          <textarea
            value={withdrawConfirm?.reason || ""}
            onChange={(e) =>
              setWithdrawConfirm((prev) => (prev ? { ...prev, reason: e.target.value } : prev))
            }
            placeholder="Why is this offer being withdrawn?"
            rows={3}
          />
        </label>
      </ConfirmDialog>
    </div>
  );
}
