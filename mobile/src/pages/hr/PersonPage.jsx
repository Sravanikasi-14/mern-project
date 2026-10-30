import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  BadgeCheck,
  Briefcase,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  IdCard,
  MapPin,
  MoreVertical,
  Pencil,
  ShieldCheck,
} from "lucide-react";
import StatusBadge from "../../components/StatusBadge";
import ConfirmDialog from "../../components/ConfirmDialog";
import Modal from "../../components/Modal";
import EmptyState, { ErrorState, Skeleton } from "../../components/EmptyState";
import AttendanceMonthCalendar from "../../components/AttendanceMonthCalendar";
import { useToast } from "../../components/Toast";
import { useNotify } from "../../app/notifyContext";
import { useAuth } from "../../app/AuthContext";
import { initialsFrom } from "../../components/SummaryRow";
import api from "../../services/api";
import {
  formatCivilDate,
  formatDisplayDate,
  resolveCompanyTimezone,
} from "../../utils/dateUtils";

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

const DOC_CATEGORY_LABELS = {
  ID_PROOF: "ID Proof",
  ADDRESS_PROOF: "Address Proof",
  EDUCATION: "Education",
  CERTIFICATION: "Certifications",
  OTHER: "Other",
};

const FOLDER_TONES = ["is-mint", "is-sage", "is-sky", "is-sand", "is-lilac"];

function categoryLabel(raw) {
  if (!raw) return "Documents";
  const key = String(raw).toUpperCase();
  return DOC_CATEGORY_LABELS[key] || String(raw).replace(/_/g, " ");
}

export default function HrPersonPage() {
  const { id } = useParams();
  const toast = useToast();
  const notify = useNotify();
  const { user, company } = useAuth();
  const timezone = resolveCompanyTimezone(company);
  const navigate = useNavigate();
  const [emp, setEmp] = useState(null);
  const [history, setHistory] = useState([]);
  const [attLoading, setAttLoading] = useState(false);
  const [attError, setAttError] = useState("");
  const [attMonth, setAttMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  });
  const [tab, setTab] = useState("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [settleOpen, setSettleOpen] = useState(false);
  const [exitDate, setExitDate] = useState("");
  const [exitReason, setExitReason] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [folderOpen, setFolderOpen] = useState(null);
  const [downloading, setDownloading] = useState("");

  const load = async () => {
    try {
      setLoading(true);
      const res = await api.get(`/employees/${id}`);
      setEmp(res.data?.employee || res.data);
    } catch (err) {
      setError(err.response?.data?.message || "Could not load this profile.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [id]);

  useEffect(() => {
    if (tab !== "attendance") return undefined;
    let cancelled = false;
    (async () => {
      try {
        setAttLoading(true);
        setAttError("");
        const last = new Date(Date.UTC(attMonth.year, attMonth.month, 0)).getUTCDate();
        const startDate = formatCivilDate(attMonth.year, attMonth.month, 1);
        const endDate = formatCivilDate(attMonth.year, attMonth.month, last);
        const res = await api.get(`/admin/attendance/employee/${id}`, {
          params: { startDate, endDate, limit: 100 },
        });
        if (!cancelled) setHistory(res.data?.records || res.data?.history || []);
      } catch (err) {
        if (!cancelled) {
          setHistory([]);
          setAttError(err.response?.data?.message || "Could not load attendance.");
        }
      } finally {
        if (!cancelled) setAttLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, id, attMonth.year, attMonth.month]);

  const docs = useMemo(() => (Array.isArray(emp?.documents) ? emp.documents : []), [emp]);

  const folders = useMemo(() => {
    const map = new Map();
    docs.forEach((doc) => {
      const key = String(doc.documentType || doc.category || doc.type || "OTHER").toUpperCase();
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(doc);
    });
    if (map.size === 0 && docs.length) {
      map.set("OTHER", docs);
    }
    return Array.from(map.entries()).map(([key, items], index) => ({
      key,
      label: categoryLabel(key),
      items,
      tone: FOLDER_TONES[index % FOLDER_TONES.length],
    }));
  }, [docs]);

  const resend = async () => {
    try {
      const res = await api.post(`/employees/${id}/resend-invite`);
      toast.push(res.data?.message || "Invitation resent.");
      setMenuOpen(false);
    } catch (err) {
      setError(err.response?.data?.message || "Could not resend invitation.");
    }
  };

  const downloadDoc = async (doc) => {
    const docId = doc._id || doc.id;
    try {
      setDownloading(String(docId));
      const response = await api.get(`/employees/${id}/documents/${docId}/download`, {
        responseType: "blob",
      });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = doc.title || doc.fileName || "document";
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.response?.data?.message || "Could not download this document.");
    } finally {
      setDownloading("");
    }
  };

  const settle = async () => {
    if (!exitDate) {
      setError("Last working day is required.");
      return;
    }
    if (!exitReason.trim()) {
      setError("Exit reason is required.");
      return;
    }
    try {
      setError("");
      await api.post("/settlements/initiate", {
        employeeId: id,
        lastWorkingDay: exitDate,
        exitReason: exitReason.trim(),
      });
      toast.push("Settlement started.");
      setSettleOpen(false);
      setExitReason("");
    } catch (err) {
      setError(err.response?.data?.message || "Could not start settlement.");
    }
  };

  if (loading) {
    return (
      <div className="st-profile">
        <div className="st-subhead">
          <button type="button" className="icon-btn" aria-label="Go back" onClick={() => navigate(-1)}>
            <ChevronLeft size={22} strokeWidth={1.85} />
          </button>
          <h1>Employee Profile</h1>
        </div>
        <Skeleton />
      </div>
    );
  }
  if (error && !emp) {
    return (
      <div className="st-profile">
        <div className="st-subhead">
          <button type="button" className="icon-btn" aria-label="Go back" onClick={() => navigate(-1)}>
            <ChevronLeft size={22} strokeWidth={1.85} />
          </button>
          <h1>Employee Profile</h1>
        </div>
        <ErrorState message={error} onRetry={load} />
      </div>
    );
  }

  const monthlyRaw =
    emp?.currentMonthlySalary ??
    emp?.compensation?.monthlySalary ??
    emp?.monthlySalary ??
    null;
  const salary =
    money(emp?.compensation?.annualCtc || emp?.compensation?.ctc) ||
    (monthlyRaw != null && monthlyRaw !== ""
      ? `${money(Number(monthlyRaw) * 12)} / yr`
      : null);
  const monthly = money(monthlyRaw);
  const requiredDocTypes = Array.isArray(emp?.requiredDocuments)
    ? emp.requiredDocuments
    : Array.isArray(emp?.documentChecklist)
      ? emp.documentChecklist
      : null;
  const completedDocs = docs.filter((d) => {
    const status = String(d.status || "").toUpperCase();
    return !status || status === "APPROVED" || status === "VERIFIED" || status === "UPLOADED";
  }).length;
  const docPct = requiredDocTypes?.length
    ? Math.min(100, Math.round((completedDocs / requiredDocTypes.length) * 100))
    : docs.length
      ? null
      : 0;
  const manager =
    emp?.job?.reportingManagerId && typeof emp.job.reportingManagerId === "object"
      ? emp.job.reportingManagerId
      : null;
  const managerName =
    manager?.fullName ||
    emp?.reportingManager?.fullName ||
    emp?.manager?.fullName ||
    emp?.job?.reportingManagerName ||
    null;

  return (
    <div className="st-profile">
      <header className="st-subhead">
        <button type="button" className="icon-btn" aria-label="Go back" onClick={() => navigate(-1)}>
          <ChevronLeft size={22} strokeWidth={1.85} />
        </button>
        <h1>Employee Profile</h1>
        <div className="st-subhead-actions">
          <button type="button" className="icon-btn" aria-label="More actions" onClick={() => setMenuOpen((v) => !v)}>
            <MoreVertical size={20} strokeWidth={1.85} />
          </button>
          <button type="button" className="hr-portal-avatar" aria-label="Account" onClick={() => notify()}>
            {initialsFrom(user?.name || user?.email || "HR")}
          </button>
        </div>
      </header>

      {menuOpen ? (
        <div className="st-profile-menu">
          <button type="button" onClick={resend}>
            Resend invite
          </button>
          <button
            type="button"
            className="is-danger"
            onClick={() => {
              setMenuOpen(false);
              setSettleOpen(true);
            }}
          >
            Start settlement
          </button>
        </div>
      ) : null}

      {error ? <div className="alert alert-error">{error}</div> : null}

      <section className="st-profile-hero">
        <div className="st-profile-hero-main">
          <span className="st-profile-photo">{initialsFrom(emp?.fullName)}</span>
          <div>
            <h2>{emp?.fullName}</h2>
            <p>{emp?.job?.jobTitle || "Team member"}</p>
            <span className="st-profile-code">{emp?.employeeCode || "—"}</span>
          </div>
        </div>
        <StatusBadge status={emp?.status} />
      </section>

      <div className="st-seg" role="tablist" aria-label="Profile sections">
        {[
          { value: "overview", label: "Overview" },
          { value: "attendance", label: "Attendance" },
          { value: "documents", label: "Documents" },
        ].map((item) => (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={tab === item.value}
            className={tab === item.value ? "is-active" : ""}
            onClick={() => setTab(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "overview" ? (
        <>
          <section className="st-detail-block">
            <div className="st-detail-head">
              <h3>Basic Information</h3>
              <IdCard size={18} strokeWidth={1.85} aria-hidden="true" />
            </div>
            <div className="st-detail-card">
              <div className="st-detail-row">
                <span>Email</span>
                <strong>{emp?.email || "—"}</strong>
              </div>
              <div className="st-detail-row">
                <span>Department</span>
                <strong>{emp?.job?.department || "—"}</strong>
              </div>
              <div className="st-detail-row">
                <span>Date of Joining</span>
                <strong>
                  {emp?.job?.joiningDate
                    ? new Date(emp.job.joiningDate).toLocaleDateString("en-IN", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })
                    : "—"}
                </strong>
              </div>
              <div className="st-detail-row">
                <span>Phone</span>
                <strong>{emp?.phoneNumber || emp?.personalPhone || "—"}</strong>
              </div>
              <div className="st-detail-row">
                <span>Reporting Manager</span>
                <strong className="st-manager">
                  {managerName ? (
                    <>
                      <span className="st-manager-av">{initialsFrom(managerName)}</span>
                      {managerName}
                    </>
                  ) : (
                    "—"
                  )}
                </strong>
              </div>
            </div>
          </section>

          <section className="st-detail-block">
            <div className="st-detail-head">
              <h3>Employment Details</h3>
              <Briefcase size={18} strokeWidth={1.85} aria-hidden="true" />
            </div>
            <div className="st-detail-card">
              <div className="st-detail-row">
                <span>Employment Type</span>
                <strong>{emp?.job?.employmentType || emp?.employmentType || "—"}</strong>
              </div>
              <div className="st-detail-row">
                <span>Work Location</span>
                <strong className="st-loc">
                  <MapPin size={14} strokeWidth={2} aria-hidden="true" />
                  {emp?.job?.workLocation || emp?.workLocation || emp?.job?.location || "—"}
                </strong>
              </div>
              <div className="st-detail-row">
                <span>Salary</span>
                <strong className="st-salary">
                  {salary || monthly || "—"}
                  {monthly && !salary ? <em>/ mo</em> : null}
                </strong>
              </div>
            </div>
          </section>

          <div className="st-compliance">
            <div className="st-compliance-main">
              <span className="st-compliance-ico">
                <ShieldCheck size={18} strokeWidth={1.85} />
              </span>
              <div>
                <strong>Compliance Status</strong>
                <p>{docs.length ? "Documents on file" : "No documents uploaded yet"}</p>
              </div>
            </div>
            <span className="st-compliance-badge">
              <BadgeCheck size={12} strokeWidth={2} aria-hidden="true" />
              {docPct == null
                ? `${docs.length} on file`
                : docPct === 0 && !docs.length
                  ? "No documents"
                  : `${docPct}% Complete`}
            </span>
          </div>

          <button
            type="button"
            className="btn-primary btn-block st-edit-cta"
            onClick={() => navigate(`/admin/employees/${id}/edit`)}
          >
            <Pencil size={18} strokeWidth={1.85} aria-hidden="true" />
            Edit Profile
          </button>
        </>
      ) : null}

      {tab === "attendance" ? (
        attLoading && history.length === 0 ? (
          <Skeleton />
        ) : attError && history.length === 0 ? (
          <ErrorState message={attError} onRetry={() => setAttMonth((m) => ({ ...m }))} />
        ) : (
          <AttendanceMonthCalendar
            records={history}
            timezone={timezone}
            month={attMonth}
            onMonthChange={setAttMonth}
          />
        )
      ) : null}

      {tab === "documents" ? (
        docs.length === 0 ? (
          <EmptyState message="No documents on file." />
        ) : (
          <div className="doc-folder-grid">
            {folders.map((folder) => (
              <button
                key={folder.key}
                type="button"
                className={`doc-folder ${folder.tone}`}
                onClick={() => setFolderOpen(folder)}
              >
                <span className="doc-folder-face">
                  <FolderOpen size={22} strokeWidth={1.75} aria-hidden="true" />
                  <strong>{folder.label}</strong>
                  <em>
                    {folder.items.length} file{folder.items.length === 1 ? "" : "s"}
                  </em>
                </span>
              </button>
            ))}
          </div>
        )
      ) : null}

      <Modal
        open={Boolean(folderOpen)}
        onClose={() => setFolderOpen(null)}
        title={folderOpen?.label || "Documents"}
      >
        {folderOpen ? (
          <div className="doc-folder-list">
            <p className="caption">
              {folderOpen.items.length} document{folderOpen.items.length === 1 ? "" : "s"}
            </p>
            {folderOpen.items.map((doc) => {
              const docId = doc._id || doc.id;
              return (
                <button
                  key={docId || doc.title}
                  type="button"
                  className="doc-folder-file"
                  onClick={() => downloadDoc(doc)}
                  disabled={Boolean(downloading)}
                >
                  <span>
                    <strong>{doc.title || doc.fileName || doc.category || "Document"}</strong>
                    <small>
                      {doc.status || formatDisplayDate(doc.uploadedAt || doc.createdAt) || "On file"}
                    </small>
                  </span>
                  <em>
                    {downloading === String(docId) ? "..." : "Download"}
                    <ChevronRight size={16} strokeWidth={1.85} aria-hidden="true" />
                  </em>
                </button>
              );
            })}
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={settleOpen}
        onClose={() => {
          setSettleOpen(false);
          setExitReason("");
        }}
        title="Start settlement"
        message="This uses the same settlement API as the web app."
        confirmLabel="Start settlement"
        danger
        onConfirm={settle}
      >
        <div className="form-grid" style={{ marginTop: 12 }}>
          <label>
            Last working day
            <input type="date" value={exitDate} onChange={(event) => setExitDate(event.target.value)} required />
          </label>
          <label>
            Exit reason
            <input
              value={exitReason}
              onChange={(event) => setExitReason(event.target.value)}
              placeholder="Resignation, termination, etc."
              required
            />
          </label>
        </div>
      </ConfirmDialog>
    </div>
  );
}
