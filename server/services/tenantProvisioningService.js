import Company from "../models/Company.js";
import {
  getCentralDbName,
  getTenantConnection,
  runWithTenantConnectionScope,
} from "../config/db.js";
import { getLeaveRequestModel } from "../models/LeaveRequest.js";
import { getLeaveBackupProposalModel } from "../models/LeaveBackupProposal.js";
import { getCompanyHrPolicyModel, DEFAULT_HR_POLICY } from "../models/CompanyHrPolicy.js";
import { getOfferLetterModel } from "../models/OfferLetter.js";
import { getOfferTemplateModel } from "../models/OfferTemplate.js";
import { ensureOfferLetterEmployeeIdIndex as ensureOfferLetterEmployeeIdIndexDefault } from "./offerLetterEmployeeIdIndex.js";
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
import { getNotificationModel } from "../models/Notification.js";
import { getNotificationReadStateModel } from "../models/NotificationReadState.js";
import { getAuthSessionModel } from "../models/AuthSession.js";
import { getUserModel } from "../models/User.js";
import { getEmployeeModel } from "../models/Employee.js";
import { getSettlementModel } from "../models/Settlement.js";
import { getEmployeeCompensationModel } from "../models/EmployeeCompensation.js";
import { getAuthTokenModel } from "../models/AuthToken.js";
import { getAuditLogModel } from "../models/AuditLog.js";
import { getConversationModel } from "../models/Conversation.js";
import { getConversationMemberModel } from "../models/ConversationMember.js";
import { getMessageModel } from "../models/Message.js";
import { getRemoteWorkRequestModel } from "../models/RemoteWorkRequest.js";
import { getLocationExceptionModel } from "../models/LocationException.js";
import { getChatFileModel } from "../models/ChatFile.js";
import { getAnnouncementModel } from "../models/Announcement.js";
import { getAnnouncementReadModel } from "../models/AnnouncementRead.js";
import { getDesignationModel } from "../models/Designation.js";
import {
  TENANT_INDEX_SCHEMA_VERSION,
  inventoryTenantConnection,
} from "./tenantIndexInventory.js";
import { ensureTenantEphemeralTtlIndexes } from "./ephemeralTtlIndexes.js";
import {
  cleanupDuplicateActiveSessions,
  ensureActiveEmployeeUniqueIndex,
} from "./liveTrackingActiveSession.js";

export { TENANT_INDEX_SCHEMA_VERSION };

/** Overridable in tests only — production always uses the default ensure helper. */
let ensureOfferLetterEmployeeIdIndexFn = ensureOfferLetterEmployeeIdIndexDefault;

/** @param {typeof ensureOfferLetterEmployeeIdIndexDefault | null | undefined} fn */
export function __setEnsureOfferLetterEmployeeIdIndexForTests(fn) {
  ensureOfferLetterEmployeeIdIndexFn =
    typeof fn === "function" ? fn : ensureOfferLetterEmployeeIdIndexDefault;
}

/**
 * Additive createIndexes with clear failure recording. Never drops indexes.
 */
async function createIndexesTracked(outcome, model, summary) {
  const collection =
    model?.collection?.collectionName || model?.collection?.name || "unknown";
  try {
    await model.createIndexes();
    outcome.indexesCreated.push(summary);
    return true;
  } catch (idxErr) {
    const failure = {
      collection,
      phase: "createIndexes",
      message: idxErr.message,
      summary,
    };
    outcome.indexFailures.push(failure);
    console.warn(
      `[TenantProvisioning] Index creation failed on ${outcome.databaseName}.${collection}:`,
      idxErr.message
    );
    return false;
  }
}

async function stampTenantIndexSchemaVersion(company) {
  if (!company?._id) {
    return { stamped: false, reason: "company_id_missing" };
  }
  await Company.updateOne(
    { _id: company._id },
    {
      $set: {
        tenantIndexSchemaVersion: TENANT_INDEX_SCHEMA_VERSION,
        tenantIndexProvisionedAt: new Date(),
      },
    }
  );
  return { stamped: true, version: TENANT_INDEX_SCHEMA_VERSION };
}

/**
 * Ensures leave_requests and company_hr_policies collections, approved indexes,
 * and at least one valid policy document exist for a tenant database.
 * Idempotent: safe to run multiple times without duplicating data or dropping indexes.
 *
 * F43/F44: stamps Company.tenantIndexSchemaVersion only after all required indexes
 * verify successfully. Never calls OfferLetter.syncIndexes() or drops indexes.
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
    indexFailures: [],
    indexSchemaVersion: TENANT_INDEX_SCHEMA_VERSION,
    indexesFullyApplied: false,
    tenantIndexSchemaVersionStamped: null,
    fullyProvisioned: false,
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
  await createIndexesTracked(
    outcome,
    LeaveRequest,
    "leave_requests: (employeeId, status, fromDate), (status, fromDate)"
  );

  // 3. Ensure company_hr_policies collection exists
  if (!existingColNames.has("company_hr_policies")) {
    await db.createCollection("company_hr_policies");
    outcome.collectionsCreated.push("company_hr_policies");
    outcome.repaired = true;
  }

  const CompanyHrPolicy = getCompanyHrPolicyModel(conn);
  await createIndexesTracked(
    outcome,
    CompanyHrPolicy,
    "company_hr_policies: { effectiveFromDate: -1 }"
  );

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
  await createIndexesTracked(
    outcome,
    OfferLetter,
    "offer_letters: { status: 1, createdAt: -1 }, { 'candidate.email': 1 }"
  );

  // Unique partial employeeId index — explicit name; never auto-drop legacy on ordinary startup.
  const applyOfferEmployeeIdMigration =
    String(process.env.APPLY_OFFER_LETTER_EMPLOYEEID_INDEX_MIGRATION || "").toLowerCase() === "true";
  try {
    const employeeIdIndex = await ensureOfferLetterEmployeeIdIndexFn(db, {
      applyMigration: applyOfferEmployeeIdMigration,
    });
    outcome.offerLetterEmployeeIdIndex = employeeIdIndex;
    if (!employeeIdIndex || typeof employeeIdIndex !== "object") {
      outcome.needsManualConfiguration = true;
      outcome.indexErrors = outcome.indexErrors || [];
      outcome.indexErrors.push({
        collection: "offer_letters",
        index: "uniq_offer_letter_employeeId_objectId",
        message: "offerLetterEmployeeIdIndex result missing after ensure",
      });
    } else if (employeeIdIndex.status === "ok") {
      if (employeeIdIndex.createdDesired || employeeIdIndex.applied) {
        outcome.indexesCreated.push(
          `offer_letters: ${employeeIdIndex.desiredName} (unique partial ObjectId)`
        );
        outcome.repaired = true;
      }
    } else if (employeeIdIndex.status === "migration_required") {
      outcome.needsManualConfiguration = true;
      outcome.message = [outcome.message, employeeIdIndex.message].filter(Boolean).join(" ");
      console.warn(
        `[TenantProvisioning] offer_letters employeeId index migration required on ${company.databaseName}:`,
        employeeIdIndex.message
      );
    } else {
      outcome.needsManualConfiguration = true;
      outcome.indexErrors = outcome.indexErrors || [];
      outcome.indexErrors.push({
        collection: "offer_letters",
        index: employeeIdIndex.desiredName,
        message: employeeIdIndex.message,
        duplicates: employeeIdIndex.duplicates || undefined,
      });
      console.error(
        `[TenantProvisioning] offer_letters employeeId index error on ${company.databaseName}:`,
        employeeIdIndex.message
      );
    }
  } catch (idxErr) {
    outcome.needsManualConfiguration = true;
    outcome.indexErrors = outcome.indexErrors || [];
    outcome.indexErrors.push({
      collection: "offer_letters",
      index: "uniq_offer_letter_employeeId_objectId",
      message: idxErr.message,
    });
    console.error(
      `[TenantProvisioning] offer_letters employeeId index exception on ${company.databaseName}:`,
      idxErr.message
    );
  }

  // 5b. Ensure empty offer_templates collection + indexes (legacy; no documents are seeded)
  if (!existingColNames.has("offer_templates")) {
    await db.createCollection("offer_templates");
    outcome.collectionsCreated.push("offer_templates");
    outcome.repaired = true;
  }
  const OfferTemplate = getOfferTemplateModel(conn);
  await createIndexesTracked(
    outcome,
    OfferTemplate,
    "offer_templates: status, type, uniq_system_default_per_master, uniq_default_template"
  );
  // Phase 4B: offers use the single standard renderer; no per-tenant template documents are seeded.
  outcome.offerTemplateProvisioned = false;

  // 6. Ensure attendances collection exists
  if (!existingColNames.has("attendances")) {
    await db.createCollection("attendances");
    outcome.collectionsCreated.push("attendances");
    outcome.repaired = true;
  }

  const Attendance = getAttendanceModel(conn);
  await createIndexesTracked(
    outcome,
    Attendance,
    "attendances: { employeeId: 1, date: 1 }"
  );

  if (!existingColNames.has("employee_face_enrollments")) {
    await db.createCollection("employee_face_enrollments");
    outcome.collectionsCreated.push("employee_face_enrollments");
    outcome.repaired = true;
  }
  const EmployeeFaceEnrollment = getEmployeeFaceEnrollmentModel(conn);
  await createIndexesTracked(
    outcome,
    EmployeeFaceEnrollment,
    "employee_face_enrollments: { companyId, employeeId, status }"
  );

  if (!existingColNames.has("attendance_verification_challenges")) {
    await db.createCollection("attendance_verification_challenges");
    outcome.collectionsCreated.push("attendance_verification_challenges");
    outcome.repaired = true;
  }

  // F45 — convert/create ephemeral TTL indexes before schema createIndexes on
  // challenges/tokens/sessions (avoids IndexOptionsConflict with legacy expiresAt_1).
  try {
    const ttlResults = await ensureTenantEphemeralTtlIndexes(conn);
    outcome.ephemeralTtlIndexes = ttlResults;
    outcome.indexesCreated.push(
      "F45 ephemeral TTL: authTokens, authSessions.purgeAt, attendance_verification_challenges"
    );
  } catch (ttlErr) {
    outcome.indexFailures.push({
      collection: "ephemeral_ttl",
      phase: "createIndexes",
      message: ttlErr.message,
      summary: "F45 ensureTenantEphemeralTtlIndexes",
    });
    console.warn(
      `[TenantProvisioning] Ephemeral TTL ensure failed on ${outcome.databaseName}:`,
      ttlErr.message
    );
  }

  const AttendanceVerificationChallenge = getAttendanceVerificationChallengeModel(conn);
  await createIndexesTracked(
    outcome,
    AttendanceVerificationChallenge,
    "attendance_verification_challenges: nonce unique, employeeId+purpose"
  );

  // 7. Ensure live_tracking_sessions collection exists
  if (!existingColNames.has("live_tracking_sessions")) {
    await db.createCollection("live_tracking_sessions");
    outcome.collectionsCreated.push("live_tracking_sessions");
    outcome.repaired = true;
  }

  const LiveTrackingSession = getLiveTrackingSessionModel(conn);

  // F73 — cleanup duplicate ACTIVE sessions before unique partial index create.
  try {
    const cleanup = await cleanupDuplicateActiveSessions(LiveTrackingSession, {
      apply: true,
    });
    outcome.liveTrackingActiveCleanup = cleanup;
    if (cleanup.stopped > 0) {
      outcome.repaired = true;
      outcome.indexesCreated.push(
        `live_tracking_sessions: F73 stopped ${cleanup.stopped} duplicate ACTIVE session(s)`
      );
    }
  } catch (cleanupErr) {
    outcome.indexFailures.push({
      collection: "live_tracking_sessions",
      phase: "createIndexes",
      message: cleanupErr.message,
      summary: "F73 cleanupDuplicateActiveSessions",
    });
    console.warn(
      `[TenantProvisioning] F73 ACTIVE cleanup failed on ${outcome.databaseName}:`,
      cleanupErr.message
    );
  }

  // Ensure unique partial ACTIVE index (drop/recreate of wrong same-name index
  // is encapsulated in ensureActiveEmployeeUniqueIndex — not syncIndexes).
  try {
    const ensured = await ensureActiveEmployeeUniqueIndex(
      LiveTrackingSession.collection
    );
    if (ensured.status === "created") {
      outcome.indexesCreated.push(
        `live_tracking_sessions: ${ensured.name} (unique partial ACTIVE)`
      );
      outcome.repaired = true;
    }
  } catch (uniqErr) {
    outcome.indexFailures.push({
      collection: "live_tracking_sessions",
      phase: "createIndexes",
      message: uniqErr.message,
      summary: "F73 uniq_live_tracking_active_employeeId",
    });
    console.warn(
      `[TenantProvisioning] F73 unique ACTIVE index failed on ${outcome.databaseName}:`,
      uniqErr.message
    );
  }

  await createIndexesTracked(
    outcome,
    LiveTrackingSession,
    "live_tracking_sessions: { employeeId: 1, status: 1 }, { startedAt: -1, status: 1 }, F73 unique ACTIVE"
  );

  // 8. Ensure payroll_cycles collection exists
  if (!existingColNames.has("payroll_cycles")) {
    await db.createCollection("payroll_cycles");
    outcome.collectionsCreated.push("payroll_cycles");
    outcome.repaired = true;
  }
  const PayrollCycle = getPayrollCycleModel(conn);
  await createIndexesTracked(
    outcome,
    PayrollCycle,
    "payroll_cycles: { periodYear: 1, periodMonth: 1 }"
  );

  // 9. Ensure payroll_payslips collection exists
  if (!existingColNames.has("payroll_payslips")) {
    await db.createCollection("payroll_payslips");
    outcome.collectionsCreated.push("payroll_payslips");
    outcome.repaired = true;
  }
  const Payslip = getPayslipModel(conn);
  await createIndexesTracked(
    outcome,
    Payslip,
    "payroll_payslips: { payrollCycleId: 1, employeeId: 1 }"
  );

  // 10. Ensure company_assets collection exists
  if (!existingColNames.has("company_assets")) {
    await db.createCollection("company_assets");
    outcome.collectionsCreated.push("company_assets");
    outcome.repaired = true;
  }
  const CompanyAsset = getCompanyAssetModel(conn);
  await createIndexesTracked(
    outcome,
    CompanyAsset,
    "company_assets: { assetTag: 1 (unique) }, { status: 1 }, { 'currentAssignment.employeeId': 1 }"
  );

  // 11. Ensure tasks collection exists for Work Management
  if (!existingColNames.has("tasks")) {
    await db.createCollection("tasks");
    outcome.collectionsCreated.push("tasks");
    outcome.repaired = true;
  }
  const Task = getTaskModel(conn);
  await createIndexesTracked(
    outcome,
    Task,
    "tasks: { assigneeId: 1, status: 1 }, { assignedByEmployeeId: 1, status: 1 }, { department: 1, status: 1 }, { deadline: 1 }"
  );

  // 12. Ensure impact_point_transactions collection exists
  if (!existingColNames.has("impact_point_transactions")) {
    await db.createCollection("impact_point_transactions");
    outcome.collectionsCreated.push("impact_point_transactions");
    outcome.repaired = true;
  }
  const ImpactPointTransaction = getImpactPointTransactionModel(conn);
  await createIndexesTracked(
    outcome,
    ImpactPointTransaction,
    "impact_point_transactions: { idempotencyKey: 1 (unique) }, { employeeId: 1, createdAt: -1 }, { 'employeeSnapshot.department': 1, points: 1 }"
  );

  // 13. Leave backup proposals (Phase 2 — proposed only, does not change task ownership)
  if (!existingColNames.has("leave_backup_proposals")) {
    await db.createCollection("leave_backup_proposals");
    outcome.collectionsCreated.push("leave_backup_proposals");
    outcome.repaired = true;
  }
  const LeaveBackupProposal = getLeaveBackupProposalModel(conn);
  await createIndexesTracked(
    outcome,
    LeaveBackupProposal,
    "leave_backup_proposals: { leaveRequestId: 1, taskId: 1 (unique) }, { proposedBackupEmployeeId: 1, status: 1 }"
  );

  // Phase 3 handover/delegation is embedded on leave_requests (no separate collections).
  // Ensure LeaveRequest indexes include handover query paths.
  await createIndexesTracked(
    outcome,
    getLeaveRequestModel(conn),
    "leave_requests: handover.status, handover.items.delegation.delegateEmployeeId+status, handover.items.taskId"
  );

  // Organization Explorer — Teams (Phase 4E)
  if (!existingColNames.has("teams")) {
    await db.createCollection("teams");
    outcome.collectionsCreated.push("teams");
    outcome.repaired = true;
  }
  const Team = getTeamModel(conn);
  await createIndexesTracked(
    outcome,
    Team,
    "teams: { nameNormalized: 1 (unique, active) }, { isActive: 1, name: 1 }, { memberEmployeeIds: 1 }, { leadEmployeeId: 1 }, { department: 1, isActive: 1 }"
  );

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
  await createIndexesTracked(
    outcome,
    Department,
    "departments: { normalizedName: 1 (unique) }, { isActive: 1, name: 1 }"
  );
  await createIndexesTracked(
    outcome,
    Project,
    "projects: { normalizedName: 1 (unique) }, { isActive: 1, status: 1, name: 1 }"
  );
  await createIndexesTracked(
    outcome,
    ProjectMembership,
    "project_memberships: active unique (employeeId, projectId), { projectId: 1, status: 1 }"
  );

  // Notifications + bounded read-state (F32/F33)
  if (!existingColNames.has("notifications")) {
    await db.createCollection("notifications");
    outcome.collectionsCreated.push("notifications");
    outcome.repaired = true;
  }
  await createIndexesTracked(
    outcome,
    getNotificationModel(conn),
    "notifications: userId+createdAt, userId+role+createdAt, userId+isRead+createdAt"
  );

  if (!existingColNames.has("notification_read_states")) {
    await db.createCollection("notification_read_states");
    outcome.collectionsCreated.push("notification_read_states");
    outcome.repaired = true;
  }
  await createIndexesTracked(
    outcome,
    getNotificationReadStateModel(conn),
    "notification_read_states: unique (userId, notificationKey)"
  );

  // AuthSession revoke-all indexes (F31) — createIndexes is additive / idempotent
  // (F45 purgeAt TTL already ensured earlier in this provision pass.)
  await createIndexesTracked(
    outcome,
    getAuthSessionModel(conn),
    "authSessions: { userId: 1, isActive: 1 }, { token: 1, isActive: 1 }"
  );

  // Users: keep onboarding.offerLetterId index for hiring $lookup filters (F34)
  await createIndexesTracked(
    outcome,
    getUserModel(conn),
    "users: onboarding.offerLetterId (hiring lookup support)"
  );

  // F44 + getCompanyModels coverage — models previously missing createIndexes
  for (const col of [
    "employees",
    "settlements",
    "employee_compensation",
    "authTokens",
    "audit_logs",
    "conversations",
    "conversationMembers",
    "messages",
    "remote_work_requests",
    "location_exceptions",
    "chat_files",
    "announcements",
    "announcementReads",
    "designations",
  ]) {
    if (!existingColNames.has(col)) {
      await db.createCollection(col);
      outcome.collectionsCreated.push(col);
      outcome.repaired = true;
    }
  }

  await createIndexesTracked(
    outcome,
    getEmployeeModel(conn),
    "employees: status/createdAt/dept/project/manager/fullName + unique userId/employeeCode"
  );
  await createIndexesTracked(
    outcome,
    getSettlementModel(conn),
    "settlements: { employeeId: 1, createdAt: -1 }, { status: 1, createdAt: -1 }"
  );
  await createIndexesTracked(
    outcome,
    getEmployeeCompensationModel(conn),
    "employee_compensation: unique employeeId"
  );
  await createIndexesTracked(
    outcome,
    getAuthTokenModel(conn),
    "authTokens: email, token unique, expiresAt, isActive"
  );
  await createIndexesTracked(
    outcome,
    getAuditLogModel(conn),
    "audit_logs: { targetId: 1, action: 1 }, actorUserId, timestamp"
  );
  await createIndexesTracked(
    outcome,
    getConversationModel(conn),
    "conversations: partial unique directKey, lastMessageAt"
  );
  await createIndexesTracked(
    outcome,
    getConversationMemberModel(conn),
    "conversationMembers: unique (conversationId, userId), userId+leftAt"
  );
  await createIndexesTracked(
    outcome,
    getMessageModel(conn),
    "messages: conversationId+createdAt+_id, message_text_search"
  );
  await createIndexesTracked(
    outcome,
    getRemoteWorkRequestModel(conn),
    "remote_work_requests: employeeId+workDate+status, pending unique partial"
  );
  await createIndexesTracked(
    outcome,
    getLocationExceptionModel(conn),
    "location_exceptions: employeeId+workDate+type+status"
  );
  await createIndexesTracked(
    outcome,
    getChatFileModel(conn),
    "chat_files: conversationId+uploadedBy+messageId, messageId"
  );
  await createIndexesTracked(
    outcome,
    getAnnouncementModel(conn),
    "announcements: status+publishedAt, status+scheduledAt, audience"
  );
  await createIndexesTracked(
    outcome,
    getAnnouncementReadModel(conn),
    "announcementReads: unique announcementId+userId"
  );
  await createIndexesTracked(
    outcome,
    getDesignationModel(conn),
    "designations: unique normalizedTitle, isActive+title"
  );

  // Fold legacy offer-letter indexErrors into the unified failure list.
  for (const err of outcome.indexErrors || []) {
    outcome.indexFailures.push({
      collection: err.collection || "offer_letters",
      phase: "createIndexes",
      message: err.message,
      index: err.index,
    });
  }

  // F43 — verify all required schema indexes before stamping version
  let inventory;
  try {
    inventory = await inventoryTenantConnection(conn);
  } catch (verifyErr) {
    inventory = {
      ok: false,
      missingCount: -1,
      indexSchemaVersion: TENANT_INDEX_SCHEMA_VERSION,
      models: [],
    };
    outcome.indexFailures.push({
      collection: "*",
      phase: "verify",
      message: verifyErr.message,
    });
  }
  outcome.indexInventory = {
    ok: inventory.ok,
    missingCount: inventory.missingCount,
    indexSchemaVersion: inventory.indexSchemaVersion,
  };

  const createFailedCollections = new Set(
    outcome.indexFailures
      .filter((f) => f.phase === "createIndexes")
      .map((f) => f.collection)
  );

  for (const modelReport of inventory.models) {
    if (modelReport.ok) continue;
    // Avoid double-counting the same collection after a createIndexes failure.
    if (createFailedCollections.has(modelReport.collection)) continue;
    outcome.indexFailures.push({
      collection: modelReport.collection,
      phase: "verify",
      message:
        modelReport.error ||
        `Missing expected indexes: ${JSON.stringify(modelReport.missing)}`,
      missing: modelReport.missing,
      label: modelReport.label,
    });
  }

  const offerIdx = outcome.offerLetterEmployeeIdIndex;
  const offerEmployeeIdOk = Boolean(offerIdx) && offerIdx.status === "ok";
  if (!offerIdx) {
    outcome.indexFailures.push({
      collection: "offer_letters",
      phase: "verify",
      message: "offerLetterEmployeeIdIndex result missing after provision",
      label: "OfferLetter.employeeId",
    });
  } else if (offerIdx.status !== "ok") {
    const already = outcome.indexFailures.some(
      (f) => f.collection === "offer_letters" && f.label === "OfferLetter.employeeId"
    );
    if (!already) {
      outcome.indexFailures.push({
        collection: "offer_letters",
        phase: "verify",
        message:
          offerIdx.message ||
          `offer letter employeeId index status=${offerIdx.status}`,
        label: "OfferLetter.employeeId",
      });
    }
  }

  // Critical stamp gate: inventory + offer employeeId result + zero failures.
  const indexesOk =
    inventory.ok && offerEmployeeIdOk && outcome.indexFailures.length === 0;
  outcome.indexesFullyApplied = indexesOk;

  if (indexesOk) {
    try {
      const stamp = await stampTenantIndexSchemaVersion(company);
      if (stamp.stamped) {
        outcome.tenantIndexSchemaVersionStamped = stamp.version;
        outcome.fullyProvisioned = true;
      } else {
        outcome.fullyProvisioned = false;
        outcome.indexFailures.push({
          collection: "companies",
          phase: "stamp",
          message: stamp.reason || "Failed to stamp tenantIndexSchemaVersion",
        });
      }
    } catch (stampErr) {
      outcome.fullyProvisioned = false;
      outcome.indexFailures.push({
        collection: "companies",
        phase: "stamp",
        message: stampErr.message,
      });
      console.warn(
        `[TenantProvisioning] Failed to stamp index schema version for ${company.databaseName}:`,
        stampErr.message
      );
    }
  } else {
    outcome.fullyProvisioned = false;
    console.warn(
      `[TenantProvisioning] Index verification incomplete for ${company.databaseName}; not stamping tenantIndexSchemaVersion. Failures:`,
      outcome.indexFailures.map((f) => `${f.collection}:${f.phase}`).join(", ")
    );
  }

  if (outcome.indexFailures.length > 0) {
    outcome.message = `Tenant database '${company.databaseName}' provisioned with index failures (${outcome.indexFailures.length}); schema version not fully stamped.`;
  } else if (outcome.repaired) {
    outcome.message = `Tenant database '${company.databaseName}' was successfully repaired/provisioned (index schema v${TENANT_INDEX_SCHEMA_VERSION}).`;
  } else {
    outcome.message = `Tenant database '${company.databaseName}' is fully provisioned and up to date (index schema v${TENANT_INDEX_SCHEMA_VERSION}).`;
  }

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
    indexIncomplete: [],
    needsManualConfiguration: [],
    errors: [],
    indexSchemaVersion: TENANT_INDEX_SCHEMA_VERSION,
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
      const outcome = await runWithTenantConnectionScope(() =>
        provisionTenantDatabase(company)
      );

      if (outcome.indexFailures?.length) {
        report.indexIncomplete.push({
          slug,
          databaseName: dbName,
          indexFailures: outcome.indexFailures,
          tenantIndexSchemaVersionStamped: outcome.tenantIndexSchemaVersionStamped,
        });
        report.errors.push({
          slug,
          databaseName: dbName,
          error: `Index provisioning incomplete (${outcome.indexFailures.length} failure(s))`,
          indexFailures: outcome.indexFailures,
        });
      } else if (outcome.repaired) {
        report.repaired.push({
          slug,
          databaseName: dbName,
          collectionsCreated: outcome.collectionsCreated,
          policyProvisioned: outcome.policyProvisioned,
          policyUpdated: outcome.policyUpdated,
          tenantIndexSchemaVersionStamped: outcome.tenantIndexSchemaVersionStamped,
        });
      } else {
        report.alreadyUpToDate.push({
          slug,
          databaseName: dbName,
          tenantIndexSchemaVersionStamped: outcome.tenantIndexSchemaVersionStamped,
        });
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
