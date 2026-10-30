import { useEffect, useState, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import AppHeader from "../components/AppHeader";
import SoftRefresh from "../components/SoftRefresh";
import StatusBadge from "../components/StatusBadge";
import Pagination from "../components/Pagination";
import { IconClose, IconCheck } from "../components/Icons";
import { TableSkeletonRows } from "../components/TableSkeleton";
import api from "../services/api";
import {
  useEmployeesSummaryQuery,
  useEmployeesPoolQuery,
  useEmployeesQuery,
} from "../hooks/useAdminQueries";
import { invalidateEmployees } from "../lib/queryKeys";
import "./PeopleManagement.css";
import MobileFilterBar from "../components/mobile/MobileFilterBar";

const PAGE_SIZE_OPTIONS = [8, 12, 24, 48, 100];

const AVAILABLE_COLUMNS = [
  { id: "employeeCode", label: "Code" },
  { id: "fullName", label: "Full Name" },
  { id: "email", label: "Email" },
  { id: "phoneNumber", label: "Phone" },
  { id: "jobTitle", label: "Designation" },
  { id: "department", label: "Department" },
  { id: "project", label: "Project" },
  { id: "status", label: "Status" },
  { id: "invitation", label: "Invitation" },
  { id: "salary", label: "Monthly Salary" },
  { id: "joiningDate", label: "Joining Date" },
];

export default function AdminHome() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const onboardOfferId = searchParams.get("onboardOfferId");
  const projectParam = searchParams.get("project");

  // Selected project state: null = Projects Overview (Ref 1), string = Project Details (Ref 2)
  const [selectedProject, setSelectedProject] = useState(projectParam || "ALL");
  const [selectedDepartment, setSelectedDepartment] = useState("");

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const initialStatus = searchParams.get("status") ? searchParams.get("status").toUpperCase() : "ALL";
  const [statusFilter, setStatusFilter] = useState(
    ["ACTIVE", "INACTIVE", "ALL"].includes(initialStatus) ? initialStatus : "ALL"
  );
  const [sortBy, setSortBy] = useState("createdAt");
  const [sortOrder, setSortOrder] = useState("desc");
  const [pageSize, setPageSize] = useState(12);
  const [currentPage, setCurrentPage] = useState(1);

  const [visibleColumns, setVisibleColumns] = useState({
    employeeCode: true,
    fullName: true,
    email: false,
    phoneNumber: false,
    jobTitle: true,
    department: true,
    project: false,
    status: true,
    invitation: false,
    salary: false,
    joiningDate: false,
  });
  const [showColumnPicker, setShowColumnPicker] = useState(false);

  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // Add Employee Modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [savingAdd, setSavingAdd] = useState(false);
  const [addError, setAddError] = useState("");
  const [addFieldErrors, setAddFieldErrors] = useState({});
  const [showNewEmpPassword, setShowNewEmpPassword] = useState(false);
  const [createdInvitationInfo, setCreatedInvitationInfo] = useState(null);
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [resendingId, setResendingId] = useState(null);

  const [newEmployee, setNewEmployee] = useState({
    fullName: "",
    employeeCode: "",
    email: "",
    jobTitle: "",
    department: "",
    employmentType: "Full-time",
    joiningDate: "",
    projectName: "",
    monthlySalary: "",
    password: "",
    offerLetterId: null,
  });

  // Keep URL searchParams synchronized with selectedProject
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
    setSearchParams(searchParams, { replace: true });
  };

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
            department: offer.department || "",
            employmentType: "Full-time",
            workLocation: offer.workLocation || "",
            joiningDate: offer.joiningDate ? new Date(offer.joiningDate).toISOString().slice(0, 10) : "",
            projectName: "",
            monthlySalary: offer.monthlySalary ? String(offer.monthlySalary) : "",
            password: "",
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

  // Debounce search
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(search);
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

    return { projectList, deptList, leadsList };
  }, [allEmployeesPool]);

  const toggleColumn = (columnId) => {
    setVisibleColumns((prev) => ({
      ...prev,
      [columnId]: !prev[columnId],
    }));
  };

  const handleViewDetails = (empId) => {
    navigate(`/admin/employees/${empId}`);
  };

  const handleOpenEdit = (emp) => {
    navigate(`/admin/employees/${emp._id}/edit`);
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

    if (newEmployee.password && newEmployee.password.length < 8) {
      errors.password = "Initial password must be at least 8 characters long.";
    }

    if (Object.keys(errors).length > 0) {
      setAddFieldErrors(errors);
      return;
    }

    setSavingAdd(true);

    try {
      const response = await api.post("/employees", {
        ...newEmployee,
        fullName: newEmployee.fullName.trim(),
        employeeCode: newEmployee.employeeCode.trim(),
        email: newEmployee.email.trim(),
        offerLetterId: newEmployee.offerLetterId || undefined,
      });

      setSuccessMsg("Employee created successfully! Onboarding invitation generated.");
      setCreatedInvitationInfo({
        employee: response.data?.employee,
        invitation: response.data?.invitation,
      });
      invalidateEmployees(queryClient);
    } catch (err) {
      if (!err.response || err.code === "ERR_NETWORK" || err.response.status >= 500) {
        setAddError("We're unable to connect right now. Please try again in a moment.");
      } else if (err.response.status === 403) {
        setAddError("Account creation blocked: you lack permission or the company workspace is unavailable.");
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
      department: "",
      employmentType: "Full-time",
      joiningDate: "",
      projectName: "",
      monthlySalary: "",
      password: "",
      offerLetterId: null,
    });
    if (onboardOfferId) {
      searchParams.delete("onboardOfferId");
      setSearchParams(searchParams, { replace: true });
    }
    setShowNewEmpPassword(false);
    setAddFieldErrors({});
    setAddError("");
    setCopiedInvite(false);
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
                          <div className="pm-lead-avatar">
                            {getInitials(lead.fullName)}
                          </div>
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
            actions={
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <SoftRefresh active={listFetching} />
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
              </div>
            }
          />

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

          <MobileFilterBar
            search={search}
            onSearchChange={(e) => setSearch(e.target.value)}
            searchPlaceholder="Search by name or role"
            filterCount={(statusFilter !== "ALL" ? 1 : 0) + (selectedProject && selectedProject !== "ALL" ? 1 : 0)}
            onReset={() => {
              setStatusFilter("ALL");
              setSortBy("createdAt");
              setSortOrder("desc");
              setSelectedProject("ALL");
              setCurrentPage(1);
            }}
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
                onChange={(e) => handleSelectProject(e.target.value)}
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

          {/* Reference 2 Toolbar: Search, Filters, Sorting, View Toggle */}
          <div className="pm-cards-toolbar">
            <div className="pm-toolbar-left">
              {/* Search by name/position */}
              <div style={{ position: "relative", minWidth: "260px" }}>
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name, role, email..."
                  className="search-input"
                  style={{ width: "100%", paddingLeft: "34px" }}
                />
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ position: "absolute", left: "11px", top: "50%", transform: "translateY(-50%)", color: "var(--muted)" }}
                >
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </div>

              {/* Status Filter */}
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className="filter-select"
              >
                <option value="ALL">All Statuses</option>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </select>

              {/* Sort By Dropdown */}
              <select
                value={sortBy}
                onChange={(e) => {
                  setSortBy(e.target.value);
                  setCurrentPage(1);
                }}
                className="filter-select"
              >
                <option value="createdAt">Sort by: Date Added</option>
                <option value="fullName">Sort by: Name (A-Z)</option>
                <option value="joiningDate">Sort by: Joining Date</option>
                <option value="employeeCode">Sort by: Employee Code</option>
              </select>

              {/* Sort Order */}
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"))}
                title="Toggle Sort Direction"
              >
                {sortOrder === "asc" ? "Asc ↑" : "Desc ↓"}
              </button>
            </div>

            <div className="pm-toolbar-right">
              <select
                value={selectedProject}
                onChange={(e) => handleSelectProject(e.target.value)}
                className="filter-select"
                aria-label="Filter by project"
              >
                <option value="ALL">All projects</option>
                {projectsData.projectList.map((proj) => (
                  <option key={proj.name} value={proj.isBench ? "ALL" : proj.name}>
                    {proj.name}
                  </option>
                ))}
              </select>
              <div className="column-visibility-container">
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={() => setShowColumnPicker((open) => !open)}
                >
                  Columns
                </button>
                {showColumnPicker && (
                  <div className="column-visibility-popover">
                    {AVAILABLE_COLUMNS.map((col) => (
                      <label key={col.id} className="column-checkbox-label">
                        <input
                          type="checkbox"
                          checked={Boolean(visibleColumns[col.id])}
                          onChange={() => toggleColumn(col.id)}
                        />
                        {col.label}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

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
                    {debouncedSearch || statusFilter !== "ALL"
                      ? "No employees match your search or filter criteria."
                      : "No employees on this project yet."}
                  </p>
                  {(debouncedSearch || statusFilter !== "ALL") && (
                    <button
                      type="button"
                      className="btn-secondary"
                      style={{ marginTop: "12px" }}
                      onClick={() => {
                        setSearch("");
                        setDebouncedSearch("");
                        setStatusFilter("ALL");
                        setCurrentPage(1);
                      }}
                    >
                      Clear Filters
                    </button>
                  )}
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
                          <div className="pm-emp-avatar">
                            {getInitials(emp.fullName)}
                          </div>
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
                            <span className="pm-emp-meta-lbl">DATE OF JOINING</span>
                            <span className="pm-emp-meta-val">
                              {formatDate(emp.job?.joiningDate)}
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
                    {debouncedSearch || statusFilter !== "ALL" || selectedDepartment
                      ? "No employees match the current filters."
                      : "Add the first employee to start the directory."}
                  </p>
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
                            <span className="pm-emp-avatar" style={{ width: 32, height: 32, fontSize: 11 }}>
                              {getInitials(emp.fullName)}
                            </span>
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
              <h2>{createdInvitationInfo ? "Invitation Sent" : "Add Employee"}</h2>
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
                    <span style={{ color: "var(--muted)" }}>Invite Status</span>
                    <StatusBadge
                      status={createdInvitationInfo.invitation?.status || "PENDING"}
                      label={createdInvitationInfo.invitation?.status || "Pending"}
                    />
                  </div>

                  <label style={{ fontSize: "12px", color: "var(--muted)", display: "block", marginBottom: "6px" }}>
                    Onboarding Link (Valid for 7 days)
                  </label>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <input
                      readOnly
                      value={createdInvitationInfo.invitation?.inviteLink || ""}
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
                        if (createdInvitationInfo.invitation?.inviteLink) {
                          navigator.clipboard?.writeText(createdInvitationInfo.invitation.inviteLink);
                          setCopiedInvite(true);
                          setTimeout(() => setCopiedInvite(false), 3000);
                        }
                      }}
                      style={{ whiteSpace: "nowrap" }}
                    >
                      {copiedInvite ? "Copied" : "Copy Link"}
                    </button>
                  </div>
                  <p style={{ margin: "10px 0 0", fontSize: "12px", color: "var(--muted)", display: "flex", alignItems: "center", gap: "6px" }}>
                    {createdInvitationInfo.invitation?.emailSent ? (
                      <>
                        <IconCheck size={14} style={{ color: "var(--g-700)" }} />
                        <span>Invitation email sent to employee.</span>
                      </>
                    ) : (
                      <span>You can copy and send this link directly to the employee.</span>
                    )}
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
                  <label>
                    Job Title
                    <input
                      value={newEmployee.jobTitle}
                      onChange={(e) =>
                        setNewEmployee({ ...newEmployee, jobTitle: e.target.value })
                      }
                      placeholder="e.g. Senior Software Engineer"
                    />
                  </label>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                  <label>
                    Department
                    <input
                      value={newEmployee.department}
                      onChange={(e) =>
                        setNewEmployee({ ...newEmployee, department: e.target.value })
                      }
                      placeholder="e.g. Engineering"
                    />
                  </label>
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
                  <label>
                    Password (Optional)
                    <div className="password-input-wrapper">
                      <input
                        type={showNewEmpPassword ? "text" : "password"}
                        className={addFieldErrors.password ? "has-error" : ""}
                        value={newEmployee.password}
                        onChange={(e) => {
                          setNewEmployee({ ...newEmployee, password: e.target.value });
                          if (addFieldErrors.password) setAddFieldErrors((prev) => ({ ...prev, password: "" }));
                          if (addError) setAddError("");
                        }}
                        placeholder="Leave blank for employee invite"
                      />
                      <button
                        type="button"
                        className="password-toggle-btn"
                        onClick={() => setShowNewEmpPassword((prev) => !prev)}
                        title={showNewEmpPassword ? "Hide password" : "Show password"}
                        aria-label={showNewEmpPassword ? "Hide password" : "Show password"}
                      >
                        {showNewEmpPassword ? (
                          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                          </svg>
                        ) : (
                          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                        )}
                      </button>
                    </div>
                    {addFieldErrors.password && (
                      <span className="field-error">{addFieldErrors.password}</span>
                    )}
                  </label>
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
    </div>
  );
}
