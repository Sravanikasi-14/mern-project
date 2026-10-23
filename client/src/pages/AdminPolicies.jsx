import { useEffect, useMemo, useState } from "react";
import AppHeader from "../components/AppHeader";
import {
  IconClose,
  IconCheck,
  IconAlertTriangle,
  IconAlertCircle,
  IconInfo,
} from "../components/Icons";
import api from "../services/api";
import "./AdminPolicies.css";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const HOLIDAY_TYPES = [
  "Gazetted Holiday",
  "National Holiday",
  "Festival Holiday",
  "Observance",
  "Restricted / Optional",
  "Company Holiday",
];

const PREDEFINED_LEAVE_TYPES = [
  { code: "CASUAL", name: "Casual Leave", yearlyDays: 10, isPaid: true },
  { code: "SICK", name: "Sick Leave", yearlyDays: 10, isPaid: true },
  { code: "EARNED", name: "Earned / Privilege Leave", yearlyDays: 15, isPaid: true },
  { code: "MATERNITY", name: "Maternity Leave", yearlyDays: 180, isPaid: true },
  { code: "PATERNITY", name: "Paternity Leave", yearlyDays: 15, isPaid: true },
  { code: "BEREAVEMENT", name: "Bereavement Leave", yearlyDays: 5, isPaid: true },
  { code: "COMP_OFF", name: "Compensatory Off", yearlyDays: 5, isPaid: true },
  { code: "MARRIAGE", name: "Marriage Leave", yearlyDays: 5, isPaid: true },
  { code: "STUDY", name: "Study / Sabbatical Leave", yearlyDays: 30, isPaid: false },
  { code: "LOP", name: "Loss of Pay / Unpaid Leave", yearlyDays: 30, isPaid: false },
];

const STANDARD_HOLIDAYS_LIBRARY = [
  { name: "New Year's Day", month: "01", day: "01", type: "National Holiday", isPaid: true },
  { name: "Republic Day", month: "01", day: "26", type: "Gazetted Holiday", isPaid: true },
  { name: "Maha Shivratri", month: "03", day: "08", type: "Festival Holiday", isPaid: true },
  { name: "Holi", month: "03", day: "25", type: "Festival Holiday", isPaid: true },
  { name: "Good Friday", month: "03", day: "29", type: "Gazetted Holiday", isPaid: true },
  { name: "Eid ul-Fitr", month: "04", day: "11", type: "Gazetted Holiday", isPaid: true },
  { name: "May Day / Labour Day", month: "05", day: "01", type: "National Holiday", isPaid: true },
  { name: "Independence Day", month: "08", day: "15", type: "Gazetted Holiday", isPaid: true },
  { name: "Ganesh Chaturthi", month: "09", day: "07", type: "Festival Holiday", isPaid: true },
  { name: "Gandhi Jayanti", month: "10", day: "02", type: "Gazetted Holiday", isPaid: true },
  { name: "Dussehra / Vijayadashami", month: "10", day: "12", type: "Festival Holiday", isPaid: true },
  { name: "Diwali / Deepavali", month: "11", day: "01", type: "Festival Holiday", isPaid: true },
  { name: "Christmas Day", month: "12", day: "25", type: "Gazetted Holiday", isPaid: true },
];

const PREDEFINED_SHIFTS = [
  { name: "General Day Shift", startTime: "09:30", endTime: "18:30", dailyHours: 8, weeklyHours: 40 },
  { name: "Early Morning Shift", startTime: "07:00", endTime: "16:00", dailyHours: 8, weeklyHours: 40 },
  { name: "Mid Day Shift", startTime: "11:00", endTime: "20:00", dailyHours: 8, weeklyHours: 40 },
  { name: "Afternoon Shift", startTime: "14:00", endTime: "23:00", dailyHours: 8, weeklyHours: 40 },
  { name: "Night Shift", startTime: "22:00", endTime: "07:00", dailyHours: 8, weeklyHours: 40 },
  { name: "Flexible Hours Shift", startTime: "09:00", endTime: "18:00", dailyHours: 8, weeklyHours: 40 },
];

const PREDEFINED_ALLOWANCES = [
  { name: "Basic Salary", code: "BASIC", taxable: true, percentageOfCtc: 40 },
  { name: "House Rent Allowance", code: "HRA", taxable: true, percentageOfCtc: 20 },
  { name: "Conveyance Allowance", code: "CONVEYANCE", taxable: false, percentageOfCtc: 10 },
  { name: "Special Allowance", code: "SPECIAL", taxable: true, percentageOfCtc: 30 },
  { name: "Medical Allowance", code: "MEDICAL", taxable: false, percentageOfCtc: 5 },
  { name: "Children Education Allowance", code: "CHILD_EDU", taxable: false, percentageOfCtc: 5 },
  { name: "Internet / Telework Allowance", code: "INTERNET", taxable: false, percentageOfCtc: 5 },
  { name: "Performance Bonus Allowance", code: "PERF_BONUS", taxable: true, percentageOfCtc: 10 },
];

const PREDEFINED_DEDUCTIONS = [
  { name: "Provident Fund (EPF)", code: "EPF", ratePercent: 12 },
  { name: "Professional Tax (PT)", code: "PT", ratePercent: 0 },
  { name: "Voluntary Provident Fund (VPF)", code: "VPF", ratePercent: 5 },
  { name: "Group Health Insurance", code: "HEALTH_INS", ratePercent: 2 },
];

const STANDARD_DOCUMENT_TYPES = [
  { id: "ID_PROOF", label: "National ID Proof (Aadhaar / Passport)" },
  { id: "APPOINTMENT_LETTER", label: "Signed Appointment Letter" },
  { id: "OFFER_LETTER", label: "Countersigned Offer Letter" },
  { id: "RELIEVING_LETTER", label: "Prior Experience / Relieving Letter" },
  { id: "TAX_DOCUMENT", label: "PAN Card / Form 16 / Tax Document" },
  { id: "ACADEMIC_CERTIFICATE", label: "Academic Degree / Educational Certificate" },
  { id: "BACKGROUND_VERIFICATION", label: "Background Verification (BGV) Report" },
  { id: "NDA", label: "Signed Non-Disclosure Agreement (NDA)" },
  { id: "BANK_PROOF", label: "Bank Account Proof / Cancelled Cheque" },
];

const CATEGORIES = [
  {
    id: "attendance",
    name: "Attendance",
    subtitle: "Shift timings & late rules",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
  },
  {
    id: "work_hours",
    name: "Work Hours & Shifts",
    subtitle: "Caps, shifts & overtime",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
        <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
      </svg>
    ),
  },
  {
    id: "leave_types",
    name: "Leave Types",
    subtitle: "Paid & unpaid allowances",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    ),
  },
  {
    id: "leave_rules",
    name: "Leave Rules",
    subtitle: "Accruals & encashments",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </svg>
    ),
  },
  {
    id: "holidays",
    name: "Holidays Calendar",
    subtitle: "Official calendar events",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
        <path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" />
      </svg>
    ),
  },
  {
    id: "weekend_policy",
    name: "Weekend Policy",
    subtitle: "Custom weekly off settings",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M8 12h8" />
      </svg>
    ),
  },
  {
    id: "location_tracking",
    name: "Location & Tracking",
    subtitle: "Geofences & verification",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
        <circle cx="12" cy="10" r="3" />
      </svg>
    ),
  },
  {
    id: "payroll_cycle",
    name: "General Payroll & Pay Cycle",
    subtitle: "Cycles, basis & deductions",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="1" x2="12" y2="23" />
        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
      </svg>
    ),
  },
  {
    id: "salary_components",
    name: "Salary Components",
    subtitle: "Allowances & EPF breakdown",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="5" width="20" height="14" rx="2" />
        <line x1="2" y1="10" x2="22" y2="10" />
      </svg>
    ),
  },
  {
    id: "tax_statutory",
    name: "Tax & Statutory Rules",
    subtitle: "PAN, PF & statutory baselines",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    ),
  },
  {
    id: "lifecycle",
    name: "Employee Lifecycle",
    subtitle: "Probation & notice periods",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    id: "recruitment_offers",
    name: "Recruitment & Offers",
    subtitle: "Validity & signing rules",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="9 11 12 14 22 4" />
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
      </svg>
    ),
  },
  {
    id: "documents_compliance",
    name: "Documents & Compliance",
    subtitle: "Mandatory uploads & limits",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
    ),
  },
  {
    id: "general_policies",
    name: "General Company Policies",
    subtitle: "Handbook & operational code",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  },
  {
    id: "revisions",
    name: "Revision History",
    subtitle: "Timeline & change records",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 8v4l3 3" />
        <circle cx="12" cy="12" r="10" />
      </svg>
    ),
  },
];

export default function AdminPolicies() {
  const [activeCategory, setActiveCategory] = useState("attendance");
  const [loading, setLoading] = useState(true);
  const [savingSection, setSavingSection] = useState(null); // category ID or "GLOBAL"
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // Revisions & Active Policy
  const [revisions, setRevisions] = useState([]);
  const [selectedRevisionId, setSelectedRevisionId] = useState(null);
  const [originalPolicy, setOriginalPolicy] = useState(null);

  // Policy Form State
  const [effectiveFromDate, setEffectiveFromDate] = useState("");
  const [notes, setNotes] = useState("");

  // Section 1: Attendance
  const [attendanceRules, setAttendanceRules] = useState({
    officeStartTime: "09:30",
    officeEndTime: "18:30",
    gracePeriodMinutes: 15,
    lateArrivalThresholdMinutes: 30,
    breakDurationMinutes: 60,
    halfDayThresholdHours: 4.5,
    fullDayThresholdHours: 8.0,
    autoCheckoutEnabled: false,
    autoCheckoutTime: "",
  });

  // Section 2: Work Hours & Shifts
  const [workHoursRules, setWorkHoursRules] = useState({
    standardDailyHours: 8,
    standardWeeklyHours: 40,
    overtimeAllowed: false,
    overtimeThresholdDailyHours: 9,
    shiftName: "General Day Shift",
  });

  // Section 3: Leave Types
  const [leaveTypes, setLeaveTypes] = useState([]);

  // Section 4: Leave Rules
  const [leaveRules, setLeaveRules] = useState({
    probationMonths: 3,
    maxConsecutiveDays: 14,
    leaveYearStartMonth: 1,
    carryForwardLimitDays: 10,
    allowEncashment: false,
    encashmentMinBalanceDays: 15,
    accrualFrequency: "YEARLY",
    priorNoticeDays: 1,
  });

  // Section 5: Holidays
  const [holidays, setHolidays] = useState([]);
  const [holidaySearch, setHolidaySearch] = useState("");
  const [holidayYearFilter, setHolidayYearFilter] = useState("ALL");

  // Section 6: Weekend Policy
  const [weekendRules, setWeekendRules] = useState({
    saturdayOff: true,
    sundayOff: true,
    alternateSaturdaysOff: false,
    isPaidWeekend: true,
  });

  // Section 7: Location & Tracking
  const [locationRules, setLocationRules] = useState({
    requireLocationForPunch: true,
    allowWebTracking: true,
    geofenceEnabled: false,
    geofenceRadiusMeters: 200,
    officeLatitude: "",
    officeLongitude: "",
    officeAddress: "",
  });

  // Section 8: General Payroll & Pay Cycle
  const [payrollRules, setPayrollRules] = useState({
    currencySymbol: "₹",
    currencyCode: "INR",
    payCycleStartDay: 1,
    salaryCalculationBasis: "ACTUAL_MONTH_DAYS",
    standardWorkingHoursPerWeek: 40,
    deductLopForUnpaidLeave: true,
    lateDeductionGraceCount: 3,
    halfDayDeductionRate: 50,
    areHolidaysPaid: true,
  });

  // Section 9: Salary Components
  const [salaryComponentRules, setSalaryComponentRules] = useState({
    allowances: [
      { name: "Basic Salary", code: "BASIC", taxable: true, percentageOfCtc: 40 },
      { name: "House Rent Allowance", code: "HRA", taxable: true, percentageOfCtc: 20 },
      { name: "Conveyance Allowance", code: "CONVEYANCE", taxable: false, percentageOfCtc: 10 },
      { name: "Special Allowance", code: "SPECIAL", taxable: true, percentageOfCtc: 30 },
    ],
    deductions: [
      { name: "Provident Fund (EPF)", code: "EPF", ratePercent: 12 },
      { name: "Professional Tax (PT)", code: "PT", ratePercent: 0 },
    ],
  });

  // Section 10: Tax & Statutory Rules
  const [taxStatutoryRules, setTaxStatutoryRules] = useState({
    panRequiredForPayroll: true,
    pfApplicable: true,
    pfDeductionRatePercent: 12,
    esiApplicable: false,
    esiThresholdAmount: 21000,
    ptApplicable: true,
    disclaimer:
      "Company deductions configure baseline statutory payroll rules and do not substitute for formal fiscal counsel.",
  });

  // Section 11: Employee Lifecycle
  const [lifecycleRules, setLifecycleRules] = useState({
    probationDurationMonths: 3,
    confirmationReviewRequired: true,
    noticePeriodDays: 30,
    noticePeriodServingRequired: true,
    resignationApprovalLevels: 1,
  });

  // Section 12: Recruitment & Offers
  const [recruitmentRules, setRecruitmentRules] = useState({
    offerValidityDays: 7,
    requireCandidateSignature: true,
    autoExpireOffers: true,
    approvalRequiredBeforeDispatch: false,
  });

  // Section 13: Documents & Compliance
  const [documentRules, setDocumentRules] = useState({
    mandatoryDocumentTypes: [
      "ID_PROOF",
      "APPOINTMENT_LETTER",
      "OFFER_LETTER",
      "RELIEVING_LETTER",
      "TAX_DOCUMENT",
    ],
    maxFileSizeMB: 10,
    allowedFileFormats: ["pdf", "png", "jpg", "jpeg"],
  });

  // Section 14: General Company Policies
  const [generalRules, setGeneralRules] = useState({
    policyTitle: "Company Human Resources Operations & Employment Policy",
    policyCode: "POL-HR-2026",
    description: "Standard operating guidelines governing attendance, leaves, lifecycle, and workplace conduct.",
    emergencyContactMandatory: true,
    workFromHomeAllowed: false,
  });

  // Modals
  const [showLeaveTypeModal, setShowLeaveTypeModal] = useState(false);
  const [editingLeaveTypeIndex, setEditingLeaveTypeIndex] = useState(null);
  const [leaveTypeForm, setLeaveTypeForm] = useState({
    code: "",
    name: "",
    yearlyDays: 10,
    isPaid: true,
    isActive: true,
  });
  const [leaveTypeModalError, setLeaveTypeModalError] = useState("");

  const [showHolidayModal, setShowHolidayModal] = useState(false);
  const [editingHolidayIndex, setEditingHolidayIndex] = useState(null);
  const [holidayForm, setHolidayForm] = useState({
    name: "",
    date: "",
    type: "Gazetted Holiday",
    isPaid: true,
  });
  const [holidayModalError, setHolidayModalError] = useState("");

  const [showNewRevisionModal, setShowNewRevisionModal] = useState(false);
  const [newRevisionDate, setNewRevisionDate] = useState("");
  const [newRevisionNotes, setNewRevisionNotes] = useState("");
  const [newRevisionError, setNewRevisionError] = useState("");

  const [confirmDeleteModal, setConfirmDeleteModal] = useState(null);

  // Salary Component Modals & State
  const [showAllowanceModal, setShowAllowanceModal] = useState(false);
  const [editingAllowanceIndex, setEditingAllowanceIndex] = useState(null);
  const [allowanceForm, setAllowanceForm] = useState({
    name: "",
    code: "",
    taxable: true,
    percentageOfCtc: 10,
  });
  const [allowanceModalError, setAllowanceModalError] = useState("");

  const [showDeductionModal, setShowDeductionModal] = useState(false);
  const [editingDeductionIndex, setEditingDeductionIndex] = useState(null);
  const [deductionForm, setDeductionForm] = useState({
    name: "",
    code: "",
    ratePercent: 5,
  });
  const [deductionModalError, setDeductionModalError] = useState("");

  // Custom Document input state
  const [customDocInput, setCustomDocInput] = useState("");
  const [customDocError, setCustomDocError] = useState("");

  // GPS Geolocation Detection State
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsStatusMsg, setGpsStatusMsg] = useState("");

  const todayStr = useMemo(() => new Date().toISOString().split("T")[0], []);

  // Total Percentage of CTC for all configured allowances
  const totalCtcPercent = useMemo(() => {
    return (salaryComponentRules.allowances || []).reduce(
      (sum, a) => sum + (Number(a.percentageOfCtc) || 0),
      0
    );
  }, [salaryComponentRules.allowances]);

  // Fetch policies on mount
  const fetchPolicies = async (preserveRevisionId = null) => {
    try {
      setLoading(true);
      setError("");
      const [historyRes, activeRes] = await Promise.all([
        api.get("/policies/history"),
        api.get("/policies/active"),
      ]);

      const historyList = historyRes.data?.policies || [];
      const activePolicy = activeRes.data?.policy;

      setRevisions(historyList);

      let target = null;
      if (preserveRevisionId) {
        target = historyList.find((r) => r._id === preserveRevisionId);
      }
      if (!target && activePolicy) {
        target = historyList.find((r) => r._id === activePolicy._id) || activePolicy;
      }
      if (!target && historyList.length > 0) {
        target = historyList[0];
      }

      if (target) {
        loadPolicyIntoForm(target);
      }
    } catch (err) {
      setError(
        err.response?.data?.message ||
          "Failed to load company HR policies. Please try again."
      );
    } finally {
      setLoading(false);
    }
  };

  const loadPolicyIntoForm = (policy) => {
    setSelectedRevisionId(policy._id);
    setOriginalPolicy(policy);

    const effDate = policy.effectiveFromDate
      ? new Date(policy.effectiveFromDate).toISOString().split("T")[0]
      : "";
    setEffectiveFromDate(effDate);
    setNotes(policy.notes || "");

    // Attendance
    setAttendanceRules({
      officeStartTime: policy.attendanceRules?.officeStartTime || "09:30",
      officeEndTime: policy.attendanceRules?.officeEndTime || "18:30",
      gracePeriodMinutes: policy.attendanceRules?.gracePeriodMinutes ?? 15,
      lateArrivalThresholdMinutes: policy.attendanceRules?.lateArrivalThresholdMinutes ?? 30,
      breakDurationMinutes: policy.attendanceRules?.breakDurationMinutes ?? 60,
      halfDayThresholdHours: policy.attendanceRules?.halfDayThresholdHours ?? 4.5,
      fullDayThresholdHours: policy.attendanceRules?.fullDayThresholdHours ?? 8.0,
      autoCheckoutEnabled: Boolean(policy.attendanceRules?.autoCheckoutEnabled),
      autoCheckoutTime: policy.attendanceRules?.autoCheckoutTime || "",
    });

    // Work Hours
    setWorkHoursRules({
      standardDailyHours: policy.workHoursRules?.standardDailyHours ?? 8,
      standardWeeklyHours: policy.workHoursRules?.standardWeeklyHours ?? 40,
      overtimeAllowed: Boolean(policy.workHoursRules?.overtimeAllowed),
      overtimeThresholdDailyHours: policy.workHoursRules?.overtimeThresholdDailyHours ?? 9,
      shiftName: policy.workHoursRules?.shiftName || "General Day Shift",
    });

    // Leave Types
    setLeaveTypes(
      Array.isArray(policy.leaveTypes)
        ? policy.leaveTypes.map((t) => ({
            code: t.code,
            name: t.name,
            yearlyDays: t.yearlyDays,
            isPaid: t.isPaid !== false,
            isActive: t.isActive !== false,
          }))
        : []
    );

    // Leave Rules
    setLeaveRules({
      probationMonths: policy.leaveRules?.probationMonths ?? 3,
      maxConsecutiveDays: policy.leaveRules?.maxConsecutiveDays ?? 14,
      leaveYearStartMonth: policy.leaveRules?.leaveYearStartMonth ?? 1,
      carryForwardLimitDays: policy.leaveRules?.carryForwardLimitDays ?? 10,
      allowEncashment: Boolean(policy.leaveRules?.allowEncashment),
      encashmentMinBalanceDays: policy.leaveRules?.encashmentMinBalanceDays ?? 15,
      accrualFrequency: policy.leaveRules?.accrualFrequency || "YEARLY",
      priorNoticeDays: policy.leaveRules?.priorNoticeDays ?? 1,
    });

    // Holidays
    setHolidays(
      Array.isArray(policy.holidays)
        ? policy.holidays.map((h) => ({
            name: h.name,
            date: h.date ? new Date(h.date).toISOString().split("T")[0] : "",
            type: h.type || "Gazetted Holiday",
            isPaid: h.isPaid !== false,
          }))
        : []
    );

    // Weekend
    setWeekendRules({
      saturdayOff: policy.weekendRules?.saturdayOff !== false,
      sundayOff: policy.weekendRules?.sundayOff !== false,
      alternateSaturdaysOff: Boolean(policy.weekendRules?.alternateSaturdaysOff),
      isPaidWeekend: policy.weekendRules?.isPaidWeekend !== false,
    });

    // Location
    setLocationRules({
      requireLocationForPunch: policy.locationRules?.requireLocationForPunch !== false,
      allowWebTracking: policy.locationRules?.allowWebTracking !== false,
      geofenceEnabled: Boolean(policy.locationRules?.geofenceEnabled),
      geofenceRadiusMeters: policy.locationRules?.geofenceRadiusMeters ?? 200,
      officeLatitude: policy.locationRules?.officeLatitude ?? "",
      officeLongitude: policy.locationRules?.officeLongitude ?? "",
      officeAddress: policy.locationRules?.officeAddress || "",
    });

    // Payroll
    setPayrollRules({
      currencySymbol: policy.payrollRules?.currencySymbol || "₹",
      currencyCode: policy.payrollRules?.currencyCode || "INR",
      payCycleStartDay: policy.payrollRules?.payCycleStartDay ?? 1,
      salaryCalculationBasis: policy.payrollRules?.salaryCalculationBasis || "ACTUAL_MONTH_DAYS",
      standardWorkingHoursPerWeek: policy.payrollRules?.standardWorkingHoursPerWeek ?? 40,
      deductLopForUnpaidLeave: policy.payrollRules?.deductLopForUnpaidLeave !== false,
      lateDeductionGraceCount: policy.payrollRules?.lateDeductionGraceCount ?? 3,
      halfDayDeductionRate: policy.payrollRules?.halfDayDeductionRate ?? 50,
      areHolidaysPaid: policy.payrollRules?.areHolidaysPaid !== false,
    });

    // Salary Component
    if (policy.salaryComponentRules) {
      setSalaryComponentRules({
        allowances: Array.isArray(policy.salaryComponentRules.allowances)
          ? policy.salaryComponentRules.allowances
          : [],
        deductions: Array.isArray(policy.salaryComponentRules.deductions)
          ? policy.salaryComponentRules.deductions
          : [],
      });
    }

    // Tax Statutory
    if (policy.taxStatutoryRules) {
      setTaxStatutoryRules({
        panRequiredForPayroll: policy.taxStatutoryRules.panRequiredForPayroll !== false,
        pfApplicable: policy.taxStatutoryRules.pfApplicable !== false,
        pfDeductionRatePercent: policy.taxStatutoryRules.pfDeductionRatePercent ?? 12,
        esiApplicable: Boolean(policy.taxStatutoryRules.esiApplicable),
        esiThresholdAmount: policy.taxStatutoryRules.esiThresholdAmount ?? 21000,
        ptApplicable: policy.taxStatutoryRules.ptApplicable !== false,
        disclaimer: policy.taxStatutoryRules.disclaimer || "",
      });
    }

    // Lifecycle
    if (policy.lifecycleRules) {
      setLifecycleRules({
        probationDurationMonths: policy.lifecycleRules.probationDurationMonths ?? 3,
        confirmationReviewRequired: policy.lifecycleRules.confirmationReviewRequired !== false,
        noticePeriodDays: policy.lifecycleRules.noticePeriodDays ?? 30,
        noticePeriodServingRequired: policy.lifecycleRules.noticePeriodServingRequired !== false,
        resignationApprovalLevels: policy.lifecycleRules.resignationApprovalLevels ?? 1,
      });
    }

    // Recruitment
    if (policy.recruitmentRules) {
      setRecruitmentRules({
        offerValidityDays: policy.recruitmentRules.offerValidityDays ?? 7,
        requireCandidateSignature: policy.recruitmentRules.requireCandidateSignature !== false,
        autoExpireOffers: policy.recruitmentRules.autoExpireOffers !== false,
        approvalRequiredBeforeDispatch: Boolean(policy.recruitmentRules.approvalRequiredBeforeDispatch),
      });
    }

    // Documents
    if (policy.documentRules) {
      setDocumentRules({
        mandatoryDocumentTypes: Array.isArray(policy.documentRules.mandatoryDocumentTypes)
          ? policy.documentRules.mandatoryDocumentTypes
          : [],
        maxFileSizeMB: policy.documentRules.maxFileSizeMB ?? 10,
        allowedFileFormats: Array.isArray(policy.documentRules.allowedFileFormats)
          ? policy.documentRules.allowedFileFormats
          : ["pdf", "png", "jpg", "jpeg"],
      });
    }

    // General
    if (policy.generalRules) {
      setGeneralRules({
        policyTitle: policy.generalRules.policyTitle || "",
        policyCode: policy.generalRules.policyCode || "",
        description: policy.generalRules.description || "",
        emergencyContactMandatory: policy.generalRules.emergencyContactMandatory !== false,
        workFromHomeAllowed: Boolean(policy.generalRules.workFromHomeAllowed),
      });
    }
  };

  useEffect(() => {
    fetchPolicies();
  }, []);

  // Determine revision timeline status
  const currentRevisionStatus = useMemo(() => {
    if (!effectiveFromDate) return "UNKNOWN";
    if (effectiveFromDate <= todayStr) {
      const newerActive = revisions.find(
        (r) =>
          r._id !== selectedRevisionId &&
          r.effectiveFromDate &&
          new Date(r.effectiveFromDate).toISOString().split("T")[0] <= todayStr &&
          new Date(r.effectiveFromDate).toISOString().split("T")[0] > effectiveFromDate
      );
      if (newerActive) return "HISTORICAL";
      return "ACTIVE_NOW";
    }
    return "FUTURE_SCHEDULED";
  }, [effectiveFromDate, todayStr, revisions, selectedRevisionId]);

  // Derived shift duration
  const workingDuration = useMemo(() => {
    const parseM = (t) => {
      const parts = (t || "").split(":");
      if (parts.length !== 2) return null;
      return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
    };
    const s = parseM(attendanceRules.officeStartTime);
    const e = parseM(attendanceRules.officeEndTime);
    if (s === null || e === null || s >= e) return null;
    const diff = e - s;
    const h = Math.floor(diff / 60);
    const m = diff % 60;
    return `${h}h ${m > 0 ? `${m}m` : "00m"}`;
  }, [attendanceRules.officeStartTime, attendanceRules.officeEndTime]);

  // Derived cutoff time
  const derivedCutoffTime = useMemo(() => {
    const parts = (attendanceRules.officeStartTime || "").split(":");
    if (parts.length !== 2) return "--:--";
    const minutes = parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10) - 60;
    const norm = ((minutes % 1440) + 1440) % 1440;
    const h = Math.floor(norm / 60);
    const m = norm % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }, [attendanceRules.officeStartTime]);

  // Reset Changes
  const handleReset = () => {
    if (originalPolicy) {
      loadPolicyIntoForm(originalPolicy);
      setSuccessMsg("");
      setError("");
    }
  };

  // Compile full current payload
  const buildCurrentPayload = () => {
    return {
      effectiveFromDate,
      notes,
      attendanceRules,
      workHoursRules,
      leaveTypes,
      leaveRules,
      holidays,
      weekendRules,
      locationRules: {
        ...locationRules,
        officeLatitude: locationRules.officeLatitude !== "" ? Number(locationRules.officeLatitude) : null,
        officeLongitude: locationRules.officeLongitude !== "" ? Number(locationRules.officeLongitude) : null,
      },
      payrollRules,
      salaryComponentRules,
      taxStatutoryRules,
      lifecycleRules,
      recruitmentRules,
      documentRules,
      generalRules,
    };
  };

  // Generic Save Handler for any section
  const handleSaveSection = async (sectionName = "GLOBAL") => {
    try {
      setSavingSection(sectionName);
      setError("");
      setSuccessMsg("");

      // Basic client validation
      if (!effectiveFromDate) {
        throw new Error("Please select an effective from date.");
      }

      const activeTypes = leaveTypes.filter((t) => t.isActive);
      if (activeTypes.length === 0) {
        throw new Error("At least one leave type must be configured as active.");
      }

      const payload = buildCurrentPayload();

      const res = await api.put(`/policies/${selectedRevisionId}`, payload);

      setSuccessMsg(res.data?.message || "Policy configuration saved successfully.");
      await fetchPolicies(selectedRevisionId);
    } catch (err) {
      setError(
        err.response?.data?.message || err.message || "Failed to save policy settings."
      );
    } finally {
      setSavingSection(null);
    }
  };

  // Leave Type Handlers
  const handleOpenAddLeaveType = () => {
    setEditingLeaveTypeIndex(null);
    setLeaveTypeForm({
      code: "",
      name: "",
      yearlyDays: 10,
      isPaid: true,
      isActive: true,
    });
    setLeaveTypeModalError("");
    setShowLeaveTypeModal(true);
  };

  const handleOpenEditLeaveType = (index) => {
    setEditingLeaveTypeIndex(index);
    const item = leaveTypes[index];
    setLeaveTypeForm({
      code: item.code,
      name: item.name,
      yearlyDays: item.yearlyDays,
      isPaid: item.isPaid !== false,
      isActive: item.isActive !== false,
    });
    setLeaveTypeModalError("");
    setShowLeaveTypeModal(true);
  };

  const handleSaveLeaveTypeModal = () => {
    setLeaveTypeModalError("");
    const cleanCode = leaveTypeForm.code.trim().toUpperCase();
    const cleanName = leaveTypeForm.name.trim();
    const yearlyDays = Number(leaveTypeForm.yearlyDays);

    if (!cleanCode || !/^[A-Z0-9_]{2,20}$/.test(cleanCode)) {
      setLeaveTypeModalError("Code must be 2-20 uppercase letters, numbers, or underscores (e.g. CASUAL, SICK, STUDY).");
      return;
    }

    if (!cleanName || cleanName.length < 2) {
      setLeaveTypeModalError("Leave type name must be at least 2 characters.");
      return;
    }

    if (isNaN(yearlyDays) || yearlyDays < 0 || yearlyDays > 365) {
      setLeaveTypeModalError("Annual entitlement days must be between 0 and 365.");
      return;
    }

    const isDuplicate = leaveTypes.some(
      (lt, idx) => idx !== editingLeaveTypeIndex && lt.code.toUpperCase() === cleanCode
    );
    if (isDuplicate) {
      setLeaveTypeModalError(`Leave type with code '${cleanCode}' already exists.`);
      return;
    }

    if (editingLeaveTypeIndex !== null) {
      setLeaveTypes((prev) =>
        prev.map((item, idx) =>
          idx === editingLeaveTypeIndex
            ? {
                ...item,
                code: cleanCode,
                name: cleanName,
                yearlyDays,
                isPaid: leaveTypeForm.isPaid,
                isActive: leaveTypeForm.isActive,
              }
            : item
        )
      );
    } else {
      setLeaveTypes((prev) => [
        ...prev,
        {
          code: cleanCode,
          name: cleanName,
          yearlyDays,
          isPaid: leaveTypeForm.isPaid,
          isActive: leaveTypeForm.isActive,
        },
      ]);
    }

    setShowLeaveTypeModal(false);
  };

  const handleToggleLeaveTypeActive = (index) => {
    setLeaveTypes((prev) =>
      prev.map((item, idx) =>
        idx === index ? { ...item, isActive: !item.isActive } : item
      )
    );
  };

  const handleRequestDeleteLeaveType = async (index) => {
    const item = leaveTypes[index];
    try {
      const res = await api.get(`/policies/leave-types/${item.code}/in-use`);
      if (res.data?.inUse) {
        setConfirmDeleteModal({
          type: "BLOCKED_LEAVE_TYPE",
          target: item,
          message: `Cannot delete leave type '${item.code}' because it is referenced by ${res.data.count} existing employee leave request(s). Instead of deleting, deactivate this leave type to preserve historical records while preventing new requests.`,
        });
        return;
      }
    } catch {
      // ignore
    }

    setConfirmDeleteModal({
      type: "LEAVE_TYPE",
      target: index,
      message: `Are you sure you want to remove leave type '${item.name}' (${item.code})?`,
    });
  };

  // Holiday Handlers
  const handleOpenAddHoliday = () => {
    setEditingHolidayIndex(null);
    setHolidayForm({
      name: "",
      date: "",
      type: "Gazetted Holiday",
      isPaid: true,
    });
    setHolidayModalError("");
    setShowHolidayModal(true);
  };

  const handleOpenEditHoliday = (index) => {
    setEditingHolidayIndex(index);
    const item = holidays[index];
    setHolidayForm({
      name: item.name,
      date: item.date,
      type: item.type || "Gazetted Holiday",
      isPaid: item.isPaid !== false,
    });
    setHolidayModalError("");
    setShowHolidayModal(true);
  };

  const handleSaveHolidayModal = () => {
    setHolidayModalError("");
    const cleanName = holidayForm.name.trim();
    const cleanDate = holidayForm.date;

    if (!cleanName || cleanName.length < 2) {
      setHolidayModalError("Holiday name must be at least 2 characters.");
      return;
    }

    if (!cleanDate) {
      setHolidayModalError("Please select a date for the holiday.");
      return;
    }

    const isDuplicate = holidays.some(
      (h, idx) =>
        idx !== editingHolidayIndex &&
        h.date === cleanDate &&
        h.name.toLowerCase() === cleanName.toLowerCase()
    );
    if (isDuplicate) {
      setHolidayModalError(`A holiday with the name '${cleanName}' on ${cleanDate} already exists.`);
      return;
    }

    if (editingHolidayIndex !== null) {
      setHolidays((prev) =>
        prev.map((item, idx) =>
          idx === editingHolidayIndex
            ? {
                ...item,
                name: cleanName,
                date: cleanDate,
                type: holidayForm.type,
                isPaid: holidayForm.isPaid,
              }
            : item
        )
      );
    } else {
      setHolidays((prev) =>
        [
          ...prev,
          {
            name: cleanName,
            date: cleanDate,
            type: holidayForm.type,
            isPaid: holidayForm.isPaid,
          },
        ].sort((a, b) => (a.date > b.date ? 1 : -1))
      );
    }

    setShowHolidayModal(false);
  };

  const handleRequestDeleteHoliday = (index) => {
    const item = holidays[index];
    setConfirmDeleteModal({
      type: "HOLIDAY",
      target: index,
      message: `Are you sure you want to remove holiday '${item.name}' (${item.date})?`,
    });
  };

  // Shift Preset Selection Handler
  const handleSelectShiftPreset = (presetName) => {
    const preset = PREDEFINED_SHIFTS.find((p) => p.name === presetName);
    if (!preset) return;
    setWorkHoursRules((prev) => ({
      ...prev,
      shiftName: preset.name,
      standardDailyHours: preset.dailyHours,
      standardWeeklyHours: preset.weeklyHours,
    }));
    setAttendanceRules((prev) => ({
      ...prev,
      officeStartTime: preset.startTime,
      officeEndTime: preset.endTime,
    }));
  };

  // Salary Component: Allowances Handlers
  const handleOpenAddAllowance = () => {
    setEditingAllowanceIndex(null);
    setAllowanceForm({
      name: "",
      code: "",
      taxable: true,
      percentageOfCtc: 10,
    });
    setAllowanceModalError("");
    setShowAllowanceModal(true);
  };

  const handleOpenEditAllowance = (index) => {
    setEditingAllowanceIndex(index);
    const item = salaryComponentRules.allowances[index];
    setAllowanceForm({
      name: item.name,
      code: item.code,
      taxable: item.taxable !== false,
      percentageOfCtc: item.percentageOfCtc ?? 0,
    });
    setAllowanceModalError("");
    setShowAllowanceModal(true);
  };

  const handleSelectPredefinedAllowance = (templateCode) => {
    const template = PREDEFINED_ALLOWANCES.find((a) => a.code === templateCode);
    if (!template) return;
    setAllowanceForm({
      name: template.name,
      code: template.code,
      taxable: template.taxable,
      percentageOfCtc: template.percentageOfCtc,
    });
  };

  const handleSaveAllowanceModal = () => {
    setAllowanceModalError("");
    const cleanCode = allowanceForm.code.trim().toUpperCase();
    const cleanName = allowanceForm.name.trim();
    const pct = Number(allowanceForm.percentageOfCtc);

    if (!cleanCode || !/^[A-Z0-9_]{2,20}$/.test(cleanCode)) {
      setAllowanceModalError("Code must be 2-20 uppercase letters, numbers, or underscores (e.g. BASIC, HRA, TRAVEL).");
      return;
    }

    if (!cleanName || cleanName.length < 2) {
      setAllowanceModalError("Allowance name must be at least 2 characters.");
      return;
    }

    if (isNaN(pct) || pct < 0 || pct > 100) {
      setAllowanceModalError("Percentage of CTC must be between 0 and 100%.");
      return;
    }

    const isDuplicate = salaryComponentRules.allowances.some(
      (a, idx) => idx !== editingAllowanceIndex && a.code.toUpperCase() === cleanCode
    );
    if (isDuplicate) {
      setAllowanceModalError(`Allowance with code '${cleanCode}' already exists.`);
      return;
    }

    if (editingAllowanceIndex !== null) {
      setSalaryComponentRules((prev) => ({
        ...prev,
        allowances: prev.allowances.map((item, idx) =>
          idx === editingAllowanceIndex
            ? {
                ...item,
                code: cleanCode,
                name: cleanName,
                taxable: allowanceForm.taxable,
                percentageOfCtc: pct,
              }
            : item
        ),
      }));
    } else {
      setSalaryComponentRules((prev) => ({
        ...prev,
        allowances: [
          ...prev.allowances,
          {
            code: cleanCode,
            name: cleanName,
            taxable: allowanceForm.taxable,
            percentageOfCtc: pct,
          },
        ],
      }));
    }

    setShowAllowanceModal(false);
  };

  const handleRequestDeleteAllowance = (index) => {
    const item = salaryComponentRules.allowances[index];
    setConfirmDeleteModal({
      type: "ALLOWANCE",
      target: index,
      message: `Are you sure you want to remove allowance '${item.name}' (${item.code})?`,
    });
  };

  // Salary Component: Deductions Handlers
  const handleOpenAddDeduction = () => {
    setEditingDeductionIndex(null);
    setDeductionForm({
      name: "",
      code: "",
      ratePercent: 5,
    });
    setDeductionModalError("");
    setShowDeductionModal(true);
  };

  const handleOpenEditDeduction = (index) => {
    setEditingDeductionIndex(index);
    const item = salaryComponentRules.deductions[index];
    setDeductionForm({
      name: item.name,
      code: item.code,
      ratePercent: item.ratePercent ?? 0,
    });
    setDeductionModalError("");
    setShowDeductionModal(true);
  };

  const handleSelectPredefinedDeduction = (templateCode) => {
    const template = PREDEFINED_DEDUCTIONS.find((d) => d.code === templateCode);
    if (!template) return;
    setDeductionForm({
      name: template.name,
      code: template.code,
      ratePercent: template.ratePercent,
    });
  };

  const handleSaveDeductionModal = () => {
    setDeductionModalError("");
    const cleanCode = deductionForm.code.trim().toUpperCase();
    const cleanName = deductionForm.name.trim();
    const rate = Number(deductionForm.ratePercent);

    if (!cleanCode || !/^[A-Z0-9_]{2,20}$/.test(cleanCode)) {
      setDeductionModalError("Code must be 2-20 uppercase letters, numbers, or underscores (e.g. EPF, PT, VPF).");
      return;
    }

    if (!cleanName || cleanName.length < 2) {
      setDeductionModalError("Deduction name must be at least 2 characters.");
      return;
    }

    if (isNaN(rate) || rate < 0 || rate > 100) {
      setDeductionModalError("Deduction rate must be between 0 and 100%.");
      return;
    }

    const isDuplicate = salaryComponentRules.deductions.some(
      (d, idx) => idx !== editingDeductionIndex && d.code.toUpperCase() === cleanCode
    );
    if (isDuplicate) {
      setDeductionModalError(`Deduction with code '${cleanCode}' already exists.`);
      return;
    }

    if (editingDeductionIndex !== null) {
      setSalaryComponentRules((prev) => ({
        ...prev,
        deductions: prev.deductions.map((item, idx) =>
          idx === editingDeductionIndex
            ? {
                ...item,
                code: cleanCode,
                name: cleanName,
                ratePercent: rate,
              }
            : item
        ),
      }));
    } else {
      setSalaryComponentRules((prev) => ({
        ...prev,
        deductions: [
          ...prev.deductions,
          {
            code: cleanCode,
            name: cleanName,
            ratePercent: rate,
          },
        ],
      }));
    }

    setShowDeductionModal(false);
  };

  const handleRequestDeleteDeduction = (index) => {
    const item = salaryComponentRules.deductions[index];
    setConfirmDeleteModal({
      type: "DEDUCTION",
      target: index,
      message: `Are you sure you want to remove deduction '${item.name}' (${item.code})?`,
    });
  };

  // Custom Document Type Handlers
  const handleAddCustomDocumentType = () => {
    setCustomDocError("");
    const clean = customDocInput.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");
    if (!clean || clean.length < 2) {
      setCustomDocError("Custom document type must be at least 2 characters (e.g. DRIVER_LICENSE).");
      return;
    }

    if (documentRules.mandatoryDocumentTypes.includes(clean)) {
      setCustomDocError(`Document type '${clean}' is already in the compliance list.`);
      return;
    }

    setDocumentRules((prev) => ({
      ...prev,
      mandatoryDocumentTypes: [...prev.mandatoryDocumentTypes, clean],
    }));
    setCustomDocInput("");
  };

  const handleRemoveCustomDocumentType = (docId) => {
    setDocumentRules((prev) => ({
      ...prev,
      mandatoryDocumentTypes: prev.mandatoryDocumentTypes.filter((t) => t !== docId),
    }));
  };

  // GPS Geolocation Auto-Detection
  const handleDetectCurrentLocation = () => {
    if (!navigator.geolocation) {
      setGpsStatusMsg("Geolocation is not supported by your current browser.");
      return;
    }
    setGpsLoading(true);
    setGpsStatusMsg("Requesting GPS coordinates from browser...");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(6));
        const lng = Number(pos.coords.longitude.toFixed(6));
        setLocationRules((prev) => ({
          ...prev,
          officeLatitude: lat,
          officeLongitude: lng,
        }));
        setGpsLoading(false);
        setGpsStatusMsg(`✓ Coordinates detected: ${lat}, ${lng}`);
        setTimeout(() => setGpsStatusMsg(""), 5000);
      },
      (err) => {
        setGpsLoading(false);
        setGpsStatusMsg(`Could not detect location: ${err.message}`);
        setTimeout(() => setGpsStatusMsg(""), 6000);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  // Schedule New Revision Handler
  const handleCreateNewRevision = async () => {
    setNewRevisionError("");
    if (!newRevisionDate) {
      setNewRevisionError("Please select an effective from date for the new revision.");
      return;
    }

    try {
      setSavingSection("NEW_REVISION");
      const payload = {
        ...buildCurrentPayload(),
        effectiveFromDate: newRevisionDate,
        notes: newRevisionNotes.trim(),
      };

      const res = await api.post("/policies", payload);
      setShowNewRevisionModal(false);
      setNewRevisionDate("");
      setNewRevisionNotes("");
      setSuccessMsg(res.data?.message || "New policy revision created successfully.");

      const newId = res.data?.policy?._id;
      await fetchPolicies(newId);
    } catch (err) {
      setNewRevisionError(
        err.response?.data?.message || "Failed to create new policy revision."
      );
    } finally {
      setSavingSection(null);
    }
  };

  // Confirm Delete Execution
  const handleConfirmDelete = async () => {
    if (!confirmDeleteModal) return;

    if (confirmDeleteModal.type === "LEAVE_TYPE") {
      const idx = confirmDeleteModal.target;
      setLeaveTypes((prev) => prev.filter((_, i) => i !== idx));
    } else if (confirmDeleteModal.type === "HOLIDAY") {
      const idx = confirmDeleteModal.target;
      setHolidays((prev) => prev.filter((_, i) => i !== idx));
    } else if (confirmDeleteModal.type === "ALLOWANCE") {
      const idx = confirmDeleteModal.target;
      setSalaryComponentRules((prev) => ({
        ...prev,
        allowances: prev.allowances.filter((_, i) => i !== idx),
      }));
    } else if (confirmDeleteModal.type === "DEDUCTION") {
      const idx = confirmDeleteModal.target;
      setSalaryComponentRules((prev) => ({
        ...prev,
        deductions: prev.deductions.filter((_, i) => i !== idx),
      }));
    } else if (confirmDeleteModal.type === "REVISION") {
      try {
        setSavingSection("DELETE_REVISION");
        const res = await api.delete(`/policies/${confirmDeleteModal.target}`);
        setSuccessMsg(res.data?.message || "Policy revision deleted successfully.");
        await fetchPolicies();
      } catch (err) {
        setError(err.response?.data?.message || "Failed to delete revision.");
      } finally {
        setSavingSection(null);
      }
    }

    setConfirmDeleteModal(null);
  };

  // Filtered Holidays
  const availableYears = useMemo(() => {
    const years = new Set(
      holidays.map((h) => (h.date ? h.date.split("-")[0] : null)).filter(Boolean)
    );
    return Array.from(years).sort();
  }, [holidays]);

  const filteredHolidays = useMemo(() => {
    return holidays.filter((h) => {
      if (holidayYearFilter !== "ALL" && !h.date.startsWith(holidayYearFilter)) {
        return false;
      }
      if (holidaySearch.trim()) {
        const q = holidaySearch.toLowerCase().trim();
        return (
          h.name.toLowerCase().includes(q) ||
          h.type.toLowerCase().includes(q) ||
          h.date.includes(q)
        );
      }
      return true;
    });
  }, [holidays, holidaySearch, holidayYearFilter]);

  if (loading && !originalPolicy) {
    return (
      <div className="container-wide" style={{ paddingBottom: 80 }}>
        <AppHeader title="Policies" />
        <div style={{ display: "flex", gap: 10, margin: "20px 0 24px" }}>
          {[1, 2, 3, 4, 5].map((n) => (
            <div key={n} className="skeleton-shimmer" style={{ width: 110, height: 38, borderRadius: 8 }} />
          ))}
        </div>
        <div style={{ background: "#ffffff", border: "1px solid #e4e4e7", borderRadius: 12, padding: 28 }}>
          <div className="skeleton-shimmer" style={{ width: "25%", height: 22, borderRadius: 6, marginBottom: 16 }} />
          <div className="skeleton-shimmer" style={{ width: "45%", height: 14, borderRadius: 4, marginBottom: 28 }} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            <div className="skeleton-shimmer" style={{ height: 120, borderRadius: 8 }} />
            <div className="skeleton-shimmer" style={{ height: 120, borderRadius: 8 }} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container-wide" style={{ paddingBottom: 80 }}>
      {/* 3.A Page Header */}
      <AppHeader title="Policies" />

      {/* Notifications */}
      {successMsg && (
        <div
          className="success-alert"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 20,
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <IconCheck size={16} />
            <span>{successMsg}</span>
          </span>
          <button
            type="button"
            className="btn-sm btn-secondary"
            onClick={() => setSuccessMsg("")}
            aria-label="Dismiss alert"
          >
            <IconClose size={14} />
          </button>
        </div>
      )}

      {error && (
        <div
          className="error"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 20,
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <IconAlertCircle size={16} />
            <span>{error}</span>
          </span>
          <button
            type="button"
            className="btn-sm btn-secondary"
            onClick={() => setError("")}
            aria-label="Dismiss alert"
          >
            <IconClose size={14} />
          </button>
        </div>
      )}

      {/* 3.B Policy Revision Toolbar */}
      <div
        style={{
          background: "#ffffff",
          border: "1px solid #e4e4e7",
          borderRadius: 14,
          padding: "18px 24px",
          marginBottom: 24,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 16,
          boxShadow: "0 1px 3px rgba(0,0,0,0.02)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <div>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: "#71717a", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Active Policy Revision
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4 }}>
              <select
                value={selectedRevisionId || ""}
                onChange={(e) => {
                  const target = revisions.find((r) => r._id === e.target.value);
                  if (target) loadPolicyIntoForm(target);
                }}
                style={{
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: "1px solid #d4d4d8",
                  fontSize: 14,
                  fontWeight: 600,
                  background: "#fcfcfd",
                  minWidth: 260,
                }}
              >
                {revisions.map((rev) => {
                  const d = rev.effectiveFromDate
                    ? new Date(rev.effectiveFromDate).toISOString().split("T")[0]
                    : "No Date";
                  const isCurrent =
                    rev.effectiveFromDate &&
                    new Date(rev.effectiveFromDate).toISOString().split("T")[0] <= todayStr;
                  return (
                    <option key={rev._id} value={rev._id}>
                      Effective: {d} {isCurrent ? "(Active Now)" : "(Scheduled)"}
                    </option>
                  );
                })}
              </select>

              {currentRevisionStatus === "ACTIVE_NOW" && (
                <span
                  style={{
                    background: "#ecfdf5",
                    color: "#047857",
                    border: "1px solid #a7f3d0",
                    padding: "4px 10px",
                    borderRadius: 20,
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  ● Active Now
                </span>
              )}

              {currentRevisionStatus === "FUTURE_SCHEDULED" && (
                <span
                  style={{
                    background: "#eff6ff",
                    color: "#1d4ed8",
                    border: "1px solid #bfdbfe",
                    padding: "4px 10px",
                    borderRadius: 20,
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  ✦ Scheduled for Future
                </span>
              )}

              {currentRevisionStatus === "HISTORICAL" && (
                <span
                  style={{
                    background: "#f4f4f5",
                    color: "#71717a",
                    border: "1px solid #e4e4e7",
                    padding: "4px 10px",
                    borderRadius: 20,
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  Historical Revision
                </span>
              )}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setNewRevisionDate("");
              setNewRevisionNotes("");
              setNewRevisionError("");
              setShowNewRevisionModal(true);
            }}
          >
            + Schedule New Revision
          </button>

          <button
            type="button"
            className="btn-secondary"
            onClick={handleReset}
            disabled={Boolean(savingSection)}
          >
            Reset Changes
          </button>

          <button
            type="button"
            onClick={() => handleSaveSection("GLOBAL")}
            disabled={Boolean(savingSection)}
            style={{
              background: "#18181b",
              borderColor: "#18181b",
            }}
          >
            {savingSection === "GLOBAL" ? "Saving All..." : "Save Policy Changes"}
          </button>
        </div>
      </div>

      {/* 3.C Main Workspace with Left Category Panel & Right Content Panel */}
      <div className="policies-workspace-container">
        {/* Left Vertical Category Navigation Panel */}
        <nav className="policies-nav-panel" aria-label="Policy Categories">
          <div className="policies-nav-header">
            <h4 className="policies-nav-title">Policy Categories</h4>
          </div>
          <ul className="policies-category-list">
            {CATEGORIES.map((cat) => {
              const isActive = activeCategory === cat.id;
              return (
                <li key={cat.id}>
                  <button
                    type="button"
                    className={`policies-category-item-btn ${isActive ? "active" : ""}`}
                    onClick={() => setActiveCategory(cat.id)}
                    aria-current={isActive ? "page" : undefined}
                  >
                    <div className="policies-category-icon-wrap">{cat.icon}</div>
                    <div className="policies-category-text-block">
                      <span className="policies-category-name">{cat.name}</span>
                      <span className="policies-category-subtitle">{cat.subtitle}</span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Right Configuration Workspace */}
        <main className="policies-content-workspace">
          {/* ============================================================== */}
          {/* 1. ATTENDANCE                                                  */}
          {/* ============================================================== */}
          {activeCategory === "attendance" && (
            <div className="policies-section-card">
              <div className="policies-card-header">
                <div className="policies-card-title-group">
                  <div className="policies-card-icon">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="policies-card-title">Attendance & Shift Timings</h3>
                    <p className="policies-card-subtitle">
                      Configure daily office start/end times, grace period thresholds, and attendance cutoff rules.
                    </p>
                  </div>
                </div>

                {workingDuration && (
                  <span
                    style={{
                      background: "#f0fdf4",
                      border: "1px solid #bbf7d0",
                      color: "#166534",
                      padding: "5px 12px",
                      borderRadius: 20,
                      fontSize: 12.5,
                      fontWeight: 700,
                    }}
                  >
                    Shift Duration: {workingDuration}
                  </span>
                )}
              </div>

              <div className="policies-form-grid-3">
                <div className="policies-field-group">
                  <label className="policies-field-label">Office Start Time</label>
                  <input
                    type="time"
                    className="policies-input-control"
                    value={attendanceRules.officeStartTime}
                    onChange={(e) =>
                      setAttendanceRules({ ...attendanceRules, officeStartTime: e.target.value })
                    }
                  />
                  <span className="policies-field-hint">Morning punch-in expected time.</span>
                </div>

                <div className="policies-field-group">
                  <label className="policies-field-label">Office End Time</label>
                  <input
                    type="time"
                    className="policies-input-control"
                    value={attendanceRules.officeEndTime}
                    onChange={(e) =>
                      setAttendanceRules({ ...attendanceRules, officeEndTime: e.target.value })
                    }
                  />
                  <span className="policies-field-hint">Evening shift completion time.</span>
                </div>

                <div className="policies-field-group">
                  <label className="policies-field-label">Grace Period (Minutes)</label>
                  <input
                    type="number"
                    min="0"
                    max="120"
                    className="policies-input-control"
                    value={attendanceRules.gracePeriodMinutes}
                    onChange={(e) =>
                      setAttendanceRules({
                        ...attendanceRules,
                        gracePeriodMinutes: Number(e.target.value),
                      })
                    }
                  />
                  <span className="policies-field-hint">Minutes allowed after start time before late count.</span>
                </div>

                <div className="policies-field-group">
                  <label className="policies-field-label">Late Arrival Threshold (Min)</label>
                  <input
                    type="number"
                    min="0"
                    max="240"
                    className="policies-input-control"
                    value={attendanceRules.lateArrivalThresholdMinutes}
                    onChange={(e) =>
                      setAttendanceRules({
                        ...attendanceRules,
                        lateArrivalThresholdMinutes: Number(e.target.value),
                      })
                    }
                  />
                  <span className="policies-field-hint">Arrivals beyond this mark triggers half-day review.</span>
                </div>

                <div className="policies-field-group">
                  <label className="policies-field-label">Break Duration (Minutes)</label>
                  <input
                    type="number"
                    min="0"
                    max="180"
                    className="policies-input-control"
                    value={attendanceRules.breakDurationMinutes}
                    onChange={(e) =>
                      setAttendanceRules({
                        ...attendanceRules,
                        breakDurationMinutes: Number(e.target.value),
                      })
                    }
                  />
                  <span className="policies-field-hint">Allotted daily lunch and break interval.</span>
                </div>

                <div className="policies-field-group">
                  <label className="policies-field-label">Half-Day Threshold (Hours)</label>
                  <input
                    type="number"
                    step="0.5"
                    min="1"
                    max="12"
                    className="policies-input-control"
                    value={attendanceRules.halfDayThresholdHours}
                    onChange={(e) =>
                      setAttendanceRules({
                        ...attendanceRules,
                        halfDayThresholdHours: Number(e.target.value),
                      })
                    }
                  />
                  <span className="policies-field-hint">Minimum hours required for half-day credit.</span>
                </div>
              </div>

              {/* Informative Cutoff Banner */}
              <div
                style={{
                  marginTop: 20,
                  padding: "14px 18px",
                  borderRadius: 10,
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 12,
                }}
              >
                <IconInfo size={18} style={{ color: "#2563eb", marginTop: 2, flexShrink: 0 }} />
                <div style={{ fontSize: 13, color: "#334155", lineHeight: 1.5 }}>
                  <strong>Same-Day Leave Application Cutoff:</strong> Per company policy, employees submitting a leave application for today must do so at least 1 hour before office start time.
                  With office starting at <strong>{attendanceRules.officeStartTime}</strong>, the daily cutoff is <strong>{derivedCutoffTime}</strong>. After this time, same-day leave applications are blocked and employees can only submit for future dates.
                </div>
              </div>

              <div className="policies-save-bar">
                <button
                  type="button"
                  className="policies-section-save-btn"
                  onClick={() => handleSaveSection("attendance")}
                  disabled={Boolean(savingSection)}
                >
                  {savingSection === "attendance" ? "Saving..." : "Save Attendance Settings"}
                </button>
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* 2. WORK HOURS & SHIFTS                                         */}
          {/* ============================================================== */}
          {activeCategory === "work_hours" && (
            <div className="policies-section-card">
              <div className="policies-card-header">
                <div className="policies-card-title-group">
                  <div className="policies-card-icon">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
                      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="policies-card-title">Work Hours & Shift Policies</h3>
                    <p className="policies-card-subtitle">
                      Configure standard shift definitions, weekly hour quotas, and overtime threshold limits.
                    </p>
                  </div>
                </div>
              </div>

              <div style={{ marginBottom: 20, padding: "14px 18px", borderRadius: 10, background: "#f8fafc", border: "1px solid #e2e8f0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 700, color: "#1e293b", textTransform: "uppercase" }}>
                      Choose Standard Shift Template
                    </label>
                    <p style={{ margin: "2px 0 0", fontSize: 12, color: "#64748b" }}>
                      Quick-apply standard industry schedules or configure custom shift hours below.
                    </p>
                  </div>
                  <select
                    className="policies-input-control"
                    style={{ width: "auto", minWidth: 260, fontSize: 13, fontWeight: 600 }}
                    value={PREDEFINED_SHIFTS.some((p) => p.name === workHoursRules.shiftName) ? workHoursRules.shiftName : ""}
                    onChange={(e) => {
                      if (e.target.value) handleSelectShiftPreset(e.target.value);
                    }}
                  >
                    <option value="">-- Select Predefined Shift Template --</option>
                    {PREDEFINED_SHIFTS.map((p) => (
                      <option key={p.name} value={p.name}>
                        {p.name} ({p.startTime} – {p.endTime}, {p.dailyHours}h)
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="policies-form-grid-2">
                <div className="policies-field-group">
                  <label className="policies-field-label">Default Shift Name</label>
                  <input
                    type="text"
                    className="policies-input-control"
                    value={workHoursRules.shiftName}
                    onChange={(e) =>
                      setWorkHoursRules({ ...workHoursRules, shiftName: e.target.value })
                    }
                  />
                  <span className="policies-field-hint">Primary operational shift title.</span>
                </div>

                <div className="policies-field-group">
                  <label className="policies-field-label">Standard Daily Working Hours</label>
                  <input
                    type="number"
                    min="1"
                    max="16"
                    className="policies-input-control"
                    value={workHoursRules.standardDailyHours}
                    onChange={(e) =>
                      setWorkHoursRules({
                        ...workHoursRules,
                        standardDailyHours: Number(e.target.value),
                      })
                    }
                  />
                  <span className="policies-field-hint">Base daily target hours (e.g. 8 hours).</span>
                </div>

                <div className="policies-field-group">
                  <label className="policies-field-label">Standard Weekly Working Hours</label>
                  <input
                    type="number"
                    min="1"
                    max="80"
                    className="policies-input-control"
                    value={workHoursRules.standardWeeklyHours}
                    onChange={(e) =>
                      setWorkHoursRules({
                        ...workHoursRules,
                        standardWeeklyHours: Number(e.target.value),
                      })
                    }
                  />
                  <span className="policies-field-hint">Weekly quota (e.g. 40 hours for 5 days).</span>
                </div>

                <div className="policies-field-group">
                  <label className="policies-field-label">Overtime Daily Threshold (Hours)</label>
                  <input
                    type="number"
                    min="1"
                    max="24"
                    className="policies-input-control"
                    value={workHoursRules.overtimeThresholdDailyHours}
                    onChange={(e) =>
                      setWorkHoursRules({
                        ...workHoursRules,
                        overtimeThresholdDailyHours: Number(e.target.value),
                      })
                    }
                  />
                  <span className="policies-field-hint">Hours exceeded before overtime accrual begins.</span>
                </div>
              </div>

              <div style={{ marginTop: 18 }}>
                <label className="policies-checkbox-card">
                  <input
                    type="checkbox"
                    className="policies-checkbox-input"
                    checked={workHoursRules.overtimeAllowed}
                    onChange={(e) =>
                      setWorkHoursRules({ ...workHoursRules, overtimeAllowed: e.target.checked })
                    }
                  />
                  <div className="policies-checkbox-text">
                    <span className="policies-checkbox-title">Enable Overtime Tracking & Compensation</span>
                    <span className="policies-checkbox-desc">
                      Authorize employees to accrue compensated hours beyond standard shifts when approved.
                    </span>
                  </div>
                </label>
              </div>

              <div className="policies-save-bar">
                <button
                  type="button"
                  className="policies-section-save-btn"
                  onClick={() => handleSaveSection("work_hours")}
                  disabled={Boolean(savingSection)}
                >
                  {savingSection === "work_hours" ? "Saving..." : "Save Work Hours Settings"}
                </button>
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* 3. LEAVE TYPES                                                 */}
          {/* ============================================================== */}
          {activeCategory === "leave_types" && (
            <div className="policies-section-card">
              <div className="policies-card-header">
                <div className="policies-card-title-group">
                  <div className="policies-card-icon">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                      <line x1="16" y1="2" x2="16" y2="6" />
                      <line x1="8" y1="2" x2="8" y2="6" />
                      <line x1="3" y1="10" x2="21" y2="10" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="policies-card-title">Company Leave Types ({leaveTypes.length})</h3>
                    <p className="policies-card-subtitle">
                      Manage leave categories, yearly quotas, paid/unpaid classification, and active status.
                    </p>
                  </div>
                </div>

                <button type="button" onClick={handleOpenAddLeaveType} className="btn-secondary">
                  + Add Leave Type
                </button>
              </div>

              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: 13.5 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #e4e4e7", color: "#71717a" }}>
                      <th style={{ padding: "10px 12px", fontWeight: 600 }}>Code</th>
                      <th style={{ padding: "10px 12px", fontWeight: 600 }}>Leave Type Name</th>
                      <th style={{ padding: "10px 12px", fontWeight: 600 }}>Annual Quota</th>
                      <th style={{ padding: "10px 12px", fontWeight: 600 }}>Pay Classification</th>
                      <th style={{ padding: "10px 12px", fontWeight: 600 }}>Status</th>
                      <th style={{ padding: "10px 12px", fontWeight: 600, textAlign: "right" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaveTypes.map((lt, idx) => (
                      <tr
                        key={lt.code || idx}
                        style={{
                          borderBottom: "1px solid #f4f4f5",
                          opacity: lt.isActive ? 1 : 0.65,
                        }}
                      >
                        <td style={{ padding: "12px", fontWeight: 700, color: "#18181b" }}>
                          <code style={{ background: "#f4f4f5", padding: "3px 6px", borderRadius: 4, fontSize: 12.5 }}>
                            {lt.code}
                          </code>
                        </td>
                        <td style={{ padding: "12px", fontWeight: 600, color: "#09090b" }}>{lt.name}</td>
                        <td style={{ padding: "12px", color: "#18181b" }}>
                          <strong>{lt.yearlyDays}</strong> days / year
                        </td>
                        <td style={{ padding: "12px" }}>
                          {lt.isPaid !== false ? (
                            <span style={{ background: "#ecfdf5", color: "#059669", padding: "3px 8px", borderRadius: 12, fontSize: 11.5, fontWeight: 700 }}>
                              Paid
                            </span>
                          ) : (
                            <span style={{ background: "#fef3c7", color: "#b45309", padding: "3px 8px", borderRadius: 12, fontSize: 11.5, fontWeight: 700 }}>
                              Unpaid (LOP)
                            </span>
                          )}
                        </td>
                        <td style={{ padding: "12px" }}>
                          {lt.isActive ? (
                            <span style={{ background: "#eff6ff", color: "#1d4ed8", padding: "3px 8px", borderRadius: 12, fontSize: 11.5, fontWeight: 700 }}>
                              Active
                            </span>
                          ) : (
                            <span style={{ background: "#f4f4f5", color: "#71717a", padding: "3px 8px", borderRadius: 12, fontSize: 11.5, fontWeight: 600 }}>
                              Inactive
                            </span>
                          )}
                        </td>
                        <td style={{ padding: "12px", textAlign: "right" }}>
                          <div style={{ display: "inline-flex", gap: 6 }}>
                            <button
                              type="button"
                              className="btn-secondary btn-sm"
                              onClick={() => handleToggleLeaveTypeActive(idx)}
                              title={lt.isActive ? "Deactivate leave type" : "Activate leave type"}
                            >
                              {lt.isActive ? "Deactivate" : "Activate"}
                            </button>
                            <button
                              type="button"
                              className="btn-secondary btn-sm"
                              onClick={() => handleOpenEditLeaveType(idx)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="btn-secondary btn-sm"
                              style={{ color: "#ef4444" }}
                              onClick={() => handleRequestDeleteLeaveType(idx)}
                            >
                              Remove
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="policies-save-bar">
                <button
                  type="button"
                  className="policies-section-save-btn"
                  onClick={() => handleSaveSection("leave_types")}
                  disabled={Boolean(savingSection)}
                >
                  {savingSection === "leave_types" ? "Saving..." : "Save Leave Types"}
                </button>
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* 4. LEAVE RULES                                                 */}
          {/* ============================================================== */}
          {activeCategory === "leave_rules" && (
            <div className="policies-section-card">
              <div className="policies-card-header">
                <div className="policies-card-title-group">
                  <div className="policies-card-icon">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="16" y1="13" x2="8" y2="13" />
                      <line x1="16" y1="17" x2="8" y2="17" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="policies-card-title">Leave Accrual & Absence Rules</h3>
                    <p className="policies-card-subtitle">
                      Configure company-wide policies governing probation, carry-forward, notice, and encashment.
                    </p>
                  </div>
                </div>
              </div>

              <div className="policies-form-grid-3">
                <div className="policies-field-group">
                  <label className="policies-field-label">Probation Duration (Months)</label>
                  <input
                    type="number"
                    min="0"
                    max="24"
                    className="policies-input-control"
                    value={leaveRules.probationMonths}
                    onChange={(e) =>
                      setLeaveRules({ ...leaveRules, probationMonths: Number(e.target.value) })
                    }
                  />
                  <span className="policies-field-hint">Waiting period before full leave access.</span>
                </div>

                <div className="policies-field-group">
                  <label className="policies-field-label">Max Consecutive Leave Days</label>
                  <input
                    type="number"
                    min="1"
                    max="90"
                    className="policies-input-control"
                    value={leaveRules.maxConsecutiveDays}
                    onChange={(e) =>
                      setLeaveRules({ ...leaveRules, maxConsecutiveDays: Number(e.target.value) })
                    }
                  />
                  <span className="policies-field-hint">Max continuous days per single request.</span>
                </div>

                <div className="policies-field-group">
                  <label className="policies-field-label">Leave-Year Cycle Start Month</label>
                  <select
                    className="policies-input-control"
                    value={leaveRules.leaveYearStartMonth}
                    onChange={(e) =>
                      setLeaveRules({
                        ...leaveRules,
                        leaveYearStartMonth: parseInt(e.target.value, 10),
                      })
                    }
                  >
                    {MONTH_NAMES.map((name, idx) => (
                      <option key={name} value={idx + 1}>
                        {name} (Month {idx + 1})
                      </option>
                    ))}
                  </select>
                  <span className="policies-field-hint">Reset cycle (e.g. January or April).</span>
                </div>

                <div className="policies-field-group">
                  <label className="policies-field-label">Carry-Forward Limit (Days)</label>
                  <input
                    type="number"
                    min="0"
                    max="180"
                    className="policies-input-control"
                    value={leaveRules.carryForwardLimitDays}
                    onChange={(e) =>
                      setLeaveRules({
                        ...leaveRules,
                        carryForwardLimitDays: Number(e.target.value),
                      })
                    }
                  />
                  <span className="policies-field-hint">Unused days rolled over to next year.</span>
                </div>

                <div className="policies-field-group">
                  <label className="policies-field-label">Accrual Frequency</label>
                  <select
                    className="policies-input-control"
                    value={leaveRules.accrualFrequency}
                    onChange={(e) =>
                      setLeaveRules({ ...leaveRules, accrualFrequency: e.target.value })
                    }
                  >
                    <option value="YEARLY">Yearly (All credit on Day 1)</option>
                    <option value="MONTHLY">Monthly Pro-Rata</option>
                    <option value="QUARTERLY">Quarterly Credit</option>
                  </select>
                  <span className="policies-field-hint">Entitlement distribution schedule.</span>
                </div>

                <div className="policies-field-group">
                  <label className="policies-field-label">Advance Notice Required (Days)</label>
                  <input
                    type="number"
                    min="0"
                    max="30"
                    className="policies-input-control"
                    value={leaveRules.priorNoticeDays}
                    onChange={(e) =>
                      setLeaveRules({ ...leaveRules, priorNoticeDays: Number(e.target.value) })
                    }
                  />
                  <span className="policies-field-hint">Recommended days prior to submission.</span>
                </div>
              </div>

              <div style={{ marginTop: 20 }}>
                <label className="policies-checkbox-card">
                  <input
                    type="checkbox"
                    className="policies-checkbox-input"
                    checked={leaveRules.allowEncashment}
                    onChange={(e) =>
                      setLeaveRules({ ...leaveRules, allowEncashment: e.target.checked })
                    }
                  />
                  <div className="policies-checkbox-text">
                    <span className="policies-checkbox-title">Allow Leave Encashment on Unused Earned Leaves</span>
                    <span className="policies-checkbox-desc">
                      Employees can convert unutilized leaves into financial compensation upon review or exit.
                    </span>
                  </div>
                </label>
              </div>

              <div className="policies-save-bar">
                <button
                  type="button"
                  className="policies-section-save-btn"
                  onClick={() => handleSaveSection("leave_rules")}
                  disabled={Boolean(savingSection)}
                >
                  {savingSection === "leave_rules" ? "Saving..." : "Save Leave Rules"}
                </button>
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* 5. HOLIDAYS CALENDAR                                           */}
          {/* ============================================================== */}
          {activeCategory === "holidays" && (
            <div className="policies-section-card">
              <div className="policies-card-header">
                <div className="policies-card-title-group">
                  <div className="policies-card-icon">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                      <line x1="16" y1="2" x2="16" y2="6" />
                      <line x1="8" y1="2" x2="8" y2="6" />
                      <line x1="3" y1="10" x2="21" y2="10" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="policies-card-title">Company Holiday Calendar ({filteredHolidays.length})</h3>
                    <p className="policies-card-subtitle">
                      Configure official paid holidays for this company policy.
                    </p>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <input
                    type="text"
                    placeholder="Search holiday..."
                    className="policies-input-control"
                    style={{ width: 170, padding: "7px 12px", fontSize: 13 }}
                    value={holidaySearch}
                    onChange={(e) => setHolidaySearch(e.target.value)}
                  />

                  {availableYears.length > 1 && (
                    <select
                      className="policies-input-control"
                      style={{ width: 120, padding: "7px 12px", fontSize: 13 }}
                      value={holidayYearFilter}
                      onChange={(e) => setHolidayYearFilter(e.target.value)}
                    >
                      <option value="ALL">All Years</option>
                      {availableYears.map((y) => (
                        <option key={y} value={y}>Year {y}</option>
                      ))}
                    </select>
                  )}

                  <button type="button" onClick={handleOpenAddHoliday} className="btn-secondary">
                    + Add Holiday
                  </button>
                </div>
              </div>

              {filteredHolidays.length === 0 ? (
                <div style={{ padding: "40px 16px", textAlign: "center", color: "#71717a" }}>
                  No holidays found. Click "+ Add Holiday" to configure official holidays.
                </div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: 13.5 }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid #e4e4e7", color: "#71717a" }}>
                        <th style={{ padding: "10px 12px", fontWeight: 600 }}>Date</th>
                        <th style={{ padding: "10px 12px", fontWeight: 600 }}>Day of Week</th>
                        <th style={{ padding: "10px 12px", fontWeight: 600 }}>Holiday Name</th>
                        <th style={{ padding: "10px 12px", fontWeight: 600 }}>Classification</th>
                        <th style={{ padding: "10px 12px", fontWeight: 600 }}>Paid Status</th>
                        <th style={{ padding: "10px 12px", fontWeight: 600, textAlign: "right" }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredHolidays.map((h, idx) => {
                        const d = h.date ? new Date(h.date) : null;
                        const dayName = d && !isNaN(d.getTime())
                          ? d.toLocaleDateString("en-US", { weekday: "long" })
                          : "--";

                        return (
                          <tr key={`${h.date}:${h.name}`} style={{ borderBottom: "1px solid #f4f4f5" }}>
                            <td style={{ padding: "12px", fontWeight: 600, color: "#18181b" }}>{h.date}</td>
                            <td style={{ padding: "12px", color: "#52525b" }}>{dayName}</td>
                            <td style={{ padding: "12px", fontWeight: 700, color: "#09090b" }}>{h.name}</td>
                            <td style={{ padding: "12px" }}>
                              <span style={{ background: "#f4f4f5", color: "#3f3f46", padding: "3px 8px", borderRadius: 6, fontSize: 12, fontWeight: 500 }}>
                                {h.type}
                              </span>
                            </td>
                            <td style={{ padding: "12px" }}>
                              <span style={{ color: "#059669", fontWeight: 600, fontSize: 12 }}>
                                {h.isPaid !== false ? "✓ Paid Holiday" : "Unpaid"}
                              </span>
                            </td>
                            <td style={{ padding: "12px", textAlign: "right" }}>
                              <div style={{ display: "inline-flex", gap: 6 }}>
                                <button type="button" className="btn-secondary btn-sm" onClick={() => handleOpenEditHoliday(idx)}>
                                  Edit
                                </button>
                                <button type="button" className="btn-secondary btn-sm" style={{ color: "#ef4444" }} onClick={() => handleRequestDeleteHoliday(idx)}>
                                  Remove
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="policies-save-bar">
                <button
                  type="button"
                  className="policies-section-save-btn"
                  onClick={() => handleSaveSection("holidays")}
                  disabled={Boolean(savingSection)}
                >
                  {savingSection === "holidays" ? "Saving..." : "Save Holiday Calendar"}
                </button>
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* 6. WEEKEND POLICY                                              */}
          {/* ============================================================== */}
          {activeCategory === "weekend_policy" && (
            <div className="policies-section-card">
              <div className="policies-card-header">
                <div className="policies-card-title-group">
                  <div className="policies-card-icon">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <path d="M8 12h8" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="policies-card-title">Weekend Policy & Weekly Offs</h3>
                    <p className="policies-card-subtitle">
                      Specify standard non-working weekend days excluded from working leave calculations.
                    </p>
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <label className="policies-checkbox-card">
                  <input
                    type="checkbox"
                    className="policies-checkbox-input"
                    checked={weekendRules.saturdayOff}
                    onChange={(e) =>
                      setWeekendRules({ ...weekendRules, saturdayOff: e.target.checked })
                    }
                  />
                  <div className="policies-checkbox-text">
                    <span className="policies-checkbox-title">Saturday is an Official Weekly Off</span>
                    <span className="policies-checkbox-desc">Saturdays are excluded from working leave days count.</span>
                  </div>
                </label>

                <label className="policies-checkbox-card">
                  <input
                    type="checkbox"
                    className="policies-checkbox-input"
                    checked={weekendRules.sundayOff}
                    onChange={(e) =>
                      setWeekendRules({ ...weekendRules, sundayOff: e.target.checked })
                    }
                  />
                  <div className="policies-checkbox-text">
                    <span className="policies-checkbox-title">Sunday is an Official Weekly Off</span>
                    <span className="policies-checkbox-desc">Standard weekly rest day across all corporate departments.</span>
                  </div>
                </label>

                <label className="policies-checkbox-card">
                  <input
                    type="checkbox"
                    className="policies-checkbox-input"
                    checked={weekendRules.alternateSaturdaysOff}
                    onChange={(e) =>
                      setWeekendRules({ ...weekendRules, alternateSaturdaysOff: e.target.checked })
                    }
                  />
                  <div className="policies-checkbox-text">
                    <span className="policies-checkbox-title">Alternate Saturday Schedule (2nd & 4th Off)</span>
                    <span className="policies-checkbox-desc">Operates on alternate weekend rotation.</span>
                  </div>
                </label>

                <label className="policies-checkbox-card">
                  <input
                    type="checkbox"
                    className="policies-checkbox-input"
                    checked={weekendRules.isPaidWeekend}
                    onChange={(e) =>
                      setWeekendRules({ ...weekendRules, isPaidWeekend: e.target.checked })
                    }
                  />
                  <div className="policies-checkbox-text">
                    <span className="policies-checkbox-title">Weekly Offs are Paid Days</span>
                    <span className="policies-checkbox-desc">Weekly off days are credited towards regular monthly pay.</span>
                  </div>
                </label>
              </div>

              <div style={{ marginTop: 18, padding: "10px 14px", borderRadius: 8, background: "#f4f4f5", fontSize: 13, color: "#52525b" }}>
                Current Work Week:{" "}
                <strong>
                  {weekendRules.saturdayOff && weekendRules.sundayOff
                    ? "5-Day Work Week (Monday through Friday)"
                    : weekendRules.sundayOff
                    ? "6-Day Work Week (Monday through Saturday)"
                    : "Continuous Operations"}
                </strong>
              </div>

              <div className="policies-save-bar">
                <button
                  type="button"
                  className="policies-section-save-btn"
                  onClick={() => handleSaveSection("weekend_policy")}
                  disabled={Boolean(savingSection)}
                >
                  {savingSection === "weekend_policy" ? "Saving..." : "Save Weekend Policy"}
                </button>
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* 7. LOCATION & TRACKING                                         */}
          {/* ============================================================== */}
          {activeCategory === "location_tracking" && (
            <div className="policies-section-card">
              <div className="policies-card-header">
                <div className="policies-card-title-group">
                  <div className="policies-card-icon">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                      <circle cx="12" cy="10" r="3" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="policies-card-title">Location Locks & Geofence Policy</h3>
                    <p className="policies-card-subtitle">
                      Configure geolocation rules for attendance punch-ins and live field tracking.
                    </p>
                  </div>
                </div>
              </div>

              <div style={{ display: "grid", gap: 16 }}>
                <label className="policies-checkbox-card">
                  <input
                    type="checkbox"
                    className="policies-checkbox-input"
                    checked={locationRules.requireLocationForPunch}
                    onChange={(e) =>
                      setLocationRules({
                        ...locationRules,
                        requireLocationForPunch: e.target.checked,
                      })
                    }
                  />
                  <div className="policies-checkbox-text">
                    <span className="policies-checkbox-title">Require Geolocation Coordinates on Punch-In / Punch-Out</span>
                    <span className="policies-checkbox-desc">
                      Enforces browser GPS capture during attendance logging via our interactive map.
                    </span>
                  </div>
                </label>

                <label className="policies-checkbox-card">
                  <input
                    type="checkbox"
                    className="policies-checkbox-input"
                    checked={locationRules.allowWebTracking}
                    onChange={(e) =>
                      setLocationRules({ ...locationRules, allowWebTracking: e.target.checked })
                    }
                  />
                  <div className="policies-checkbox-text">
                    <span className="policies-checkbox-title">Enable Live Tracking Sessions for Field Staff</span>
                    <span className="policies-checkbox-desc">
                      Permits authorized employees to broadcast breadcrumb GPS trails during active shift sessions.
                    </span>
                  </div>
                </label>

                <label className="policies-checkbox-card">
                  <input
                    type="checkbox"
                    className="policies-checkbox-input"
                    checked={locationRules.geofenceEnabled}
                    onChange={(e) =>
                      setLocationRules({ ...locationRules, geofenceEnabled: e.target.checked })
                    }
                  />
                  <div className="policies-checkbox-text">
                    <span className="policies-checkbox-title">Enforce Office Geofence Perimeter</span>
                    <span className="policies-checkbox-desc">
                      Punches must originate within the defined perimeter around corporate headquarters.
                    </span>
                  </div>
                </label>
              </div>

              <div className="policies-form-grid-3" style={{ marginTop: 20 }}>
                <div className="policies-field-group">
                  <label className="policies-field-label">Geofence Radius (Meters)</label>
                  <input
                    type="number"
                    min="10"
                    max="5000"
                    className="policies-input-control"
                    value={locationRules.geofenceRadiusMeters}
                    onChange={(e) =>
                      setLocationRules({
                        ...locationRules,
                        geofenceRadiusMeters: Number(e.target.value),
                      })
                    }
                  />
                  <div className="policies-preset-group">
                    {[50, 100, 200, 500, 1000].map((r) => (
                      <button
                        key={r}
                        type="button"
                        className={`policies-preset-chip ${locationRules.geofenceRadiusMeters === r ? "active" : ""}`}
                        onClick={() => setLocationRules({ ...locationRules, geofenceRadiusMeters: r })}
                      >
                        {r}m
                      </button>
                    ))}
                  </div>
                  <span className="policies-field-hint">e.g. 200 meters from office pin.</span>
                </div>

                <div className="policies-field-group">
                  <label className="policies-field-label">Office Latitude</label>
                  <input
                    type="number"
                    step="any"
                    className="policies-input-control"
                    placeholder="e.g. 17.448293"
                    value={locationRules.officeLatitude}
                    onChange={(e) =>
                      setLocationRules({ ...locationRules, officeLatitude: e.target.value })
                    }
                  />
                  <span className="policies-field-hint">Center GPS coordinate.</span>
                </div>

                <div className="policies-field-group">
                  <label className="policies-field-label">Office Longitude</label>
                  <input
                    type="number"
                    step="any"
                    className="policies-input-control"
                    placeholder="e.g. 78.374628"
                    value={locationRules.officeLongitude}
                    onChange={(e) =>
                      setLocationRules({ ...locationRules, officeLongitude: e.target.value })
                    }
                  />
                  <span className="policies-field-hint">Center GPS coordinate.</span>
                </div>
              </div>

              <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  disabled={gpsLoading}
                  onClick={handleDetectCurrentLocation}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                >
                  <span>📍</span>
                  <span>{gpsLoading ? "Detecting GPS..." : "Detect Current Location"}</span>
                </button>
                {gpsStatusMsg && (
                  <span style={{ fontSize: 12, color: gpsStatusMsg.startsWith("✓") ? "#16a34a" : "#dc2626", fontWeight: 600 }}>
                    {gpsStatusMsg}
                  </span>
                )}
              </div>

              <div className="policies-field-group" style={{ marginTop: 14 }}>
                <label className="policies-field-label">Office Base Address</label>
                <input
                  type="text"
                  className="policies-input-control"
                  placeholder="e.g. Corporate Headquarters, Tech Park, Hyderabad"
                  value={locationRules.officeAddress}
                  onChange={(e) =>
                    setLocationRules({ ...locationRules, officeAddress: e.target.value })
                  }
                />
              </div>

              <div className="policies-save-bar">
                <button
                  type="button"
                  className="policies-section-save-btn"
                  onClick={() => handleSaveSection("location_tracking")}
                  disabled={Boolean(savingSection)}
                >
                  {savingSection === "location_tracking" ? "Saving..." : "Save Location Settings"}
                </button>
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* 8. GENERAL PAYROLL & PAY CYCLE (Matches Screenshot)            */}
          {/* ============================================================== */}
          {activeCategory === "payroll_cycle" && (
            <div className="policies-section-card">
              <div className="policies-card-header">
                <div className="policies-card-title-group">
                  <div className="policies-card-icon">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="1" x2="12" y2="23" />
                      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="policies-card-title">General Payroll & Pay Cycle</h3>
                    <p className="policies-card-subtitle">
                      Salary calculation basis, cycle start dates, and absence deduction policies.
                    </p>
                  </div>
                </div>
              </div>

              <div className="policies-form-grid-3">
                <div className="policies-field-group">
                  <label className="policies-field-label">Currency Symbol</label>
                  <input
                    type="text"
                    className="policies-input-control"
                    value={payrollRules.currencySymbol}
                    onChange={(e) =>
                      setPayrollRules({ ...payrollRules, currencySymbol: e.target.value })
                    }
                  />
                  <span className="policies-field-hint">e.g. ₹ or $ or €</span>
                </div>

                <div className="policies-field-group">
                  <label className="policies-field-label">Pay Cycle Start Day</label>
                  <input
                    type="number"
                    min="1"
                    max="31"
                    className="policies-input-control"
                    value={payrollRules.payCycleStartDay}
                    onChange={(e) =>
                      setPayrollRules({
                        ...payrollRules,
                        payCycleStartDay: Number(e.target.value),
                      })
                    }
                  />
                  <span className="policies-field-hint">Day of month salary period begins (e.g. 1st).</span>
                </div>

                <div className="policies-field-group">
                  <label className="policies-field-label">Salary Calculation Basis</label>
                  <select
                    className="policies-input-control"
                    value={payrollRules.salaryCalculationBasis}
                    onChange={(e) =>
                      setPayrollRules({
                        ...payrollRules,
                        salaryCalculationBasis: e.target.value,
                      })
                    }
                  >
                    <option value="ACTUAL_MONTH_DAYS">Actual Calendar Days (28-31)</option>
                    <option value="FIXED_30_DAYS">Fixed 30 Days Basis</option>
                    <option value="WORKING_DAYS_ONLY">Total Working Days Only</option>
                  </select>
                  <span className="policies-field-hint">Daily wage divisor for pro-rata pay.</span>
                </div>

                <div className="policies-field-group">
                  <label className="policies-field-label">Standard Working Hours / Week</label>
                  <input
                    type="number"
                    min="1"
                    max="80"
                    className="policies-input-control"
                    value={payrollRules.standardWorkingHoursPerWeek}
                    onChange={(e) =>
                      setPayrollRules({
                        ...payrollRules,
                        standardWorkingHoursPerWeek: Number(e.target.value),
                      })
                    }
                  />
                  <span className="policies-field-hint">Weekly quota (e.g. 40 hours).</span>
                </div>

                <div className="policies-field-group">
                  <label className="policies-field-label">Deduct LOP for Absence?</label>
                  <select
                    className="policies-input-control"
                    value={payrollRules.deductLopForUnpaidLeave ? "YES" : "NO"}
                    onChange={(e) =>
                      setPayrollRules({
                        ...payrollRules,
                        deductLopForUnpaidLeave: e.target.value === "YES",
                      })
                    }
                  >
                    <option value="YES">Yes, Deduct Loss of Pay (LOP)</option>
                    <option value="NO">No, Pay Full Salary</option>
                  </select>
                  <span className="policies-field-hint">Enforces deductions on unauthorized leaves.</span>
                </div>

                <div className="policies-field-group">
                  <label className="policies-field-label">Late Grace Count (Per Month)</label>
                  <input
                    type="number"
                    min="0"
                    max="30"
                    className="policies-input-control"
                    value={payrollRules.lateDeductionGraceCount}
                    onChange={(e) =>
                      setPayrollRules({
                        ...payrollRules,
                        lateDeductionGraceCount: Number(e.target.value),
                      })
                    }
                  />
                  <span className="policies-field-hint">Late arrivals permitted without wage deduction.</span>
                </div>

                <div className="policies-field-group">
                  <label className="policies-field-label">Half-Day Pay Rate (%)</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    className="policies-input-control"
                    value={payrollRules.halfDayDeductionRate}
                    onChange={(e) =>
                      setPayrollRules({
                        ...payrollRules,
                        halfDayDeductionRate: Number(e.target.value),
                      })
                    }
                  />
                  <span className="policies-field-hint">Percentage of full-day wage credited for half day.</span>
                </div>

                <div className="policies-field-group">
                  <label className="policies-field-label">Are Holidays Paid?</label>
                  <select
                    className="policies-input-control"
                    value={payrollRules.areHolidaysPaid ? "YES" : "NO"}
                    onChange={(e) =>
                      setPayrollRules({
                        ...payrollRules,
                        areHolidaysPaid: e.target.value === "YES",
                      })
                    }
                  >
                    <option value="YES">Yes, Full Paid Holidays</option>
                    <option value="NO">No, Unpaid Holidays</option>
                  </select>
                  <span className="policies-field-hint">Applies to gazetted and festival holidays.</span>
                </div>
              </div>

              <div className="policies-save-bar">
                <button
                  type="button"
                  className="policies-section-save-btn"
                  onClick={() => handleSaveSection("payroll_cycle")}
                  disabled={Boolean(savingSection)}
                >
                  {savingSection === "payroll_cycle" ? "Saving..." : "Save General Payroll Settings"}
                </button>
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* 9. SALARY COMPONENTS & DEDUCTIONS                              */}
          {/* ============================================================== */}
          {activeCategory === "salary_components" && (
            <div className="policies-section-card">
              <div className="policies-card-header">
                <div className="policies-card-title-group">
                  <div className="policies-card-icon">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="5" width="20" height="14" rx="2" />
                      <line x1="2" y1="10" x2="22" y2="10" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="policies-card-title">Salary Components & Deductions Structure</h3>
                    <p className="policies-card-subtitle">
                      Configured salary components compatible with Employee Compensation revisions and payslips.
                    </p>
                  </div>
                </div>
              </div>

              {/* Visual CTC Allocation Balance Meter */}
              <div className="policies-ctc-meter">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                  <div>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#09090b" }}>
                      CTC Allocation Balance: {totalCtcPercent}%
                    </span>
                    <span style={{ fontSize: 12, color: "#64748b", marginLeft: 8 }}>
                      {totalCtcPercent === 100
                        ? "(100% Balanced - Standard Full CTC Distribution)"
                        : totalCtcPercent < 100
                        ? `(${100 - totalCtcPercent}% Unallocated Remaining)`
                        : `(${totalCtcPercent - 100}% Exceeded Over 100%)`}
                    </span>
                  </div>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      padding: "2px 8px",
                      borderRadius: 12,
                      background: totalCtcPercent === 100 ? "#ecfdf5" : totalCtcPercent < 100 ? "#eff6ff" : "#fef2f2",
                      color: totalCtcPercent === 100 ? "#059669" : totalCtcPercent < 100 ? "#2563eb" : "#dc2626",
                    }}
                  >
                    {totalCtcPercent === 100 ? "● Balanced" : totalCtcPercent < 100 ? "Partial Allocation" : "Over-allocated"}
                  </span>
                </div>
                <div className="policies-ctc-meter-track">
                  <div
                    className="policies-ctc-meter-bar"
                    style={{
                      width: `${Math.min(totalCtcPercent, 100)}%`,
                      backgroundColor: totalCtcPercent === 100 ? "#10b981" : totalCtcPercent < 100 ? "#3b82f6" : "#ef4444",
                    }}
                  />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 20 }}>
                {/* Earnings List */}
                <div style={{ border: "1px solid #e4e4e7", borderRadius: 10, padding: 18, background: "#ffffff" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                    <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#09090b" }}>
                      Configured Allowances ({salaryComponentRules.allowances.length})
                    </h4>
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={handleOpenAddAllowance}
                    >
                      + Add Allowance
                    </button>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {salaryComponentRules.allowances.map((a, i) => (
                      <div
                        key={a.code || i}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          padding: "10px 12px",
                          background: "#f8fafc",
                          borderRadius: 8,
                          border: "1px solid #f1f5f9",
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13, color: "#0f172a" }}>{a.name}</div>
                          <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                            <code>{a.code}</code> • {a.taxable ? "Taxable" : "Non-taxable"}
                          </div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span style={{ fontSize: 12.5, fontWeight: 700, color: "#2563eb" }}>
                            {a.percentageOfCtc}%
                          </span>
                          <button
                            type="button"
                            className="btn-secondary btn-sm"
                            style={{ padding: "3px 8px", fontSize: 11.5 }}
                            onClick={() => handleOpenEditAllowance(i)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="btn-secondary btn-sm"
                            style={{ padding: "3px 8px", fontSize: 11.5, color: "#ef4444" }}
                            onClick={() => handleRequestDeleteAllowance(i)}
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Deductions List */}
                <div style={{ border: "1px solid #e4e4e7", borderRadius: 10, padding: 18, background: "#ffffff" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                    <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#09090b" }}>
                      Standard Deductions ({salaryComponentRules.deductions.length})
                    </h4>
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={handleOpenAddDeduction}
                    >
                      + Add Deduction
                    </button>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {salaryComponentRules.deductions.map((d, i) => (
                      <div
                        key={d.code || i}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          padding: "10px 12px",
                          background: "#f8fafc",
                          borderRadius: 8,
                          border: "1px solid #f1f5f9",
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13, color: "#0f172a" }}>{d.name}</div>
                          <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                            <code>{d.code}</code>
                          </div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span style={{ fontSize: 12.5, fontWeight: 700, color: "#dc2626" }}>
                            {d.ratePercent}%
                          </span>
                          <button
                            type="button"
                            className="btn-secondary btn-sm"
                            style={{ padding: "3px 8px", fontSize: 11.5 }}
                            onClick={() => handleOpenEditDeduction(i)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="btn-secondary btn-sm"
                            style={{ padding: "3px 8px", fontSize: 11.5, color: "#ef4444" }}
                            onClick={() => handleRequestDeleteDeduction(i)}
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div style={{ marginTop: 18, padding: "12px 16px", borderRadius: 8, background: "#f8fafc", border: "1px solid #e2e8f0", fontSize: 12.5, color: "#475569" }}>
                ✓ <strong>Single Source of Truth:</strong> Maintains 100% compatibility with the Employee Compensation module, preventing divergent salary tables or miscalculated net disbursements.
              </div>

              <div className="policies-save-bar">
                <button
                  type="button"
                  className="policies-section-save-btn"
                  onClick={() => handleSaveSection("salary_components")}
                  disabled={Boolean(savingSection)}
                >
                  {savingSection === "salary_components" ? "Saving..." : "Save Salary Structure"}
                </button>
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* 10. TAX & STATUTORY RULES                                      */}
          {/* ============================================================== */}
          {activeCategory === "tax_statutory" && (
            <div className="policies-section-card">
              <div className="policies-card-header">
                <div className="policies-card-title-group">
                  <div className="policies-card-icon">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="policies-card-title">Tax & Statutory Compliance Baselines</h3>
                    <p className="policies-card-subtitle">
                      Configured company deduction baselines for Provident Fund, ESI, and Professional Tax.
                    </p>
                  </div>
                </div>
              </div>

              <div style={{ display: "grid", gap: 14 }}>
                <label className="policies-checkbox-card">
                  <input
                    type="checkbox"
                    className="policies-checkbox-input"
                    checked={taxStatutoryRules.panRequiredForPayroll}
                    onChange={(e) =>
                      setTaxStatutoryRules({
                        ...taxStatutoryRules,
                        panRequiredForPayroll: e.target.checked,
                      })
                    }
                  />
                  <div className="policies-checkbox-text">
                    <span className="policies-checkbox-title">Require Valid PAN Number for Monthly Disbursements</span>
                    <span className="policies-checkbox-desc">Mandatory tax identity required prior to salary dispatch.</span>
                  </div>
                </label>

                <label className="policies-checkbox-card">
                  <input
                    type="checkbox"
                    className="policies-checkbox-input"
                    checked={taxStatutoryRules.pfApplicable}
                    onChange={(e) =>
                      setTaxStatutoryRules({
                        ...taxStatutoryRules,
                        pfApplicable: e.target.checked,
                      })
                    }
                  />
                  <div className="policies-checkbox-text">
                    <span className="policies-checkbox-title">Employee Provident Fund (EPF) Deductions Active</span>
                    <span className="policies-checkbox-desc">Standard 12% deduction applied to basic salary component.</span>
                  </div>
                </label>

                <label className="policies-checkbox-card">
                  <input
                    type="checkbox"
                    className="policies-checkbox-input"
                    checked={taxStatutoryRules.ptApplicable}
                    onChange={(e) =>
                      setTaxStatutoryRules({
                        ...taxStatutoryRules,
                        ptApplicable: e.target.checked,
                      })
                    }
                  />
                  <div className="policies-checkbox-text">
                    <span className="policies-checkbox-title">Professional Tax (PT) Deductions Active</span>
                    <span className="policies-checkbox-desc">Deducted according to applicable state jurisdiction.</span>
                  </div>
                </label>
              </div>

              {/* Legal Disclaimer Box */}
              <div style={{ marginTop: 20, padding: "14px 18px", borderRadius: 8, background: "#fefce8", border: "1px solid #fef08a", color: "#854d0e", fontSize: 12.5, lineHeight: 1.5 }}>
                ⚠️ <strong>Statutory Disclaimer:</strong> Settings configured here represent corporate payroll deduction policies and do not constitute formal legal or taxation counsel. Please ensure your configuration aligns with local state labor laws.
              </div>

              <div className="policies-save-bar">
                <button
                  type="button"
                  className="policies-section-save-btn"
                  onClick={() => handleSaveSection("tax_statutory")}
                  disabled={Boolean(savingSection)}
                >
                  {savingSection === "tax_statutory" ? "Saving..." : "Save Statutory Settings"}
                </button>
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* 11. EMPLOYEE LIFECYCLE                                         */}
          {/* ============================================================== */}
          {activeCategory === "lifecycle" && (
            <div className="policies-section-card">
              <div className="policies-card-header">
                <div className="policies-card-title-group">
                  <div className="policies-card-icon">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                      <circle cx="9" cy="7" r="4" />
                      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="policies-card-title">Employee Lifecycle & Notice Policies</h3>
                    <p className="policies-card-subtitle">
                      Company standards for probation periods, formal confirmation, and exit notice requirements.
                    </p>
                  </div>
                </div>
              </div>

              <div className="policies-form-grid-2">
                <div className="policies-field-group">
                  <label className="policies-field-label">Probation Duration (Months)</label>
                  <input
                    type="number"
                    min="0"
                    max="24"
                    className="policies-input-control"
                    value={lifecycleRules.probationDurationMonths}
                    onChange={(e) =>
                      setLifecycleRules({
                        ...lifecycleRules,
                        probationDurationMonths: Number(e.target.value),
                      })
                    }
                  />
                  <div className="policies-preset-group">
                    {[0, 1, 3, 6, 12].map((m) => (
                      <button
                        key={m}
                        type="button"
                        className={`policies-preset-chip ${lifecycleRules.probationDurationMonths === m ? "active" : ""}`}
                        onClick={() => setLifecycleRules({ ...lifecycleRules, probationDurationMonths: m })}
                      >
                        {m === 0 ? "No Probation" : `${m} Month${m > 1 ? "s" : ""}`}
                      </button>
                    ))}
                  </div>
                  <span className="policies-field-hint">Initial trial employment duration.</span>
                </div>

                <div className="policies-field-group">
                  <label className="policies-field-label">Standard Notice Period (Days)</label>
                  <input
                    type="number"
                    min="0"
                    max="180"
                    className="policies-input-control"
                    value={lifecycleRules.noticePeriodDays}
                    onChange={(e) =>
                      setLifecycleRules({
                        ...lifecycleRules,
                        noticePeriodDays: Number(e.target.value),
                      })
                    }
                  />
                  <div className="policies-preset-group">
                    {[0, 15, 30, 60, 90].map((d) => (
                      <button
                        key={d}
                        type="button"
                        className={`policies-preset-chip ${lifecycleRules.noticePeriodDays === d ? "active" : ""}`}
                        onClick={() => setLifecycleRules({ ...lifecycleRules, noticePeriodDays: d })}
                      >
                        {d === 0 ? "Immediate (0d)" : `${d} Days`}
                      </button>
                    ))}
                  </div>
                  <span className="policies-field-hint">Required notice period upon resignation.</span>
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 18 }}>
                <label className="policies-checkbox-card">
                  <input
                    type="checkbox"
                    className="policies-checkbox-input"
                    checked={lifecycleRules.confirmationReviewRequired}
                    onChange={(e) =>
                      setLifecycleRules({
                        ...lifecycleRules,
                        confirmationReviewRequired: e.target.checked,
                      })
                    }
                  />
                  <div className="policies-checkbox-text">
                    <span className="policies-checkbox-title">Require Formal Confirmation Review</span>
                    <span className="policies-checkbox-desc">
                      HR administrator must approve permanent employment status following probation.
                    </span>
                  </div>
                </label>

                <label className="policies-checkbox-card">
                  <input
                    type="checkbox"
                    className="policies-checkbox-input"
                    checked={lifecycleRules.noticePeriodServingRequired}
                    onChange={(e) =>
                      setLifecycleRules({
                        ...lifecycleRules,
                        noticePeriodServingRequired: e.target.checked,
                      })
                    }
                  />
                  <div className="policies-checkbox-text">
                    <span className="policies-checkbox-title">Mandatory Notice Serving (No Automatic Buyout)</span>
                    <span className="policies-checkbox-desc">
                      Exiting employees must serve active notice duration unless waived by executive management.
                    </span>
                  </div>
                </label>
              </div>

              <div className="policies-save-bar">
                <button
                  type="button"
                  className="policies-section-save-btn"
                  onClick={() => handleSaveSection("lifecycle")}
                  disabled={Boolean(savingSection)}
                >
                  {savingSection === "lifecycle" ? "Saving..." : "Save Lifecycle Policies"}
                </button>
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* 12. RECRUITMENT & OFFERS                                       */}
          {/* ============================================================== */}
          {activeCategory === "recruitment_offers" && (
            <div className="policies-section-card">
              <div className="policies-card-header">
                <div className="policies-card-title-group">
                  <div className="policies-card-icon">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="9 11 12 14 22 4" />
                      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="policies-card-title">Recruitment & Offer Letter Policies</h3>
                    <p className="policies-card-subtitle">
                      Settings governing candidate offer validity, digital signing, and expiration rules.
                    </p>
                  </div>
                </div>
              </div>

              <div className="policies-form-grid-2">
                <div className="policies-field-group">
                  <label className="policies-field-label">Offer Acceptance Window (Days)</label>
                  <input
                    type="number"
                    min="1"
                    max="90"
                    className="policies-input-control"
                    value={recruitmentRules.offerValidityDays}
                    onChange={(e) =>
                      setRecruitmentRules({
                        ...recruitmentRules,
                        offerValidityDays: Number(e.target.value),
                      })
                    }
                  />
                  <div className="policies-preset-group">
                    {[3, 7, 14, 30, 60].map((d) => (
                      <button
                        key={d}
                        type="button"
                        className={`policies-preset-chip ${recruitmentRules.offerValidityDays === d ? "active" : ""}`}
                        onClick={() => setRecruitmentRules({ ...recruitmentRules, offerValidityDays: d })}
                      >
                        {d} Days
                      </button>
                    ))}
                  </div>
                  <span className="policies-field-hint">Days before candidate offer review link expires.</span>
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 18 }}>
                <label className="policies-checkbox-card">
                  <input
                    type="checkbox"
                    className="policies-checkbox-input"
                    checked={recruitmentRules.requireCandidateSignature}
                    onChange={(e) =>
                      setRecruitmentRules({
                        ...recruitmentRules,
                        requireCandidateSignature: e.target.checked,
                      })
                    }
                  />
                  <div className="policies-checkbox-text">
                    <span className="policies-checkbox-title">Mandatory Candidate Digital Signature</span>
                    <span className="policies-checkbox-desc">
                      Candidates must digitally sign and accept terms on the portal before onboarding unlocks.
                    </span>
                  </div>
                </label>

                <label className="policies-checkbox-card">
                  <input
                    type="checkbox"
                    className="policies-checkbox-input"
                    checked={recruitmentRules.autoExpireOffers}
                    onChange={(e) =>
                      setRecruitmentRules({
                        ...recruitmentRules,
                        autoExpireOffers: e.target.checked,
                      })
                    }
                  />
                  <div className="policies-checkbox-text">
                    <span className="policies-checkbox-title">Automatically Expire Unaccepted Offers</span>
                    <span className="policies-checkbox-desc">
                      Marks pending offers as expired once the validity window passes.
                    </span>
                  </div>
                </label>
              </div>

              <div className="policies-save-bar">
                <button
                  type="button"
                  className="policies-section-save-btn"
                  onClick={() => handleSaveSection("recruitment_offers")}
                  disabled={Boolean(savingSection)}
                >
                  {savingSection === "recruitment_offers" ? "Saving..." : "Save Offer Settings"}
                </button>
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* 13. DOCUMENTS & COMPLIANCE                                     */}
          {/* ============================================================== */}
          {activeCategory === "documents_compliance" && (
            <div className="policies-section-card">
              <div className="policies-card-header">
                <div className="policies-card-title-group">
                  <div className="policies-card-icon">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="policies-card-title">Documents & Compliance Standards</h3>
                    <p className="policies-card-subtitle">
                      Specify mandatory employee records and upload constraints connected to the employee document vault.
                    </p>
                  </div>
                </div>
              </div>

              <div className="policies-form-grid-2">
                <div className="policies-field-group">
                  <label className="policies-field-label">Maximum Upload File Size (MB)</label>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    className="policies-input-control"
                    value={documentRules.maxFileSizeMB}
                    onChange={(e) =>
                      setDocumentRules({
                        ...documentRules,
                        maxFileSizeMB: Number(e.target.value),
                      })
                    }
                  />
                  <div className="policies-preset-group">
                    {[5, 10, 25, 50].map((s) => (
                      <button
                        key={s}
                        type="button"
                        className={`policies-preset-chip ${documentRules.maxFileSizeMB === s ? "active" : ""}`}
                        onClick={() => setDocumentRules({ ...documentRules, maxFileSizeMB: s })}
                      >
                        {s} MB
                      </button>
                    ))}
                  </div>
                  <span className="policies-field-hint">Maximum megabytes allowed per document upload.</span>
                </div>

                <div className="policies-field-group">
                  <label className="policies-field-label">Allowed Document File Types</label>
                  <input
                    type="text"
                    className="policies-input-control"
                    value={documentRules.allowedFileFormats.join(", ")}
                    onChange={(e) =>
                      setDocumentRules({
                        ...documentRules,
                        allowedFileFormats: e.target.value
                          .split(",")
                          .map((s) => s.trim().toLowerCase())
                          .filter(Boolean),
                      })
                    }
                  />
                  <span className="policies-field-hint">Comma-separated extensions (e.g. pdf, png, jpg, docx).</span>
                </div>
              </div>

              {/* Standard Compliance Documents Library */}
              <div style={{ marginTop: 22 }}>
                <h4 style={{ margin: "0 0 12px", fontSize: 13, fontWeight: 700, color: "#09090b", textTransform: "uppercase" }}>
                  Standard Compliance Records Library
                </h4>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10 }}>
                  {STANDARD_DOCUMENT_TYPES.map((doc) => {
                    const isChecked = documentRules.mandatoryDocumentTypes.includes(doc.id);
                    return (
                      <label key={doc.id} className="policies-checkbox-card">
                        <input
                          type="checkbox"
                          className="policies-checkbox-input"
                          checked={isChecked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setDocumentRules({
                                ...documentRules,
                                mandatoryDocumentTypes: [...documentRules.mandatoryDocumentTypes, doc.id],
                              });
                            } else {
                              setDocumentRules({
                                ...documentRules,
                                mandatoryDocumentTypes: documentRules.mandatoryDocumentTypes.filter((t) => t !== doc.id),
                              });
                            }
                          }}
                        />
                        <div className="policies-checkbox-text">
                          <span className="policies-checkbox-title">{doc.label}</span>
                          <span className="policies-checkbox-desc"><code>{doc.id}</code></span>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Company-Specific Custom Document Types */}
              <div style={{ marginTop: 24, padding: "16px 20px", borderRadius: 10, background: "#f8fafc", border: "1px solid #e2e8f0" }}>
                <h4 style={{ margin: "0 0 6px", fontSize: 13, fontWeight: 700, color: "#09090b", textTransform: "uppercase" }}>
                  Company-Specific Custom Document Types
                </h4>
                <p style={{ margin: "0 0 14px", fontSize: 12.5, color: "#64748b" }}>
                  Add organization-specific document requirements (e.g. DRIVER_LICENSE, CLIENT_NDA, SECURITY_CLEARANCE).
                </p>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-start", marginBottom: 14 }}>
                  <div style={{ flex: 1, minWidth: 240 }}>
                    <input
                      type="text"
                      className="policies-input-control"
                      placeholder="e.g. DRIVER_LICENSE or CLIENT_SECURITY_AGREEMENT"
                      value={customDocInput}
                      onChange={(e) => setCustomDocInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleAddCustomDocumentType();
                        }
                      }}
                    />
                    {customDocError && (
                      <span style={{ fontSize: 12, color: "#dc2626", marginTop: 4, display: "block" }}>
                        {customDocError}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={handleAddCustomDocumentType}
                  >
                    + Add Custom Document
                  </button>
                </div>

                {/* Custom Documents List */}
                {(() => {
                  const standardIds = STANDARD_DOCUMENT_TYPES.map((d) => d.id);
                  const customDocs = documentRules.mandatoryDocumentTypes.filter((id) => !standardIds.includes(id));

                  if (customDocs.length === 0) {
                    return (
                      <div style={{ fontSize: 12.5, color: "#94a3b8", fontStyle: "italic" }}>
                        No company-specific custom document types added yet.
                      </div>
                    );
                  }

                  return (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {customDocs.map((docId) => (
                        <span key={docId} className="policies-custom-doc-pill">
                          <span>{docId}</span>
                          <button
                            type="button"
                            className="policies-custom-doc-remove"
                            onClick={() => handleRemoveCustomDocumentType(docId)}
                            title="Remove custom document type"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  );
                })()}
              </div>

              <div className="policies-save-bar">
                <button
                  type="button"
                  className="policies-section-save-btn"
                  onClick={() => handleSaveSection("documents_compliance")}
                  disabled={Boolean(savingSection)}
                >
                  {savingSection === "documents_compliance" ? "Saving..." : "Save Document Policies"}
                </button>
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* 14. GENERAL COMPANY POLICIES                                   */}
          {/* ============================================================== */}
          {activeCategory === "general_policies" && (
            <div className="policies-section-card">
              <div className="policies-card-header">
                <div className="policies-card-title-group">
                  <div className="policies-card-icon">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="3" />
                      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="policies-card-title">General Company Operations Policy</h3>
                    <p className="policies-card-subtitle">
                      Company handbook metadata, document codes, and foundational operational guidelines.
                    </p>
                  </div>
                </div>
              </div>

              <div className="policies-form-grid-2">
                <div className="policies-field-group">
                  <label className="policies-field-label">Official Policy Title</label>
                  <input
                    type="text"
                    className="policies-input-control"
                    value={generalRules.policyTitle}
                    onChange={(e) =>
                      setGeneralRules({ ...generalRules, policyTitle: e.target.value })
                    }
                  />
                  <span className="policies-field-hint">Published handbook header.</span>
                </div>

                <div className="policies-field-group">
                  <label className="policies-field-label">Document Code / Reference</label>
                  <input
                    type="text"
                    className="policies-input-control"
                    value={generalRules.policyCode}
                    onChange={(e) =>
                      setGeneralRules({ ...generalRules, policyCode: e.target.value })
                    }
                  />
                  <span className="policies-field-hint">Formal policy identifier (e.g. POL-HR-2026).</span>
                </div>
              </div>

              <div className="policies-field-group" style={{ marginTop: 16 }}>
                <label className="policies-field-label">Policy Summary & Operating Guidelines</label>
                <textarea
                  rows="3"
                  className="policies-input-control"
                  value={generalRules.description}
                  onChange={(e) =>
                    setGeneralRules({ ...generalRules, description: e.target.value })
                  }
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 18 }}>
                <label className="policies-checkbox-card">
                  <input
                    type="checkbox"
                    className="policies-checkbox-input"
                    checked={generalRules.emergencyContactMandatory}
                    onChange={(e) =>
                      setGeneralRules({
                        ...generalRules,
                        emergencyContactMandatory: e.target.checked,
                      })
                    }
                  />
                  <div className="policies-checkbox-text">
                    <span className="policies-checkbox-title">Mandatory Emergency Contact Information</span>
                    <span className="policies-checkbox-desc">
                      Requires employees to provide verified emergency contact details in their profile.
                    </span>
                  </div>
                </label>

                <label className="policies-checkbox-card">
                  <input
                    type="checkbox"
                    className="policies-checkbox-input"
                    checked={generalRules.workFromHomeAllowed}
                    onChange={(e) =>
                      setGeneralRules({
                        ...generalRules,
                        workFromHomeAllowed: e.target.checked,
                      })
                    }
                  />
                  <div className="policies-checkbox-text">
                    <span className="policies-checkbox-title">Remote / Work-From-Home Arrangements Permitted</span>
                    <span className="policies-checkbox-desc">
                      Enables designated remote check-in modes subject to department manager sign-off.
                    </span>
                  </div>
                </label>
              </div>

              <div className="policies-save-bar">
                <button
                  type="button"
                  className="policies-section-save-btn"
                  onClick={() => handleSaveSection("general_policies")}
                  disabled={Boolean(savingSection)}
                >
                  {savingSection === "general_policies" ? "Saving..." : "Save General Policy"}
                </button>
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* 15. REVISION HISTORY                                           */}
          {/* ============================================================== */}
          {activeCategory === "revisions" && (
            <div className="policies-section-card">
              <div className="policies-card-header">
                <div className="policies-card-title-group">
                  <div className="policies-card-icon">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 8v4l3 3" />
                      <circle cx="12" cy="12" r="10" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="policies-card-title">Policy Revision History ({revisions.length})</h3>
                    <p className="policies-card-subtitle">
                      Timeline and audit history of effective-dated policy versions for this tenant workspace.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setNewRevisionDate("");
                    setNewRevisionNotes("");
                    setNewRevisionError("");
                    setShowNewRevisionModal(true);
                  }}
                >
                  + Schedule New Revision
                </button>
              </div>

              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: 13.5 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #e4e4e7", color: "#71717a" }}>
                      <th style={{ padding: "10px 12px", fontWeight: 600 }}>Effective Date</th>
                      <th style={{ padding: "10px 12px", fontWeight: 600 }}>Timeline Status</th>
                      <th style={{ padding: "10px 12px", fontWeight: 600 }}>Leave Types</th>
                      <th style={{ padding: "10px 12px", fontWeight: 600 }}>Holidays</th>
                      <th style={{ padding: "10px 12px", fontWeight: 600 }}>Shift Timings</th>
                      <th style={{ padding: "10px 12px", fontWeight: 600 }}>Created Date</th>
                      <th style={{ padding: "10px 12px", fontWeight: 600, textAlign: "right" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {revisions.map((rev) => {
                      const effStr = rev.effectiveFromDate
                        ? new Date(rev.effectiveFromDate).toISOString().split("T")[0]
                        : "None";
                      const isSelected = rev._id === selectedRevisionId;

                      let statusBadge = (
                        <span style={{ background: "#eff6ff", color: "#1d4ed8", padding: "3px 8px", borderRadius: 12, fontSize: 11.5, fontWeight: 700 }}>
                          Scheduled
                        </span>
                      );

                      if (effStr <= todayStr) {
                        const hasNewer = revisions.some(
                          (r) =>
                            r._id !== rev._id &&
                            r.effectiveFromDate &&
                            new Date(r.effectiveFromDate).toISOString().split("T")[0] <= todayStr &&
                            new Date(r.effectiveFromDate).toISOString().split("T")[0] > effStr
                        );
                        if (hasNewer) {
                          statusBadge = (
                            <span style={{ background: "#f4f4f5", color: "#71717a", padding: "3px 8px", borderRadius: 12, fontSize: 11.5, fontWeight: 600 }}>
                              Historical
                            </span>
                          );
                        } else {
                          statusBadge = (
                            <span style={{ background: "#ecfdf5", color: "#059669", padding: "3px 8px", borderRadius: 12, fontSize: 11.5, fontWeight: 700 }}>
                              ● Active Now
                            </span>
                          );
                        }
                      }

                      return (
                        <tr key={rev._id} style={{ borderBottom: "1px solid #f4f4f5", background: isSelected ? "#f8fafc" : undefined }}>
                          <td style={{ padding: "12px", fontWeight: 700, color: "#09090b" }}>{effStr}</td>
                          <td style={{ padding: "12px" }}>{statusBadge}</td>
                          <td style={{ padding: "12px" }}>{(rev.leaveTypes || []).filter((t) => t.isActive).length} active types</td>
                          <td style={{ padding: "12px" }}>{(rev.holidays || []).length} holidays</td>
                          <td style={{ padding: "12px", color: "#52525b" }}>
                            {rev.attendanceRules?.officeStartTime || "09:30"} – {rev.attendanceRules?.officeEndTime || "18:30"}
                          </td>
                          <td style={{ padding: "12px", color: "#71717a" }}>
                            {rev.createdAt ? new Date(rev.createdAt).toISOString().split("T")[0] : "--"}
                          </td>
                          <td style={{ padding: "12px", textAlign: "right" }}>
                            <div style={{ display: "inline-flex", gap: 6 }}>
                              {isSelected ? (
                                <span style={{ fontSize: 12, fontWeight: 700, color: "#2563eb", padding: "4px 8px" }}>
                                  Currently Editing
                                </span>
                              ) : (
                                <button type="button" className="btn-secondary btn-sm" onClick={() => loadPolicyIntoForm(rev)}>
                                  Edit / View
                                </button>
                              )}

                              {revisions.length > 1 && !isSelected && (
                                <button
                                  type="button"
                                  className="btn-secondary btn-sm"
                                  style={{ color: "#ef4444" }}
                                  onClick={() =>
                                    setConfirmDeleteModal({
                                      type: "REVISION",
                                      target: rev._id,
                                      message: `Are you sure you want to delete policy revision effective ${effStr}? This action cannot be undone.`,
                                    })
                                  }
                                >
                                  Delete
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* ============================================================== */}
      {/* MODAL: ADD / EDIT LEAVE TYPE                                   */}
      {/* ============================================================== */}
      {showLeaveTypeModal && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
          <div style={{ background: "#ffffff", borderRadius: 14, padding: 24, width: "100%", maxWidth: 460, boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#09090b" }}>
                {editingLeaveTypeIndex !== null ? "Edit Leave Type" : "Add New Leave Type"}
              </h3>
              <button type="button" className="btn-secondary btn-sm" onClick={() => setShowLeaveTypeModal(false)} aria-label="Close">
                <IconClose size={14} />
              </button>
            </div>

            {leaveTypeModalError && <div className="error" style={{ marginBottom: 14, fontSize: 13 }}>{leaveTypeModalError}</div>}

            <div style={{ marginBottom: 14 }}>
              <label className="policies-field-label">Predefined Type Template (Optional)</label>
              <select
                className="policies-input-control"
                onChange={(e) => {
                  const t = PREDEFINED_LEAVE_TYPES.find((lt) => lt.code === e.target.value);
                  if (t) {
                    setLeaveTypeForm({
                      code: t.code,
                      name: t.name,
                      yearlyDays: t.yearlyDays,
                      isPaid: t.isPaid,
                      isActive: true,
                    });
                  }
                }}
                defaultValue=""
              >
                <option value="">-- Choose Standard Predefined Leave --</option>
                {PREDEFINED_LEAVE_TYPES.map((t) => (
                  <option key={t.code} value={t.code}>
                    {t.name} ({t.code} • {t.yearlyDays} days • {t.isPaid ? "Paid" : "Unpaid"})
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: "grid", gap: 14 }}>
              <div className="policies-field-group">
                <label className="policies-field-label">Code (Uppercase Identifier)</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. CASUAL, SICK, EARNED, MATERNITY"
                  className="policies-input-control"
                  style={{ textTransform: "uppercase" }}
                  value={leaveTypeForm.code}
                  onChange={(e) => setLeaveTypeForm({ ...leaveTypeForm, code: e.target.value.toUpperCase() })}
                />
              </div>

              <div className="policies-field-group">
                <label className="policies-field-label">Leave Type Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Casual Leave"
                  className="policies-input-control"
                  value={leaveTypeForm.name}
                  onChange={(e) => setLeaveTypeForm({ ...leaveTypeForm, name: e.target.value })}
                />
              </div>

              <div className="policies-field-group">
                <label className="policies-field-label">Annual Entitlement (Days / Year)</label>
                <input
                  type="number"
                  min="0"
                  max="365"
                  required
                  className="policies-input-control"
                  value={leaveTypeForm.yearlyDays}
                  onChange={(e) => setLeaveTypeForm({ ...leaveTypeForm, yearlyDays: e.target.value })}
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <label className="policies-checkbox-card">
                  <input
                    type="checkbox"
                    className="policies-checkbox-input"
                    checked={leaveTypeForm.isPaid}
                    onChange={(e) => setLeaveTypeForm({ ...leaveTypeForm, isPaid: e.target.checked })}
                  />
                  <div className="policies-checkbox-text">
                    <span className="policies-checkbox-title">Paid Leave Category</span>
                    <span className="policies-checkbox-desc">Uncheck if absences in this category result in Loss of Pay (LOP).</span>
                  </div>
                </label>

                <label className="policies-checkbox-card">
                  <input
                    type="checkbox"
                    className="policies-checkbox-input"
                    checked={leaveTypeForm.isActive}
                    onChange={(e) => setLeaveTypeForm({ ...leaveTypeForm, isActive: e.target.checked })}
                  />
                  <div className="policies-checkbox-text">
                    <span className="policies-checkbox-title">Active for Employee Requests</span>
                    <span className="policies-checkbox-desc">Available for employees to select on their self-service leave portal.</span>
                  </div>
                </label>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
              <button type="button" className="btn-secondary" onClick={() => setShowLeaveTypeModal(false)}>
                Cancel
              </button>
              <button type="button" onClick={handleSaveLeaveTypeModal}>
                {editingLeaveTypeIndex !== null ? "Update Leave Type" : "Add Leave Type"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL: ADD / EDIT HOLIDAY                                      */}
      {/* ============================================================== */}
      {showHolidayModal && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
          <div style={{ background: "#ffffff", borderRadius: 14, padding: 24, width: "100%", maxWidth: 460, boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#09090b" }}>
                {editingHolidayIndex !== null ? "Edit Holiday" : "Add Company Holiday"}
              </h3>
              <button type="button" className="btn-secondary btn-sm" onClick={() => setShowHolidayModal(false)} aria-label="Close">
                <IconClose size={14} />
              </button>
            </div>

            {holidayModalError && <div className="error" style={{ marginBottom: 14, fontSize: 13 }}>{holidayModalError}</div>}

            <div style={{ marginBottom: 14 }}>
              <label className="policies-field-label">Quick Standard Holiday Template</label>
              <select
                className="policies-input-control"
                onChange={(e) => {
                  const h = STANDARD_HOLIDAYS_LIBRARY.find((item) => item.name === e.target.value);
                  if (h) {
                    const year = effectiveFromDate ? effectiveFromDate.split("-")[0] : new Date().getFullYear();
                    setHolidayForm({
                      name: h.name,
                      date: `${year}-${h.month}-${h.day}`,
                      type: h.type,
                      isPaid: h.isPaid,
                    });
                  }
                }}
                defaultValue=""
              >
                <option value="">-- Select Standard Recognized Holiday --</option>
                {STANDARD_HOLIDAYS_LIBRARY.map((h) => (
                  <option key={h.name} value={h.name}>
                    {h.name} ({h.month}/{h.day} • {h.type})
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: "grid", gap: 14 }}>
              <div className="policies-field-group">
                <label className="policies-field-label">Holiday Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Independence Day or Diwali"
                  className="policies-input-control"
                  value={holidayForm.name}
                  onChange={(e) => setHolidayForm({ ...holidayForm, name: e.target.value })}
                />
              </div>

              <div className="policies-field-group">
                <label className="policies-field-label">Holiday Date</label>
                <input
                  type="date"
                  required
                  className="policies-input-control"
                  value={holidayForm.date}
                  onChange={(e) => setHolidayForm({ ...holidayForm, date: e.target.value })}
                />
              </div>

              <div className="policies-field-group">
                <label className="policies-field-label">Classification / Category</label>
                <select
                  className="policies-input-control"
                  value={holidayForm.type}
                  onChange={(e) => setHolidayForm({ ...holidayForm, type: e.target.value })}
                >
                  {HOLIDAY_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>

              <label className="policies-checkbox-card">
                <input
                  type="checkbox"
                  className="policies-checkbox-input"
                  checked={holidayForm.isPaid}
                  onChange={(e) => setHolidayForm({ ...holidayForm, isPaid: e.target.checked })}
                />
                <div className="policies-checkbox-text">
                  <span className="policies-checkbox-title">Official Paid Holiday</span>
                  <span className="policies-checkbox-desc">Employees receive full compensation for this recognized holiday.</span>
                </div>
              </label>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
              <button type="button" className="btn-secondary" onClick={() => setShowHolidayModal(false)}>
                Cancel
              </button>
              <button type="button" onClick={handleSaveHolidayModal}>
                {editingHolidayIndex !== null ? "Update Holiday" : "Save Holiday"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL: ADD / EDIT SALARY ALLOWANCE                             */}
      {/* ============================================================== */}
      {showAllowanceModal && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
          <div style={{ background: "#ffffff", borderRadius: 14, padding: 24, width: "100%", maxWidth: 460, boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#09090b" }}>
                {editingAllowanceIndex !== null ? "Edit Salary Allowance" : "Add Salary Allowance"}
              </h3>
              <button type="button" className="btn-secondary btn-sm" onClick={() => setShowAllowanceModal(false)} aria-label="Close">
                <IconClose size={14} />
              </button>
            </div>

            {allowanceModalError && <div className="error" style={{ marginBottom: 14, fontSize: 13 }}>{allowanceModalError}</div>}

            <div style={{ marginBottom: 14 }}>
              <label className="policies-field-label">Predefined Allowance Template (Optional)</label>
              <select
                className="policies-input-control"
                onChange={(e) => {
                  if (e.target.value) handleSelectPredefinedAllowance(e.target.value);
                }}
                defaultValue=""
              >
                <option value="">-- Select Standard Allowance Template --</option>
                {PREDEFINED_ALLOWANCES.map((a) => (
                  <option key={a.code} value={a.code}>
                    {a.name} ({a.percentageOfCtc}% CTC • {a.taxable ? "Taxable" : "Non-taxable"})
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: "grid", gap: 14 }}>
              <div className="policies-field-group">
                <label className="policies-field-label">Allowance Code (Uppercase)</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. BASIC, HRA, TRAVEL"
                  className="policies-input-control"
                  style={{ textTransform: "uppercase" }}
                  value={allowanceForm.code}
                  onChange={(e) => setAllowanceForm({ ...allowanceForm, code: e.target.value.toUpperCase() })}
                />
              </div>

              <div className="policies-field-group">
                <label className="policies-field-label">Allowance Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Basic Salary or Special Allowance"
                  className="policies-input-control"
                  value={allowanceForm.name}
                  onChange={(e) => setAllowanceForm({ ...allowanceForm, name: e.target.value })}
                />
              </div>

              <div className="policies-field-group">
                <label className="policies-field-label">Percentage of Annual CTC (%)</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.5"
                  required
                  className="policies-input-control"
                  value={allowanceForm.percentageOfCtc}
                  onChange={(e) => setAllowanceForm({ ...allowanceForm, percentageOfCtc: e.target.value })}
                />
                <span className="policies-field-hint">Proportion of gross CTC allocated to this earning component.</span>
              </div>

              <label className="policies-checkbox-card">
                <input
                  type="checkbox"
                  className="policies-checkbox-input"
                  checked={allowanceForm.taxable}
                  onChange={(e) => setAllowanceForm({ ...allowanceForm, taxable: e.target.checked })}
                />
                <div className="policies-checkbox-text">
                  <span className="policies-checkbox-title">Taxable Earning Component</span>
                  <span className="policies-checkbox-desc">Subject to income tax withholding and statutory calculations.</span>
                </div>
              </label>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
              <button type="button" className="btn-secondary" onClick={() => setShowAllowanceModal(false)}>
                Cancel
              </button>
              <button type="button" onClick={handleSaveAllowanceModal}>
                {editingAllowanceIndex !== null ? "Update Allowance" : "Save Allowance"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL: ADD / EDIT PAYROLL DEDUCTION                            */}
      {/* ============================================================== */}
      {showDeductionModal && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
          <div style={{ background: "#ffffff", borderRadius: 14, padding: 24, width: "100%", maxWidth: 460, boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#09090b" }}>
                {editingDeductionIndex !== null ? "Edit Payroll Deduction" : "Add Payroll Deduction"}
              </h3>
              <button type="button" className="btn-secondary btn-sm" onClick={() => setShowDeductionModal(false)} aria-label="Close">
                <IconClose size={14} />
              </button>
            </div>

            {deductionModalError && <div className="error" style={{ marginBottom: 14, fontSize: 13 }}>{deductionModalError}</div>}

            <div style={{ marginBottom: 14 }}>
              <label className="policies-field-label">Predefined Deduction Template (Optional)</label>
              <select
                className="policies-input-control"
                onChange={(e) => {
                  if (e.target.value) handleSelectPredefinedDeduction(e.target.value);
                }}
                defaultValue=""
              >
                <option value="">-- Select Standard Deduction Template --</option>
                {PREDEFINED_DEDUCTIONS.map((d) => (
                  <option key={d.code} value={d.code}>
                    {d.name} ({d.code} • {d.ratePercent}%)
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: "grid", gap: 14 }}>
              <div className="policies-field-group">
                <label className="policies-field-label">Deduction Code (Uppercase)</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. EPF, PT, VPF, HEALTH_INS"
                  className="policies-input-control"
                  style={{ textTransform: "uppercase" }}
                  value={deductionForm.code}
                  onChange={(e) => setDeductionForm({ ...deductionForm, code: e.target.value.toUpperCase() })}
                />
              </div>

              <div className="policies-field-group">
                <label className="policies-field-label">Deduction Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Provident Fund (EPF)"
                  className="policies-input-control"
                  value={deductionForm.name}
                  onChange={(e) => setDeductionForm({ ...deductionForm, name: e.target.value })}
                />
              </div>

              <div className="policies-field-group">
                <label className="policies-field-label">Standard Rate (%)</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.5"
                  required
                  className="policies-input-control"
                  value={deductionForm.ratePercent}
                  onChange={(e) => setDeductionForm({ ...deductionForm, ratePercent: e.target.value })}
                />
                <span className="policies-field-hint">Deduction rate percentage applied in payroll processing.</span>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
              <button type="button" className="btn-secondary" onClick={() => setShowDeductionModal(false)}>
                Cancel
              </button>
              <button type="button" onClick={handleSaveDeductionModal}>
                {editingDeductionIndex !== null ? "Update Deduction" : "Save Deduction"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL: SCHEDULE NEW POLICY REVISION                            */}
      {/* ============================================================== */}
      {showNewRevisionModal && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
          <div style={{ background: "#ffffff", borderRadius: 14, padding: 24, width: "100%", maxWidth: 480, boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#09090b" }}>
                Schedule New Policy Revision
              </h3>
              <button type="button" className="btn-secondary btn-sm" onClick={() => setShowNewRevisionModal(false)} aria-label="Close">
                <IconClose size={14} />
              </button>
            </div>

            {newRevisionError && <div className="error" style={{ marginBottom: 14, fontSize: 13 }}>{newRevisionError}</div>}

            <p style={{ margin: "0 0 16px", fontSize: 13, color: "#52525b", lineHeight: 1.5 }}>
              Creates a new policy version cloned from your current configuration. Historical policy versions remain safe and intact, and this version will automatically take effect on the selected date.
            </p>

            <div style={{ display: "grid", gap: 14 }}>
              <div className="policies-field-group">
                <label className="policies-field-label">Effective From Date</label>
                <input
                  type="date"
                  required
                  className="policies-input-control"
                  value={newRevisionDate}
                  onChange={(e) => setNewRevisionDate(e.target.value)}
                />
              </div>

              <div className="policies-field-group">
                <label className="policies-field-label">Revision Description / Audit Memo</label>
                <input
                  type="text"
                  placeholder="e.g. FY2027 Annual policy overhaul & shift updates"
                  className="policies-input-control"
                  value={newRevisionNotes}
                  onChange={(e) => setNewRevisionNotes(e.target.value)}
                />
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 22 }}>
              <button type="button" className="btn-secondary" onClick={() => setShowNewRevisionModal(false)} disabled={Boolean(savingSection)}>
                Cancel
              </button>
              <button type="button" onClick={handleCreateNewRevision} disabled={Boolean(savingSection)}>
                {savingSection === "NEW_REVISION" ? "Creating..." : "Create Revision"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* CONFIRMATION / ALERT MODAL                                     */}
      {/* ============================================================== */}
      {confirmDeleteModal && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1100, padding: 16 }}>
          <div style={{ background: "#ffffff", borderRadius: 14, padding: 24, width: "100%", maxWidth: 440, boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.15)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  background: confirmDeleteModal.type === "BLOCKED_LEAVE_TYPE" ? "#fef3c7" : "#fee2e2",
                  color: confirmDeleteModal.type === "BLOCKED_LEAVE_TYPE" ? "#b45309" : "#dc2626",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                {confirmDeleteModal.type === "BLOCKED_LEAVE_TYPE" ? (
                  <IconAlertTriangle size={20} />
                ) : (
                  <IconAlertCircle size={20} />
                )}
              </div>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#09090b" }}>
                {confirmDeleteModal.type === "BLOCKED_LEAVE_TYPE"
                  ? "Cannot Delete Leave Type"
                  : "Confirm Deletion"}
              </h3>
            </div>

            <p style={{ margin: "0 0 20px", fontSize: 13.5, color: "#52525b", lineHeight: 1.5 }}>
              {confirmDeleteModal.message}
            </p>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              {confirmDeleteModal.type === "BLOCKED_LEAVE_TYPE" ? (
                <>
                  <button type="button" className="btn-secondary" onClick={() => setConfirmDeleteModal(null)}>
                    Close
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const item = confirmDeleteModal.target;
                      setLeaveTypes((prev) =>
                        prev.map((lt) => (lt.code === item.code ? { ...lt, isActive: false } : lt))
                      );
                      setConfirmDeleteModal(null);
                    }}
                  >
                    Deactivate Leave Type Instead
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className="btn-secondary" onClick={() => setConfirmDeleteModal(null)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    style={{ background: "#dc2626", borderColor: "#dc2626" }}
                    onClick={handleConfirmDelete}
                  >
                    Delete
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
