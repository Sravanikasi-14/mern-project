import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import AppHeader from "../components/AppHeader";
import SoftRefresh from "../components/SoftRefresh";
import StatusBadge from "../components/StatusBadge";
import Pagination from "../components/Pagination";
import { IconClose, IconCheck } from "../components/Icons";
import { TableSkeletonRows } from "../components/TableSkeleton";
import api from "../services/api";
import ColumnChooser from "../components/ColumnChooser";
import { useEmployeesSummaryQuery,
  useEmployeesPoolQuery,
  useEmployeesQuery,
} from "../hooks/useAdminQueries";
import { useColumnPreferences } from "../hooks/useColumnPreferences";
import { invalidateEmployees } from "../lib/queryKeys";
import { useAuth } from "../context/AuthContext";
import { hrPortalAllows } from "../utils/hrPortalAccess";
import DepartmentSelect from "../components/DepartmentSelect";
import { departmentPayload } from "../components/departmentAssignment";
import DesignationFields from "../components/organization-workspace/DesignationFields";
import { AccessRestrictedInline } from "../components/AccessRestrictedNotice";
import "./PeopleManagement.css";
import MobileFilterBar from "../components/mobile/MobileFilterBar";
import ModuleToolbar from "../components/ModuleToolbar";
import ReportingManagerSelect from "../components/ReportingManagerSelect";
import DateRangePicker from "../components/DateRangePicker";
import AuthedAvatar from "../components/AuthedAvatar";

const PAGE_SIZE_OPTIONS = [8, 12, 24, 48, 100];

const AVAILABLE_COLUMNS = [
  { id: "employeeCode", label: "Code", essential: true },
  { id: "fullName", label: "Full Name", essential: true },
  { id: "email", label: "Email", defaultVisible: false },
  { id: "phoneNumber", label: "Phone", defaultVisible: false },
  { id: "jobTitle", label: "Designation", defaultVisible: true },
  { id: "department", label: "Department", defaultVisible: true },
  { id: "manager", label: "Manager", defaultVisible: true },
  { id: "project", label: "Project", defaultVisible: false },
  { id: "status", label: "Status", essential: true },
  { id: "invitation", label: "Invitation", defaultVisible: false },
  { id: "salary", label: "Monthly Salary", defaultVisible: false },
  { id: "joiningDate", label: "Joining Date", defaultVisible: false },
  { id: "actions", label: "Actions", essential: true },
];

const SEARCH_PLACEHOLDER =
  "Search by name, preferred name, ID, email, phone, designation, department, project or location…";

const INVITATION_STATUS_OPTIONS = [
  { value: "PENDING", label: "Invite pending" },
  { value: "ACCEPTED", label: "Invite accepted" },
  { value: "EXPIRED", label: "Invite expired" },
  { value: "DELIVERY_FAILED", label: "Delivery failed" },
];

const PROJECT_TYPE_OPTIONS = [
  { value: "MANDATE", label: "Mandate" },
  { value: "RETAIL", label: "Retail" },
  { value: "BENCH", label: "Bench" },
  { value: "INTERNAL", label: "Internal" },
];

function parseManagerFilterParam(raw) {
  if (!raw) return null;
  const v = String(raw).trim();
  if (!v) return null;
  if (["none", "null", "unassigned"].includes(v.toLowerCase())) return "none";
  return v;
}

function invitationStatusLabel(value) {
  return INVITATION_STATUS_OPTIONS.find((o) => o.value === value)?.label || value;
}

function projectTypeLabel(value) {
  return PROJECT_TYPE_OPTIONS.find((o) => o.value === value)?.label || value;
}

function ManagerCell({ employee }) {
  const mgr = employee?.job?.reportingManagerId;
  if (!mgr || typeof mgr !== "object" || !mgr.fullName) {
    return <span className="pm-mgr-none">No manager</span>;
  }
  return (
    <span className="pm-mgr-cell">
      <span className="pm-mgr-name">{mgr.fullName}</span>
      {mgr.job?.jobTitle ? <span className="pm-mgr-title">{mgr.job.jobTitle}</span> : null}
    </span>
  );
}

export default function AdminHome() {
  const navigate = useNavigate();
  const { user, company } = useAuth();
  const canCreatePeople = hrPortalAllows(user, company, "people.create");
  const canImportPeople = hrPortalAllows(user, company, "people.import");
  const location = useLocation();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const onboardOfferId = searchParams.get("onboardOfferId");
  const projectParam = searchParams.get("project");

  // Selected project state: null = Projects Overview (Ref 1), string = Project Details (Ref 2)
  const [selectedProject, setSelectedProject] = useState(projectParam || "ALL");
  const [selectedDepartment, setSelectedDepartment] = useState(
    () => searchParams.get("department") || ""
  );
  const [jobTitleFilter, setJobTitleFilter] = useState(() => searchParams.get("jobTitle") || "");
  /** null = all; "none" = unassigned; ObjectId = direct reports of that manager */
  const [managerFilter, setManagerFilter] = useState(() =>
    parseManagerFilterParam(searchParams.get("reportingManagerId"))
  );
  const [employmentTypeFilter, setEmploymentTypeFilter] = useState(
    () => searchParams.get("employmentType") || ""
  );
  const [workLocationFilter, setWorkLocationFilter] = useState(
    () => searchParams.get("workLocation") || ""
  );
  const [invitationStatusFilter, setInvitationStatusFilter] = useState(() => {
    const raw = (searchParams.get("invitationStatus") || "").toUpperCase();
    return INVITATION_STATUS_OPTIONS.some((o) => o.value === raw) ? raw : "";
  });
  const [joiningFrom, setJoiningFrom] = useState(() => searchParams.get("joiningFrom") || "");
  const [joiningTo, setJoiningTo] = useState(() => searchParams.get("joiningTo") || "");
  const [projectTypeFilter, setProjectTypeFilter] = useState(() => {
    const raw = (searchParams.get("projectType") || "").toUpperCase();
    return PROJECT_TYPE_OPTIONS.some((o) => o.value === raw) ? raw : "";
  });

  const [search, setSearch] = useState(() => searchParams.get("q") || "");
  const [debouncedSearch, setDebouncedSearch] = useState(() => searchParams.get("q") || "");
  const initialStatus = searchParams.get("status") ? searchParams.get("status").toUpperCase() : "ALL";
  const [statusFilter, setStatusFilter] = useState(
    ["ACTIVE", "INACTIVE", "ALL"].includes(initialStatus) ? initialStatus : "ALL"
  );
  const [sortBy, setSortBy] = useState(() => searchParams.get("sortBy") || "createdAt");
  const [sortOrder, setSortOrder] = useState(() => searchParams.get("sortOrder") || "desc");
  const [pageSize, setPageSize] = useState(() => Math.max(1, Number(searchParams.get("limit") || 12) || 12));
  const [currentPage, setCurrentPage] = useState(() => Math.max(1, Number(searchParams.get("page") || 1) || 1));

  const peopleCols = useColumnPreferences("hr-people-directory", AVAILABLE_COLUMNS);
  const visibleColumns = peopleCols.visible;

  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // Add Employee Modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [savingAdd, setSavingAdd] = useState(false);
  const [addError, setAddError] = useState("");
  const [addFieldErrors, setAddFieldErrors] = useState({});
  const [createdInvitationInfo, setCreatedInvitationInfo] = useState(null);
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [resendingId, setResendingId] = useState(null);

  // Bulk import modal
  const [showImportModal, setShowImportModal] = useState(false);
  const [importRows, setImportRows] = useState([]);
  const [importPreview, setImportPreview] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState("");
  const [copiedActivationId, setCopiedActivationId] = useState(null);

  const [newEmployee, setNewEmployee] = useState({
    fullName: "",
    employeeCode: "",
    email: "",
    jobTitle: "",
    jobGrade: "",
    department: "",
    departmentId: "",
    employmentType: "Full-time",
    joiningDate: "",
    projectName: "",
    monthlySalary: "",
    reportingManagerId: null,
    offerLetterId: null,
  });

  // Project overview drill-down: clear free-text search so the project view starts clean.
  const handleSelectProject = (projName) => {
    const next = projName || "ALL";
    setSelectedProject(next);
    setCurrentPage(1);
    setSearch("");
    setDebouncedSearch("");
    if (next && next !== "ALL") {
      searchParams.set("project", next);
    } else {
      searchParams.delete("project");
    }
    searchParams.delete("q");
    searchParams.delete("page");
    setSearchParams(searchParams, { replace: true });
  };

  // Filter-panel project change: keep search + other filters intact.
  const applyProjectFilter = (projName) => {
    setSelectedProject(projName || "ALL");
    setCurrentPage(1);
  };

  // Persist directory list state so Back from employee details restores filters/pagination.
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (selectedProject && selectedProject !== "ALL") next.set("project", selectedProject);
    else next.delete("project");
    if (statusFilter && statusFilter !== "ALL") next.set("status", statusFilter);
    else next.delete("status");
    if (debouncedSearch.trim()) next.set("q", debouncedSearch.trim());
    else next.delete("q");
    if (selectedDepartment.trim()) next.set("department", selectedDepartment.trim());
    else next.delete("department");
    if (jobTitleFilter.trim()) next.set("jobTitle", jobTitleFilter.trim());
    else next.delete("jobTitle");
    if (managerFilter === "none") next.set("reportingManagerId", "none");
    else if (managerFilter) next.set("reportingManagerId", String(managerFilter));
    else next.delete("reportingManagerId");
    if (employmentTypeFilter.trim()) next.set("employmentType", employmentTypeFilter.trim());
    else next.delete("employmentType");
    if (workLocationFilter.trim()) next.set("workLocation", workLocationFilter.trim());
    else next.delete("workLocation");
    if (invitationStatusFilter) next.set("invitationStatus", invitationStatusFilter);
    else next.delete("invitationStatus");
    if (joiningFrom) next.set("joiningFrom", joiningFrom);
    else next.delete("joiningFrom");
    if (joiningTo) next.set("joiningTo", joiningTo);
    else next.delete("joiningTo");
    if (projectTypeFilter) next.set("projectType", projectTypeFilter);
    else next.delete("projectType");
    if (sortBy && sortBy !== "createdAt") next.set("sortBy", sortBy);
    else next.delete("sortBy");
    if (sortOrder && sortOrder !== "desc") next.set("sortOrder", sortOrder);
    else next.delete("sortOrder");
    if (pageSize !== 12) next.set("limit", String(pageSize));
    else next.delete("limit");
    if (currentPage > 1) next.set("page", String(currentPage));
    else next.delete("page");
    if (next.toString() === searchParams.toString()) return;
    setSearchParams(next, { replace: true });
  }, [
    selectedProject,
    statusFilter,
    debouncedSearch,
    selectedDepartment,
    jobTitleFilter,
    managerFilter,
    employmentTypeFilter,
    workLocationFilter,
    invitationStatusFilter,
    joiningFrom,
    joiningTo,
    projectTypeFilter,
    sortBy,
    sortOrder,
    pageSize,
    currentPage,
    searchParams,
    setSearchParams,
  ]);

  // Check for offer letter onboarding parameter
  useEffect(() => {
    if (!onboardOfferId) return;

    let cancelled = false;
    const fetchOfferForOnboarding = async () => {
      try {
        const res = await api.get(`/offer-letters/${onboardOfferId}`);
        const offer = res.data?.offerLetter;
        if (!cancelled && offer) {
          if (offer.status !== "ACCEPTED") {
            setError(`Cannot onboard: Offer letter is in '${offer.status}' status (must be ACCEPTED).`);
            return;
          }
          if (offer.employeeId) {
            setError("This offer letter has already been linked to an onboarded employee.");
            return;
          }
          setNewEmployee({
            fullName: offer.candidate?.fullName || "",
            employeeCode: "",
            email: offer.candidate?.email || "",
            jobTitle: offer.position || "",
            jobGrade: "",
            department: offer.department || "",
            departmentId: "",
            employmentType: "Full-time",
            workLocation: offer.workLocation || "",
            joiningDate: offer.joiningDate ? new Date(offer.joiningDate).toISOString().slice(0, 10) : "",
            projectName: "",
            monthlySalary: offer.monthlySalary ? String(offer.monthlySalary) : "",
            reportingManagerId: null,
            offerLetterId: offer._id,
          });
          setShowAddModal(true);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.response?.data?.message || "Failed to load offer details for onboarding.");
        }
      }
    };
    fetchOfferForOnboarding();

    return () => {
      cancelled = true;
    };
  }, [onboardOfferId]);

  // Debounce search (skip page reset on initial URL hydration)
  const searchHydratedRef = useRef(true);
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(search);
      if (searchHydratedRef.current) {
        searchHydratedRef.current = false;
        return;
      }
      setCurrentPage(1);
    }, 300);
    return () => clearTimeout(handler);
  }, [search]);

  const summaryQuery = useEmployeesSummaryQuery();
  const poolQuery = useEmployeesPoolQuery();
  const employeesQuery = useEmployeesQuery({
    page: currentPage,
    limit: pageSize,
    sortBy,
    sortOrder,
    search: debouncedSearch,
    status: statusFilter,
    project: selectedProject,
    department: selectedDepartment,
    jobTitle: jobTitleFilter,
    reportingManagerId: managerFilter || "",
    employmentType: employmentTypeFilter,
    workLocation: workLocationFilter,
    invitationStatus: invitationStatusFilter,
    joiningFrom,
    joiningTo,
    projectType: projectTypeFilter,
  });

  const summary = summaryQuery.data?.summary || summaryQuery.data || null;
  const allEmployeesPool = poolQuery.data || [];
  const employees = employeesQuery.data?.employees || [];
  const pagination = employeesQuery.data?.pagination || {
    page: currentPage,
    limit: pageSize,
    totalEmployees: 0,
    totalPages: 1,
  };
  const loading = employeesQuery.isLoading && employees.length === 0;
  const loadingPool = poolQuery.isLoading && allEmployeesPool.length === 0;
  const listFetching = employeesQuery.isFetching && employees.length > 0;

  useEffect(() => {
    if (employeesQuery.error) {
      setError(
        employeesQuery.error.response?.data?.message || "Failed to load employee records."
      );
    } else if (employeesQuery.isSuccess) {
      setError("");
    }
  }, [employeesQuery.error, employeesQuery.isSuccess]);

  // Derive projects structure from all employees pool
  const projectsData = useMemo(() => {
    const map = new Map();
    const deptMap = new Map();
    const leadsMap = new Map();

    allEmployeesPool.forEach((emp) => {
      // Aggregate departments
      const dept = emp.job?.department || "Operations";
      deptMap.set(dept, (deptMap.get(dept) || 0) + 1);

      // Check if project lead / manager
      const role = (emp.job?.jobTitle || "").toLowerCase();
      if (
        role.includes("lead") ||
        role.includes("manager") ||
        role.includes("head") ||
        role.includes("director") ||
        role.includes("principal")
      ) {
        if (!leadsMap.has(emp._id)) {
          leadsMap.set(emp._id, emp);
        }
      }

      // Aggregate projects
      const projName = emp.job?.project?.projectName?.trim();
      const projKey = projName || "General Operations & Bench";
      const projType = emp.job?.project?.projectType || (projName ? "MANDATE" : "BENCH");

      if (!map.has(projKey)) {
        map.set(projKey, {
          name: projKey,
          isBench: !projName,
          projectType: projType,
          location: emp.job?.workLocation || emp.city || "Bangalore HQ",
          members: [],
          lead: null,
          departments: new Set(),
        });
      }

      const pObj = map.get(projKey);
      pObj.members.push(emp);
      if (emp.job?.department) pObj.departments.add(emp.job.department);
      if (!pObj.lead && (role.includes("lead") || role.includes("manager") || role.includes("head"))) {
        pObj.lead = emp;
      }
    });

    // If a project doesn't have an explicit lead, pick its most senior or first member
    map.forEach((pObj) => {
      if (!pObj.lead && pObj.members.length > 0) {
        pObj.lead = pObj.members[0];
      }
    });

    const projectList = Array.from(map.values()).sort(
      (a, b) => b.members.length - a.members.length
    );

    const deptList = Array.from(deptMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    const leadsList = Array.from(leadsMap.values()).slice(0, 4);

    const designationSet = new Set();
    const employmentTypeSet = new Set();
    const workLocationSet = new Set();
    allEmployeesPool.forEach((emp) => {
      const title = emp.job?.jobTitle?.trim();
      if (title) designationSet.add(title);
      const empType = emp.job?.employmentType?.trim();
      if (empType) employmentTypeSet.add(empType);
      const loc = emp.job?.workLocation?.trim();
      if (loc) workLocationSet.add(loc);
    });
    const designationList = Array.from(designationSet).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" })
    );
    const employmentTypeList = Array.from(employmentTypeSet).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" })
    );
    const workLocationList = Array.from(workLocationSet).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" })
    );
    return {
      projectList,
      deptList,
      leadsList,
      designationList,
      employmentTypeList,
      workLocationList,
    };
  }, [allEmployeesPool]);

  const peopleFilterCount =
    (statusFilter !== "ALL" ? 1 : 0) +
    (sortBy !== "createdAt" || sortOrder !== "desc" ? 1 : 0) +
    (selectedProject && selectedProject !== "ALL" ? 1 : 0) +
    (selectedDepartment.trim() ? 1 : 0) +
    (jobTitleFilter.trim() ? 1 : 0) +
    (managerFilter ? 1 : 0) +
    (employmentTypeFilter.trim() ? 1 : 0) +
    (workLocationFilter.trim() ? 1 : 0) +
    (invitationStatusFilter ? 1 : 0) +
    (joiningFrom || joiningTo ? 1 : 0) +
    (projectTypeFilter ? 1 : 0) +
    (debouncedSearch.trim() ? 1 : 0);

  const hasChipFilters =
    Boolean(selectedDepartment.trim()) ||
    Boolean(jobTitleFilter.trim()) ||
    Boolean(managerFilter) ||
    Boolean(employmentTypeFilter.trim()) ||
    Boolean(workLocationFilter.trim()) ||
    Boolean(invitationStatusFilter) ||
    Boolean(joiningFrom || joiningTo) ||
    Boolean(projectTypeFilter) ||
    (selectedProject && selectedProject !== "ALL") ||
    statusFilter !== "ALL" ||
    Boolean(debouncedSearch.trim());

  const clearPeopleFilters = () => {
    setStatusFilter("ALL");
    setSortBy("createdAt");
    setSortOrder("desc");
    setSelectedProject("ALL");
    setJobTitleFilter("");
    setManagerFilter(null);
    setSelectedDepartment("");
    setEmploymentTypeFilter("");
    setWorkLocationFilter("");
    setInvitationStatusFilter("");
    setJoiningFrom("");
    setJoiningTo("");
    setProjectTypeFilter("");
    setSearch("");
    setDebouncedSearch("");
    setCurrentPage(1);
  };

  const handleViewDetails = (empId) => {
    navigate(`/admin/employees/${empId}`, {
      state: { from: `${location.pathname}${location.search || ""}` },
    });
  };

  const handleOpenEdit = (emp) => {
    navigate(`/admin/employees/${emp._id}/edit`, {
      state: { from: `${location.pathname}${location.search || ""}` },
    });
  };

  const handleCreateEmployee = async (e) => {
    e.preventDefault();
    setAddError("");
    const errors = {};

    if (!newEmployee.fullName.trim()) {
      errors.fullName = "Full name is required.";
    }
    if (!newEmployee.employeeCode.trim()) {
      errors.employeeCode = "Employee code is required.";
    }
    if (!newEmployee.email.trim()) {
      errors.email = "Email is required.";
    } else {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(newEmployee.email.trim())) {
        errors.email = "Please enter a valid email address.";
      }
    }

    if (newEmployee.monthlySalary !== "" && newEmployee.monthlySalary != null) {
      const salaryNum = parseFloat(newEmployee.monthlySalary);
      if (isNaN(salaryNum) || salaryNum < 0) {
        errors.monthlySalary = "Please enter a valid non-negative salary amount.";
      }
    }

    if (newEmployee.joiningDate) {
      const d = new Date(newEmployee.joiningDate);
      if (isNaN(d.getTime())) {
        errors.joiningDate = "Please enter a valid date.";
      }
    }

    if (Object.keys(errors).length > 0) {
      setAddFieldErrors(errors);
      return;
    }

    setSavingAdd(true);

    try {
      const { department, departmentId, ...employeeFields } = newEmployee;
      const response = await api.post("/employees", {
        ...employeeFields,
        ...departmentPayload({
          departmentId,
          legacyName: department,
          submitLegacy: !departmentId,
        }),
        fullName: newEmployee.fullName.trim(),
        employeeCode: newEmployee.employeeCode.trim(),
        email: newEmployee.email.trim(),
        reportingManagerId: newEmployee.reportingManagerId || null,
        offerLetterId: newEmployee.offerLetterId || undefined,
      });

      setSuccessMsg("Employee created. Copy and share the activation link.");
      setCreatedInvitationInfo({
        employee: response.data?.employee,
        invitation: response.data?.invitation || response.data?.activation,
        activation: response.data?.activation,
      });
      invalidateEmployees(queryClient);
    } catch (err) {
      if (!err.response || err.code === "ERR_NETWORK" || err.response.status >= 500) {
        setAddError("We're unable to connect right now. Please try again in a moment.");
      } else {
        const backendMessage = err.response.data?.message || "Unable to create employee.";
        const backendErrors = err.response.data?.errors || {};
        setAddError(backendMessage);
        if (Object.keys(backendErrors).length > 0) {
          setAddFieldErrors((prev) => ({ ...prev, ...backendErrors }));
        }
      }
    } finally {
      setSavingAdd(false);
    }
  };

  const handleResendInvite = async (empId) => {
    try {
      setResendingId(empId);
      const res = await api.post(`/employees/${empId}/resend-invite`);
      setSuccessMsg(res.data?.message || "Invitation resent successfully!");
      if (res.data?.invitation?.inviteLink) {
        navigator.clipboard?.writeText(res.data.invitation.inviteLink);
        setSuccessMsg("Invitation resent! Link copied to clipboard.");
      }
      invalidateEmployees(queryClient);
      setTimeout(() => setSuccessMsg(""), 5000);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to resend onboarding invitation.");
      setTimeout(() => setError(""), 5000);
    } finally {
      setResendingId(null);
    }
  };

  const handleCloseAddModal = () => {
    setShowAddModal(false);
    setCreatedInvitationInfo(null);
    setNewEmployee({
      fullName: "",
      employeeCode: "",
      email: "",
      jobTitle: "",
      jobGrade: "",
      department: "",
      departmentId: "",
      employmentType: "Full-time",
      joiningDate: "",
      projectName: "",
      monthlySalary: "",
      reportingManagerId: null,
      offerLetterId: null,
    });
    if (onboardOfferId) {
      searchParams.delete("onboardOfferId");
      setSearchParams(searchParams, { replace: true });
    }
    setAddFieldErrors({});
    setAddError("");
    setCopiedInvite(false);
  };

  const parseDelimitedText = (text) => {
    const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return [];
    const splitCsv = (line) => {
      const cells = [];
      let cur = "";
      let inQuotes = false;
      for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (ch === '"') {
          if (inQuotes && line[i + 1] === '"') {
            cur += '"';
            i += 1;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (ch === "," && !inQuotes) {
          cells.push(cur.trim());
          cur = "";
        } else {
          cur += ch;
        }
      }
      cells.push(cur.trim());
      return cells;
    };
    const headers = splitCsv(lines[0]).map((h) => h.trim());
    return lines.slice(1).map((line) => {
      const cells = splitCsv(line);
      const row = {};
      headers.forEach((h, idx) => {
        row[h] = cells[idx] ?? "";
      });
      return row;
    });
  };

  const handleImportFile = async (file) => {
    setImportError("");
    setImportPreview(null);
    setImportResult(null);
    if (!file) return;

    const name = (file.name || "").toLowerCase();
    try {
      let rows = [];
      if (name.endsWith(".csv") || name.endsWith(".txt")) {
        const text = await file.text();
        rows = parseDelimitedText(text);
      } else if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
        const XLSX = await import("xlsx");
        const buf = await file.arrayBuffer();
        const workbook = XLSX.read(buf, { type: "array", cellDates: true });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        // raw:false keeps dates/numbers as display strings so header mapping stays stable
        rows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
      } else {
        setImportError("Please upload a .csv or .xlsx file.");
        return;
      }

      if (!rows.length) {
        setImportError("No data rows found in the file.");
        return;
      }

      setImportRows(rows);
      setImportBusy(true);
      const res = await api.post("/employees/import/preview", { rows });
      setImportPreview(res.data);
    } catch (err) {
      setImportError(err.response?.data?.message || "Failed to read or validate the import file.");
    } finally {
      setImportBusy(false);
    }
  };

  const handleCommitImport = async () => {
    if (!importRows.length) return;
    setImportBusy(true);
    setImportError("");
    try {
      const res = await api.post("/employees/import", {
        rows: importRows,
        importValidOnly: true,
      });
      setImportResult(res.data);
      setImportPreview(null);
      invalidateEmployees(queryClient);
      setSuccessMsg(res.data?.message || "Import completed.");
    } catch (err) {
      if (err.response?.data?.failed || err.response?.data?.summary) {
        setImportResult(err.response.data);
      } else {
        setImportError(err.response?.data?.message || "Import failed.");
      }
    } finally {
      setImportBusy(false);
    }
  };

  const handleCloseImportModal = () => {
    setShowImportModal(false);
    setImportRows([]);
    setImportPreview(null);
    setImportResult(null);
    setImportError("");
    setCopiedActivationId(null);
  };

  const formatCurrency = (amount) => {
    if (amount == null) return "—";
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const formatDate = (dateString) => {
    if (!dateString) return "—";
    return new Date(dateString).toLocaleDateString("en-IN", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const getInitials = (name) => {
    if (!name) return "E";
    const parts = name.trim().split(" ");
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  const selectedProjectInfo = useMemo(() => {
    if (!selectedProject || selectedProject === "ALL") return null;
    return projectsData.projectList.find((p) => p.name === selectedProject) || {
      name: selectedProject,
      projectType: "MANDATE",
      location: "Bangalore HQ",
      members: [],
      lead: null,
    };
  }, [selectedProject, projectsData.projectList]);

  // Total workforce & staffing calculations
  const totalEmployeesCount = summary?.totalEmployees || allEmployeesPool.length || 0;
  const activeEmployeesCount = summary?.activeEmployees || allEmployeesPool.filter((e) => e.status === "ACTIVE").length || 0;
  const assignedEmployeesCount = summary?.assignedEmployees || allEmployeesPool.filter((e) => e.job?.project?.projectName).length || 0;
  const activeProjectsCount = projectsData.projectList.filter((p) => !p.isBench).length;
  const staffingRate = totalEmployeesCount > 0 ? Math.round((assignedEmployeesCount / totalEmployeesCount) * 100) : 0;

  return (
    <div className="pm-container">
      {/* =========================================================================
          VIEW 1: PROJECTS OVERVIEW (REFERENCE 1 LAYOUT)
          Active when selectedProject is null
          ========================================================================= */}
      {false ? (
        <>
          <AppHeader
            title="Employees"
            actions={
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => handleSelectProject("ALL")}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 32, padding: "0 10px", fontSize: 12.5 }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                  <span>All Employees</span>
                </button>
                {(!canImportPeople || !canCreatePeople) ? <AccessRestrictedInline /> : null}
                {canImportPeople ? (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowImportModal(true)}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 32, padding: "0 12px", fontSize: 12.5 }}
                >
                  Import
                </button>
                ) : null}
                {canCreatePeople ? (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => {
                    setNewEmployee((prev) => ({ ...prev, projectName: "" }));
                    setShowAddModal(true);
                  }}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 32, padding: "0 12px", fontSize: 12.5 }}
                >
                  <span>+</span> <span>Add Employee</span>
                </button>
                ) : null}
              </div>
            }
          />

          {/* Compact Workforce & Project Metrics Strip */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 20,
              background: "var(--card, #ffffff)",
              border: "1px solid var(--hair, #e6ede8)",
              borderRadius: 8,
              padding: "8px 16px",
              marginBottom: 16,
              fontSize: 13,
              flexWrap: "wrap",
            }}
          >
            <span style={{ color: "var(--text-muted, #646d67)" }}>
              Active Workforce: <strong style={{ color: "var(--ink, #131a15)" }}>{activeEmployeesCount}/{totalEmployeesCount}</strong>
            </span>
            <span style={{ color: "#d4d4d8" }}>•</span>
            <span style={{ color: "var(--text-muted, #646d67)" }}>
              Active Projects: <strong style={{ color: "var(--g-800, #155a37)" }}>{activeProjectsCount}/{projectsData.projectList.length}</strong>
            </span>
            <span style={{ color: "#d4d4d8" }}>•</span>
            <span style={{ color: "var(--text-muted, #646d67)" }}>
              Staffing Allocation: <strong style={{ color: "var(--g-700, #1d7347)" }}>{staffingRate}%</strong>
            </span>
          </div>

          {/* Reference 1: Main Dashboard Composition (Projects Stack + Staffing Distribution) */}
          <div className="pm-overview-grid">
            {/* LEFT / CENTER COLUMN: Projects Stream */}
            <section className="pm-projects-panel" aria-label="Active Projects Overview">
              <div className="pm-panel-header">
                <div className="pm-panel-title-group">
                  <h2>Active Projects & Portfolios</h2>
                  <p>Click any project to inspect assigned team members and roles</p>
                </div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <span className="pm-dist-badge">
                    {projectsData.projectList.length} Portfolios
                  </span>
                </div>
              </div>

              {loadingPool && projectsData.projectList.length === 0 ? (
                <div className="pm-empty-box">
                  <div className="profile-spinner" style={{ margin: "0 auto 12px" }} />
                  <p>Loading projects & staffing data...</p>
                </div>
              ) : projectsData.projectList.length === 0 ? (
                <div className="pm-empty-box">
                  <h4>No active projects found</h4>
                  <p>Assign employees to projects or create a new employee with a project name.</p>
                </div>
              ) : (
                <div className="pm-projects-list">
                  {projectsData.projectList.map((proj, idx) => {
                    const badgeClass = proj.isBench
                      ? "type-bench"
                      : proj.projectType === "RETAIL"
                      ? "type-retail"
                      : proj.projectType === "INTERNAL"
                      ? "type-internal"
                      : "type-mandate";

                    return (
                      <div
                        key={proj.name}
                        className="pm-project-row"
                        onClick={() => handleSelectProject(proj.isBench ? "ALL" : proj.name)}
                        title={`View ${proj.members.length} team members on ${proj.name}`}
                      >
                        {/* Circular Badge on Left (Reference 1 style) */}
                        <div className={`pm-project-badge-circle ${badgeClass}`}>
                          <span className="pm-circle-main">{proj.members.length}</span>
                          <span className="pm-circle-sub">staff</span>
                        </div>

                        {/* Project Info */}
                        <div className="pm-project-info">
                          <div className="pm-project-name-row">
                            <h3 className="pm-project-name">{proj.name}</h3>
                            <span
                              className={`pm-project-pill ${
                                proj.isBench
                                  ? "bench"
                                  : proj.projectType?.toLowerCase() === "retail"
                                  ? "retail"
                                  : proj.projectType?.toLowerCase() === "internal"
                                  ? "internal"
                                  : "mandate"
                              }`}
                            >
                              {proj.isBench ? "Bench" : proj.projectType || "Mandate"}
                            </span>
                          </div>

                          <div className="pm-project-subtext">
                            <span>{proj.location}</span>
                            <span className="pm-meta-dot">•</span>
                            <span>
                              {proj.lead ? `Lead: ${proj.lead.fullName}` : `${proj.members.length} Assigned`}
                            </span>
                            {proj.departments.size > 0 && (
                              <>
                                <span className="pm-meta-dot">•</span>
                                <span>{Array.from(proj.departments).slice(0, 2).join(", ")}</span>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Arrow Action Button on Right (Reference 1) */}
                        <button
                          type="button"
                          className="pm-arrow-btn"
                          aria-label={`Open ${proj.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSelectProject(proj.isBench ? "ALL" : proj.name);
                          }}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="5" y1="12" x2="19" y2="12" />
                            <polyline points="12 5 19 12 12 19" />
                          </svg>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* RIGHT COLUMN: Team Staffing Distribution (Replacing Calendar) + Leads Spotlight */}
            <aside className="pm-side-column">
              {/* Card A: Project Staffing & Team Distribution (Replacing Calendar) */}
              <div className="pm-distribution-card">
                <div className="pm-dist-title-row">
                  <h3 className="pm-dist-title">Workforce Allocation</h3>
                  <span className="pm-dist-badge">By Department</span>
                </div>

                <div className="pm-dist-list">
                  {projectsData.deptList.length === 0 ? (
                    <p style={{ fontSize: "13px", color: "var(--muted)" }}>No department data available.</p>
                  ) : (
                    projectsData.deptList.slice(0, 6).map((dept) => {
                      const pct = totalEmployeesCount > 0 ? Math.round((dept.count / totalEmployeesCount) * 100) : 0;
                      return (
                        <div key={dept.name} className="pm-dist-item">
                          <div className="pm-dist-item-head">
                            <span className="pm-dist-name" title={dept.name}>{dept.name}</span>
                            <span className="pm-dist-count">{dept.count} ({pct}%)</span>
                          </div>
                          <div className="pm-dist-track" role="progressbar" aria-valuenow={pct} aria-valuemin="0" aria-valuemax="100">
                            <div className="pm-dist-fill" style={{ width: `${Math.max(pct, 6)}%` }} />
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Card B: Project Leads & Mentors Spotlight (Matching Reference 1 Bottom Right) */}
              <div className="pm-leads-card">
                <div className="pm-leads-title-row">
                  <h3 className="pm-leads-title">Project Leads & Managers</h3>
                </div>

                <div className="pm-leads-list">
                  {projectsData.leadsList.length === 0 ? (
                    <p style={{ fontSize: "13px", color: "var(--muted)" }}>No lead records available.</p>
                  ) : (
                    projectsData.leadsList.map((lead) => (
                      <div
                        key={lead._id}
                        className="pm-lead-row"
                        onClick={() => handleViewDetails(lead._id)}
                        title={`View profile of ${lead.fullName}`}
                      >
                        <div className="pm-lead-left">
                          <AuthedAvatar
                            className="pm-lead-avatar"
                            employee={lead}
                            name={lead.fullName}
                            initials={getInitials(lead.fullName)}
                            alt={lead.fullName}
                          />
                          <div className="pm-lead-text">
                            <span className="pm-lead-name">{lead.fullName}</span>
                            <span className="pm-lead-role">
                              {lead.job?.jobTitle || "Lead"} • {lead.job?.project?.projectName || "Platform"}
                            </span>
                          </div>
                        </div>

                        <div className="pm-lead-arrow">
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="9 18 15 12 9 6" />
                          </svg>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </aside>
          </div>
        </>
      ) : (
        /* =========================================================================
           VIEW 2: PROJECT DETAILS & EMPLOYEE CARDS GRID (REFERENCE 2 LAYOUT)
           Active when selectedProject is non-null
           ========================================================================= */
        <>
          <AppHeader
            title={<><span className="m-title-full">Employees</span><span className="m-title-short">People</span></>}
            actions={<SoftRefresh active={listFetching} />}
            nav={
              <div className="dept-chip-row" role="tablist" aria-label="Filter by department">
                <button
                  type="button"
                  className={`dept-chip ${!selectedDepartment ? "is-selected" : ""}`}
                  onClick={() => {
                    setSelectedDepartment("");
                    setCurrentPage(1);
                  }}
                >
                  All <strong>{totalEmployeesCount}</strong>
                </button>
                {projectsData.deptList.map((dept) => (
                  <button
                    key={dept.name}
                    type="button"
                    className={`dept-chip ${selectedDepartment === dept.name ? "is-selected" : ""}`}
                    onClick={() => {
                      setSelectedDepartment(dept.name);
                      setCurrentPage(1);
                    }}
                  >
                    {dept.name} <strong>{dept.count}</strong>
                  </button>
                ))}
              </div>
            }
          />

          <MobileFilterBar
            search={search}
            onSearchChange={(e) => setSearch(e.target.value)}
            searchPlaceholder={SEARCH_PLACEHOLDER}
            filterCount={peopleFilterCount}
            onReset={clearPeopleFilters}
          >
            <label>
              Status
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className="filter-select"
              >
                <option value="ALL">All statuses</option>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </select>
            </label>
            <label>
              Designation
              <select
                value={jobTitleFilter}
                onChange={(e) => {
                  setJobTitleFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className="filter-select"
              >
                <option value="">All designations</option>
                {jobTitleFilter &&
                !projectsData.designationList.includes(jobTitleFilter) ? (
                  <option value={jobTitleFilter}>{jobTitleFilter}</option>
                ) : null}
                {projectsData.designationList.map((title) => (
                  <option key={title} value={title}>
                    {title}
                  </option>
                ))}
              </select>
            </label>
            <div className="pm-manager-filter">
              <ReportingManagerSelect
                filterMode
                compact
                label="Reporting manager"
                value={managerFilter}
                onChange={(next) => {
                  setManagerFilter(next);
                  setCurrentPage(1);
                }}
              />
            </div>
            <label>
              Employment type
              <select
                value={employmentTypeFilter}
                onChange={(e) => {
                  setEmploymentTypeFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className="filter-select"
              >
                <option value="">All types</option>
                {employmentTypeFilter &&
                !projectsData.employmentTypeList.includes(employmentTypeFilter) ? (
                  <option value={employmentTypeFilter}>{employmentTypeFilter}</option>
                ) : null}
                {projectsData.employmentTypeList.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Work location
              <select
                value={workLocationFilter}
                onChange={(e) => {
                  setWorkLocationFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className="filter-select"
              >
                <option value="">All locations</option>
                {workLocationFilter &&
                !projectsData.workLocationList.includes(workLocationFilter) ? (
                  <option value={workLocationFilter}>{workLocationFilter}</option>
                ) : null}
                {projectsData.workLocationList.map((loc) => (
                  <option key={loc} value={loc}>
                    {loc}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Invitation status
              <select
                value={invitationStatusFilter}
                onChange={(e) => {
                  setInvitationStatusFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className="filter-select"
              >
                <option value="">All invitation statuses</option>
                {INVITATION_STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Project type
              <select
                value={projectTypeFilter}
                onChange={(e) => {
                  setProjectTypeFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className="filter-select"
              >
                <option value="">All project types</option>
                {PROJECT_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="pm-joining-filter">
              <DateRangePicker
                label="Joining date"
                placeholder="Any joining dates"
                startDate={joiningFrom}
                endDate={joiningTo}
                onChange={({ startDate, endDate }) => {
                  setJoiningFrom(startDate || "");
                  setJoiningTo(endDate || "");
                  setCurrentPage(1);
                }}
              />
            </div>
            <label>
              Sort by
              <select
                value={sortBy}
                onChange={(e) => {
                  setSortBy(e.target.value);
                  setCurrentPage(1);
                }}
                className="filter-select"
              >
                <option value="createdAt">Date added</option>
                <option value="fullName">Name</option>
                <option value="joiningDate">Start date</option>
                <option value="employeeCode">Employee code</option>
              </select>
            </label>
            <label>
              Project
              <select
                value={selectedProject}
                onChange={(e) => applyProjectFilter(e.target.value)}
                className="filter-select"
              >
                <option value="ALL">All projects</option>
                {projectsData.projectList.map((proj) => (
                  <option key={proj.name} value={proj.isBench ? "ALL" : proj.name}>
                    {proj.name}
                  </option>
                ))}
              </select>
            </label>
          </MobileFilterBar>

          <ModuleToolbar
            searchValue={search}
            onSearchChange={(e) => setSearch(e.target.value)}
            searchPlaceholder={SEARCH_PLACEHOLDER}
            searchAriaLabel="Search employees by name, ID, email, phone, designation, department, project or location"
            actions={
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {(!canImportPeople || !canCreatePeople) ? <AccessRestrictedInline /> : null}
                {canImportPeople ? (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setShowImportModal(true)}
                  >
                    Import
                  </button>
                ) : null}
                {canCreatePeople ? (
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => {
                      setNewEmployee((prev) => ({
                        ...prev,
                        projectName: selectedProject === "ALL" ? "" : selectedProject,
                      }));
                      setShowAddModal(true);
                    }}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                    Add Employee
                  </button>
                ) : null}
              </div>
            }
            secondaryActions={
              <ColumnChooser
                columns={peopleCols.columns}
                visible={peopleCols.visible}
                onToggle={peopleCols.toggle}
                onReset={peopleCols.reset}
              />
            }
            filterCount={peopleFilterCount}
            onFiltersClear={clearPeopleFilters}
            filters={
              <>
                <label className="module-toolbar-filter-field">
                  Status
                  <select
                    className="filter-select"
                    value={statusFilter}
                    onChange={(e) => {
                      setStatusFilter(e.target.value);
                      setCurrentPage(1);
                    }}
                  >
                    <option value="ALL">All Statuses</option>
                    <option value="ACTIVE">Active</option>
                    <option value="INACTIVE">Inactive</option>
                  </select>
                </label>
                <label className="module-toolbar-filter-field">
                  Designation
                  <select
                    className="filter-select"
                    value={jobTitleFilter}
                    onChange={(e) => {
                      setJobTitleFilter(e.target.value);
                      setCurrentPage(1);
                    }}
                  >
                    <option value="">All designations</option>
                    {jobTitleFilter &&
                    !projectsData.designationList.includes(jobTitleFilter) ? (
                      <option value={jobTitleFilter}>{jobTitleFilter}</option>
                    ) : null}
                    {projectsData.designationList.map((title) => (
                      <option key={title} value={title}>
                        {title}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="module-toolbar-filter-field pm-manager-filter">
                  <ReportingManagerSelect
                    filterMode
                    compact
                    label="Reporting manager"
                    value={managerFilter}
                    onChange={(next) => {
                      setManagerFilter(next);
                      setCurrentPage(1);
                    }}
                  />
                </div>
                <label className="module-toolbar-filter-field">
                  Employment type
                  <select
                    className="filter-select"
                    value={employmentTypeFilter}
                    onChange={(e) => {
                      setEmploymentTypeFilter(e.target.value);
                      setCurrentPage(1);
                    }}
                  >
                    <option value="">All types</option>
                    {employmentTypeFilter &&
                    !projectsData.employmentTypeList.includes(employmentTypeFilter) ? (
                      <option value={employmentTypeFilter}>{employmentTypeFilter}</option>
                    ) : null}
                    {projectsData.employmentTypeList.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="module-toolbar-filter-field">
                  Work location
                  <select
                    className="filter-select"
                    value={workLocationFilter}
                    onChange={(e) => {
                      setWorkLocationFilter(e.target.value);
                      setCurrentPage(1);
                    }}
                  >
                    <option value="">All locations</option>
                    {workLocationFilter &&
                    !projectsData.workLocationList.includes(workLocationFilter) ? (
                      <option value={workLocationFilter}>{workLocationFilter}</option>
                    ) : null}
                    {projectsData.workLocationList.map((loc) => (
                      <option key={loc} value={loc}>
                        {loc}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="module-toolbar-filter-field">
                  Invitation status
                  <select
                    className="filter-select"
                    value={invitationStatusFilter}
                    onChange={(e) => {
                      setInvitationStatusFilter(e.target.value);
                      setCurrentPage(1);
                    }}
                  >
                    <option value="">All invitation statuses</option>
                    {INVITATION_STATUS_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="module-toolbar-filter-field">
                  Project type
                  <select
                    className="filter-select"
                    value={projectTypeFilter}
                    onChange={(e) => {
                      setProjectTypeFilter(e.target.value);
                      setCurrentPage(1);
                    }}
                  >
                    <option value="">All project types</option>
                    {PROJECT_TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="module-toolbar-filter-field pm-joining-filter">
                  <DateRangePicker
                    label="Joining date"
                    placeholder="Any joining dates"
                    startDate={joiningFrom}
                    endDate={joiningTo}
                    onChange={({ startDate, endDate }) => {
                      setJoiningFrom(startDate || "");
                      setJoiningTo(endDate || "");
                      setCurrentPage(1);
                    }}
                  />
                </div>
                <label className="module-toolbar-filter-field">
                  Sort by
                  <select
                    className="filter-select"
                    value={sortBy}
                    onChange={(e) => {
                      setSortBy(e.target.value);
                      setCurrentPage(1);
                    }}
                  >
                    <option value="createdAt">Date Added</option>
                    <option value="fullName">Name (A-Z)</option>
                    <option value="joiningDate">Joining Date</option>
                    <option value="employeeCode">Employee Code</option>
                  </select>
                </label>
                <label className="module-toolbar-filter-field">
                  Sort order
                  <select
                    className="filter-select"
                    value={sortOrder}
                    onChange={(e) => {
                      setSortOrder(e.target.value);
                      setCurrentPage(1);
                    }}
                  >
                    <option value="asc">Ascending</option>
                    <option value="desc">Descending</option>
                  </select>
                </label>
                <label className="module-toolbar-filter-field">
                  Project
                  <select
                    className="filter-select"
                    value={selectedProject}
                    onChange={(e) => applyProjectFilter(e.target.value)}
                  >
                    <option value="ALL">All projects</option>
                    {projectsData.projectList.map((proj) => (
                      <option key={proj.name} value={proj.isBench ? "ALL" : proj.name}>
                        {proj.name}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            }
          />

          {hasChipFilters ? (
            <div className="pm-active-filters" aria-label="Active people filters">
              <div className="pm-filter-chip-row">
                {debouncedSearch.trim() ? (
                  <button
                    type="button"
                    className="pm-filter-chip"
                    onClick={() => {
                      setSearch("");
                      setDebouncedSearch("");
                      setCurrentPage(1);
                    }}
                  >
                    Search: {debouncedSearch.trim()}
                    <span aria-hidden="true">×</span>
                  </button>
                ) : null}
                {statusFilter !== "ALL" ? (
                  <button
                    type="button"
                    className="pm-filter-chip"
                    onClick={() => {
                      setStatusFilter("ALL");
                      setCurrentPage(1);
                    }}
                  >
                    Status: {statusFilter}
                    <span aria-hidden="true">×</span>
                  </button>
                ) : null}
                {selectedDepartment.trim() ? (
                  <button
                    type="button"
                    className="pm-filter-chip"
                    onClick={() => {
                      setSelectedDepartment("");
                      setCurrentPage(1);
                    }}
                  >
                    Department: {selectedDepartment.trim()}
                    <span aria-hidden="true">×</span>
                  </button>
                ) : null}
                {selectedProject && selectedProject !== "ALL" ? (
                  <button
                    type="button"
                    className="pm-filter-chip"
                    onClick={() => {
                      setSelectedProject("ALL");
                      setCurrentPage(1);
                    }}
                  >
                    Project: {selectedProject}
                    <span aria-hidden="true">×</span>
                  </button>
                ) : null}
                {jobTitleFilter.trim() ? (
                  <button
                    type="button"
                    className="pm-filter-chip"
                    onClick={() => {
                      setJobTitleFilter("");
                      setCurrentPage(1);
                    }}
                  >
                    Designation: {jobTitleFilter.trim()}
                    <span aria-hidden="true">×</span>
                  </button>
                ) : null}
                {managerFilter === "none" ? (
                  <button
                    type="button"
                    className="pm-filter-chip"
                    onClick={() => {
                      setManagerFilter(null);
                      setCurrentPage(1);
                    }}
                  >
                    Manager: Unassigned
                    <span aria-hidden="true">×</span>
                  </button>
                ) : null}
                {managerFilter && managerFilter !== "none" ? (
                  <button
                    type="button"
                    className="pm-filter-chip"
                    onClick={() => {
                      setManagerFilter(null);
                      setCurrentPage(1);
                    }}
                  >
                    Manager: Direct reports
                    <span aria-hidden="true">×</span>
                  </button>
                ) : null}
                {employmentTypeFilter.trim() ? (
                  <button
                    type="button"
                    className="pm-filter-chip"
                    onClick={() => {
                      setEmploymentTypeFilter("");
                      setCurrentPage(1);
                    }}
                  >
                    Type: {employmentTypeFilter.trim()}
                    <span aria-hidden="true">×</span>
                  </button>
                ) : null}
                {workLocationFilter.trim() ? (
                  <button
                    type="button"
                    className="pm-filter-chip"
                    onClick={() => {
                      setWorkLocationFilter("");
                      setCurrentPage(1);
                    }}
                  >
                    Location: {workLocationFilter.trim()}
                    <span aria-hidden="true">×</span>
                  </button>
                ) : null}
                {invitationStatusFilter ? (
                  <button
                    type="button"
                    className="pm-filter-chip"
                    onClick={() => {
                      setInvitationStatusFilter("");
                      setCurrentPage(1);
                    }}
                  >
                    Invitation: {invitationStatusLabel(invitationStatusFilter)}
                    <span aria-hidden="true">×</span>
                  </button>
                ) : null}
                {joiningFrom || joiningTo ? (
                  <button
                    type="button"
                    className="pm-filter-chip"
                    onClick={() => {
                      setJoiningFrom("");
                      setJoiningTo("");
                      setCurrentPage(1);
                    }}
                  >
                    Joined: {[joiningFrom, joiningTo].filter(Boolean).join(" → ")}
                    <span aria-hidden="true">×</span>
                  </button>
                ) : null}
                {projectTypeFilter ? (
                  <button
                    type="button"
                    className="pm-filter-chip"
                    onClick={() => {
                      setProjectTypeFilter("");
                      setCurrentPage(1);
                    }}
                  >
                    Project type: {projectTypeLabel(projectTypeFilter)}
                    <span aria-hidden="true">×</span>
                  </button>
                ) : null}
              </div>
              <button type="button" className="pm-filter-chip-clear" onClick={clearPeopleFilters}>
                Clear all
              </button>
            </div>
          ) : null}

          {/* Feedback messages */}
          {successMsg && <div className="success-alert">{successMsg}</div>}
          {error && (
            <div className="table-error-banner" style={{ marginBottom: "16px" }}>
              <span>{error}</span>
              <button
                type="button"
                className="btn-sm-retry"
                onClick={() => {
                  summaryQuery.refetch();
                  poolQuery.refetch();
                  employeesQuery.refetch();
                }}
              >
                Retry
              </button>
            </div>
          )}

          <div className="pm-results-meta" aria-live="polite">
            <strong>{pagination.totalEmployees}</strong>
            {" "}
            result{pagination.totalEmployees === 1 ? "" : "s"}
            {hasChipFilters ? " matching current filters" : ""}
            {pagination.totalPages > 1
              ? ` · Page ${pagination.page || currentPage} of ${pagination.totalPages}`
              : ""}
          </div>

          {/* -------------------------------------------------------------------
              REFERENCE 2: RESPONSIVE EMPLOYEE PROFILE CARDS GRID
              ------------------------------------------------------------------- */}
          <>
            <div className="pm-emp-cards-mobile">
              {loading && employees.length === 0 ? (
                <div className="pm-empty-box">
                  <div className="profile-spinner" style={{ margin: "0 auto 12px" }} />
                  <p>Loading employee profiles...</p>
                </div>
              ) : employees.length === 0 ? (
                <div className="pm-empty-box">
                  <h4>No employees found</h4>
                  <p>
                    {hasChipFilters
                      ? "No employees match your search or filter criteria."
                      : "No employees on this project yet."}
                  </p>
                  {hasChipFilters ? (
                    <button
                      type="button"
                      className="btn-secondary"
                      style={{ marginTop: "12px" }}
                      onClick={clearPeopleFilters}
                    >
                      Clear Filters
                    </button>
                  ) : null}
                </div>
              ) : (
                <div className="pm-emp-grid">
                  {employees.map((emp) => {
                    const isActive = emp.status === "ACTIVE";
                    return (
                      <div
                        key={emp._id}
                        className="pm-emp-card"
                        role="link"
                        tabIndex={0}
                        onClick={() => handleViewDetails(emp._id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            handleViewDetails(emp._id);
                          }
                        }}
                      >
                        <span className="m-card-chevron m-chevron" aria-hidden="true" />
                        {/* Top Indicator & Status Badge */}
                        <div className="pm-emp-card-top">
                          <span
                            className="pm-emp-dot-indicator"
                            style={{ background: isActive ? "var(--g-600)" : "var(--muted)" }}
                          />
                          <span className={`pm-emp-status-badge ${isActive ? "active" : "inactive"}`}>
                            {emp.status || "ACTIVE"}
                          </span>
                        </div>

                        {/* Avatar & Identity Row */}
                        <div className="pm-emp-avatar-row">
                          <AuthedAvatar
                            className="pm-emp-avatar"
                            employee={emp}
                            name={emp.fullName}
                            initials={getInitials(emp.fullName)}
                            alt={emp.fullName}
                          />
                          <div className="pm-emp-identity">
                            <span
                              className="pm-emp-name"
                              onClick={() => handleViewDetails(emp._id)}
                              title={emp.fullName}
                            >
                              {emp.fullName}
                            </span>
                            <span className="pm-emp-title" title={emp.job?.jobTitle || "Team Member"}>
                              {emp.job?.jobTitle || "Team Member"}
                            </span>
                          </div>
                        </div>

                        {/* 2-Column Meta Grid (Department & Date of Joining) */}
                        <div className="pm-emp-meta-grid">
                          <div className="pm-emp-meta-col">
                            <span className="pm-emp-meta-lbl">DEPARTMENT</span>
                            <span className="pm-emp-meta-val" title={emp.job?.department || "General"}>
                              {emp.job?.department || "General"}
                            </span>
                          </div>
                          <div className="pm-emp-meta-col">
                            <span className="pm-emp-meta-lbl">MANAGER</span>
                            <span className="pm-emp-meta-val">
                              <ManagerCell employee={emp} />
                            </span>
                          </div>
                        </div>

                        {/* Contact Box (Email & Phone) */}
                        <div className="pm-emp-contact-box">
                          <div className="pm-emp-contact-row" title={emp.email}>
                            <svg className="pm-emp-contact-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                              <polyline points="22,6 12,13 2,6" />
                            </svg>
                            <span className="pm-emp-contact-val">{emp.email}</span>
                          </div>

                          <div className="pm-emp-contact-row">
                            <svg className="pm-emp-contact-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                            </svg>
                            <span className="pm-emp-contact-val">
                              {emp.phoneNumber || "Not provided"}
                            </span>
                          </div>
                        </div>

                        {/* Card Actions: Edit & View (Reference 2 style) */}
                        <div className="pm-emp-card-actions">
                          <button
                            type="button"
                            className="pm-card-btn-edit"
                            onClick={(event) => {
                              event.stopPropagation();
                              handleOpenEdit(emp);
                            }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="pm-card-btn-view"
                            onClick={(event) => {
                              event.stopPropagation();
                              handleViewDetails(emp._id);
                            }}
                          >
                            <span className="m-title-full">View</span>
                            <span className="m-title-short">View details</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="pm-emp-table-desktop">
            <div className="data-table-container table-wrapper-relative">
              {loading && employees.length === 0 ? (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Code</th>
                      <th>Department</th>
                      <th>Designation</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    <TableSkeletonRows rows={8} cols={6} />
                  </tbody>
                </table>
              ) : employees.length === 0 ? (
                <div className="table-empty-state">
                  <h3>No employees found</h3>
                  <p>
                    {hasChipFilters
                      ? "No employees match the current filters. Try clearing a filter or broadening your search."
                      : "Add the first employee to start the directory."}
                  </p>
                  {hasChipFilters ? (
                    <button
                      type="button"
                      className="btn-secondary"
                      style={{ marginTop: 12 }}
                      onClick={clearPeopleFilters}
                    >
                      Clear all filters
                    </button>
                  ) : null}
                </div>
              ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    {visibleColumns.employeeCode && <th>Code</th>}
                    {visibleColumns.fullName && <th>Full Name</th>}
                    {visibleColumns.email && <th>Email</th>}
                    {visibleColumns.phoneNumber && <th>Phone</th>}
                    {visibleColumns.jobTitle && <th>Designation</th>}
                    {visibleColumns.department && <th>Department</th>}
                    {visibleColumns.manager && <th>Manager</th>}
                    {visibleColumns.project && <th>Project</th>}
                    {visibleColumns.status && <th>Status</th>}
                    {visibleColumns.invitation && <th>Invitation</th>}
                    {visibleColumns.salary && <th>Salary</th>}
                    {visibleColumns.joiningDate && <th>Start Date</th>}
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {employees.map((emp) => (
                    <tr key={emp._id}>
                      {visibleColumns.employeeCode && <td><strong>{emp.employeeCode}</strong></td>}
                      {visibleColumns.fullName && (
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <AuthedAvatar
                              className="pm-emp-avatar"
                              style={{ width: 32, height: 32, fontSize: 11 }}
                              employee={emp}
                              name={emp.fullName}
                              initials={getInitials(emp.fullName)}
                              alt={emp.fullName}
                            />
                            <button
                              type="button"
                              className="btn-secondary"
                              style={{ background: "transparent", border: 0, boxShadow: "none", padding: 0, color: "var(--ink)", fontWeight: 650 }}
                              onClick={() => handleViewDetails(emp._id)}
                            >
                              {emp.fullName}
                            </button>
                          </div>
                        </td>
                      )}
                      {visibleColumns.email && <td>{emp.email}</td>}
                      {visibleColumns.phoneNumber && <td>{emp.phoneNumber || "—"}</td>}
                      {visibleColumns.jobTitle && <td>{emp.job?.jobTitle || "—"}</td>}
                      {visibleColumns.department && <td>{emp.job?.department || "General"}</td>}
                      {visibleColumns.manager && (
                        <td>
                          <ManagerCell employee={emp} />
                        </td>
                      )}
                      {visibleColumns.project && <td>{emp.job?.project?.projectName || "—"}</td>}
                      {visibleColumns.status && <td><StatusBadge status={emp.status} /></td>}
                      {visibleColumns.invitation && (
                        <td>
                          <StatusBadge
                            status={emp.invitation?.status || "PENDING"}
                            label={
                              emp.invitation?.status === "ACCEPTED"
                                ? "Accepted"
                                : emp.invitation?.status === "DELIVERY_FAILED"
                                ? "Delivery Failed"
                                : "Invite Pending"
                            }
                          />
                        </td>
                      )}
                      {visibleColumns.salary && (
                        <td>
                          <span style={{ fontWeight: "500" }}>
                            {formatCurrency(emp.currentMonthlySalary)}
                          </span>
                        </td>
                      )}
                      {visibleColumns.joiningDate && <td>{formatDate(emp.job?.joiningDate)}</td>}
                      <td>
                        <div className="row-actions">
                          <button
                            type="button"
                            className="btn-secondary btn-sm"
                            onClick={() => handleViewDetails(emp._id)}
                          >
                            Details
                          </button>
                          <button
                            type="button"
                            className="btn-secondary btn-sm"
                            onClick={() => handleOpenEdit(emp)}
                          >
                            Edit
                          </button>
                          {emp.invitation?.status !== "ACCEPTED" && (
                            <button
                              type="button"
                              className="btn-secondary btn-sm"
                              disabled={resendingId === emp._id}
                              onClick={() => handleResendInvite(emp._id)}
                            >
                              {resendingId === emp._id ? "Sending..." : "Resend"}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              )}
            </div>
            </div>
          </>

          {/* Bottom Pagination */}
          {pagination.totalEmployees > 0 && (
            <Pagination
              currentPage={pagination.page}
              totalPages={pagination.totalPages}
              totalItems={pagination.totalEmployees}
              pageSize={pagination.limit}
              pageSizeOptions={PAGE_SIZE_OPTIONS}
              onPageChange={(p) => setCurrentPage(p)}
              onPageSizeChange={(s) => {
                setPageSize(s);
                setCurrentPage(1);
              }}
              itemLabel="employees"
            />
          )}
        </>
      )}

      {/* =========================================================================
          Add Employee Modal (Preserved HR Creation & Invitation Workflow)
          ========================================================================= */}
      {showAddModal && (
        <div className="modal-overlay" onClick={handleCloseAddModal}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "620px" }}>
            <div className="modal-header">
              <h2>{createdInvitationInfo ? "Activation Link Ready" : "Add Employee"}</h2>
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={handleCloseAddModal}
                aria-label="Close modal"
              >
                <IconClose size={14} />
              </button>
            </div>

            {addError && <div className="error">{addError}</div>}

            {createdInvitationInfo ? (
              <div style={{ padding: "8px 0" }}>
                <div style={{ textAlign: "center", marginBottom: "20px" }}>
                  <div
                    style={{
                      width: "48px",
                      height: "48px",
                      borderRadius: "50%",
                      background: "var(--g-100)",
                      color: "var(--g-800)",
                      border: "1px solid rgba(21, 90, 55, 0.2)",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      marginBottom: "12px",
                    }}
                  >
                    <IconCheck size={24} />
                  </div>
                  <h3 style={{ margin: "0 0 6px", fontSize: "17px", color: "var(--ink)" }}>
                    Employee Created Successfully
                  </h3>
                  <p style={{ margin: 0, fontSize: "13.5px", color: "var(--muted)" }}>
                    {createdInvitationInfo.employee?.fullName} ({createdInvitationInfo.employee?.employeeCode})
                  </p>
                </div>

                <div
                  style={{
                    background: "var(--panel)",
                    border: "1px solid var(--hair)",
                    borderRadius: "8px",
                    padding: "16px",
                    marginBottom: "18px",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "10px", fontSize: "13px" }}>
                    <span style={{ color: "var(--muted)" }}>Email</span>
                    <strong style={{ color: "var(--ink)" }}>{createdInvitationInfo.employee?.email}</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "14px", fontSize: "13px", alignItems: "center" }}>
                    <span style={{ color: "var(--muted)" }}>Account Status</span>
                    <StatusBadge
                      status="PENDING"
                      label="Pending Activation"
                    />
                  </div>

                  <label style={{ fontSize: "12px", color: "var(--muted)", display: "block", marginBottom: "6px" }}>
                    Activation Link (Valid for 7 days)
                  </label>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <input
                      readOnly
                      value={
                        createdInvitationInfo.activation?.activationLink ||
                        createdInvitationInfo.invitation?.inviteLink ||
                        ""
                      }
                      style={{
                        background: "#ffffff",
                        border: "1px solid var(--hair)",
                        color: "var(--ink)",
                        fontSize: "12px",
                        padding: "8px 10px",
                        flex: 1,
                        borderRadius: "6px",
                      }}
                    />
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => {
                        const link =
                          createdInvitationInfo.activation?.activationLink ||
                          createdInvitationInfo.invitation?.inviteLink;
                        if (link) {
                          navigator.clipboard?.writeText(link);
                          setCopiedInvite(true);
                          setTimeout(() => setCopiedInvite(false), 3000);
                        }
                      }}
                      style={{ whiteSpace: "nowrap" }}
                    >
                      {copiedInvite ? "Copied" : "Copy Link"}
                    </button>
                  </div>
                  <p style={{ margin: "10px 0 0", fontSize: "12px", color: "var(--muted)" }}>
                    Share this link so the employee can set their password and activate login. No email is sent automatically.
                  </p>
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                  <button type="button" className="btn-primary" onClick={handleCloseAddModal}>
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleCreateEmployee} className="auth-form" noValidate>
                {newEmployee.offerLetterId && (
                  <div style={{
                    marginBottom: "16px",
                    padding: "10px 14px",
                    background: "var(--g-100)",
                    border: "1px solid rgba(29, 115, 71, 0.25)",
                    borderRadius: "8px",
                    color: "var(--g-800)",
                    fontSize: "13px",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                  }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                      <polyline points="22 4 12 14.01 9 11.01" />
                    </svg>
                    <span><strong>Linked Offer:</strong> Details prefilled from accepted offer letter.</span>
                  </div>
                )}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                  <label>
                    Full Name *
                    <input
                      className={addFieldErrors.fullName ? "has-error" : ""}
                      value={newEmployee.fullName}
                      onChange={(e) => {
                        setNewEmployee({ ...newEmployee, fullName: e.target.value });
                        if (addFieldErrors.fullName) setAddFieldErrors((prev) => ({ ...prev, fullName: "" }));
                        if (addError) setAddError("");
                      }}
                      placeholder="e.g. Maya Rao"
                      required
                    />
                    {addFieldErrors.fullName && (
                      <span className="field-error">{addFieldErrors.fullName}</span>
                    )}
                  </label>
                  <label>
                    Employee Code *
                    <input
                      className={addFieldErrors.employeeCode ? "has-error" : ""}
                      value={newEmployee.employeeCode}
                      onChange={(e) => {
                        setNewEmployee({ ...newEmployee, employeeCode: e.target.value });
                        if (addFieldErrors.employeeCode) setAddFieldErrors((prev) => ({ ...prev, employeeCode: "" }));
                        if (addError) setAddError("");
                      }}
                      placeholder="e.g. EMP-004"
                      required
                    />
                    {addFieldErrors.employeeCode && (
                      <span className="field-error">{addFieldErrors.employeeCode}</span>
                    )}
                  </label>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                  <label>
                    Email *
                    <input
                      type="email"
                      className={addFieldErrors.email ? "has-error" : ""}
                      value={newEmployee.email}
                      onChange={(e) => {
                        setNewEmployee({ ...newEmployee, email: e.target.value });
                        if (addFieldErrors.email) setAddFieldErrors((prev) => ({ ...prev, email: "" }));
                        if (addError) setAddError("");
                      }}
                      placeholder="maya@company.com"
                      required
                    />
                    {addFieldErrors.email && (
                      <span className="field-error">{addFieldErrors.email}</span>
                    )}
                  </label>
                  <DesignationFields
                    jobTitle={newEmployee.jobTitle}
                    jobGrade={newEmployee.jobGrade}
                    onJobTitleChange={(jobTitle) => setNewEmployee((prev) => ({ ...prev, jobTitle }))}
                    onJobGradeChange={(jobGrade) => setNewEmployee((prev) => ({ ...prev, jobGrade }))}
                  />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                  <DepartmentSelect
                    departmentId={newEmployee.departmentId}
                    departmentName={newEmployee.department}
                    linked={Boolean(newEmployee.departmentId)}
                    onChange={(next) => setNewEmployee((prev) => ({
                      ...prev,
                      departmentId: next.departmentId,
                      department: next.clearDepartment ? "" : next.departmentName || prev.department,
                    }))}
                  />
                  <label>
                    Employment Type
                    <select
                      value={newEmployee.employmentType}
                      onChange={(e) =>
                        setNewEmployee({ ...newEmployee, employmentType: e.target.value })
                      }
                      className="filter-select"
                    >
                      <option value="Full-time">Full-time</option>
                      <option value="Part-time">Part-time</option>
                      <option value="Contract">Contract</option>
                      <option value="Intern">Intern</option>
                    </select>
                  </label>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                  <label>
                    Start Date
                    <input
                      type="date"
                      className={addFieldErrors.joiningDate ? "has-error" : ""}
                      value={newEmployee.joiningDate}
                      onChange={(e) => {
                        setNewEmployee({ ...newEmployee, joiningDate: e.target.value });
                        if (addFieldErrors.joiningDate) setAddFieldErrors((prev) => ({ ...prev, joiningDate: "" }));
                        if (addError) setAddError("");
                      }}
                    />
                    {addFieldErrors.joiningDate && (
                      <span className="field-error">{addFieldErrors.joiningDate}</span>
                    )}
                  </label>
                  <label>
                    Monthly Salary (₹)
                    <input
                      type="number"
                      className={addFieldErrors.monthlySalary ? "has-error" : ""}
                      value={newEmployee.monthlySalary}
                      onChange={(e) => {
                        setNewEmployee({ ...newEmployee, monthlySalary: e.target.value });
                        if (addFieldErrors.monthlySalary) setAddFieldErrors((prev) => ({ ...prev, monthlySalary: "" }));
                        if (addError) setAddError("");
                      }}
                      placeholder="e.g. 75000"
                      min="0"
                    />
                    {addFieldErrors.monthlySalary && (
                      <span className="field-error">{addFieldErrors.monthlySalary}</span>
                    )}
                  </label>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                  <label>
                    Project
                    <input
                      value={newEmployee.projectName}
                      onChange={(e) =>
                        setNewEmployee({ ...newEmployee, projectName: e.target.value })
                      }
                      placeholder="e.g. Core Banking Platform"
                    />
                  </label>
                  <div style={{ fontSize: 12.5, color: "var(--muted)", alignSelf: "end", paddingBottom: 10 }}>
                    After creation you will get an activation link to share. The employee sets their own password.
                  </div>
                </div>

                <div style={{ marginTop: 4 }}>
                  <ReportingManagerSelect
                    value={newEmployee.reportingManagerId}
                    disabled={savingAdd}
                    error={addFieldErrors.reportingManagerId || ""}
                    onChange={(nextId) => {
                      setNewEmployee((prev) => ({ ...prev, reportingManagerId: nextId }));
                      if (addFieldErrors.reportingManagerId) {
                        setAddFieldErrors((prev) => ({ ...prev, reportingManagerId: "" }));
                      }
                      if (addError) setAddError("");
                    }}
                  />
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "16px" }}>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={handleCloseAddModal}
                  >
                    Cancel
                  </button>
                  <button type="submit" disabled={savingAdd} className="btn-primary">
                    {savingAdd ? "Adding..." : "Add Employee"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {showImportModal && (
        <div className="modal-overlay" onClick={handleCloseImportModal}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "760px" }}>
            <div className="modal-header">
              <h2>Import Employees</h2>
              <button type="button" className="btn-secondary btn-sm" onClick={handleCloseImportModal} aria-label="Close">
                <IconClose size={14} />
              </button>
            </div>

            {importError && <div className="error">{importError}</div>}

            {!importResult && (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <p style={{ margin: 0, fontSize: 13.5, color: "var(--muted)" }}>
                  Upload a CSV or Excel file. Prefer the HRMS template headers, or common aliases such as
                  employee_id→code, name, title, hire_date, salary, location, manager_id. Email is required
                  for account provisioning — rows without email are shown in preview with field errors and
                  are not imported. Activation links appear only after a successful create.
                </p>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <a
                    className="btn-secondary"
                    href={`${api.defaults.baseURL || "/api"}/employees/import/template`}
                    onClick={async (e) => {
                      e.preventDefault();
                      try {
                        const res = await api.get("/employees/import/template", { responseType: "blob" });
                        const url = URL.createObjectURL(res.data);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = "employee-import-template.csv";
                        a.click();
                        URL.revokeObjectURL(url);
                      } catch {
                        setImportError("Could not download the template.");
                      }
                    }}
                    style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", height: 34, padding: "0 12px" }}
                  >
                    Download HRMS template
                  </a>
                  <label className="btn-primary" style={{ cursor: "pointer", height: 34, padding: "0 12px", display: "inline-flex", alignItems: "center" }}>
                    {importBusy ? "Working..." : "Choose file"}
                    <input
                      type="file"
                      accept=".csv,.txt,.xlsx,.xls"
                      hidden
                      disabled={importBusy}
                      onChange={(e) => handleImportFile(e.target.files?.[0])}
                    />
                  </label>
                </div>

                {importPreview && (
                  <>
                    <div style={{ fontSize: 13, color: "var(--ink)" }}>
                      Total {importPreview.summary?.totalRows ?? 0} · Valid {importPreview.summary?.validRows ?? 0} · Invalid {importPreview.summary?.invalidRows ?? 0}
                    </div>
                    {(importPreview.unrecognizedColumns || importPreview.summary?.unrecognizedColumns || []).length >
                    0 ? (
                      <div
                        style={{
                          fontSize: 12.5,
                          color: "#92400e",
                          background: "#fffbeb",
                          border: "1px solid #fde68a",
                          borderRadius: 8,
                          padding: "8px 10px",
                        }}
                      >
                        Unsupported columns were kept in the file but are not imported:{" "}
                        {(importPreview.unrecognizedColumns || importPreview.summary?.unrecognizedColumns || []).join(
                          ", "
                        )}
                        . Use the HRMS template headers or documented aliases.
                      </div>
                    ) : null}
                    <div style={{ maxHeight: 320, overflow: "auto", border: "1px solid var(--hair)", borderRadius: 8 }}>
                      <table className="data-table" style={{ width: "100%", fontSize: 12.5, borderCollapse: "collapse" }}>
                        <thead>
                          <tr style={{ background: "#f8faf8", textAlign: "left" }}>
                            <th style={{ padding: "8px 10px" }}>#</th>
                            <th style={{ padding: "8px 10px" }}>Name</th>
                            <th style={{ padding: "8px 10px" }}>Email</th>
                            <th style={{ padding: "8px 10px" }}>Code</th>
                            <th style={{ padding: "8px 10px" }}>Department</th>
                            <th style={{ padding: "8px 10px" }}>Title</th>
                            <th style={{ padding: "8px 10px" }}>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(importPreview.rows || []).map((r) => (
                            <tr
                              key={r.rowIndex}
                              style={{
                                borderTop: "1px solid var(--hair)",
                                background: r.valid ? "transparent" : "rgba(185, 28, 28, 0.04)",
                              }}
                            >
                              <td style={{ padding: "8px 10px" }}>{r.rowIndex + 1}</td>
                              <td style={{ padding: "8px 10px" }}>{r.data?.fullName || "—"}</td>
                              <td style={{ padding: "8px 10px" }}>{r.data?.email || "—"}</td>
                              <td style={{ padding: "8px 10px" }}>{r.data?.employeeCode || "—"}</td>
                              <td style={{ padding: "8px 10px" }}>{r.data?.department || "—"}</td>
                              <td style={{ padding: "8px 10px" }}>{r.data?.jobTitle || "—"}</td>
                              <td style={{ padding: "8px 10px", color: r.valid ? "var(--g-800)" : "#b91c1c" }}>
                                {r.valid
                                  ? "Valid"
                                  : Object.entries(r.errors || {})
                                      .map(([field, msg]) => `${field}: ${msg}`)
                                      .join("; ")}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                      <button type="button" className="btn-secondary" onClick={handleCloseImportModal}>
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="btn-primary"
                        disabled={importBusy || !(importPreview.summary?.validRows > 0)}
                        onClick={handleCommitImport}
                      >
                        {importBusy ? "Importing..." : `Import ${importPreview.summary?.validRows || 0} valid row(s)`}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {importResult && (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div style={{ fontSize: 13.5, color: "var(--ink)" }}>
                  Created {importResult.summary?.createdCount ?? 0} · Failed {importResult.summary?.failedCount ?? 0} · Invalid {importResult.summary?.invalidRows ?? 0}
                </div>
                {(importResult.created || []).length > 0 && (
                  <div style={{ maxHeight: 240, overflow: "auto", border: "1px solid var(--hair)", borderRadius: 8 }}>
                    <table className="data-table" style={{ width: "100%", fontSize: 12.5, borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ background: "#f8faf8", textAlign: "left" }}>
                          <th style={{ padding: "8px 10px" }}>Employee</th>
                          <th style={{ padding: "8px 10px" }}>Email</th>
                          <th style={{ padding: "8px 10px" }}>Activation</th>
                        </tr>
                      </thead>
                      <tbody>
                        {importResult.created.map((c) => (
                          <tr key={c.employeeId} style={{ borderTop: "1px solid var(--hair)" }}>
                            <td style={{ padding: "8px 10px" }}>{c.fullName} ({c.employeeCode})</td>
                            <td style={{ padding: "8px 10px" }}>{c.email}</td>
                            <td style={{ padding: "8px 10px" }}>
                              <button
                                type="button"
                                className="btn-secondary btn-sm"
                                onClick={() => {
                                  navigator.clipboard?.writeText(c.activationLink);
                                  setCopiedActivationId(c.employeeId);
                                  setTimeout(() => setCopiedActivationId(null), 2500);
                                }}
                              >
                                {copiedActivationId === c.employeeId ? "Copied" : "Copy link"}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {(importResult.failed || []).length > 0 && (
                  <div style={{ fontSize: 12.5, color: "#b91c1c" }}>
                    {(importResult.failed || []).slice(0, 8).map((f) => (
                      <div key={f.rowIndex}>
                        Row {f.rowIndex + 1}: {Object.values(f.errors || {}).join("; ")}
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button type="button" className="btn-primary" onClick={handleCloseImportModal}>
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
