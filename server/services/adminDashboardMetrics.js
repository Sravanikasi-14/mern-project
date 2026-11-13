/**
 * F37 — Admin dashboard metric helpers.
 *
 * Keeps getAdminDashboard from loading full employee documents. Facts used for
 * payroll/workforce/assets are a narrow projection; attendance "today" is driven
 * from Attendance rows (+ optional legacy fallback only for employees missing a row).
 */

/** Projection for dashboard employee facts — never includes avatar/email/HTML blobs. */
export const DASHBOARD_EMPLOYEE_FACT_SELECT =
  "_id job.department job.project customFields.monthlySalary customFields.salary customFields.assignedAssets";

export function isAttendancePresentRecord(att) {
  if (!att) return false;
  return Boolean(
    att.checkIn ||
      att.status === "CHECKED_IN" ||
      att.status === "CHECKED_OUT" ||
      att.status === "PRESENT"
  );
}

/**
 * Count present/late from Attendance documents only (O(attendance rows), not O(employees)).
 */
export function countPresentAndLateFromAttendance({
  attendanceRecords,
  companyTimezone,
  lateThresholdMinutes,
  getTimeInTimezone,
  parseTimeToMinutes,
}) {
  let todayPresent = 0;
  let todayLate = 0;
  const presentIds = new Set();

  for (const att of attendanceRecords || []) {
    if (!isAttendancePresentRecord(att)) continue;
    const empId = String(att.employeeId);
    if (presentIds.has(empId)) continue;
    presentIds.add(empId);
    todayPresent += 1;
    if (att.checkIn) {
      const checkInLocalTime = getTimeInTimezone(att.checkIn, companyTimezone);
      const checkInMins = parseTimeToMinutes(checkInLocalTime);
      if (checkInMins !== null && checkInMins > lateThresholdMinutes) {
        todayLate += 1;
      }
    }
  }

  return { todayPresent, todayLate, presentIds };
}

/**
 * Legacy customFields.attendanceLogs fallback for active employees with no Attendance row today.
 * Only loads the narrow attendanceLogs field for candidate ids.
 */
export async function applyLegacyAttendanceLogFallback({
  Employee,
  candidateEmployeeIds,
  targetDate,
  lateThresholdMinutes,
  parseTimeToMinutes,
  presentIds,
}) {
  let todayPresent = 0;
  let todayLate = 0;
  if (!candidateEmployeeIds?.length) {
    return { todayPresent, todayLate, presentIds };
  }

  const legacyEmps = await Employee.find({
    _id: { $in: candidateEmployeeIds },
    "customFields.attendanceLogs.date": targetDate,
  })
    .select("_id customFields.attendanceLogs")
    .lean();

  for (const emp of legacyEmps) {
    const empIdStr = String(emp._id);
    if (presentIds.has(empIdStr)) continue;
    const legacyLogs = emp.customFields?.attendanceLogs || [];
    const todayLog = legacyLogs.find((l) => l.date === targetDate);
    if (!todayLog || !(todayLog.checkIn || todayLog.status === "PRESENT")) continue;
    presentIds.add(empIdStr);
    todayPresent += 1;
    if (todayLog.checkIn) {
      const checkInMins = parseTimeToMinutes(todayLog.checkIn);
      if (checkInMins !== null && checkInMins > lateThresholdMinutes) {
        todayLate += 1;
      }
    }
  }

  return { todayPresent, todayLate, presentIds };
}

export function resolveEmployeeMonthlySalary(emp, compMap) {
  const empIdStr = String(emp._id);
  const fromComp = compMap.get(empIdStr);
  if (fromComp !== undefined) return fromComp;
  const customSalary = parseFloat(
    String(emp.customFields?.monthlySalary || emp.customFields?.salary || 0)
  );
  return Number.isFinite(customSalary) ? customSalary : 0;
}

export function buildCompensationMap(compensationRecords, targetDateEnd) {
  const compMap = new Map();
  for (const comp of compensationRecords || []) {
    const revisions = (comp.revisions || []).filter(
      (r) => new Date(r.effectiveFromDate) <= targetDateEnd
    );
    if (revisions.length === 0) continue;
    revisions.sort((a, b) => new Date(b.effectiveFromDate) - new Date(a.effectiveFromDate));
    const latest = revisions[0];
    const val = parseFloat(String(latest.monthlyCostToCompany || 0));
    if (!Number.isNaN(val)) {
      compMap.set(String(comp.employeeId), val);
    }
  }
  return compMap;
}

/**
 * Workforce + payroll allocation from lean employee facts + compensation map.
 */
export function buildWorkforcePayrollAndProjects(employeeFacts, compMap) {
  let totalMonthlyPayroll = 0;
  const deptSalaryMap = new Map();
  const deptHeadcount = new Map();
  const projectTypeCountMap = {
    MANDATE: 0,
    RETAIL: 0,
    INTERNAL: 0,
    BENCH: 0,
  };
  const projectNameMap = new Map();
  let totalEmployeesWithProjects = 0;

  for (const emp of employeeFacts || []) {
    const dept = emp.job?.department || "General / Unassigned";
    const sal = resolveEmployeeMonthlySalary(emp, compMap);
    totalMonthlyPayroll += sal;
    deptSalaryMap.set(dept, (deptSalaryMap.get(dept) || 0) + sal);
    deptHeadcount.set(dept, (deptHeadcount.get(dept) || 0) + 1);

    const p = emp.job?.project;
    if (p) {
      if (p.projectType && projectTypeCountMap[p.projectType] !== undefined) {
        projectTypeCountMap[p.projectType] += 1;
        totalEmployeesWithProjects += 1;
      }
      if (p.projectName && String(p.projectName).trim()) {
        const pName = String(p.projectName).trim();
        projectNameMap.set(pName, (projectNameMap.get(pName) || 0) + 1);
      }
    }
  }

  const payrollAllocation = [];
  for (const [department, cost] of deptSalaryMap.entries()) {
    const pct = totalMonthlyPayroll > 0 ? Math.round((cost / totalMonthlyPayroll) * 100) : 0;
    payrollAllocation.push({ department, cost, percentage: pct });
  }
  payrollAllocation.sort((a, b) => b.cost - a.cost);

  const workforceDepartments = Array.from(deptHeadcount.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  const projectTeams = {
    mandate: {
      count: projectTypeCountMap.MANDATE,
      pct:
        totalEmployeesWithProjects > 0
          ? Math.round((projectTypeCountMap.MANDATE / totalEmployeesWithProjects) * 100)
          : 0,
    },
    retail: {
      count: projectTypeCountMap.RETAIL,
      pct:
        totalEmployeesWithProjects > 0
          ? Math.round((projectTypeCountMap.RETAIL / totalEmployeesWithProjects) * 100)
          : 0,
    },
    topStaffed: Array.from(projectNameMap.entries())
      .map(([name, members]) => ({ name, members }))
      .sort((a, b) => b.members - a.members)
      .slice(0, 5),
  };

  return {
    totalMonthlyPayroll,
    payrollAllocation,
    workforceDepartments,
    projectTeams,
  };
}

export function buildCompanyAssetsSummary(employeeFacts, assignedFromAssetCollection) {
  const activeCount = employeeFacts.length;
  const assignedEmpIds = new Set(assignedFromAssetCollection || []);
  let employeesWithAssets = 0;
  for (const emp of employeeFacts) {
    const assets = emp.customFields?.assignedAssets;
    const hasLegacy = Array.isArray(assets) && assets.length > 0;
    if (assignedEmpIds.has(String(emp._id)) || hasLegacy) {
      employeesWithAssets += 1;
    }
  }
  const employeesWithoutAssets = Math.max(0, activeCount - employeesWithAssets);
  return {
    totalEmployees: activeCount,
    employeesWithAssets,
    employeesWithAssetsPct:
      activeCount > 0 ? Math.round((employeesWithAssets / activeCount) * 100) : 0,
    employeesWithoutAssets,
    employeesWithoutAssetsPct:
      activeCount > 0 ? Math.round((employeesWithoutAssets / activeCount) * 100) : 0,
  };
}

/**
 * Load scoped active employee facts for the dashboard (narrow projection).
 */
export async function loadDashboardEmployeeFacts(Employee, empQueryFilter) {
  const facts = await Employee.find(empQueryFilter)
    .select(DASHBOARD_EMPLOYEE_FACT_SELECT)
    .lean();
  return facts;
}
