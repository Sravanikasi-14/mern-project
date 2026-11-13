import { AsyncLocalStorage } from "node:async_hooks";
import mongoose from "mongoose";
import Company from "../models/Company.js";
import { getAuthSessionModel } from "../models/AuthSession.js";
import { getAuthTokenModel } from "../models/AuthToken.js";
import { getEmployeeModel } from "../models/Employee.js";
import { getEmployeeCompensationModel } from "../models/EmployeeCompensation.js";
import { getUserModel } from "../models/User.js";
import { getAuditLogModel } from "../models/AuditLog.js";
import { getLeaveRequestModel } from "../models/LeaveRequest.js";
import { getCompanyHrPolicyModel } from "../models/CompanyHrPolicy.js";
import { getOfferLetterModel } from "../models/OfferLetter.js";
import { getOfferTemplateModel } from "../models/OfferTemplate.js";
import { getSettlementModel } from "../models/Settlement.js";
import { getAttendanceModel } from "../models/Attendance.js";
import { getLiveTrackingSessionModel } from "../models/LiveTrackingSession.js";
import { getPayrollCycleModel } from "../models/PayrollCycle.js";
import { getPayslipModel } from "../models/Payslip.js";
import { getCompanyAssetModel } from "../models/CompanyAsset.js";
import { getTaskModel } from "../models/Task.js";
import { getImpactPointTransactionModel } from "../models/ImpactPointTransaction.js";
import { getNotificationModel } from "../models/Notification.js";
import { getNotificationReadStateModel } from "../models/NotificationReadState.js";
import { getConversationModel } from "../models/Conversation.js";
import { getConversationMemberModel } from "../models/ConversationMember.js";
import { getMessageModel } from "../models/Message.js";
import { getChatFileModel } from "../models/ChatFile.js";
import { getAnnouncementModel } from "../models/Announcement.js";
import { getAnnouncementReadModel } from "../models/AnnouncementRead.js";
import { getLeaveBackupProposalModel } from "../models/LeaveBackupProposal.js";
import { getTeamModel } from "../models/Team.js";
import { getDepartmentModel } from "../models/Department.js";
import { getDesignationModel } from "../models/Designation.js";
import { getProjectModel } from "../models/Project.js";
import { getProjectMembershipModel } from "../models/ProjectMembership.js";
import { getRemoteWorkRequestModel } from "../models/RemoteWorkRequest.js";
import { getLocationExceptionModel } from "../models/LocationException.js";
import { getEmployeeFaceEnrollmentModel } from "../models/EmployeeFaceEnrollment.js";
import { getAttendanceVerificationChallengeModel } from "../models/AttendanceVerificationChallenge.js";
import { HttpError } from "../utils/httpError.js";

/**
 * Per-process tenant connection cache (F35).
 *
 * Each entry is one mongoose connection bound to a single tenant dbName.
 * Limits below are **per Node/Vercel instance**, not deployment-wide.
 *
 * Active-use safety: HTTP requests and job scopes auto-retain via
 * AsyncLocalStorage ({@link runWithTenantConnectionScope} /
 * {@link tenantConnectionScopeMiddleware}). Eviction never closes
 * refCount > 0. Ordinary controllers do not call retain/release manually.
 *
 * @typedef {{
 *   databaseName: string,
 *   connection: import("mongoose").Connection | null,
 *   connectPromise: Promise<import("mongoose").Connection> | null,
 *   lastUsedAt: number,
 *   refCount: number,
 * }} TenantConnectionEntry
 *
 * @typedef {{
 *   retains: Map<string, number>,
 *   ended?: boolean,
 * }} TenantConnectionScopeStore
 */

/** @type {Map<string, TenantConnectionEntry>} */
const tenantConnections = new Map();

/** @type {AsyncLocalStorage<TenantConnectionScopeStore>} */
const tenantConnectionScope = new AsyncLocalStorage();

const DATABASE_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;

function parsePositiveInt(value, fallback) {
  const n = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * Runtime configuration for tenant Mongo connections (read on each use so tests
 * can adjust env without reloading the module).
 */
export function getTenantConnectionConfig() {
  return {
    /** Max cached tenant DB connections in this process. */
    cacheMax: Math.max(1, parsePositiveInt(process.env.TENANT_CONN_CACHE_MAX, 50)),
    /**
     * Prefer evicting unpinned entries idle at least this long (ms).
     * 0 = any unpinned (refCount===0) entry is immediately eligible under pressure.
     * Idle is measured from last touch/release — active scopes keep refCount > 0
     * so in-flight work is not treated as idle.
     */
    idleEvictMs: parsePositiveInt(process.env.TENANT_CONN_IDLE_EVICT_MS, 60_000),
    /** Mongoose/driver pool size per tenant connection. */
    maxPoolSize: Math.max(1, parsePositiveInt(process.env.TENANT_MONGO_MAX_POOL_SIZE, 5)),
    minPoolSize: parsePositiveInt(process.env.TENANT_MONGO_MIN_POOL_SIZE, 0),
    /** Driver closes idle pooled sockets after this many ms. */
    maxIdleTimeMS: parsePositiveInt(process.env.TENANT_MONGO_MAX_IDLE_MS, 30_000),
    serverSelectionTimeoutMS: parsePositiveInt(process.env.TENANT_MONGO_SERVER_SELECTION_MS, 8_000),
  };
}

function buildTenantConnectionOptions(databaseName) {
  const cfg = getTenantConnectionConfig();
  return {
    dbName: databaseName,
    maxPoolSize: cfg.maxPoolSize,
    minPoolSize: Math.min(cfg.minPoolSize, cfg.maxPoolSize),
    maxIdleTimeMS: cfg.maxIdleTimeMS,
    serverSelectionTimeoutMS: cfg.serverSelectionTimeoutMS,
  };
}

export function getCentralDbName() {
  return process.env.CENTRAL_DB_NAME || "platform";
}

export function getMongoUri() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error("MONGO_URI is not set");
  }
  return uri;
}

let centralConnectionPromise = null;

export async function connectCentralDB() {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  if (centralConnectionPromise) {
    return centralConnectionPromise;
  }

  centralConnectionPromise = (async () => {
    try {
      await mongoose.connect(getMongoUri(), {
        dbName: getCentralDbName(),
        serverSelectionTimeoutMS: 8000,
      });
      if (process.env.NODE_ENV !== "test") {
        console.log("Central MongoDB connected");
      }
      return mongoose.connection;
    } catch (error) {
      centralConnectionPromise = null;
      console.error("MongoDB connection failed:", error.message || error);
      throw error;
    }
  })();

  return centralConnectionPromise;
}

function isConnectionReady(connection) {
  return Boolean(connection && connection.readyState === 1);
}

function isConnectionConnecting(connection) {
  return Boolean(connection && connection.readyState === 2);
}

function touchEntry(entry) {
  entry.lastUsedAt = Date.now();
}

/**
 * Snapshot of the per-process tenant connection cache (for ops/tests).
 * Does not include secrets or URIs.
 */
export function getTenantConnectionStats() {
  const cfg = getTenantConnectionConfig();
  const entries = [...tenantConnections.values()].map((entry) => ({
    databaseName: entry.databaseName,
    readyState: entry.connection?.readyState ?? null,
    refCount: entry.refCount,
    lastUsedAt: entry.lastUsedAt,
    connecting: Boolean(entry.connectPromise),
  }));
  return {
    size: tenantConnections.size,
    cacheMax: cfg.cacheMax,
    idleEvictMs: cfg.idleEvictMs,
    maxPoolSize: cfg.maxPoolSize,
    entries,
  };
}

/**
 * Mark a cached tenant connection as actively in use so eviction will not close it.
 * Prefer {@link runWithTenantConnectionScope} / middleware for automatic pairing.
 */
export function retainTenantConnection(databaseName) {
  const entry = tenantConnections.get(databaseName);
  if (!entry) return false;
  entry.refCount += 1;
  touchEntry(entry);
  return true;
}

/**
 * Release a previous {@link retainTenantConnection} hold.
 */
export function releaseTenantConnection(databaseName) {
  const entry = tenantConnections.get(databaseName);
  if (!entry) return;
  entry.refCount = Math.max(0, entry.refCount - 1);
  touchEntry(entry);
}

/**
 * Release all retains tracked by a scope store (safe outside ALS, e.g. res 'finish').
 * @param {TenantConnectionScopeStore} store
 */
export function releaseTenantConnectionScopeStore(store) {
  if (!store || store.ended) return;
  store.ended = true;
  for (const [databaseName, count] of store.retains.entries()) {
    for (let i = 0; i < count; i += 1) {
      releaseTenantConnection(databaseName);
    }
  }
  store.retains.clear();
}

/**
 * Run async work with automatic retain/release for every tenant DB touched inside.
 * Used by cron/provisioning loops and tests. HTTP uses {@link tenantConnectionScopeMiddleware}.
 */
export async function runWithTenantConnectionScope(fn) {
  const store = { retains: new Map(), ended: false };
  try {
    return await tenantConnectionScope.run(store, fn);
  } finally {
    releaseTenantConnectionScopeStore(store);
  }
}

/**
 * Express middleware: one scope per HTTP request; releases on finish/close.
 * Must run before routes that open tenant connections (including authenticate).
 */
export function tenantConnectionScopeMiddleware(req, res, next) {
  const store = { retains: new Map(), ended: false };
  const end = () => {
    releaseTenantConnectionScopeStore(store);
  };
  res.on("finish", end);
  res.on("close", end);
  tenantConnectionScope.run(store, () => next());
}

/**
 * Inside an active scope, retain each tenant DB at most once until scope ends.
 * Controllers calling getCompanyModels repeatedly do not stack retains.
 */
function retainInActiveScope(databaseName) {
  const store = tenantConnectionScope.getStore();
  if (!store || store.ended) return;
  if (store.retains.has(databaseName)) {
    const existing = tenantConnections.get(databaseName);
    if (existing) touchEntry(existing);
    return;
  }
  if (retainTenantConnection(databaseName)) {
    store.retains.set(databaseName, 1);
  }
}

/**
 * Pick an eviction candidate.
 * Never closes refCount > 0 (active scoped/manual retain).
 * Prefer longest-idle past idleEvictMs; under pressure, LRU among other unpinned
 * entries (safe because active requests/jobs hold refCount via scopes).
 * @returns {TenantConnectionEntry | null}
 */
function pickEvictionCandidate(excludeDatabaseName) {
  const { idleEvictMs } = getTenantConnectionConfig();
  const now = Date.now();
  /** @type {TenantConnectionEntry | null} */
  let idleBest = null;
  /** @type {TenantConnectionEntry | null} */
  let unpinnedBest = null;

  for (const entry of tenantConnections.values()) {
    if (entry.databaseName === excludeDatabaseName) continue;
    if (entry.refCount > 0) continue;
    // Do not evict an in-flight first connect for another tenant mid-await.
    if (entry.connectPromise && !isConnectionReady(entry.connection)) continue;

    if (!unpinnedBest || entry.lastUsedAt < unpinnedBest.lastUsedAt) {
      unpinnedBest = entry;
    }
    if (now - entry.lastUsedAt >= idleEvictMs) {
      if (!idleBest || entry.lastUsedAt < idleBest.lastUsedAt) {
        idleBest = entry;
      }
    }
  }

  return idleBest || unpinnedBest;
}

async function closeTenantEntry(entry) {
  const current = tenantConnections.get(entry.databaseName);
  if (current !== entry) {
    return;
  }
  tenantConnections.delete(entry.databaseName);
  provisionedTenantDbs.delete(entry.databaseName);

  const connection = entry.connection;
  entry.connection = null;
  entry.connectPromise = null;
  entry.refCount = 0;

  if (connection && connection.readyState !== 0) {
    try {
      await connection.close();
    } catch (err) {
      if (process.env.NODE_ENV !== "test") {
        console.warn(
          `[db] Failed closing tenant connection ${entry.databaseName}:`,
          err?.message || err
        );
      }
    }
  }
}

/**
 * Ensure there is room for a new tenant dbName in this process cache.
 * Never closes retained (refCount > 0) connections.
 */
async function ensureTenantCacheCapacity(databaseName) {
  const { cacheMax } = getTenantConnectionConfig();

  while (tenantConnections.size >= cacheMax && !tenantConnections.has(databaseName)) {
    const victim = pickEvictionCandidate(databaseName);
    if (!victim) {
      throw new HttpError(
        503,
        "Tenant database connection capacity reached on this instance"
      );
    }
    await closeTenantEntry(victim);
  }
}

async function removeDeadTenantEntry(databaseName) {
  const entry = tenantConnections.get(databaseName);
  if (!entry) return;
  if (entry.connectPromise) return;
  if (isConnectionReady(entry.connection) || isConnectionConnecting(entry.connection)) {
    return;
  }
  await closeTenantEntry(entry);
}

/**
 * Returns a mongoose connection scoped to exactly one tenant database.
 * Reuses the per-process cache; coalesces concurrent first-connects for the same dbName.
 */
export async function getTenantConnection(databaseName) {
  if (typeof databaseName !== "string" || !DATABASE_NAME_PATTERN.test(databaseName)) {
    throw new HttpError(500, "Company database is not available");
  }

  // Bounded retry loop for race between dead-entry cleanup and concurrent creators.
  for (let attempt = 0; attempt < 8; attempt += 1) {
    let entry = tenantConnections.get(databaseName);

    if (entry?.connectPromise) {
      try {
        const connection = await entry.connectPromise;
        touchEntry(entry);
        retainInActiveScope(databaseName);
        return connection;
      } catch {
        // Failed connect removed the entry in the creator path; retry.
        continue;
      }
    }

    if (isConnectionReady(entry?.connection)) {
      touchEntry(entry);
      retainInActiveScope(databaseName);
      return entry.connection;
    }

    if (isConnectionConnecting(entry?.connection)) {
      try {
        await entry.connection.asPromise();
        touchEntry(entry);
        retainInActiveScope(databaseName);
        return entry.connection;
      } catch {
        await removeDeadTenantEntry(databaseName);
        continue;
      }
    }

    if (entry) {
      await removeDeadTenantEntry(databaseName);
    }

    await ensureTenantCacheCapacity(databaseName);

    // Another caller may have created the entry while we awaited eviction.
    entry = tenantConnections.get(databaseName);
    if (entry?.connectPromise || isConnectionReady(entry?.connection)) {
      continue;
    }

    /** @type {TenantConnectionEntry} */
    const newEntry = {
      databaseName,
      connection: null,
      connectPromise: null,
      lastUsedAt: Date.now(),
      refCount: 0,
    };

    // Claim the slot before awaiting so concurrent callers join this promise.
    if (tenantConnections.has(databaseName)) {
      continue;
    }
    tenantConnections.set(databaseName, newEntry);

    newEntry.connectPromise = (async () => {
      const connection = mongoose.createConnection(
        getMongoUri(),
        buildTenantConnectionOptions(databaseName)
      );
      newEntry.connection = connection;
      await connection.asPromise();
      touchEntry(newEntry);
      newEntry.connectPromise = null;
      return connection;
    })().catch(async (error) => {
      const still = tenantConnections.get(databaseName);
      if (still === newEntry) {
        tenantConnections.delete(databaseName);
      }
      newEntry.connectPromise = null;
      if (newEntry.connection && newEntry.connection.readyState !== 0) {
        try {
          await newEntry.connection.close();
        } catch {
          // ignore close errors after failed open
        }
      }
      newEntry.connection = null;
      throw error;
    });

    try {
      const connection = await newEntry.connectPromise;
      retainInActiveScope(databaseName);
      return connection;
    } catch {
      throw new HttpError(503, "Company database is not available");
    }
  }

  throw new HttpError(503, "Company database is not available");
}

const provisionedTenantDbs = new Set();

export async function getCompanyModels(company, { provision = false } = {}) {
  const connection = await getTenantConnection(company.databaseName);

  // In serverless production execution, skip automatic tenant provisioning on cold start.
  // Tenant collections, indexes, and initial policies are maintained via explicit provisioning
  // scripts (e.g. provisionCompany, provisionAllTenants) or registration workflows.
  const isServerlessProd =
    Boolean(process.env.VERCEL) ||
    Boolean(process.env.VERCEL_ENV) ||
    (process.env.NODE_ENV === "production" && process.env.ENABLE_AUTO_PROVISIONING !== "true");

  if ((!isServerlessProd || provision) && !provisionedTenantDbs.has(company.databaseName)) {
    try {
      const { provisionTenantDatabase } = await import("../services/tenantProvisioningService.js");
      await provisionTenantDatabase(company, connection);
      provisionedTenantDbs.add(company.databaseName);
    } catch (provErr) {
      console.warn(`[db] Tenant provisioning check warning for ${company.databaseName}:`, provErr.message);
    }
  }

  return {
    connection,
    User: getUserModel(connection),
    AuthSession: getAuthSessionModel(connection),
    AuthToken: getAuthTokenModel(connection),
    Employee: getEmployeeModel(connection),
    EmployeeCompensation: getEmployeeCompensationModel(connection),
    AuditLog: getAuditLogModel(connection),
    LeaveRequest: getLeaveRequestModel(connection),
    CompanyHrPolicy: getCompanyHrPolicyModel(connection),
    OfferLetter: getOfferLetterModel(connection),
    OfferTemplate: getOfferTemplateModel(connection),
    Settlement: getSettlementModel(connection),
    Attendance: getAttendanceModel(connection),
    LiveTrackingSession: getLiveTrackingSessionModel(connection),
    RemoteWorkRequest: getRemoteWorkRequestModel(connection),
    LocationException: getLocationExceptionModel(connection),
    EmployeeFaceEnrollment: getEmployeeFaceEnrollmentModel(connection),
    AttendanceVerificationChallenge: getAttendanceVerificationChallengeModel(connection),
    PayrollCycle: getPayrollCycleModel(connection),
    Payslip: getPayslipModel(connection),
    CompanyAsset: getCompanyAssetModel(connection),
    Task: getTaskModel(connection),
    ImpactPointTransaction: getImpactPointTransactionModel(connection),
    Notification: getNotificationModel(connection),
    NotificationReadState: getNotificationReadStateModel(connection),
    Conversation: getConversationModel(connection),
    ConversationMember: getConversationMemberModel(connection),
    Message: getMessageModel(connection),
    ChatFile: getChatFileModel(connection),
    Announcement: getAnnouncementModel(connection),
    AnnouncementRead: getAnnouncementReadModel(connection),
    LeaveBackupProposal: getLeaveBackupProposalModel(connection),
    Team: getTeamModel(connection),
    Department: getDepartmentModel(connection),
    Designation: getDesignationModel(connection),
    Project: getProjectModel(connection),
    ProjectMembership: getProjectMembershipModel(connection),
  };
}

export async function findCompanyBySlug(slug) {
  return Company.findOne({ slug });
}

export async function findCompanyById(companyId) {
  return Company.findById(companyId);
}

export async function disconnectAll() {
  centralConnectionPromise = null;
  provisionedTenantDbs.clear();

  const entries = [...tenantConnections.values()];
  tenantConnections.clear();

  await Promise.all(
    entries.map(async (entry) => {
      entry.connectPromise = null;
      entry.refCount = 0;
      const connection = entry.connection;
      entry.connection = null;
      if (connection && connection.readyState !== 0) {
        await connection.close();
      }
    })
  );

  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}
