import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import AppHeader from "../components/AppHeader";
import StatusBadge from "../components/StatusBadge";
import SoftRefresh from "../components/SoftRefresh";
import ProfilePhotoField from "../components/ProfilePhotoField";
import DepartmentSelect from "../components/DepartmentSelect";
import DateRangePicker from "../components/DateRangePicker";
import { departmentPayload } from "../components/departmentAssignment";
import ReportingManagerSelect from "../components/ReportingManagerSelect";
import DesignationFields from "../components/organization-workspace/DesignationFields";
import {
  IconDocument,
  IconArrowLeft,
  IconClose,
  IconCheck,
  IconMail,
  IconBriefcase,
  IconDownload,
  IconUsers,
  IconShield,
} from "../components/Icons";
import { useAuth } from "../context/AuthContext";
import { hrPortalAllows } from "../utils/hrPortalAccess";
import {
  formatDisplayDate,
  formatCivilDate,
  getCompanyBusinessDate,
  parseCivilDate,
  resolveCompanyTimezone,
} from "../utils/dateUtils";
import {
  analyzeAttendance,
  buildHolidaySet,
  ATTENDANCE_STATUS_LABELS,
} from "../utils/employeeAttendanceInsights";
import { useSmartBack } from "../hooks/useSmartBack";
import { useQueryClient } from "@tanstack/react-query";
import { invalidateProfile } from "../lib/queryKeys";
import api from "../services/api";
import useAuthedImage from "../hooks/useAuthedImage";
import "./EmployeeProfileView.css";

/* ------------------------------------------------------------------------
   Tabs
   ------------------------------------------------------------------------ */
const TABS = [
  { id: "overview", label: "Overview" },
  { id: "personal", label: "Personal Info" },
  { id: "work", label: "Work Info" },
  { id: "attendance", label: "Attendance" },
  { id: "performance", label: "Performance" },
  { id: "payroll", label: "Payroll" },
  { id: "documents", label: "Documents" },
  { id: "activity", label: "Activity" },
];

/* ------------------------------------------------------------------------
   Small helpers
   ------------------------------------------------------------------------ */
function managerIdOf(emp) {
  const m = emp?.job?.reportingManagerId;
  if (!m) return null;
  return typeof m === "object" ? String(m._id || "") || null : String(m);
}

function managerOf(emp) {
  const m = emp?.job?.reportingManagerId;
  return m && typeof m === "object" && m._id ? m : null;
}

/**
 * The HR employee API fills bank / tax with demo placeholders when none are on
 * file. Never show or re-save those as if they were real records.
 */
function realBank(emp) {
  const b = emp?.bankDetails;
  if (!b || !b.accountNumber) return null;
  if (b.bankName === "HDFC Bank" && b.ifscCode === "HDFC0001024") return null;
  return b;
}

function realTax(emp) {
  const t = emp?.taxDetails;
  if (!t || !t.panNumber) return null;
  if (t.panNumber === "ABCDE1234F" && /115BAC/.test(t.taxRegime || "")) return null;
  return t;
}

function initialsOf(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "E";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" });
}

function formatDateTime(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function shortCivil(dateStr) {
  const p = parseCivilDate(dateStr);
  if (!p) return "";
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function formatCurrency(amount) {
  if (amount == null || Number.isNaN(Number(amount))) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatFileSize(bytes) {
  if (!bytes && bytes !== 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function IconPhone({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.9.34 1.78.64 2.62a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.46-1.21a2 2 0 0 1 2.11-.45c.84.3 1.72.52 2.62.64A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

function IconPencil({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function IconMore({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="12" cy="5" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="12" cy="19" r="1.8" />
    </svg>
  );
}

function IconBuilding({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2" />
    </svg>
  );
}

/* ------------------------------------------------------------------------
   Presentational building blocks (module-level so inputs never remount)
   ------------------------------------------------------------------------ */
function Card({ title, subtitle, action, icon = null, children, className = "" }) {
  return (
    <section className={`epd-card ${className}`.trim()}>
      {(title || action || icon) && (
        <header className="epd-card-head">
          <div className="epd-card-head-main">
            {icon ? <span className="epd-card-icon">{icon}</span> : null}
            <div>
              {title ? <h3 className="epd-card-title">{title}</h3> : null}
              {subtitle ? <p className="epd-card-sub">{subtitle}</p> : null}
            </div>
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

function Info({ label, children, mono = false, highlight = false, hideIfEmpty = false }) {
  const raw = typeof children === "string" ? children.trim() : children;
  const empty =
    raw === undefined ||
    raw === null ||
    raw === "" ||
    raw === "—" ||
    raw === "Not recorded" ||
    raw === "Not specified";
  if (hideIfEmpty && empty) return null;
  return (
    <div className="epd-info">
      <span className="epd-info-lbl">{label}</span>
      <span className={`epd-info-val${mono ? " is-mono" : ""}${highlight ? " is-highlight" : ""}`}>
        {empty ? "—" : children}
      </span>
    </div>
  );
}

function Field({ label, tag, children, wide = false }) {
  return (
    <div className={`epv-edit-field-group${wide ? " epd-span-all" : ""}`}>
      <label className="epv-edit-label">
        <span>{label}</span>
        {tag ? <span className="epv-readonly-tag">{tag}</span> : null}
      </label>
      {children}
    </div>
  );
}

function TextField({ label, value, onChange, type = "text", placeholder, tag, disabled, wide, ...rest }) {
  return (
    <Field label={label} tag={tag} wide={wide}>
      <input
        type={type}
        className="epv-edit-input"
        value={value ?? ""}
        placeholder={placeholder}
        disabled={disabled}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        {...rest}
      />
    </Field>
  );
}

function EmptyState({ title, children, icon = null, compact = true }) {
  return (
    <div className={`epd-empty${compact ? " is-compact" : ""}`}>
      {icon ? <span className="epd-empty-icon">{icon}</span> : null}
      <strong>{title}</strong>
      {children ? <p>{children}</p> : null}
    </div>
  );
}

function StatCard({ tone, label, value, sub }) {
  return (
    <div className="epd-stat">
      <span className={`epd-stat-dot is-${tone}`} aria-hidden="true" />
      <span className="epd-stat-lbl">{label}</span>
      <strong className="epd-stat-val">{value}</strong>
      {sub ? <span className="epd-stat-sub">{sub}</span> : null}
    </div>
  );
}

/* ========================================================================
   Page — shared by HR (`mode="hr"`) and Employee self-service (`mode="self"`)
   ======================================================================== */
export default function EmployeeProfile({ mode = "hr", defaultTab = "overview" }) {
  const isSelf = mode === "self";
  const { id: routeId } = useParams();
  const navigate = useNavigate();
  const goBack = useSmartBack();
  const queryClient = useQueryClient();
  const { user, company } = useAuth();
  const timeZone = resolveCompanyTimezone(company);
  const todayStr = useMemo(() => getCompanyBusinessDate(new Date(), timeZone), [timeZone]);

  // HR capabilities (always false for employees)
  const hrCanEdit = !isSelf && hrPortalAllows(user, company, "people.edit");
  const hrCanViewPayroll = !isSelf && hrPortalAllows(user, company, "payroll.view");
  const hrCanViewAttendance = !isSelf && hrPortalAllows(user, company, "attendance.view");
  const hrCanViewLeave = !isSelf && hrPortalAllows(user, company, "leave.view");
  const hrCanViewImpact = !isSelf && hrPortalAllows(user, company, "impact.view");
  const canInitiateFnF = !isSelf && hrPortalAllows(user, company, "settlements.create");
  const canViewFnF = !isSelf && hrPortalAllows(user, company, "settlements.view");

  // Shared capability flags — same UI shell; data/actions stay permission-scoped
  const canEdit = isSelf || hrCanEdit;
  const canEditWork = hrCanEdit;
  const canViewPayroll = hrCanViewPayroll; // compensation / salary (HR only)
  const canEditBankTax = isSelf || hrCanViewPayroll; // self may update own bank/PAN
  const canViewAttendance = isSelf || hrCanViewAttendance;
  const canViewLeave = isSelf || hrCanViewLeave;
  const canViewImpact = isSelf || hrCanViewImpact;
  const canUploadDocuments = isSelf;

  const [employee, setEmployee] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState(defaultTab || "overview");
  const { url: avatarUrl } = useAuthedImage(employee?.avatar);

  useEffect(() => {
    if (defaultTab) setActiveTab(defaultTab);
  }, [defaultTab]);

  // Integrated editing state
  const [isEditing, setIsEditing] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editSuccess, setEditSuccess] = useState("");
  const [editError, setEditError] = useState("");
  const [editFormData, setEditFormData] = useState({});
  const editBaselineRef = useRef({});

  // F&F initiation modal
  const [showFnFModal, setShowFnFModal] = useState(false);
  const [submittingFnF, setSubmittingFnF] = useState(false);
  const [fnfForm, setFnfForm] = useState({
    lastWorkingDay: "",
    exitReason: "Resignation",
    hrRemarks: "",
  });
  const [fnfError, setFnfError] = useState("");
  const [fnfSuccess, setFnfSuccess] = useState("");
  const [downloadingDocId, setDownloadingDocId] = useState(null);

  // Header overflow menu
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  // Real data sources (all optional / permissioned)
  const [range, setRange] = useState(() => {
    const p = parseCivilDate(getCompanyBusinessDate(new Date(), resolveCompanyTimezone(company)));
    return {
      startDate: p ? formatCivilDate(p.year, p.month, 1) : "",
      endDate: p ? formatCivilDate(p.year, p.month, p.day) : "",
    };
  });
  const [attendance, setAttendance] = useState({ state: "idle", records: [], total: 0, error: "" });
  const [policy, setPolicy] = useState(null);
  const [leaves, setLeaves] = useState({ state: "idle", items: [], error: "" });
  const [impact, setImpact] = useState({ state: "idle", data: null, error: "" });

  // Attendance log table controls
  const [logFilter, setLogFilter] = useState("all");
  const [logSortDesc, setLogSortDesc] = useState(true);
  const [logPageSize, setLogPageSize] = useState(10);
  const [logPage, setLogPage] = useState(1);

  /* -------------------------- edit form plumbing -------------------------- */
  const populateEditForm = (emp) => {
    if (!emp) return;
    const bank = realBank(emp);
    const tax = realTax(emp);
    const next = {
      fullName: emp.fullName || "",
      preferredName: emp.preferredName || "",
      employeeCode: emp.employeeCode || "",
      email: emp.email || "",
      personalEmail: emp.personalEmail || "",
      phoneNumber: emp.phoneNumber || "",
      personalPhone: emp.personalPhone || "",
      city: emp.city || "",
      dateOfBirth: emp.dateOfBirth ? emp.dateOfBirth.split("T")[0] : "",
      gender: emp.gender && emp.gender !== "Not specified" ? emp.gender : "",
      residentialStreet: emp.residentialAddress?.street || "",
      residentialCity: emp.residentialAddress?.city || emp.city || "",
      residentialState: emp.residentialAddress?.state || "",
      residentialPostalCode: emp.residentialAddress?.postalCode || "",
      emergencyName: emp.emergencyContact?.name || "",
      emergencyRel: emp.emergencyContact?.relationship || "",
      emergencyPhone: emp.emergencyContact?.phone || "",
      jobTitle: emp.job?.jobTitle || "",
      departmentId: emp.job?.departmentId ? String(emp.job.departmentId) : "",
      departmentName: emp.job?.department || "",
      clearDepartment: false,
      departmentTouched: false,
      jobGrade: emp.job?.jobGrade || "",
      employmentType: emp.job?.employmentType || "",
      workLocation: emp.job?.workLocation || "",
      status: emp.status || "ACTIVE",
      projectName: emp.job?.project?.projectName || "",
      projectType: emp.job?.project?.projectType || "MANDATE",
      monthlySalary: emp.currentMonthlySalary != null ? String(emp.currentMonthlySalary) : "",
      reportingManagerId: managerIdOf(emp),
      bankName: bank?.bankName || "",
      accountNumber: bank?.accountNumber || "",
      ifscCode: bank?.ifscCode || "",
      panNumber: tax?.panNumber || "",
    };
    editBaselineRef.current = {
      bankName: next.bankName,
      accountNumber: next.accountNumber,
      ifscCode: next.ifscCode,
      panNumber: next.panNumber,
    };
    setEditFormData(next);
  };

  const handleStartEdit = () => {
    if (!canEdit) return;
    populateEditForm(employee);
    setEditError("");
    setEditSuccess("");
    setIsEditing(true);
    if (isSelf) setActiveTab("personal");
  };

  const handleCancelEdit = () => {
    populateEditForm(employee);
    setEditError("");
    setIsEditing(false);
  };

  const handleEditChange = (field, value) => {
    setEditFormData((prev) => ({ ...prev, [field]: value }));
    if (editError) setEditError("");
  };

  const handleSaveProfile = async (e) => {
    if (e) e.preventDefault();
    if (!canEdit) return;
    setEditError("");
    setEditSuccess("");

    if (!isSelf && !editFormData.fullName?.trim()) {
      setEditError("Full name is required.");
      return;
    }

    if (canViewPayroll && editFormData.monthlySalary) {
      const sal = parseFloat(editFormData.monthlySalary);
      if (Number.isNaN(sal) || sal < 0) {
        setEditError("Please enter a valid monthly salary.");
        return;
      }
    }

    setSavingEdit(true);
    try {
      let payload;

      if (isSelf) {
        // Self-service: only fields permitted by updateMyProfile
        payload = {
          preferredName: editFormData.preferredName?.trim() || undefined,
          personalEmail: editFormData.personalEmail?.trim() || undefined,
          personalPhone: editFormData.personalPhone?.trim() || undefined,
          phoneNumber: editFormData.phoneNumber?.trim() || undefined,
          city: editFormData.city?.trim() || undefined,
          dateOfBirth: editFormData.dateOfBirth || undefined,
          gender: editFormData.gender || undefined,
          emergencyContact: {
            name: editFormData.emergencyName?.trim() || undefined,
            relationship: editFormData.emergencyRel?.trim() || undefined,
            phone: editFormData.emergencyPhone?.trim() || undefined,
          },
          residentialAddress: {
            street: editFormData.residentialStreet?.trim() || undefined,
            city: editFormData.residentialCity?.trim() || undefined,
            state: editFormData.residentialState?.trim() || undefined,
            postalCode: editFormData.residentialPostalCode?.trim() || undefined,
            country: "India",
          },
        };
        const base = editBaselineRef.current || {};
        const bankChanged =
          editFormData.bankName !== base.bankName ||
          editFormData.accountNumber !== base.accountNumber ||
          editFormData.ifscCode !== base.ifscCode;
        if (bankChanged) {
          payload.bankDetails = {
            accountHolderName: employee.fullName,
            bankName: editFormData.bankName?.trim() || undefined,
            accountNumber: editFormData.accountNumber?.trim() || undefined,
            ifscCode: editFormData.ifscCode?.trim() || undefined,
            accountType: "SAVINGS",
          };
        }
        if (editFormData.panNumber !== base.panNumber) {
          payload.taxDetails = { panNumber: editFormData.panNumber?.trim() || undefined };
        }
        await api.patch("/employees/me", payload);
        const refreshed = await api.get("/employees/me");
        if (refreshed.data?.employee) setEmployee(refreshed.data.employee);
        invalidateProfile(queryClient);
        setEditSuccess("Your profile was updated successfully.");
      } else {
        payload = {
          fullName: editFormData.fullName.trim(),
          preferredName: editFormData.preferredName?.trim() || undefined,
          personalEmail: editFormData.personalEmail?.trim() || undefined,
          personalPhone: editFormData.personalPhone?.trim() || undefined,
          phoneNumber: editFormData.phoneNumber?.trim() || undefined,
          city: editFormData.city?.trim() || undefined,
          dateOfBirth: editFormData.dateOfBirth || undefined,
          gender: editFormData.gender || undefined,
          jobTitle: editFormData.jobTitle?.trim() || undefined,
          ...departmentPayload({
            clearDepartment: editFormData.departmentTouched && editFormData.clearDepartment,
            departmentId:
              editFormData.departmentTouched && !editFormData.clearDepartment
                ? editFormData.departmentId
                : "",
          }),
          jobGrade: editFormData.jobGrade?.trim() || undefined,
          employmentType: editFormData.employmentType || undefined,
          workLocation: editFormData.workLocation?.trim() || undefined,
          status: editFormData.status || "ACTIVE",
          projectName: editFormData.projectName?.trim() || undefined,
          projectType: editFormData.projectType || "MANDATE",
          reportingManagerId:
            editFormData.reportingManagerId === undefined
              ? undefined
              : editFormData.reportingManagerId || null,
          emergencyContact: {
            name: editFormData.emergencyName?.trim() || undefined,
            relationship: editFormData.emergencyRel?.trim() || undefined,
            phone: editFormData.emergencyPhone?.trim() || undefined,
          },
          residentialAddress: {
            street: editFormData.residentialStreet?.trim() || undefined,
            city: editFormData.residentialCity?.trim() || undefined,
            state: editFormData.residentialState?.trim() || undefined,
            postalCode: editFormData.residentialPostalCode?.trim() || undefined,
            country: "India",
          },
        };

        if (canViewPayroll) {
          const base = editBaselineRef.current || {};
          const bankChanged =
            editFormData.bankName !== base.bankName ||
            editFormData.accountNumber !== base.accountNumber ||
            editFormData.ifscCode !== base.ifscCode;
          if (bankChanged) {
            payload.bankDetails = {
              accountHolderName: editFormData.fullName?.trim(),
              bankName: editFormData.bankName?.trim() || undefined,
              accountNumber: editFormData.accountNumber?.trim() || undefined,
              ifscCode: editFormData.ifscCode?.trim() || undefined,
              accountType: "SAVINGS",
            };
          }
          if (editFormData.panNumber !== base.panNumber) {
            payload.taxDetails = { panNumber: editFormData.panNumber?.trim() || undefined };
          }
          if (editFormData.monthlySalary !== "" && editFormData.monthlySalary != null) {
            payload.monthlySalary = parseFloat(editFormData.monthlySalary);
          }
        }

        await api.patch(`/employees/${routeId}`, payload);
        const refreshed = await api.get(`/employees/${routeId}`);
        if (refreshed.data) setEmployee(refreshed.data);
        setEditSuccess("Employee profile updated successfully.");
      }

      setIsEditing(false);
      setTimeout(() => setEditSuccess(""), 4000);
    } catch (err) {
      setEditError(err.response?.data?.message || "Failed to update employee details.");
    } finally {
      setSavingEdit(false);
    }
  };

  /* ------------------------------- F&F flow ------------------------------- */
  const openFnFModal = () => {
    setFnfForm({
      lastWorkingDay: new Date().toISOString().split("T")[0],
      exitReason: "Resignation",
      hrRemarks: "",
    });
    setFnfError("");
    setFnfSuccess("");
    setShowFnFModal(true);
    setMenuOpen(false);
  };

  const handleInitiateFnF = async (e) => {
    e.preventDefault();
    setFnfError("");
    setFnfSuccess("");

    if (!fnfForm.lastWorkingDay) {
      setFnfError("Please specify the employee's last working day.");
      return;
    }
    if (!fnfForm.exitReason || !fnfForm.exitReason.trim()) {
      setFnfError("Please select or enter the exit reason.");
      return;
    }

    setSubmittingFnF(true);
    try {
      const res = await api.post("/settlements/initiate", {
        employeeId: employee._id,
        lastWorkingDay: fnfForm.lastWorkingDay,
        exitReason: fnfForm.exitReason,
        hrRemarks: fnfForm.hrRemarks,
      });

      const settlement = res.data?.settlement;
      setFnfSuccess(res.data?.message || "F&F settlement initiated successfully.");

      setEmployee((prev) => ({
        ...prev,
        settlement: {
          id: settlement?._id,
          _id: settlement?._id,
          status: settlement?.status || "DRAFT",
          netSettlementAmount: settlement?.financialBreakdown?.netSettlementAmount || 0,
        },
      }));

      setTimeout(() => {
        setShowFnFModal(false);
        navigate(`/admin/payroll?settlementId=${settlement?._id}`);
      }, 700);
    } catch (err) {
      setFnfError(err.response?.data?.message || "Failed to initiate F&F settlement.");
    } finally {
      setSubmittingFnF(false);
    }
  };

  const handleDownloadDocument = async (docId, fileName) => {
    setDownloadingDocId(docId);
    try {
      const path = isSelf
        ? `/employees/me/documents/${docId}/download`
        : `/employees/${routeId}/documents/${docId}/download`;
      const response = await api.get(path, { responseType: "blob" });
      const blob = new Blob([response.data], {
        type: response.headers["content-type"] || "application/octet-stream",
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", fileName || "document");
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert("Failed to download document: " + (err.response?.data?.message || err.message));
    } finally {
      setDownloadingDocId(null);
    }
  };

  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [uploadCategory, setUploadCategory] = useState("ID_PROOF");
  const [uploadTitle, setUploadTitle] = useState("");
  const [selectedFile, setSelectedFile] = useState(null);
  const [docMsg, setDocMsg] = useState({ error: "", success: "" });

  const handleUploadDocument = async (e) => {
    e.preventDefault();
    if (!canUploadDocuments || !selectedFile) return;
    setDocMsg({ error: "", success: "" });
    setUploadingDoc(true);
    try {
      const reader = new FileReader();
      const fileData = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(selectedFile);
      });
      await api.post("/employees/me/documents", {
        documentType: uploadCategory,
        title: uploadTitle.trim() || selectedFile.name,
        fileData,
        fileName: selectedFile.name,
        mimeType: selectedFile.type || "application/octet-stream",
      });
      const refreshed = await api.get("/employees/me");
      if (refreshed.data?.employee) setEmployee(refreshed.data.employee);
      setUploadTitle("");
      setSelectedFile(null);
      setDocMsg({ error: "", success: "Document uploaded successfully." });
      setTimeout(() => setDocMsg({ error: "", success: "" }), 4000);
    } catch (err) {
      setDocMsg({ error: err.response?.data?.message || "Upload failed.", success: "" });
    } finally {
      setUploadingDoc(false);
    }
  };

  /* ------------------------------- data loads ------------------------------ */
  useEffect(() => {
    let cancelled = false;

    const fetchEmployee = async () => {
      setLoading(true);
      setError("");
      try {
        if (isSelf) {
          const res = await api.get("/employees/me");
          const emp = res.data?.employee || null;
          if (!cancelled) {
            if (!emp) {
              setError("No employee record is linked to your account.");
              setEmployee(null);
            } else {
              setEmployee(emp);
              populateEditForm(emp);
            }
          }
        } else {
          const res = await api.get(`/employees/${routeId}`);
          if (!cancelled) {
            setEmployee(res.data);
            populateEditForm(res.data);
          }
        }
      } catch (err) {
        if (!cancelled) {
          if (err.response?.status === 404) {
            setError("Employee record not found. It may have been removed.");
          } else {
            setError(err.response?.data?.message || "Failed to load employee profile.");
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchEmployee();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSelf, routeId]);

  // Active attendance policy (HR only — employees use defaults + dashboard holidays).
  useEffect(() => {
    if (!canViewAttendance || isSelf) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get("/policies/active");
        if (!cancelled) setPolicy(res.data?.policy || null);
      } catch {
        if (!cancelled) setPolicy(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canViewAttendance, isSelf]);

  // Attendance history — admin API for HR, self history for employees.
  useEffect(() => {
    if (!canViewAttendance || !range.startDate || !range.endDate) return undefined;
    if (!isSelf && !routeId) return undefined;
    let cancelled = false;
    setAttendance((prev) => ({ ...prev, state: "loading", error: "" }));
    (async () => {
      try {
        const res = isSelf
          ? await api.get("/employees/me/attendance/history", {
              params: { startDate: range.startDate, endDate: range.endDate, limit: 100 },
            })
          : await api.get(`/admin/attendance/employee/${routeId}`, {
              params: { startDate: range.startDate, endDate: range.endDate, limit: 100 },
            });
        if (cancelled) return;
        const records = res.data?.records || res.data?.history || [];
        setAttendance({
          state: "ready",
          records,
          total: res.data?.pagination?.total ?? records.length,
          error: "",
        });
      } catch (err) {
        if (cancelled) return;
        setAttendance({
          state: "error",
          records: [],
          total: 0,
          error: err.response?.data?.message || "Failed to load attendance history.",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isSelf, routeId, canViewAttendance, range.startDate, range.endDate]);

  // Leave history — HR list API vs employee dashboard recent requests.
  useEffect(() => {
    if (!canViewLeave) return undefined;
    if (!isSelf && !employee?.employeeCode) return undefined;
    let cancelled = false;
    setLeaves((prev) => ({ ...prev, state: "loading", error: "" }));
    (async () => {
      try {
        if (isSelf) {
          const res = await api.get("/employees/me/dashboard");
          if (cancelled) return;
          const items = res.data?.leave?.recentRequests || res.data?.leave?.requests || [];
          setLeaves({ state: "ready", items, error: "" });
        } else {
          const res = await api.get("/leave-requests", {
            params: { search: employee.employeeCode, limit: 100, includeSummary: "false" },
          });
          if (cancelled) return;
          const items = (res.data?.leaveRequests || []).filter(
            (l) => String(l.employeeId) === String(routeId)
          );
          setLeaves({ state: "ready", items, error: "" });
        }
      } catch (err) {
        if (cancelled) return;
        setLeaves({
          state: "error",
          items: [],
          error: err.response?.data?.message || "Failed to load leave history.",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isSelf, routeId, canViewLeave, employee?.employeeCode]);

  // Impact points — HR employee API vs /impact-points/me.
  useEffect(() => {
    if (!canViewImpact) return undefined;
    if (!isSelf && !routeId) return undefined;
    let cancelled = false;
    setImpact((prev) => ({ ...prev, state: "loading", error: "" }));
    (async () => {
      try {
        const res = isSelf
          ? await api.get("/impact-points/me")
          : await api.get(`/impact-points/employee/${routeId}`);
        if (cancelled) return;
        const raw = res.data?.summary || res.data?.data || res.data || null;
        const data = raw
          ? {
              balance: raw.balance ?? raw.totalPoints ?? 0,
              pointsThisMonth: raw.pointsThisMonth ?? raw.thisMonth ?? 0,
              rankInCompany: raw.rankInCompany ?? raw.companyRank ?? "—",
              rankInDepartment: raw.rankInDepartment ?? raw.departmentRank ?? "—",
              totalEarned: raw.totalEarned ?? raw.pointsEarned ?? 0,
              totalDeducted: raw.totalDeducted ?? raw.pointsDeducted ?? 0,
              recentTransactions: raw.recentTransactions || raw.transactions || [],
            }
          : null;
        setImpact({ state: "ready", data, error: "" });
      } catch (err) {
        if (cancelled) return;
        setImpact({
          state: "error",
          data: null,
          error: err.response?.data?.message || "Failed to load impact points.",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isSelf, routeId, canViewImpact]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDoc = (e) => {
      if (!menuRef.current?.contains(e.target)) setMenuOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  useEffect(() => {
    setLogPage(1);
  }, [logFilter, logPageSize, logSortDesc, range.startDate, range.endDate]);

  /* ----------------------------- derived values ---------------------------- */
  const analysis = useMemo(() => {
    if (attendance.state !== "ready") return null;
    return analyzeAttendance({
      records: attendance.records,
      startDate: range.startDate,
      endDate: range.endDate,
      todayStr,
      weekendRules: policy?.weekendRules || { saturdayOff: true, sundayOff: true },
      holidaySet: buildHolidaySet(policy?.holidays),
      officeStart: policy?.attendanceRules?.officeStartTime || "09:30",
      graceMinutes: policy?.attendanceRules?.gracePeriodMinutes ?? 15,
      timeZone,
    });
  }, [attendance, range.startDate, range.endDate, todayStr, policy, timeZone]);

  const activityEvents = useMemo(() => {
    if (!employee) return [];
    const events = [];
    const push = (ts, title, detail, tone = "neutral") => {
      const t = new Date(ts).getTime();
      if (Number.isNaN(t)) return;
      events.push({ ts: t, title, detail, tone });
    };

    push(employee.job?.joiningDate, "Joined the company", employee.job?.jobTitle || "", "success");
    push(employee.createdAt, "Employee record created", "", "neutral");
    if (employee.updatedAt && employee.updatedAt !== employee.createdAt) {
      push(employee.updatedAt, "Profile last updated", "", "neutral");
    }
    if (employee.settlement?.initiatedAt) {
      push(
        employee.settlement.initiatedAt,
        "F&F settlement initiated",
        `Status: ${String(employee.settlement.status || "").replace(/_/g, " ")}`,
        "warn"
      );
    }
    for (const l of leaves.items.slice(0, 15)) {
      push(
        l.createdAt,
        `Leave request ${String(l.status || "").toLowerCase()}`,
        `${l.leaveTypeCode || "Leave"} · ${shortCivil(l.fromDate)}${l.toDate && l.toDate !== l.fromDate ? ` – ${shortCivil(l.toDate)}` : ""} · ${l.daysCount} day(s)`,
        l.status === "APPROVED" ? "success" : l.status === "REJECTED" ? "danger" : "warn"
      );
    }
    for (const tx of impact.data?.recentTransactions || []) {
      const pts = Number(tx.points) || 0;
      push(
        tx.createdAt,
        `${pts >= 0 ? "+" : ""}${pts} impact points`,
        tx.reason || tx.source || "",
        pts >= 0 ? "success" : "danger"
      );
    }
    if (analysis) {
      for (const d of analysis.days.filter((x) => x.record?.checkIn).slice(-10)) {
        push(
          d.record.checkIn,
          `Checked in${d.checkIn ? ` at ${d.checkIn}` : ""}`,
          d.checkOut ? `Checked out at ${d.checkOut}${d.hours ? ` · ${d.hours}` : ""}` : "No check-out recorded",
          d.statusKey === "late" ? "warn" : "success"
        );
      }
    }
    return events.sort((a, b) => b.ts - a.ts).slice(0, 40);
  }, [employee, leaves.items, impact.data, analysis]);

  /* ------------------------------ early returns ---------------------------- */
  if (loading) {
    return (
      <div className="epv-container">
        <div className="profile-loading-box">
          <div className="profile-spinner" style={{ margin: "0 auto 16px" }} aria-hidden="true" />
          <p style={{ color: "var(--muted)", fontSize: "14px" }}>Loading employee profile...</p>
        </div>
      </div>
    );
  }

  if (error || !employee) {
    return (
      <div className="epv-container">
        <nav className="epv-breadcrumb" aria-label="Breadcrumb">
          <Link to="/admin">Employees</Link>
          <span className="epv-breadcrumb-sep">/</span>
          <span className="epv-breadcrumb-current">Error</span>
        </nav>
        <div className="pm-empty-box" style={{ marginTop: "20px" }}>
          <h3>Unable to display profile</h3>
          <p>{error || "Employee not found."}</p>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => goBack()}
            style={{ marginTop: "16px", display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <IconArrowLeft size={14} />
            <span>Back to People Management</span>
          </button>
        </div>
      </div>
    );
  }

  /* ------------------------------- derived (post-load) --------------------- */
  const job = employee.job || {};
  const manager = managerOf(employee);
  const project = job.project?.projectName ? job.project : null;
  const bank = realBank(employee);
  const tax = realTax(employee);
  const skills = Array.isArray(employee.skills) ? employee.skills.filter(Boolean) : [];
  const aboutText =
    [employee.about, employee.bio, employee.summary, employee.customFields?.about].find(
      (v) => typeof v === "string" && v.trim()
    ) || "";
  const phone = employee.phoneNumber || employee.personalPhone || "";
  const hasFnFMenu = employee.settlement ? canViewFnF : canInitiateFnF;
  const isInactive = employee.status === "INACTIVE";
  const rangeLabel =
    range.startDate && range.endDate
      ? `${formatDisplayDate(range.startDate, timeZone)} – ${formatDisplayDate(range.endDate, timeZone)}`
      : "";

  const filteredRows = (analysis?.rows || []).filter((r) => {
    if (logFilter === "all") return true;
    return r.statusKey === logFilter;
  });
  const sortedRows = logSortDesc ? filteredRows : filteredRows.slice().reverse();
  const totalLogPages = Math.max(1, Math.ceil(sortedRows.length / logPageSize));
  const safeLogPage = Math.min(logPage, totalLogPages);
  const pageRows = sortedRows.slice((safeLogPage - 1) * logPageSize, safeLogPage * logPageSize);

  const attendanceUnavailable = !canViewAttendance
    ? "You don't have permission to view attendance data."
    : attendance.state === "error"
      ? attendance.error
      : null;

  /* --------------------------------- tab bodies ---------------------------- */
  const renderAttendanceSummary = () => {
    if (attendanceUnavailable) {
      return <EmptyState title="Attendance summary unavailable">{attendanceUnavailable}</EmptyState>;
    }
    if (!analysis) return <p className="epd-muted">Loading attendance…</p>;
    return (
      <>
        <p className="epd-card-sub" style={{ marginBottom: 10 }}>{rangeLabel}</p>
        <ul className="epd-summary-list">
          <li><span className="epd-stat-dot is-present" /> <span>Present Days</span> <strong>{analysis.counts.present + analysis.counts.late}</strong></li>
          <li><span className="epd-stat-dot is-late" /> <span>Late Check-ins</span> <strong>{analysis.counts.late}</strong></li>
          <li><span className="epd-stat-dot is-absent" /> <span>Absent Days</span> <strong>{analysis.counts.absent}</strong></li>
          <li><span className="epd-stat-dot is-leave" /> <span>Leave Taken</span> <strong>{analysis.counts.leave} {analysis.counts.leave === 1 ? "Day" : "Days"}</strong></li>
        </ul>
      </>
    );
  };

  const renderOverview = () => (
    <div className="epd-overview-layout">
      {aboutText ? (
        <Card title="About Employee" className="epd-overview-full">
          <p className="epd-about">{aboutText}</p>
        </Card>
      ) : null}

      {/*
        Independently flowing columns (not a shared-row card grid).
        Left packs Snapshot + Performance; right packs Projects + Attendance
        so short cards do not leave a tall blank band beside a taller neighbour.
      */}
      <div className="epd-overview-cols">
        <div className="epd-overview-col">
          <Card title="Employee Information Snapshot">
            <div className="epd-info-grid epd-info-grid-3">
              <Info label="Employee ID" mono>{employee.employeeCode ? `#${employee.employeeCode}` : ""}</Info>
              <Info label="Email"><span title={employee.email}>{employee.email}</span></Info>
              <Info label="Phone">{phone}</Info>
              <Info label="Join Date">{formatDate(job.joiningDate)}</Info>
              <Info label="Reporting To">
                {manager ? (
                  isSelf ? (
                    manager.fullName
                  ) : (
                    <Link className="epd-link" to={`/admin/employees/${manager._id}`}>{manager.fullName}</Link>
                  )
                ) : (
                  ""
                )}
              </Info>
              <Info label="Work Type">{job.employmentType}</Info>
              <Info label="Office Location">{job.workLocation || employee.city}</Info>
              <Info label="Department">{job.department}</Info>
              <Info label="Designation">{job.jobTitle}</Info>
            </div>
          </Card>

          <Card title="Performance Snapshot" subtitle="From impact points and skill tags on file">
            {impact.state === "ready" && impact.data ? (
              <div className="epd-info-grid">
                <Info label="Impact Balance" highlight>{impact.data.balance}</Info>
                <Info label="This Month">{impact.data.pointsThisMonth}</Info>
                <Info label="Company Rank">{impact.data.rankInCompany}</Info>
                <Info label="Department Rank">{impact.data.rankInDepartment}</Info>
              </div>
            ) : null}
            {skills.length > 0 ? (
              <div className="epd-chips" style={{ marginTop: impact.data ? 14 : 0 }}>
                {skills.map((s) => <span key={s} className="epd-chip">{s}</span>)}
              </div>
            ) : null}
            {!(impact.state === "ready" && impact.data) && skills.length === 0 ? (
              <div className="epd-empty is-compact">
                <strong>No performance data yet</strong>
                <p>
                  {!canViewImpact
                    ? "You don't have permission to view impact points."
                    : "Impact points and skill tags will appear here once recorded."}
                </p>
              </div>
            ) : null}
          </Card>
        </div>

        <div className="epd-overview-col">
          <Card title="Current Projects">
            {project ? (
              <ul className="epd-project-list">
                <li>
                  <span className="epd-project-bar" aria-hidden="true" />
                  <div>
                    <strong>{project.projectName}</strong>
                    <span>{project.projectType ? `${project.projectType} project` : "Assigned project"}</span>
                  </div>
                </li>
              </ul>
            ) : (
              <div className="epd-empty is-compact">
                <strong>No project assigned</strong>
                <p>
                  {isSelf ? "No project is currently assigned to you." : "Assign a project from the Work Info tab."}
                </p>
              </div>
            )}
          </Card>

          <Card
            title="Attendance Summary"
            action={
              <button type="button" className="epd-text-btn" onClick={() => setActiveTab("attendance")}>
                View details
              </button>
            }
          >
            {renderAttendanceSummary()}
          </Card>
        </div>
      </div>
    </div>
  );

  const renderPersonal = () => {
    const addressLine = [
      employee.residentialAddress?.street,
      employee.residentialAddress?.city || employee.city,
      employee.residentialAddress?.state,
      employee.residentialAddress?.postalCode,
    ].filter(Boolean).join(", ");
    const emergencyLine = employee.emergencyContact?.name
      ? `${employee.emergencyContact.name}${employee.emergencyContact.relationship ? ` (${employee.emergencyContact.relationship})` : ""}${employee.emergencyContact.phone ? ` — ${employee.emergencyContact.phone}` : ""}`
      : "";

    if (isEditing) {
      return (
        <div className="epd-stack">
          <Card title="Demographic & Contact Details" subtitle="Edit personal information">
            <div className="epd-form-grid">
              {isSelf ? (
                <TextField label="Full Legal Name" tag="Read-only" value={employee.fullName} disabled />
              ) : (
                <TextField label="Full Legal Name *" value={editFormData.fullName} onChange={(v) => handleEditChange("fullName", v)} placeholder="Legal Name" required />
              )}
              <TextField label="Preferred Name" value={editFormData.preferredName} onChange={(v) => handleEditChange("preferredName", v)} placeholder="Preferred Name" />
              <TextField label="Work Email" tag="Read-only" value={employee.email} disabled />
              <TextField label="Personal Email" type="email" value={editFormData.personalEmail} onChange={(v) => handleEditChange("personalEmail", v)} placeholder="personal@email.com" />
              <TextField label="Work Phone" value={editFormData.phoneNumber} onChange={(v) => handleEditChange("phoneNumber", v)} placeholder="Work Phone" />
              <TextField label="Personal Phone" value={editFormData.personalPhone} onChange={(v) => handleEditChange("personalPhone", v)} placeholder="Personal Phone" />
              <TextField label="Date of Birth" type="date" value={editFormData.dateOfBirth} onChange={(v) => handleEditChange("dateOfBirth", v)} />
              <Field label="Gender">
                <select className="epv-edit-input" value={editFormData.gender || ""} onChange={(e) => handleEditChange("gender", e.target.value)}>
                  <option value="">Select Gender</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Non-binary">Non-binary</option>
                  <option value="Prefer not to say">Prefer not to say</option>
                </select>
              </Field>
              <TextField label="City" value={editFormData.city} onChange={(v) => handleEditChange("city", v)} placeholder="City" />
            </div>
          </Card>
          <Card title="Address & Emergency Contact">
            <div className="epd-form-grid">
              <TextField label="Street Address" value={editFormData.residentialStreet} onChange={(v) => handleEditChange("residentialStreet", v)} placeholder="Street Address" />
              <TextField label="State" value={editFormData.residentialState} onChange={(v) => handleEditChange("residentialState", v)} placeholder="State" />
              <TextField label="Postal Code" value={editFormData.residentialPostalCode} onChange={(v) => handleEditChange("residentialPostalCode", v)} placeholder="Postal Code" />
              <TextField label="Emergency Contact Name" value={editFormData.emergencyName} onChange={(v) => handleEditChange("emergencyName", v)} placeholder="Emergency Contact Name" />
              <TextField label="Emergency Relationship" value={editFormData.emergencyRel} onChange={(v) => handleEditChange("emergencyRel", v)} placeholder="e.g. Spouse, Parent, Sibling" />
              <TextField label="Emergency Contact Phone" value={editFormData.emergencyPhone} onChange={(v) => handleEditChange("emergencyPhone", v)} placeholder="Phone Number" />
            </div>
          </Card>
        </div>
      );
    }

    return (
      <div className="epd-stack">
        <Card title="Demographic & Contact Details" subtitle="Official identity and contact information">
          <div className="epd-info-grid epd-info-grid-3">
            <Info hideIfEmpty label="Full Legal Name">{employee.fullName}</Info>
            <Info hideIfEmpty label="Preferred Name">{employee.preferredName}</Info>
            <Info hideIfEmpty label="Work Email">{employee.email}</Info>
            <Info hideIfEmpty label="Personal Email">{employee.personalEmail}</Info>
            <Info hideIfEmpty label="Work Phone">{employee.phoneNumber}</Info>
            <Info hideIfEmpty label="Personal Phone">{employee.personalPhone}</Info>
            <Info hideIfEmpty label="Date of Birth">{formatDate(employee.dateOfBirth)}</Info>
            <Info hideIfEmpty label="Gender">{employee.gender && employee.gender !== "Not specified" ? employee.gender : ""}</Info>
            <Info hideIfEmpty label="City">{employee.residentialAddress?.city || employee.city}</Info>
          </div>
        </Card>

        {addressLine || emergencyLine ? (
          <div className={`epd-section-cols${addressLine && emergencyLine ? "" : " epd-section-cols--single"}`}>
            {addressLine ? (
              <div className="epd-section-col">
                <Card title="Residential Address">
                  <p className="epd-plain-value">{addressLine}</p>
                </Card>
              </div>
            ) : null}
            {emergencyLine ? (
              <div className="epd-section-col">
                <Card title="Emergency Contact">
                  <p className="epd-plain-value">{emergencyLine}</p>
                </Card>
              </div>
            ) : null}
          </div>
        ) : (
          <Card title="Address & Emergency Contact">
            <EmptyState title="No address or emergency contact on file" />
          </Card>
        )}
      </div>
    );
  };

  const reportingManagerDisplay = manager ? (
    <>
      {isSelf ? (
        <span>{manager.fullName}</span>
      ) : (
        <Link className="epd-link" to={`/admin/employees/${manager._id}`}>{manager.fullName}</Link>
      )}
      {manager.job?.jobTitle ? <span className="epd-info-sub">{manager.job.jobTitle}</span> : null}
    </>
  ) : (
    "No reporting manager"
  );

  const renderWork = () => {
    const jobCard = (
      <Card
        title="Job & Organization Role"
        subtitle={isSelf ? "Maintained by HR — view only" : "Corporate structure and placement"}
      >
        {isEditing && canEditWork ? (
          <div className="epd-form-grid">
            <TextField label="Employee Code" tag="Read-only" value={employee.employeeCode || "—"} disabled />
            <div className="epd-span-all epd-designation">
              <DesignationFields
                jobTitle={editFormData.jobTitle || ""}
                jobGrade={editFormData.jobGrade || ""}
                inputClassName="epv-edit-input"
                titleLabel="Official job title"
                gradeLabel="Job grade / level"
                disabled={savingEdit}
                onJobTitleChange={(value) => handleEditChange("jobTitle", value)}
                onJobGradeChange={(value) => handleEditChange("jobGrade", value)}
              />
              <DepartmentSelect
                departmentId={editFormData.clearDepartment ? "" : editFormData.departmentId}
                departmentName={editFormData.clearDepartment ? "" : editFormData.departmentName}
                linked={Boolean(editFormData.departmentId) && !editFormData.clearDepartment}
                disabled={savingEdit}
                onChange={(next) =>
                  setEditFormData((prev) => ({
                    ...prev,
                    departmentId: next.departmentId,
                    departmentName: next.departmentName,
                    clearDepartment: next.clearDepartment && !next.departmentId,
                    departmentTouched: true,
                  }))
                }
              />
            </div>
            <Field label="Employment Type">
              <select className="epv-edit-input" value={editFormData.employmentType || ""} onChange={(e) => handleEditChange("employmentType", e.target.value)}>
                <option value="">Not specified</option>
                <option value="Full-time Permanent">Full-time Permanent</option>
                <option value="Part-time">Part-time</option>
                <option value="Contract">Contract</option>
                <option value="Intern">Intern</option>
                {editFormData.employmentType &&
                !["Full-time Permanent", "Part-time", "Contract", "Intern"].includes(editFormData.employmentType) ? (
                  <option value={editFormData.employmentType}>{editFormData.employmentType}</option>
                ) : null}
              </select>
            </Field>
            <Field label="Employment Status">
              <select className="epv-edit-input" value={editFormData.status || "ACTIVE"} onChange={(e) => handleEditChange("status", e.target.value)}>
                <option value="ACTIVE">ACTIVE</option>
                <option value="INACTIVE">INACTIVE</option>
                {editFormData.status && !["ACTIVE", "INACTIVE"].includes(editFormData.status) ? (
                  <option value={editFormData.status}>{editFormData.status}</option>
                ) : null}
              </select>
            </Field>
            <TextField label="Date of Joining" tag="Read-only" value={formatDate(job.joiningDate)} disabled />
            <TextField label="Work Location" value={editFormData.workLocation} onChange={(v) => handleEditChange("workLocation", v)} placeholder="Work Location" />
            <div className="epd-span-all">
              <ReportingManagerSelect
                value={editFormData.reportingManagerId ?? null}
                initialSelected={job.reportingManagerId && typeof job.reportingManagerId === "object" ? job.reportingManagerId : null}
                excludeEmployeeId={routeId}
                disabled={savingEdit}
                onChange={(nextId) => handleEditChange("reportingManagerId", nextId)}
              />
            </div>
          </div>
        ) : (
          <div className="epd-info-grid epd-info-grid-3">
            <Info hideIfEmpty label="Employee Code" mono>{employee.employeeCode}</Info>
            <Info hideIfEmpty label="Official Job Title">{job.jobTitle}</Info>
            <Info hideIfEmpty label="Department">{job.department}</Info>
            <Info hideIfEmpty label="Job Grade / Level">{job.jobGrade}</Info>
            <Info hideIfEmpty label="Employment Type">{job.employmentType}</Info>
            <Info label="Employment Status"><StatusBadge status={employee.status || "ACTIVE"} /></Info>
            <Info hideIfEmpty label="Date of Joining">{formatDate(job.joiningDate)}</Info>
            <Info hideIfEmpty label="Work Location">{job.workLocation}</Info>
            <Info label="Reporting Manager">{reportingManagerDisplay}</Info>
          </div>
        )}
      </Card>
    );

    const projectCard = (
      <Card title="Project Assignment" subtitle="Current project and deployment type">
        {isEditing && canEditWork ? (
          <div className="epd-form-grid">
            <TextField label="Assigned Project Name" value={editFormData.projectName} onChange={(v) => handleEditChange("projectName", v)} placeholder="e.g. Core Platform Modernization" />
            <Field label="Project Type">
              <select className="epv-edit-input" value={editFormData.projectType || "MANDATE"} onChange={(e) => handleEditChange("projectType", e.target.value)}>
                <option value="MANDATE">MANDATE</option>
                <option value="RETAIL">RETAIL</option>
                <option value="INTERNAL">INTERNAL</option>
                <option value="BENCH">BENCH</option>
              </select>
            </Field>
          </div>
        ) : project ? (
          <div className="epd-info-grid">
            <Info label="Assigned Project" highlight>{project.projectName}</Info>
            <Info hideIfEmpty label="Project Type">{project.projectType}</Info>
          </div>
        ) : (
          <EmptyState title="No project assigned" />
        )}
      </Card>
    );

    const exitCard = isInactive ? (
      <Card title="Exit & Deactivation Details">
        <div className="epd-info-grid">
          <Info hideIfEmpty label="Last Working Day">{formatDate(job.terminationDate || employee.exit?.inactiveDate || employee.settlement?.lastWorkingDay)}</Info>
          <Info hideIfEmpty label="Exit Reason">{employee.exit?.reason || employee.settlement?.exitReason}</Info>
        </div>
      </Card>
    ) : null;

    /* Full-width stack avoids a tall Job card leaving ~277px blank beside an empty Project card */
    return (
      <div className="epd-stack">
        {jobCard}
        {project ? (
          <div className="epd-section-cols">
            <div className="epd-section-col">{projectCard}</div>
            {exitCard ? <div className="epd-section-col">{exitCard}</div> : null}
          </div>
        ) : (
          <>
            {projectCard}
            {exitCard}
          </>
        )}
      </div>
    );
  };

  const renderAttendance = () => {
    const toolbar = (
      <div className="epd-toolbar">
        <div>
          <h3 className="epd-card-title">Attendance</h3>
          <p className="epd-card-sub">Real punch records for the selected period</p>
        </div>
        <DateRangePicker
          label=""
          placeholder="Select dates"
          startDate={range.startDate}
          endDate={range.endDate}
          maxDate={todayStr}
          autoApply
          onChange={({ startDate, endDate }) => setRange({ startDate, endDate })}
        />
      </div>
    );

    if (attendanceUnavailable) {
      return (
        <div className="epd-stack">
          {canViewAttendance ? toolbar : null}
          <Card><EmptyState title="Attendance unavailable" icon={<IconShield size={18} />}>{attendanceUnavailable}</EmptyState></Card>
        </div>
      );
    }
    if (!analysis) {
      return (
        <div className="epd-stack">
          {toolbar}
          <Card><p className="epd-muted">Loading attendance…</p></Card>
        </div>
      );
    }

    const maxWeekly = 100;
    const todayDay = analysis.today;

    return (
      <div className="epd-stack">
        {toolbar}

        <div className="epd-stat-row">
          <StatCard tone="present" label="Present Days" value={analysis.counts.present + analysis.counts.late} sub={`of ${analysis.workingDays} working days`} />
          <StatCard tone="late" label="Late Check-ins" value={analysis.counts.late} />
          <StatCard tone="absent" label="Absent Days" value={analysis.counts.absent} sub={analysis.counts.absent === 0 ? "No unexcused absences" : undefined} />
          <StatCard tone="leave" label="Leave Taken" value={`${analysis.counts.leave} ${analysis.counts.leave === 1 ? "Day" : "Days"}`} sub="Marked on leave in period" />
        </div>

        {attendance.total > attendance.records.length ? (
          <p className="epd-note">
            Showing the latest {attendance.records.length} of {attendance.total} records. Narrow the period to see all of them.
          </p>
        ) : null}

        {/* Three compact peers — Leave is a list so it stays full-width below */}
        <div className="epd-section-cols epd-section-cols--3">
          <div className="epd-section-col">
            <Card title="Attendance Rate">
              {analysis.rate === null ? (
                <EmptyState title="No working days in this period" />
              ) : (
                <>
                  <div className="epd-rate">
                    <strong>{analysis.rate}%</strong>
                    <span>{analysis.attended} of {analysis.workingDays} working days attended</span>
                  </div>
                  <div className="epd-progress" role="progressbar" aria-valuenow={analysis.rate} aria-valuemin={0} aria-valuemax={100}>
                    <span style={{ width: `${analysis.rate}%` }} />
                  </div>
                </>
              )}
            </Card>
          </div>

          <div className="epd-section-col">
            <Card title="Today's Attendance Status">
              {!todayDay ? (
                <p className="epd-muted">Today is outside the selected period.</p>
              ) : (
                <div className="epd-today">
                  <div><span>Current Status</span><b className={`epd-pill is-${todayDay.statusKey}`}>{ATTENDANCE_STATUS_LABELS[todayDay.statusKey] || (todayDay.statusKey === "weekend" ? "Weekend" : "Holiday")}</b></div>
                  <div><span>Clock In</span><b>{todayDay.checkIn || "—"}</b></div>
                  <div><span>Clock Out</span><b>{todayDay.checkOut || "—"}</b></div>
                  <div><span>Worked Hours</span><b>{todayDay.hours || "—"}</b></div>
                </div>
              )}
            </Card>
          </div>

          <div className="epd-section-col">
            <Card title="Attendance Trend" subtitle="Weekly rate in period">
              {analysis.weekly.length === 0 ? (
                <EmptyState title="Not enough data for a trend" />
              ) : (
                <div className="epd-bars" role="img" aria-label="Weekly attendance rate">
                  {analysis.weekly.map((w) => (
                    <div key={w.startDate} className="epd-bar-col" title={`Week of ${shortCivil(w.startDate)}: ${w.attended}/${w.working} days (${w.rate}%)`}>
                      <span className="epd-bar-val">{w.rate}%</span>
                      <span className="epd-bar-track"><span className="epd-bar-fill" style={{ height: `${(w.rate / maxWeekly) * 100}%` }} /></span>
                      <span className="epd-bar-lbl">{shortCivil(w.startDate)}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>

        <Card title="Recent Leave History">
          {!canViewLeave ? (
            <EmptyState title="Leave history unavailable">You don't have permission to view leave requests.</EmptyState>
          ) : leaves.state === "loading" ? (
            <p className="epd-muted">Loading leave history…</p>
          ) : leaves.state === "error" ? (
            <EmptyState title="Leave history unavailable">{leaves.error}</EmptyState>
          ) : leaves.items.length === 0 ? (
            <EmptyState title="No leave requests on record" />
          ) : (
            <ul className="epd-leave-list">
              {leaves.items.slice(0, 5).map((l) => (
                <li key={l._id} className={`is-${String(l.status || "").toLowerCase()}`}>
                  <div>
                    <strong>{l.leaveTypeCode || "Leave"}</strong>
                    <span>
                      {shortCivil(l.fromDate)}
                      {l.toDate && l.toDate !== l.fromDate ? ` – ${shortCivil(l.toDate)}` : ""} · {l.daysCount} {l.daysCount === 1 ? "day" : "days"}
                    </span>
                  </div>
                  <StatusBadge status={l.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Recent Attendance Logs"
          action={
            <div className="epd-log-controls">
              <select className="epd-select" value={logFilter} onChange={(e) => setLogFilter(e.target.value)} aria-label="Filter by status">
                <option value="all">All statuses</option>
                <option value="present">Present</option>
                <option value="late">Late</option>
                <option value="absent">Absent</option>
                <option value="leave">On leave</option>
              </select>
              <button type="button" className="epd-select epd-sort-btn" onClick={() => setLogSortDesc((v) => !v)}>
                Date {logSortDesc ? "↓" : "↑"}
              </button>
            </div>
          }
        >
          {sortedRows.length === 0 ? (
            <EmptyState title="No attendance logs for this selection" />
          ) : (
            <>
              <div className="epd-table-wrap">
                <table className="epd-table">
                  <thead>
                    <tr><th>Date</th><th>Clock In</th><th>Clock Out</th><th>Hours</th><th>Status</th></tr>
                  </thead>
                  <tbody>
                    {pageRows.map((r) => (
                      <tr key={r.date}>
                        <td>{formatDisplayDate(r.date, timeZone)}</td>
                        <td>{r.checkIn || "—"}</td>
                        <td>{r.checkOut || "—"}</td>
                        <td>{r.hours || "—"}</td>
                        <td><span className={`epd-pill is-${r.statusKey}`}>{ATTENDANCE_STATUS_LABELS[r.statusKey] || (r.statusKey === "weekend" ? "Weekend" : "Holiday")}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="epd-pager">
                <label>
                  Show
                  <select className="epd-select" value={logPageSize} onChange={(e) => setLogPageSize(Number(e.target.value))}>
                    {[5, 10, 20, 50].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                  of {sortedRows.length} entries
                </label>
                <div className="epd-pager-btns">
                  <button type="button" onClick={() => setLogPage(Math.max(1, safeLogPage - 1))} disabled={safeLogPage <= 1} aria-label="Previous page">‹</button>
                  <span>{safeLogPage} / {totalLogPages}</span>
                  <button type="button" onClick={() => setLogPage(Math.min(totalLogPages, safeLogPage + 1))} disabled={safeLogPage >= totalLogPages} aria-label="Next page">›</button>
                </div>
              </div>
            </>
          )}
        </Card>
      </div>
    );
  };

  const renderPerformance = () => (
    <div className="epd-stack">
      <Card title="Impact Points" subtitle="Recognition ledger from the Impact Points module">
        {!canViewImpact ? (
          <EmptyState title="Impact points unavailable" icon={<IconShield size={18} />}>You don't have permission to view impact points.</EmptyState>
        ) : impact.state === "loading" ? (
          <p className="epd-muted">Loading impact points…</p>
        ) : impact.state === "error" ? (
          <EmptyState title="Impact points unavailable">{impact.error}</EmptyState>
        ) : impact.data ? (
          <>
            <div className="epd-stat-row">
              <StatCard tone="present" label="Balance" value={impact.data.balance} />
              <StatCard tone="leave" label="This Month" value={impact.data.pointsThisMonth} />
              <StatCard tone="late" label="Company Rank" value={impact.data.rankInCompany} />
              <StatCard tone="absent" label="Department Rank" value={impact.data.rankInDepartment} />
            </div>
            <div className="epd-info-grid epd-info-grid-3" style={{ marginTop: 14 }}>
              <Info label="Total Earned">{impact.data.totalEarned}</Info>
              <Info label="Total Deducted">{impact.data.totalDeducted}</Info>
            </div>
          </>
        ) : (
          <EmptyState title="No impact points recorded" />
        )}
      </Card>

      <div className="epd-section-cols">
        <div className="epd-section-col">
          <Card title="Skills" subtitle="Skill tags on the employee record">
            {skills.length > 0 ? (
              <div className="epd-chips">{skills.map((s) => <span key={s} className="epd-chip">{s}</span>)}</div>
            ) : (
              <EmptyState title="No skills recorded" />
            )}
          </Card>
        </div>
        <div className="epd-section-col">
          <Card title="Reviews & KPIs">
            <EmptyState title="No performance review data">
              No performance review or KPI module is connected yet.
            </EmptyState>
          </Card>
        </div>
      </div>
    </div>
  );

  const renderPayroll = () => {
    if (!canViewPayroll && !isSelf) {
      return (
        <Card>
          <EmptyState title="Payroll details are restricted" icon={<IconShield size={18} />}>
            Your HR access does not include payroll.view, so compensation, bank and tax details are hidden.
          </EmptyState>
        </Card>
      );
    }

    const monthly = employee.currentMonthlySalary ?? employee.compensation?.monthlyCostToCompany ?? null;
    const salaryComponents = employee.salaryComponents || employee.compensation?.salaryComponents || null;
    const hasRichCompensation = canViewPayroll && monthly != null;

    const compensationCard = canViewPayroll ? (
      <Card title="Current Compensation Structure" subtitle="Visible only to HR users with payroll access">
        {isEditing && canEditWork ? (
          <div className="epd-form-grid">
            <TextField label="Monthly CTC (₹)" type="number" min="0" value={editFormData.monthlySalary} onChange={(v) => handleEditChange("monthlySalary", v)} placeholder="e.g. 75000" />
          </div>
        ) : monthly == null ? (
          <EmptyState title="No compensation record on file" />
        ) : (
          <>
            <div className="epd-stat-row epd-stat-row-3">
              <StatCard tone="present" label="Monthly CTC" value={formatCurrency(monthly)} />
              <StatCard tone="leave" label="Annual CTC" value={formatCurrency(monthly * 12)} sub="Monthly × 12" />
              <StatCard tone="late" label="Currency" value="INR (₹)" />
            </div>
            {salaryComponents ? (
              <div className="epd-info-grid epd-info-grid-3" style={{ marginTop: 14 }}>
                <Info label="Basic Salary">{formatCurrency(salaryComponents.basicSalary)}</Info>
                <Info label="House Rent Allowance (HRA)">{formatCurrency(salaryComponents.houseRentAllowance)}</Info>
                <Info label="Conveyance Allowance">{formatCurrency(salaryComponents.conveyanceAllowance)}</Info>
                <Info label="Special Allowance">{formatCurrency(salaryComponents.specialAllowance)}</Info>
                <Info label="Employer PF Contribution">{formatCurrency(salaryComponents.employerProvidentFund)}</Info>
                <Info label="Statutory Deductions">{formatCurrency(salaryComponents.otherDeductions)}</Info>
              </div>
            ) : null}
          </>
        )}
      </Card>
    ) : (
      <Card title="Compensation">
        <EmptyState title="Compensation is managed by HR" icon={<IconShield size={18} />}>
          Monthly CTC and salary components are not shown in self-service. Open Payslips for disbursement history.
        </EmptyState>
      </Card>
    );

    const bankCard = (
      <Card title="Bank & Tax Details" subtitle={isSelf ? "You may update these details" : undefined}>
        {isEditing && canEditBankTax ? (
          <div className="epd-form-grid">
            <TextField label="PAN Number" value={editFormData.panNumber} onChange={(v) => handleEditChange("panNumber", v.toUpperCase())} placeholder="ABCDE1234F" />
            <TextField label="Bank Name" value={editFormData.bankName} onChange={(v) => handleEditChange("bankName", v)} placeholder="e.g. HDFC Bank" />
            <TextField label="Account Number" value={editFormData.accountNumber} onChange={(v) => handleEditChange("accountNumber", v)} placeholder="Bank Account Number" />
            <TextField label="IFSC Code" value={editFormData.ifscCode} onChange={(v) => handleEditChange("ifscCode", v.toUpperCase())} placeholder="IFSC" />
          </div>
        ) : (
          <div className="epd-info-grid">
            <Info label="PAN Number" mono>{tax?.panNumber || "Not recorded"}</Info>
            <Info label="Bank Name">{bank?.bankName || "Not recorded"}</Info>
            <Info label="Account Number" mono>{bank?.accountNumber ? `••••••••${String(bank.accountNumber).slice(-4)}` : "Not recorded"}</Info>
            <Info label="IFSC Code" mono>{bank?.ifscCode || "Not recorded"}</Info>
          </div>
        )}
      </Card>
    );

    const payslipsCard = (
      <Card title="Payslips">
        {isSelf ? (
          <>
            <EmptyState title="Payslips are available in self-service">
              Download and review your payslips from the Payslips page.
            </EmptyState>
            <div style={{ marginTop: 12 }}>
              <Link className="btn-secondary" to="/app/payslips">Open Payslips</Link>
            </div>
          </>
        ) : (
          <>
            <EmptyState title="Payslips live in the Payroll module">
              There is no per-employee payslip list in the HR API. Open a payroll cycle to review or download this employee&apos;s payslip.
            </EmptyState>
            <div style={{ marginTop: 12 }}>
              <Link className="btn-secondary" to="/admin/payroll">Open Payroll</Link>
            </div>
          </>
        )}
      </Card>
    );

    /* Rich compensation beside bank+payslips; otherwise stack to avoid tall blank columns */
    if (hasRichCompensation) {
      return (
        <div className="epd-section-cols">
          <div className="epd-section-col">{compensationCard}</div>
          <div className="epd-section-col">
            {bankCard}
            {payslipsCard}
          </div>
        </div>
      );
    }

    return (
      <div className="epd-stack">
        {compensationCard}
        <div className="epd-section-cols">
          <div className="epd-section-col">{bankCard}</div>
          <div className="epd-section-col">{payslipsCard}</div>
        </div>
      </div>
    );
  };

  const renderDocuments = () => (
    <div className="epd-stack">
      {canUploadDocuments ? (
        <Card title="Upload Document" subtitle="PDF, PNG or JPG — max 10MB">
          {docMsg.success ? <div className="success-alert" style={{ marginBottom: 12 }}>{docMsg.success}</div> : null}
          {docMsg.error ? <div className="error" style={{ marginBottom: 12 }}>{docMsg.error}</div> : null}
          <form onSubmit={handleUploadDocument} className="epd-form-grid" noValidate>
            <Field label="Category *">
              <select className="epv-edit-input" value={uploadCategory} onChange={(e) => setUploadCategory(e.target.value)}>
                <option value="ID_PROOF">ID Proof</option>
                <option value="ADDRESS_PROOF">Address Proof</option>
                <option value="EDUCATION">Educational Certificate</option>
                <option value="CERTIFICATION">Professional Certification</option>
                <option value="OTHER">Other</option>
              </select>
            </Field>
            <TextField label="Document Title *" value={uploadTitle} onChange={setUploadTitle} placeholder="e.g. Updated Aadhaar Card" required />
            <Field label="File *" wide>
              <input
                className="epv-edit-input"
                type="file"
                accept=".pdf,.png,.jpg,.jpeg"
                onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                required
              />
            </Field>
            <div className="epd-span-all" style={{ display: "flex", justifyContent: "flex-end" }}>
              <button type="submit" className="btn-primary" disabled={uploadingDoc || !selectedFile}>
                {uploadingDoc ? "Uploading…" : "Upload Document"}
              </button>
            </div>
          </form>
        </Card>
      ) : null}

      <Card title="Uploaded Verification Documents" subtitle={`${employee.documents?.length || 0} document(s) on file`}>
        {!employee.documents || employee.documents.length === 0 ? (
          <EmptyState title="No documents uploaded" icon={<IconDocument size={18} />}>
            {isSelf ? "You have not uploaded any documents yet." : "No documents have been uploaded for this employee yet."}
          </EmptyState>
        ) : (
          <div className="epd-doc-list">
            {employee.documents.map((doc) => (
              <div key={doc._id} className="epv-doc-row">
                <div className="epv-doc-left">
                  <div className="epv-doc-icon"><IconDocument size={18} /></div>
                  <div>
                    <div className="epv-doc-title">{doc.title || doc.fileName}</div>
                    <div className="epv-doc-meta">
                      {doc.documentType?.replace("_", " ")} • {formatFileSize(doc.fileSize)} • Uploaded {formatDate(doc.uploadedAt)}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  className="epv-doc-download-btn"
                  disabled={downloadingDocId === doc._id}
                  onClick={() => handleDownloadDocument(doc._id, doc.fileName)}
                >
                  <IconDownload size={14} />
                  <span>{downloadingDocId === doc._id ? "Downloading..." : "Download"}</span>
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );

  const renderActivity = () => {
    const visible = activityEvents.slice(0, 12);
    return (
      <div className="epd-stack">
        <Card
          title="Recent Activity"
          subtitle="Built from the employee record, attendance, leave and impact points — not a full audit log"
        >
          {activityEvents.length === 0 ? (
            <EmptyState title="No activity to show yet" />
          ) : (
            <>
              <ol className="epd-timeline epd-timeline--compact">
                {visible.map((ev, idx) => (
                  <li key={`${ev.ts}-${idx}`} className={`is-${ev.tone}`}>
                    <span className="epd-timeline-dot" aria-hidden="true" />
                    <div>
                      <strong>{ev.title}</strong>
                      {ev.detail ? <span>{ev.detail}</span> : null}
                      <time>{formatDateTime(ev.ts)}</time>
                    </div>
                  </li>
                ))}
              </ol>
              {activityEvents.length > visible.length ? (
                <p className="epd-muted" style={{ marginTop: 10 }}>
                  Showing {visible.length} of {activityEvents.length} events
                </p>
              ) : null}
            </>
          )}
        </Card>
      </div>
    );
  };

  const tabBodies = {
    overview: renderOverview,
    personal: renderPersonal,
    work: renderWork,
    attendance: renderAttendance,
    performance: renderPerformance,
    payroll: renderPayroll,
    documents: renderDocuments,
    activity: renderActivity,
  };

  const onTabKeyDown = (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const idx = TABS.findIndex((t) => t.id === activeTab);
    const next = (idx + (e.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length;
    setActiveTab(TABS[next].id);
    e.preventDefault();
  };

  return (
    <div className="epv-container epd-page">
      <AppHeader
        title={isSelf ? "My Profile" : "Employee Detail"}
        actions={isSelf ? <SoftRefresh active={loading} /> : null}
        leading={
          isSelf ? null : (
            <button type="button" className="epd-back" onClick={() => goBack()} aria-label="Go back">
              <IconArrowLeft size={18} />
            </button>
          )
        }
        nav={
          isSelf ? (
            <p className="epv-header-sub">Your employment profile, contact details and documents</p>
          ) : (
            <nav className="epv-breadcrumb" aria-label="Breadcrumb">
              <Link to="/admin">Employees</Link>
              <span className="epv-breadcrumb-sep">›</span>
              <span className="epv-breadcrumb-current">{employee.fullName}</span>
            </nav>
          )
        }
      />

      {editSuccess && <div className="success-alert" style={{ marginBottom: 14 }}>{editSuccess}</div>}
      {editError && <div className="error" style={{ marginBottom: 14 }}>{editError}</div>}

      {/* ---------------------------- Profile header --------------------------- */}
      <section className="epd-header" aria-label="Employee profile header">
        <div className="epd-banner" aria-hidden="true" />
        <div className="epd-header-body">
          <div className="epd-identity">
            <div className="epd-avatar">
              {avatarUrl ? (
                <img src={avatarUrl} alt={employee.fullName} />
              ) : (
                <span aria-hidden="true">{initialsOf(employee.fullName)}</span>
              )}
            </div>
            <div className="epd-identity-copy">
              <h2 className="epd-name">{employee.fullName}</h2>
              <p className="epd-sub">
                {employee.employeeCode ? <span className="epd-code">#{employee.employeeCode}</span> : null}
                {employee.employeeCode && job.jobTitle ? <span className="epd-dot">›</span> : null}
                {job.jobTitle ? <span>{job.jobTitle}</span> : null}
              </p>
              {isSelf ? (
                <ProfilePhotoField
                  hideAvatar
                  className="epv-photo-field"
                  onChanged={() => {
                    invalidateProfile(queryClient);
                    api.get("/employees/me").then((res) => {
                      if (res.data?.employee) setEmployee(res.data.employee);
                    }).catch(() => {});
                  }}
                />
              ) : null}
            </div>
          </div>

          <div className="epd-header-actions">
            <StatusBadge status={employee.status || "ACTIVE"} />
            {isEditing ? (
              <>
                <button type="button" className="btn-secondary" onClick={handleCancelEdit} disabled={savingEdit}>Cancel</button>
                <button type="button" className="btn-primary epd-btn" onClick={handleSaveProfile} disabled={savingEdit}>
                  <IconCheck size={14} />
                  <span>{savingEdit ? "Saving..." : "Save Changes"}</span>
                </button>
              </>
            ) : canEdit ? (
              <button
                type="button"
                className="btn-primary epd-btn"
                onClick={handleStartEdit}
                title={isSelf ? "Edit contact details" : "Edit employee details"}
                aria-label={isSelf ? "Edit contact details" : "Edit employee details"}
              >
                <IconPencil />
                <span>{isSelf ? "Edit Contact Info" : "Edit"}</span>
              </button>
            ) : null}

            {hasFnFMenu && !isEditing ? (
              <div className="epd-menu" ref={menuRef}>
                <button type="button" className="epd-icon-btn" aria-haspopup="menu" aria-expanded={menuOpen} aria-label="More actions" onClick={() => setMenuOpen((v) => !v)}>
                  <IconMore />
                </button>
                {menuOpen ? (
                  <div className="epd-menu-list" role="menu">
                    {employee.settlement ? (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMenuOpen(false);
                          navigate(`/admin/payroll?settlementId=${employee.settlement.id || employee.settlement._id}`);
                        }}
                      >
                        View F&amp;F ({employee.settlement.status?.replace("_", " ")})
                      </button>
                    ) : (
                      <button type="button" role="menuitem" onClick={openFnFModal}>Initiate F&amp;F</button>
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        <div className="epd-tiles">
          <div className="epd-tile">
            <span className="epd-tile-lbl">Department</span>
            <span className="epd-tile-val"><IconBuilding size={15} /><span>{job.department || "—"}</span></span>
          </div>
          <div className="epd-tile">
            <span className="epd-tile-lbl">Employment Type</span>
            <span className="epd-tile-val"><IconBriefcase size={15} /><span>{job.employmentType || "—"}</span></span>
          </div>
          <div className="epd-tile">
            <span className="epd-tile-lbl">Email</span>
            <span className="epd-tile-val"><IconMail size={15} /><span title={employee.email}>{employee.email || "—"}</span></span>
          </div>
          <div className="epd-tile">
            <span className="epd-tile-lbl">Phone Number</span>
            <span className="epd-tile-val"><IconPhone size={15} /><span>{phone || "—"}</span></span>
          </div>
        </div>
      </section>

      {/* ------------------------------- Tabs --------------------------------- */}
      <div className="epd-tabs" role="tablist" aria-label="Employee detail sections" onKeyDown={onTabKeyDown}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            id={`epd-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls="epd-panel"
            tabIndex={activeTab === tab.id ? 0 : -1}
            className={`epd-tab${activeTab === tab.id ? " is-active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
            {tab.id === "documents" && employee.documents?.length ? (
              <span className="epd-tab-count">{employee.documents.length}</span>
            ) : null}
          </button>
        ))}
      </div>

      {isEditing ? (
        <div className="epd-edit-banner" role="status">
          <IconUsers size={15} />
          <span>
            {isSelf
              ? "Editing mode — update Personal Info and bank/tax details. Employment fields stay read-only."
              : `Editing mode — changes in Personal Info, Work Info${canViewPayroll ? " and Payroll" : ""} are saved together.`}
          </span>
        </div>
      ) : null}

      <div id="epd-panel" role="tabpanel" aria-labelledby={`epd-tab-${activeTab}`} className="epd-panel">
        {tabBodies[activeTab]()}
      </div>

      {/* =========================================================================
          F&F Initiation Modal (preserved operational settlement flow)
          ========================================================================= */}
      {showFnFModal && (
        <div className="modal-overlay" onClick={() => setShowFnFModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "520px" }}>
            <div className="modal-header">
              <h2>Initiate Full & Final Settlement</h2>
              <button type="button" className="btn-secondary btn-sm" onClick={() => setShowFnFModal(false)} aria-label="Close modal">
                <IconClose size={14} />
              </button>
            </div>

            {fnfError && <div className="error">{fnfError}</div>}
            {fnfSuccess && <div className="success-alert">{fnfSuccess}</div>}

            <form onSubmit={handleInitiateFnF} className="auth-form" style={{ marginTop: "16px" }}>
              <div style={{ marginBottom: "14px" }}>
                <label>
                  Last Working Day *
                  <input
                    type="date"
                    required
                    value={fnfForm.lastWorkingDay}
                    onChange={(e) => setFnfForm({ ...fnfForm, lastWorkingDay: e.target.value })}
                  />
                </label>
              </div>

              <div style={{ marginBottom: "14px" }}>
                <label>
                  Exit Reason *
                  <select
                    value={fnfForm.exitReason}
                    onChange={(e) => setFnfForm({ ...fnfForm, exitReason: e.target.value })}
                    className="filter-select"
                    style={{ width: "100%" }}
                  >
                    <option value="Resignation">Resignation</option>
                    <option value="Termination">Termination</option>
                    <option value="Retirement">Retirement</option>
                    <option value="Contract End">Contract End</option>
                    <option value="Mutual Separation">Mutual Separation</option>
                  </select>
                </label>
              </div>

              <div style={{ marginBottom: "20px" }}>
                <label>
                  HR Remarks (Optional)
                  <textarea
                    rows={3}
                    value={fnfForm.hrRemarks}
                    onChange={(e) => setFnfForm({ ...fnfForm, hrRemarks: e.target.value })}
                    placeholder="Enter any handover or exit clearance notes..."
                    style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid var(--hair)" }}
                  />
                </label>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                <button type="button" className="btn-secondary" onClick={() => setShowFnFModal(false)}>Cancel</button>
                <button type="submit" disabled={submittingFnF} className="btn-primary">
                  {submittingFnF ? "Initiating..." : "Initiate Settlement"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
