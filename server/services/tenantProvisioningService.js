import Company from "../models/Company.js";
import { getCentralDbName, getTenantConnection } from "../config/db.js";
import { getLeaveRequestModel } from "../models/LeaveRequest.js";
import { getLeaveBackupProposalModel } from "../models/LeaveBackupProposal.js";
import { getCompanyHrPolicyModel, DEFAULT_HR_POLICY } from "../models/CompanyHrPolicy.js";
import { getOfferLetterModel } from "../models/OfferLetter.js";
import { getOfferTemplateModel } from "../models/OfferTemplate.js";
import { getAttendanceModel } from "../models/Attendance.js";
import { getEmployeeFaceEnrollmentModel } from "../models/EmployeeFaceEnrollment.js";
import { getAttendanceVerificationChallengeModel } from "../models/AttendanceVerificationChallenge.js";
import { getLiveTrackingSessionModel } from "../models/LiveTrackingSession.js";
import { getPayrollCycleModel } from "../models/PayrollCycle.js";
import { getPayslipModel } from "../models/Payslip.js";
import { getCompanyAssetModel } from "../models/CompanyAsset.js";
import { getTaskModel } from "../models/Task.js";
import { getImpactPointTransactionModel } from "../models/ImpactPointTransaction.js";
import { getTeamModel } from "../models/Team.js";
import { getDepartmentModel } from "../models/Department.js";
import { getProjectModel } from "../models/Project.js";
import { getProjectMembershipModel } from "../models/ProjectMembership.js";

/**
 * Ensures leave_requests and company_hr_policies collections, approved indexes,
 * and at least one valid policy document exist for a tenant database.
 * Idempotent: safe to run multiple times without duplicating data or dropping indexes.
 */
export async function provisionTenantDatabase(company, connection) {
  if (!company || !company.databaseName) {
    throw new Error("Invalid company object: databaseName is required");
  }

  const centralDb = getCentralDbName();
  if (company.databaseName === centralDb) {
    throw new Error(
      `Production safety check failed: Cannot run tenant provisioning against central platform database '${centralDb}'`
    );
  }

  const conn = connection || (await getTenantConnection(company.databaseName));
  const db = conn.db;

  const outcome = {
    companySlug: company.slug,
    databaseName: company.databaseName,
    collectionsCreated: [],
    indexesCreated: [],
    policyProvisioned: false,
    policyUpdated: false,
    repaired: false,
    needsManualConfiguration: false,
    message: "",
  };

  // 1. List existing collections in the tenant database
  const existingCols = await db.listCollections().toArray();
  const existingColNames = new Set(existingCols.map((c) => c.name));

  // 2. Ensure leave_requests collection exists
  if (!existingColNames.has("leave_requests")) {
    await db.createCollection("leave_requests");
    outcome.collectionsCreated.push("leave_requests");
    outcome.repaired = true;
  }

  // Ensure approved indexes on leave_requests
  const LeaveRequest = getLeaveRequestModel(conn);
  try {
    await LeaveRequest.createIndexes();
    outcome.indexesCreated.push("leave_requests: (employeeId, status, fromDate), (status, fromDate)");
  } catch (idxErr) {
    console.warn(`[TenantProvisioning] Index creation warning on ${company.databaseName}:`, idxErr.message);
  }

  // 3. Ensure company_hr_policies collection exists
  if (!existingColNames.has("company_hr_policies")) {
    await db.createCollection("company_hr_policies");
    outcome.collectionsCreated.push("company_hr_policies");
    outcome.repaired = true;
  }

  const CompanyHrPolicy = getCompanyHrPolicyModel(conn);
  try {
    await CompanyHrPolicy.createIndexes();
    outcome.indexesCreated.push("company_hr_policies: { effectiveFromDate: -1 }");
  } catch (idxErr) {
    console.warn(`[TenantProvisioning] Index creation warning on ${company.databaseName}:`, idxErr.message);
  }

  // 4. Ensure at least one valid policy document exists
  const policyCol = db.collection("company_hr_policies");
  const existingPolicyCount = await policyCol.countDocuments();
  if (existingPolicyCount === 0) {
    // Determine company-configured office start time or approved default
    const configuredOfficeStartTime = company.config?.officeStartTime || "09:30";
    const configuredOfficeEndTime = company.config?.officeEndTime || "18:30";

    const initialPolicy = {
      ...DEFAULT_HR_POLICY,
      effectiveFromDate: new Date("2026-01-01"),
      attendanceRules: {
        officeStartTime: configuredOfficeStartTime,
        officeEndTime: configuredOfficeEndTime,
      },
      schemaVersion: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await policyCol.insertOne(initialPolicy);
    outcome.policyProvisioned = true;
    outcome.repaired = true;
  } else {
    // Policy exists: Never overwrite company-specific settings or leave entitlements!
    // Check if the current applicable policy revision lacks attendanceRules.officeStartTime
    const activePolicy = await policyCol.find().sort({ effectiveFromDate: -1 }).limit(1).next();

    if (
      activePolicy &&
      (!activePolicy.attendanceRules || !activePolicy.attendanceRules.officeStartTime)
    ) {
      // Safely backfill attendanceRules without modifying leave types or rules
      const configuredOfficeStartTime = company.config?.officeStartTime || "09:30";
      const configuredOfficeEndTime = company.config?.officeEndTime || "18:30";

      await policyCol.updateOne(
        { _id: activePolicy._id },
        {
          $set: {
            "attendanceRules.officeStartTime": configuredOfficeStartTime,
            "attendanceRules.officeEndTime": configuredOfficeEndTime,
            updatedAt: new Date(),
          },
        }
      );
      outcome.policyUpdated = true;
      outcome.repaired = true;
    }
  }

  // 5. Ensure offer_letters collection exists
  if (!existingColNames.has("offer_letters")) {
    await db.createCollection("offer_letters");
    outcome.collectionsCreated.push("offer_letters");
    outcome.repaired = true;
  }

  const OfferLetter = getOfferLetterModel(conn);
  try {
    await OfferLetter.createIndexes();
    outcome.indexesCreated.push("offer_letters: { status: 1, createdAt: -1 }, { 'candidate.email': 1 }");
  } catch (idxErr) {
    console.warn(`[TenantProvisioning] Index creation warning on ${company.databaseName}:`, idxErr.message);
  }

  // 5b. Ensure empty offer_templates collection + indexes (legacy; no documents are seeded)
  if (!existingColNames.has("offer_templates")) {
    await db.createCollection("offer_templates");
    outcome.collectionsCreated.push("offer_templates");
    outcome.repaired = true;
  }
  const OfferTemplate = getOfferTemplateModel(conn);
  try {
    await OfferTemplate.createIndexes();
    outcome.indexesCreated.push(
      "offer_templates: status, type, uniq_system_default_per_master, uniq_default_template"
    );
  } catch (idxErr) {
    console.warn(`[TenantProvisioning] Index creation warning on ${company.databaseName}:`, idxErr.message);
  }
  // Phase 4B: offers use the single standard renderer; no per-tenant template documents are seeded.
  outcome.offerTemplateProvisioned = false;

  // 6. Ensure attendances collection exists
  if (!existingColNames.has("attendances")) {
    await db.createCollection("attendances");
    outcome.collectionsCreated.push("attendances");
    outcome.repaired = true;
  }

  const Attendance = getAttendanceModel(conn);
  try {
    await Attendance.createIndexes();
    outcome.indexesCreated.push("attendances: { employeeId: 1, date: 1 }");
  } catch (idxErr) {
    console.warn(`[TenantProvisioning] Index creation warning on ${company.databaseName}:`, idxErr.message);
  }

  if (!existingColNames.has("employee_face_enrollments")) {
    await db.createCollection("employee_face_enrollments");
    outcome.collectionsCreated.push("employee_face_enrollments");
    outcome.repaired = true;
  }
  const EmployeeFaceEnrollment = getEmployeeFaceEnrollmentModel(conn);
  try {
    await EmployeeFaceEnrollment.createIndexes();
    outcome.indexesCreated.push("employee_face_enrollments: { companyId, employeeId, status }");
  } catch (idxErr) {
    console.warn(`[TenantProvisioning] Index creation warning on ${company.databaseName}:`, idxErr.message);
  }

  if (!existingColNames.has("attendance_verification_challenges")) {
    await db.createCollection("attendance_verification_challenges");
    outcome.collectionsCreated.push("attendance_verification_challenges");
    outcome.repaired = true;
  }
  const AttendanceVerificationChallenge = getAttendanceVerificationChallengeModel(conn);
  try {
    await AttendanceVerificationChallenge.createIndexes();
    outcome.indexesCreated.push("attendance_verification_challenges: nonce unique, employeeId+purpose");
  } catch (idxErr) {
    console.warn(`[TenantProvisioning] Index creation warning on ${company.databaseName}:`, idxErr.message);
  }

  // 7. Ensure live_tracking_sessions collection exists
  if (!existingColNames.has("live_tracking_sessions")) {
    await db.createCollection("live_tracking_sessions");
    outcome.collectionsCreated.push("live_tracking_sessions");
    outcome.repaired = true;
  }

  const LiveTrackingSession = getLiveTrackingSessionModel(conn);
  try {
    await LiveTrackingSession.createIndexes();
    outcome.indexesCreated.push("live_tracking_sessions: { employeeId: 1, status: 1 }");
  } catch (idxErr) {
    console.warn(`[TenantProvisioning] Index creation warning on ${company.databaseName}:`, idxErr.message);
  }

  // 8. Ensure payroll_cycles collection exists
  if (!existingColNames.has("payroll_cycles")) {
    await db.createCollection("payroll_cycles");
    outcome.collectionsCreated.push("payroll_cycles");
    outcome.repaired = true;
  }
  const PayrollCycle = getPayrollCycleModel(conn);
  try {
    await PayrollCycle.createIndexes();
    outcome.indexesCreated.push("payroll_cycles: { periodYear: 1, periodMonth: 1 }");
  } catch (idxErr) {
    console.warn(`[TenantProvisioning] Index creation warning on ${company.databaseName}:`, idxErr.message);
  }

  // 9. Ensure payroll_payslips collection exists
  if (!existingColNames.has("payroll_payslips")) {
    await db.createCollection("payroll_payslips");
    outcome.collectionsCreated.push("payroll_payslips");
    outcome.repaired = true;
  }
  const Payslip = getPayslipModel(conn);
  try {
    await Payslip.createIndexes();
    outcome.indexesCreated.push("payroll_payslips: { payrollCycleId: 1, employeeId: 1 }");
  } catch (idxErr) {
    console.warn(`[TenantProvisioning] Index creation warning on ${company.databaseName}:`, idxErr.message);
  }

  // 10. Ensure company_assets collection exists
  if (!existingColNames.has("company_assets")) {
    await db.createCollection("company_assets");
    outcome.collectionsCreated.push("company_assets");
    outcome.repaired = true;
  }
  const CompanyAsset = getCompanyAssetModel(conn);
  try {
    await CompanyAsset.createIndexes();
    outcome.indexesCreated.push("company_assets: { assetTag: 1 (unique) }, { status: 1 }, { 'currentAssignment.employeeId': 1 }");
  } catch (idxErr) {
    console.warn(`[TenantProvisioning] Index creation warning on ${company.databaseName}:`, idxErr.message);
  }

  // 11. Ensure tasks collection exists for Work Management
  if (!existingColNames.has("tasks")) {
    await db.createCollection("tasks");
    outcome.collectionsCreated.push("tasks");
    outcome.repaired = true;
  }
  const Task = getTaskModel(conn);
  try {
    await Task.createIndexes();
    outcome.indexesCreated.push("tasks: { assigneeId: 1, status: 1 }, { assignedByEmployeeId: 1, status: 1 }, { department: 1, status: 1 }, { deadline: 1 }");
  } catch (idxErr) {
    console.warn(`[TenantProvisioning] Index creation warning on ${company.databaseName}:`, idxErr.message);
  }

  // 12. Ensure impact_point_transactions collection exists
  if (!existingColNames.has("impact_point_transactions")) {
    await db.createCollection("impact_point_transactions");
    outcome.collectionsCreated.push("impact_point_transactions");
    outcome.repaired = true;
  }
  const ImpactPointTransaction = getImpactPointTransactionModel(conn);
  try {
    await ImpactPointTransaction.createIndexes();
    outcome.indexesCreated.push("impact_point_transactions: { idempotencyKey: 1 (unique) }, { employeeId: 1, createdAt: -1 }, { 'employeeSnapshot.department': 1, points: 1 }");
  } catch (idxErr) {
    console.warn(`[TenantProvisioning] Index creation warning on ${company.databaseName}:`, idxErr.message);
  }

  // 13. Leave backup proposals (Phase 2 — proposed only, does not change task ownership)
  if (!existingColNames.has("leave_backup_proposals")) {
    await db.createCollection("leave_backup_proposals");
    outcome.collectionsCreated.push("leave_backup_proposals");
    outcome.repaired = true;
  }
  const LeaveBackupProposal = getLeaveBackupProposalModel(conn);
  try {
    await LeaveBackupProposal.createIndexes();
    outcome.indexesCreated.push(
      "leave_backup_proposals: { leaveRequestId: 1, taskId: 1 (unique) }, { proposedBackupEmployeeId: 1, status: 1 }"
    );
  } catch (idxErr) {
    console.warn(`[TenantProvisioning] Index creation warning on ${company.databaseName}:`, idxErr.message);
  }

  // Phase 3 handover/delegation is embedded on leave_requests (no separate collections).
  // Ensure LeaveRequest indexes include handover query paths.
  try {
    const LeaveRequest = getLeaveRequestModel(conn);
    await LeaveRequest.createIndexes();
    outcome.indexesCreated.push(
      "leave_requests: handover.status, handover.items.delegation.delegateEmployeeId+status, handover.items.taskId"
    );
  } catch (idxErr) {
    console.warn(`[TenantProvisioning] LeaveRequest index warning on ${company.databaseName}:`, idxErr.message);
  }

  // Organization Explorer — Teams (Phase 4E)
  if (!existingColNames.has("teams")) {
    await db.createCollection("teams");
    outcome.collectionsCreated.push("teams");
    outcome.repaired = true;
  }
  const Team = getTeamModel(conn);
  try {
    await Team.createIndexes();
    outcome.indexesCreated.push(
      "teams: { nameNormalized: 1 (unique, active) }, { isActive: 1, name: 1 }, { memberEmployeeIds: 1 }, { leadEmployeeId: 1 }, { department: 1, isActive: 1 }"
    );
  } catch (idxErr) {
    console.warn(`[TenantProvisioning] Team index warning on ${company.databaseName}:`, idxErr.message);
  }

  // Departments, Projects, ProjectMemberships (Organization Explorer / org entities)
  for (const col of ["departments", "projects", "project_memberships"]) {
    if (!existingColNames.has(col)) {
      await db.createCollection(col);
      outcome.collectionsCreated.push(col);
      outcome.repaired = true;
    }
  }
  const Department = getDepartmentModel(conn);
  const Project = getProjectModel(conn);
  const ProjectMembership = getProjectMembershipModel(conn);
  try {
    await Department.createIndexes();
    outcome.indexesCreated.push("departments: { normalizedName: 1 (unique) }, { isActive: 1, name: 1 }");
  } catch (idxErr) {
    console.warn(`[TenantProvisioning] Department index warning on ${company.databaseName}:`, idxErr.message);
  }
  try {
    await Project.createIndexes();
    outcome.indexesCreated.push(
      "projects: { normalizedName: 1 (unique) }, { isActive: 1, status: 1, name: 1 }"
    );
  } catch (idxErr) {
    console.warn(`[TenantProvisioning] Project index warning on ${company.databaseName}:`, idxErr.message);
  }
  try {
    await ProjectMembership.createIndexes();
    outcome.indexesCreated.push(
      "project_memberships: active unique (employeeId, projectId), { projectId: 1, status: 1 }"
    );
  } catch (idxErr) {
    console.warn(
      `[TenantProvisioning] ProjectMembership index warning on ${company.databaseName}:`,
      idxErr.message
    );
  }

  outcome.message = outcome.repaired
    ? `Tenant database '${company.databaseName}' was successfully repaired/provisioned.`
    : `Tenant database '${company.databaseName}' is fully provisioned and up to date.`;

  return outcome;
}

/**
 * Iterates through all companies in the central database and provisions
 * leave collections and policies for every tenant database.
 */
export async function provisionAllTenantDatabases() {
  const centralDb = getCentralDbName();
  const companies = await Company.find({}).lean();

  const report = {
    totalCompanies: companies.length,
    checked: [],
    repaired: [],
    alreadyUpToDate: [],
    needsManualConfiguration: [],
    errors: [],
  };

  for (const company of companies) {
    const slug = company.slug;
    const dbName = company.databaseName;

    if (dbName === centralDb) {
      report.errors.push({
        slug,
        databaseName: dbName,
        error: "Database name matches central database. Skipped for production safety.",
      });
      continue;
    }

    try {
      report.checked.push({ slug, databaseName: dbName });
      const outcome = await provisionTenantDatabase(company);

      if (outcome.repaired) {
        report.repaired.push({
          slug,
          databaseName: dbName,
          collectionsCreated: outcome.collectionsCreated,
          policyProvisioned: outcome.policyProvisioned,
          policyUpdated: outcome.policyUpdated,
        });
      } else {
        report.alreadyUpToDate.push({ slug, databaseName: dbName });
      }

      if (outcome.needsManualConfiguration) {
        report.needsManualConfiguration.push({ slug, databaseName: dbName });
      }
    } catch (err) {
      report.errors.push({
        slug,
        databaseName: dbName,
        error: err.message,
      });
    }
  }

  return report;
}
