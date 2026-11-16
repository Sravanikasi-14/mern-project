/**
 * F43/F44 — shared helpers for expected tenant indexes (read-only inventory + provision verify).
 * Additive only: never drops or syncs indexes.
 *
 * TENANT_INDEX_SCHEMA_VERSION covers every getCompanyModels() tenant model that declares
 * schema indexes. Bump when the required set or matcher semantics change.
 */

/** Bump when required inventory set or verification semantics change. */
export const TENANT_INDEX_SCHEMA_VERSION = 3;

/**
 * Serialize an index key preserving Mongo/Mongoose field order (do not sort).
 * @param {Record<string, unknown>} key
 */
export function serializeIndexKey(key) {
  if (!key || typeof key !== "object") return "";
  return Object.keys(key)
    .map((k) => `${k}:${JSON.stringify(key[k])}`)
    .join("|");
}

/** @deprecated use serializeIndexKey — kept name alias for older tests */
export function normalizeIndexKey(key) {
  return serializeIndexKey(key);
}

function isTextKeySpec(key) {
  return Object.values(key || {}).some((v) => v === "text");
}

function stableStringify(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

function normalizePartialFilter(pfe) {
  if (!pfe || typeof pfe !== "object") return null;
  return stableStringify(pfe);
}

function normalizeWeights(weights) {
  if (!weights || typeof weights !== "object") return null;
  const out = {};
  for (const k of Object.keys(weights).sort()) {
    out[k] = Number(weights[k]);
  }
  return out;
}

function weightsEqual(a, b) {
  const na = normalizeWeights(a);
  const nb = normalizeWeights(b);
  if (!na && !nb) return true;
  if (!na || !nb) return false;
  return stableStringify(na) === stableStringify(nb);
}

/**
 * Collect expected index specs from a Mongoose schema (compound + path-level index/unique).
 * Preserves compound key order; captures unique/sparse/partialFilterExpression/weights.
 * @param {import("mongoose").Schema} schema
 */
export function expectedIndexesFromSchema(schema) {
  const expected = [];
  const seen = new Set();

  const add = (key, extra = {}) => {
    if (!key || typeof key !== "object") return;
    const text = Boolean(extra.text) || isTextKeySpec(key);
    const id = [
      serializeIndexKey(key),
      extra.name || "",
      text ? "text" : "",
      extra.unique ? "U" : "",
      extra.sparse ? "S" : "",
      normalizePartialFilter(extra.partialFilterExpression) || "",
      extra.weights ? stableStringify(normalizeWeights(extra.weights)) : "",
    ].join("~");
    if (seen.has(id)) return;
    seen.add(id);
    expected.push({
      key,
      unique: Boolean(extra.unique),
      sparse: Boolean(extra.sparse),
      name: extra.name || undefined,
      text,
      partialFilterExpression: extra.partialFilterExpression || undefined,
      weights: extra.weights || undefined,
    });
  };

  for (const entry of schema.indexes() || []) {
    const fields = entry[0] || {};
    const options = entry[1] || {};
    const text = isTextKeySpec(fields);
    add(fields, {
      unique: Boolean(options.unique),
      sparse: Boolean(options.sparse),
      name: options.name || undefined,
      text,
      partialFilterExpression: options.partialFilterExpression,
      weights: text ? options.weights : undefined,
    });
  }

  schema.eachPath((pathname, schematype) => {
    if (pathname === "_id") return;
    const opts = schematype?.options || {};
    if (!opts.index && !opts.unique) return;
    const indexOpts = typeof opts.index === "object" && opts.index ? opts.index : {};
    add(
      { [pathname]: 1 },
      {
        unique: Boolean(opts.unique || indexOpts.unique),
        sparse: Boolean(opts.sparse || indexOpts.sparse),
        name: indexOpts.name || undefined,
        partialFilterExpression:
          opts.partialFilterExpression || indexOpts.partialFilterExpression,
      }
    );
  });

  return expected;
}

/**
 * Whether an actual Mongo index satisfies an expected schema index.
 * @param {object} actual — from collection.indexes()
 * @param {object} expected
 */
export function actualMatchesExpected(actual, expected) {
  if (!actual?.key || !expected?.key) return false;

  const expectedIsText = expected.text || isTextKeySpec(expected.key);
  if (expectedIsText) {
    const actualIsText =
      actual.textIndexVersion != null ||
      Object.prototype.hasOwnProperty.call(actual.key, "_fts") ||
      Object.values(actual.key).some((v) => v === "text");
    if (!actualIsText) return false;
    if (expected.name && actual.name !== expected.name) return false;

    // Build expected weights from options or from text fields (default weight 1).
    let expectedWeights = expected.weights;
    if (!expectedWeights) {
      expectedWeights = {};
      for (const [field, spec] of Object.entries(expected.key)) {
        if (spec === "text") expectedWeights[field] = 1;
      }
    }
    if (!weightsEqual(expectedWeights, actual.weights)) return false;

    // Every expected text field must appear in actual weights.
    for (const [field, spec] of Object.entries(expected.key)) {
      if (spec !== "text") continue;
      if (actual.weights == null || actual.weights[field] == null) return false;
    }
    return true;
  }

  if (serializeIndexKey(actual.key) !== serializeIndexKey(expected.key)) return false;

  if (Boolean(actual.unique) !== Boolean(expected.unique)) return false;
  if (Boolean(actual.sparse) !== Boolean(expected.sparse)) return false;

  const expectedPfe = normalizePartialFilter(expected.partialFilterExpression);
  const actualPfe = normalizePartialFilter(actual.partialFilterExpression);
  if (expectedPfe !== actualPfe) return false;

  // When schema names the index, require that exact name on the actual index.
  if (expected.name && actual.name !== expected.name) return false;

  return true;
}

/**
 * Describe why an expected index did not match any actual index (for tests/diagnostics).
 */
export function explainIndexMismatch(actualIndexes, expected) {
  const candidates = (actualIndexes || []).filter((act) => {
    if (!act?.key || !expected?.key) return false;
    if (expected.text || isTextKeySpec(expected.key)) {
      return (
        act.textIndexVersion != null ||
        Object.prototype.hasOwnProperty.call(act.key, "_fts") ||
        Object.values(act.key).some((v) => v === "text")
      );
    }
    return serializeIndexKey(act.key) === serializeIndexKey(expected.key);
  });
  if (candidates.length === 0) {
    return `no index with key ${serializeIndexKey(expected.key)}`;
  }
  for (const act of candidates) {
    if (actualMatchesExpected(act, expected)) return null;
  }
  return `key found but options mismatch (unique/sparse/partial/weights/name) for ${serializeIndexKey(expected.key)}`;
}

/**
 * Read-only: compare model schema expectations to indexes currently on the collection.
 * @param {import("mongoose").Model} model
 */
export async function verifyModelIndexes(model) {
  const collectionName = model.collection?.collectionName || model.collection?.name;
  const expected = expectedIndexesFromSchema(model.schema);
  let actual = [];
  try {
    actual = await model.collection.indexes();
  } catch (err) {
    return {
      ok: false,
      collection: collectionName,
      expected,
      actual: [],
      missing: expected,
      error: err.message,
    };
  }

  const missing = expected.filter(
    (exp) => !actual.some((act) => actualMatchesExpected(act, exp))
  );

  return {
    ok: missing.length === 0,
    collection: collectionName,
    expected,
    actual,
    missing,
  };
}

/**
 * @typedef {{ id: string, label: string, getModel: Function }} IndexModelSpec
 */

/** @type {IndexModelSpec[] | null} */
let cachedSpecs = null;

/**
 * Every getCompanyModels() tenant model that declares schema indexes.
 * Exclusions (documented): none — connection itself is not a model.
 * OfferLetter.employeeId unique partial is enforced separately via
 * ensureOfferLetterEmployeeIdIndex (not a Mongoose schema.index entry).
 */
export async function getRequiredIndexModelSpecs() {
  if (cachedSpecs) return cachedSpecs;

  const { getLeaveRequestModel } = await import("../models/LeaveRequest.js");
  const { getCompanyHrPolicyModel } = await import("../models/CompanyHrPolicy.js");
  const { getOfferLetterModel } = await import("../models/OfferLetter.js");
  const { getOfferTemplateModel } = await import("../models/OfferTemplate.js");
  const { getAttendanceModel } = await import("../models/Attendance.js");
  const { getEmployeeFaceEnrollmentModel } = await import("../models/EmployeeFaceEnrollment.js");
  const { getAttendanceVerificationChallengeModel } = await import(
    "../models/AttendanceVerificationChallenge.js"
  );
  const { getLiveTrackingSessionModel } = await import("../models/LiveTrackingSession.js");
  const { getRemoteWorkRequestModel } = await import("../models/RemoteWorkRequest.js");
  const { getLocationExceptionModel } = await import("../models/LocationException.js");
  const { getPayrollCycleModel } = await import("../models/PayrollCycle.js");
  const { getPayslipModel } = await import("../models/Payslip.js");
  const { getCompanyAssetModel } = await import("../models/CompanyAsset.js");
  const { getTaskModel } = await import("../models/Task.js");
  const { getImpactPointTransactionModel } = await import("../models/ImpactPointTransaction.js");
  const { getLeaveBackupProposalModel } = await import("../models/LeaveBackupProposal.js");
  const { getTeamModel } = await import("../models/Team.js");
  const { getDepartmentModel } = await import("../models/Department.js");
  const { getDesignationModel } = await import("../models/Designation.js");
  const { getProjectModel } = await import("../models/Project.js");
  const { getProjectMembershipModel } = await import("../models/ProjectMembership.js");
  const { getNotificationModel } = await import("../models/Notification.js");
  const { getNotificationReadStateModel } = await import("../models/NotificationReadState.js");
  const { getAuthSessionModel } = await import("../models/AuthSession.js");
  const { getUserModel } = await import("../models/User.js");
  const { getEmployeeModel } = await import("../models/Employee.js");
  const { getSettlementModel } = await import("../models/Settlement.js");
  const { getEmployeeCompensationModel } = await import("../models/EmployeeCompensation.js");
  const { getAuthTokenModel } = await import("../models/AuthToken.js");
  const { getAuditLogModel } = await import("../models/AuditLog.js");
  const { getConversationModel } = await import("../models/Conversation.js");
  const { getConversationMemberModel } = await import("../models/ConversationMember.js");
  const { getMessageModel } = await import("../models/Message.js");
  const { getChatFileModel } = await import("../models/ChatFile.js");
  const { getAnnouncementModel } = await import("../models/Announcement.js");
  const { getAnnouncementReadModel } = await import("../models/AnnouncementRead.js");

  cachedSpecs = [
    { id: "leave_requests", label: "LeaveRequest", getModel: getLeaveRequestModel },
    { id: "company_hr_policies", label: "CompanyHrPolicy", getModel: getCompanyHrPolicyModel },
    { id: "offer_letters", label: "OfferLetter", getModel: getOfferLetterModel },
    { id: "offer_templates", label: "OfferTemplate", getModel: getOfferTemplateModel },
    { id: "attendances", label: "Attendance", getModel: getAttendanceModel },
    {
      id: "employee_face_enrollments",
      label: "EmployeeFaceEnrollment",
      getModel: getEmployeeFaceEnrollmentModel,
    },
    {
      id: "attendance_verification_challenges",
      label: "AttendanceVerificationChallenge",
      getModel: getAttendanceVerificationChallengeModel,
    },
    { id: "live_tracking_sessions", label: "LiveTrackingSession", getModel: getLiveTrackingSessionModel },
    { id: "remote_work_requests", label: "RemoteWorkRequest", getModel: getRemoteWorkRequestModel },
    { id: "location_exceptions", label: "LocationException", getModel: getLocationExceptionModel },
    { id: "payroll_cycles", label: "PayrollCycle", getModel: getPayrollCycleModel },
    { id: "payroll_payslips", label: "Payslip", getModel: getPayslipModel },
    { id: "company_assets", label: "CompanyAsset", getModel: getCompanyAssetModel },
    { id: "tasks", label: "Task", getModel: getTaskModel },
    {
      id: "impact_point_transactions",
      label: "ImpactPointTransaction",
      getModel: getImpactPointTransactionModel,
    },
    { id: "leave_backup_proposals", label: "LeaveBackupProposal", getModel: getLeaveBackupProposalModel },
    { id: "teams", label: "Team", getModel: getTeamModel },
    { id: "departments", label: "Department", getModel: getDepartmentModel },
    { id: "designations", label: "Designation", getModel: getDesignationModel },
    { id: "projects", label: "Project", getModel: getProjectModel },
    { id: "project_memberships", label: "ProjectMembership", getModel: getProjectMembershipModel },
    { id: "notifications", label: "Notification", getModel: getNotificationModel },
    {
      id: "notification_read_states",
      label: "NotificationReadState",
      getModel: getNotificationReadStateModel,
    },
    { id: "authSessions", label: "AuthSession", getModel: getAuthSessionModel },
    { id: "users", label: "User", getModel: getUserModel },
    { id: "employees", label: "Employee", getModel: getEmployeeModel },
    { id: "settlements", label: "Settlement", getModel: getSettlementModel },
    {
      id: "employee_compensation",
      label: "EmployeeCompensation",
      getModel: getEmployeeCompensationModel,
    },
    { id: "authTokens", label: "AuthToken", getModel: getAuthTokenModel },
    { id: "audit_logs", label: "AuditLog", getModel: getAuditLogModel },
    { id: "conversations", label: "Conversation", getModel: getConversationModel },
    { id: "conversationMembers", label: "ConversationMember", getModel: getConversationMemberModel },
    { id: "messages", label: "Message", getModel: getMessageModel },
    { id: "chat_files", label: "ChatFile", getModel: getChatFileModel },
    { id: "announcements", label: "Announcement", getModel: getAnnouncementModel },
    { id: "announcementReads", label: "AnnouncementRead", getModel: getAnnouncementReadModel },
  ];

  return cachedSpecs;
}

/**
 * Read-only inventory for one tenant connection.
 * @param {import("mongoose").Connection} conn
 */
export async function inventoryTenantConnection(conn) {
  const specs = await getRequiredIndexModelSpecs();
  const results = [];
  let missingCount = 0;

  for (const spec of specs) {
    const model = spec.getModel(conn);
    const verification = await verifyModelIndexes(model);
    if (!verification.ok) missingCount += verification.missing.length;
    results.push({
      id: spec.id,
      label: spec.label,
      collection: verification.collection || spec.id,
      ok: verification.ok,
      missing: verification.missing.map((m) => ({
        key: m.key,
        name: m.name || null,
        text: Boolean(m.text),
        unique: Boolean(m.unique),
        sparse: Boolean(m.sparse),
        partialFilterExpression: m.partialFilterExpression || null,
        weights: m.weights || null,
      })),
      actualIndexNames: (verification.actual || []).map((a) => a.name),
      error: verification.error || null,
    });
  }

  return {
    indexSchemaVersion: TENANT_INDEX_SCHEMA_VERSION,
    ok: missingCount === 0,
    missingCount,
    models: results,
  };
}
