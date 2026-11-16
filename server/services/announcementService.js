import crypto from "node:crypto";
import mongoose from "mongoose";
import {
  ANNOUNCEMENT_AUDIENCES,
  ANNOUNCEMENT_BODY_MAX,
  ANNOUNCEMENT_PRIORITIES,
  ANNOUNCEMENT_STATUSES,
  ANNOUNCEMENT_TITLE_MAX,
} from "../models/Announcement.js";
import Company, { COMPANY_STATUSES } from "../models/Company.js";
import { EMPLOYEE_STATUSES } from "../models/Employee.js";
import { NOTIFICATION_TYPES } from "../models/Notification.js";
import { USER_ROLES } from "../models/User.js";
import { getCompanyModels, runWithTenantConnectionScope } from "../config/db.js";
import { assertHrPermission } from "./hrAccessEnforcementService.js";
import { HR_SCOPE_MODES } from "../constants/hrAccessCatalog.js";
import { HttpError } from "../utils/httpError.js";
import { isStrictObjectId } from "./reportingManagerService.js";

const PORTAL_ROLES = Object.freeze([
  USER_ROLES.COMPANY_ADMIN,
  USER_ROLES.HR_ADMIN,
  USER_ROLES.EMPLOYEE,
]);

const PAGE_DEFAULT = 20;
const PAGE_MAX = 50;
const PREVIEW_LENGTH = 160;
const READ_PAGE_MAX = 40;
const SCHEDULE_HORIZON_MS = 366 * 24 * 60 * 60 * 1000;
/** F53 — exclusive notify claim TTL (ms). Expired locks may be stolen by a later worker. */
const ANNOUNCEMENT_NOTIFY_LOCK_MS = 120_000;
/** F53 — soft wall-clock budget for one multi-tenant publish-due invocation. */
const DEFAULT_ANNOUNCEMENT_PUBLISH_BUDGET_MS = 50_000;
/** F53 — per-tenant cap within a multi-tenant publish-due invocation. */
export const DEFAULT_ANNOUNCEMENT_PER_COMPANY_BUDGET_MS = 15_000;
/** F51 — portal audience cursor page size (users per batch). */
export const PORTAL_AUDIENCE_PAGE_SIZE = 200;

/**
 * Audience is the current set of active portal users.
 * Company announcements include every active Company Admin, HR Admin, and Employee.
 * Department announcements include users whose linked employee is active and whose
 * current job.departmentId is one of the targeted departments.
 * People who move into a targeted department later can see it. People who leave cannot.
 * Inactive employees, inactive users, candidates, and users with no department are
 * outside a department audience. Unlinked portal users remain in the company audience.
 * Read rows are kept, but counts use only the current audience.
 */

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function assertObjectId(value, message) {
  if (!isStrictObjectId(value)) throw new HttpError(400, message);
  return new mongoose.Types.ObjectId(String(value));
}

function previewOf(body) {
  const text = cleanText(body).replace(/\s+/g, " ");
  if (text.length <= PREVIEW_LENGTH) return text;
  return `${text.slice(0, PREVIEW_LENGTH - 1)}…`;
}

function pageArgs(query, max = PAGE_MAX) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(max, Math.max(1, Number.parseInt(query.limit, 10) || PAGE_DEFAULT));
  return { page, limit, skip: (page - 1) * limit };
}

export function publisherAccess(req) {
  const role = req.auth.user.role;
  if (role === USER_ROLES.COMPANY_ADMIN) {
    return { canPublish: true, companyWide: true, scopeMode: HR_SCOPE_MODES.COMPANY, departmentIds: null };
  }
  if (role !== USER_ROLES.HR_ADMIN) {
    return { canPublish: false, companyWide: false, scopeMode: null, departmentIds: [] };
  }
  try {
    assertHrPermission(req.hrAccess, "announcements.publish");
  } catch {
    return { canPublish: false, companyWide: false, scopeMode: null, departmentIds: [] };
  }
  const enforcedCustom = req.hrAccess?.enforced && req.hrAccess.scopeMode === HR_SCOPE_MODES.CUSTOM;
  if (!enforcedCustom) {
    return {
      canPublish: true,
      companyWide: true,
      scopeMode: req.hrAccess?.scopeMode || HR_SCOPE_MODES.COMPANY,
      departmentIds: null,
    };
  }
  return {
    canPublish: true,
    companyWide: false,
    scopeMode: HR_SCOPE_MODES.CUSTOM,
    departmentIds: (req.hrAccess.departmentIds || []).map(String),
  };
}

function assertPublisher(req) {
  const access = publisherAccess(req);
  if (!access.canPublish) {
    if (req.auth.user.role === USER_ROLES.HR_ADMIN) {
      assertHrPermission(req.hrAccess, "announcements.publish");
    }
    throw new HttpError(403, "You cannot publish announcements.");
  }
  return access;
}

function displayName(user, employee) {
  const fromEmployee = employee?.fullName || employee?.preferredName;
  if (fromEmployee && String(fromEmployee).trim()) return String(fromEmployee).trim();
  if (user?.fullName && String(user.fullName).trim()) return String(user.fullName).trim();
  return "Colleague";
}

async function departmentNameMap(Department, ids) {
  if (!Department || ids.length === 0) return new Map();
  const rows = await Department.find({ _id: { $in: ids } }).select("name").lean();
  return new Map(rows.map((row) => [String(row._id), row.name]));
}

function toDto(announcement, { names = new Map(), isRead = null, publisherName = "" } = {}) {
  const departmentIds = (announcement.departmentIds || []).map(String);
  return {
    id: String(announcement._id),
    title: announcement.title,
    preview: previewOf(announcement.body),
    priority: announcement.priority,
    audience: announcement.audience,
    departmentIds,
    departmentNames: departmentIds.map((id) => names.get(id)).filter(Boolean),
    status: announcement.status,
    scheduledAt: announcement.scheduledAt,
    publishedAt: announcement.publishedAt,
    editedAt: announcement.editedAt,
    withdrawnAt: announcement.withdrawnAt,
    publishedBy: String(announcement.publishedBy),
    publishedByName: publisherName,
    isRead,
    createdAt: announcement.createdAt,
    updatedAt: announcement.updatedAt,
  };
}

/**
 * F51 — Resolve one page of portal audience entries (active users + linked employees).
 * Callers should iterate with afterId rather than loading the full portal into memory.
 */
export async function loadPortalAudiencePage(
  models,
  { afterId = null, limit = PORTAL_AUDIENCE_PAGE_SIZE } = {}
) {
  const pageSize = Math.min(
    Math.max(1, Number(limit) || PORTAL_AUDIENCE_PAGE_SIZE),
    PORTAL_AUDIENCE_PAGE_SIZE
  );
  const filter = {
    isActive: true,
    role: { $in: PORTAL_ROLES },
  };
  if (afterId) {
    filter._id = { $gt: afterId };
  }
  const users = await models.User.find(filter)
    .sort({ _id: 1 })
    .limit(pageSize)
    .select("fullName email role employeeId isActive preferences.emailNotifications")
    .lean();
  const employeeIds = users.map((user) => user.employeeId).filter(Boolean);
  const employees = employeeIds.length
    ? await models.Employee.find({ _id: { $in: employeeIds } })
        .select("fullName preferredName employeeCode status job.department job.departmentId")
        .lean()
    : [];
  const employeeById = new Map(employees.map((row) => [String(row._id), row]));
  const entries = users
    .map((user) => {
      const employee = user.employeeId ? employeeById.get(String(user.employeeId)) : null;
      if (employee && employee.status === EMPLOYEE_STATUSES.INACTIVE) return null;
      return { user, employee };
    })
    .filter(Boolean);
  const nextAfterId = users.length ? users[users.length - 1]._id : null;
  return {
    entries,
    nextAfterId,
    hasMore: users.length === pageSize,
  };
}

/** @deprecated Prefer loadPortalAudiencePage + cursor; kept for narrow list/read helpers. */
async function loadPortalAudience(models) {
  const all = [];
  let afterId = null;
  for (;;) {
    const page = await loadPortalAudiencePage(models, { afterId });
    all.push(...page.entries);
    if (!page.hasMore) break;
    afterId = page.nextAfterId;
  }
  return all;
}

function inAudience(entry, announcement) {
  if (announcement.audience === ANNOUNCEMENT_AUDIENCES.COMPANY) return true;
  const departmentId = entry.employee?.job?.departmentId;
  if (!departmentId) return false;
  return (announcement.departmentIds || []).some((id) => String(id) === String(departmentId));
}

async function audienceFor(models, announcement) {
  const people = [];
  let afterId = null;
  for (;;) {
    const page = await loadPortalAudiencePage(models, { afterId });
    for (const entry of page.entries) {
      if (inAudience(entry, announcement)) people.push(entry);
    }
    if (!page.hasMore) break;
    afterId = page.nextAfterId;
  }
  return people;
}

function viewerDepartmentId(entry) {
  return entry?.employee?.job?.departmentId ? String(entry.employee.job.departmentId) : null;
}

async function viewerEntry(models, user) {
  let employee = null;
  if (user.employeeId && models.Employee) {
    employee = await models.Employee.findById(user.employeeId)
      .select("fullName preferredName employeeCode status job.department job.departmentId")
      .lean();
    if (employee && employee.status === EMPLOYEE_STATUSES.INACTIVE) employee = null;
  }
  return { user, employee };
}

function recipientCanSee(announcement, entry, now = new Date()) {
  if (!announcement || announcement.status !== ANNOUNCEMENT_STATUSES.PUBLISHED) return false;
  if (announcement.publishedAt && new Date(announcement.publishedAt) > now) return false;
  return inAudience(entry, announcement);
}

/**
 * F53 — Build personal announcement notification docs (same payload rules as legacy create loop).
 * Skips users who opted out of emailNotifications (preserved legacy behavior).
 */
export function buildAnnouncementNotificationDocs(announcement, audienceEntries) {
  const announcementId = String(announcement._id);
  const title = announcement.title;
  const message = previewOf(announcement.body) || "A new announcement was published.";
  const docs = [];
  for (const entry of audienceEntries || []) {
    if (entry.user?.preferences?.emailNotifications === false) continue;
    const link =
      entry.user.role === USER_ROLES.EMPLOYEE
        ? `/app/messages?view=announcements&a=${announcementId}`
        : `/admin/messages?view=announcements&a=${announcementId}`;
    docs.push({
      userId: entry.user._id,
      role: null,
      title,
      message,
      type: NOTIFICATION_TYPES.ANNOUNCEMENT,
      link,
      isRead: false,
      metadata: { announcementId, event: "published" },
    });
  }
  return docs;
}

/**
 * F53 — Persist announcement notifications with one bulk write (F42-style `ordered: false`).
 * Returns how many documents were inserted (including partial success).
 */
export async function insertAnnouncementNotificationDocs(models, docs) {
  if (!models?.Notification || !Array.isArray(docs) || docs.length === 0) {
    return 0;
  }
  try {
    const inserted = await models.Notification.insertMany(docs, { ordered: false });
    return Array.isArray(inserted) ? inserted.length : docs.length;
  } catch (err) {
    const partial =
      (Array.isArray(err?.insertedDocs) && err.insertedDocs.length) ||
      Number(err?.result?.result?.nInserted) ||
      Number(err?.result?.nInserted) ||
      0;
    const onlyDupes =
      err?.code === 11000 ||
      (Array.isArray(err?.writeErrors) &&
        err.writeErrors.length > 0 &&
        err.writeErrors.every((e) => e.code === 11000));
    if (partial > 0) {
      if (process.env.NODE_ENV !== "test") {
        console.warn(
          `[announcements] partial insertMany ${partial}/${docs.length}:`,
          err?.message || err
        );
      }
      return partial;
    }
    if (onlyDupes) return 0;
    throw err;
  }
}

/**
 * F53 — Fan-out with 1 existing-recipient query + insertMany (not N× findOne+create).
 * @returns {{ delivered: number, complete: boolean, candidateCount: number, queryCount: number, writeCount: number }}
 */
export async function notifyAudience(models, announcement) {
  if (!models.Notification) {
    return { delivered: 0, complete: true, candidateCount: 0, queryCount: 0, writeCount: 0 };
  }

  // F51: page portal audience + insertMany per page (no full-audience materialization).
  const announcementId = String(announcement._id);
  let delivered = 0;
  let candidateCount = 0;
  let queryCount = 0;
  let writeCount = 0;
  let afterId = null;

  for (;;) {
    const page = await loadPortalAudiencePage(models, { afterId });
    queryCount += 1;
    const audience = page.entries.filter((entry) => inAudience(entry, announcement));
    const candidates = buildAnnouncementNotificationDocs(announcement, audience);
    candidateCount += candidates.length;

    if (candidates.length > 0) {
      queryCount += 1;
      const existing = await models.Notification.find({
        type: NOTIFICATION_TYPES.ANNOUNCEMENT,
        "metadata.announcementId": announcementId,
        "metadata.event": "published",
        userId: { $in: candidates.map((doc) => doc.userId) },
      })
        .select("userId")
        .lean();
      const have = new Set(existing.map((row) => String(row.userId)));
      const docs = candidates.filter((doc) => !have.has(String(doc.userId)));
      if (docs.length > 0) {
        writeCount += 1;
        delivered += await insertAnnouncementNotificationDocs(models, docs);
      }
    }

    if (!page.hasMore) break;
    afterId = page.nextAfterId;
  }

  queryCount += 1;
  const covered = await models.Notification.countDocuments({
    type: NOTIFICATION_TYPES.ANNOUNCEMENT,
    "metadata.announcementId": announcementId,
    "metadata.event": "published",
  });
  const complete = covered >= candidateCount;
  return {
    delivered,
    complete,
    candidateCount,
    queryCount,
    writeCount,
  };
}

async function claimAnnouncementNotify(models, announcementId, now = new Date()) {
  const token = crypto.randomBytes(16).toString("hex");
  const lockUntil = new Date(now.getTime() + ANNOUNCEMENT_NOTIFY_LOCK_MS);
  const claimed = await models.Announcement.findOneAndUpdate(
    {
      _id: announcementId,
      status: ANNOUNCEMENT_STATUSES.PUBLISHED,
      notifiedAt: null,
      $or: [
        { notifyLockUntil: null },
        { notifyLockUntil: { $exists: false } },
        { notifyLockUntil: { $lte: now } },
      ],
    },
    { $set: { notifyLockUntil: lockUntil, notifyLockToken: token } },
    { returnDocument: "after" }
  );
  return claimed ? { claimed: true, token, announcement: claimed } : { claimed: false, token: null, announcement: null };
}

async function releaseAnnouncementNotifyClaim(models, announcementId, token) {
  await models.Announcement.updateOne(
    { _id: announcementId, notifyLockToken: token, notifiedAt: null },
    { $set: { notifyLockUntil: null, notifyLockToken: "" } }
  );
}

async function markAnnouncementNotified(models, announcementId, token) {
  const result = await models.Announcement.updateOne(
    { _id: announcementId, notifyLockToken: token, notifiedAt: null },
    {
      $set: { notifiedAt: new Date(), notifyLockUntil: null, notifyLockToken: "" },
    }
  );
  return result.modifiedCount > 0;
}

/**
 * Notify + mark notifiedAt only when fan-out is complete.
 * On failure or incomplete coverage, release the claim so a later run can retry (deduped).
 */
async function notifyAudienceAndMark(models, announcement) {
  const claim = await claimAnnouncementNotify(models, announcement._id);
  if (!claim.claimed) {
    return { skipped: true, reason: "lock_held_or_notified" };
  }
  try {
    const result = await notifyAudience(models, claim.announcement);
    if (result.complete) {
      await markAnnouncementNotified(models, announcement._id, claim.token);
      return { ...result, skipped: false, marked: true };
    }
    await releaseAnnouncementNotifyClaim(models, announcement._id, claim.token);
    return { ...result, skipped: false, marked: false };
  } catch (error) {
    await releaseAnnouncementNotifyClaim(models, announcement._id, claim.token);
    throw error;
  }
}

/**
 * Publish due announcements for one tenant.
 * @param {object} [options]
 * @param {number} [options.deadline] — wall-clock ms epoch; stop starting new items when exceeded.
 * Incomplete notify work keeps notifiedAt=null for retry (never marked complete early).
 * @returns {Promise<number>} count of newly status-flipped SCHEDULED→PUBLISHED rows
 */
export async function publishDueAnnouncements(models, now = new Date(), options = {}) {
  const deadline = Number.isFinite(options.deadline) ? Number(options.deadline) : null;
  const due = await models.Announcement.find({
    $or: [
      { status: ANNOUNCEMENT_STATUSES.SCHEDULED, scheduledAt: { $lte: now } },
      { status: ANNOUNCEMENT_STATUSES.PUBLISHED, notifiedAt: null, publishedAt: { $ne: null } },
    ],
  }).select("_id status");

  let published = 0;
  for (const row of due) {
    if (deadline != null && Date.now() >= deadline) {
      // Do not flip more SCHEDULED rows or start fan-out; remaining stay due for next run.
      break;
    }
    let current = row;
    if (row.status === ANNOUNCEMENT_STATUSES.SCHEDULED) {
      current = await models.Announcement.findOneAndUpdate(
        { _id: row._id, status: ANNOUNCEMENT_STATUSES.SCHEDULED, scheduledAt: { $lte: now } },
        { $set: { status: ANNOUNCEMENT_STATUSES.PUBLISHED, publishedAt: now } },
        { returnDocument: "after" }
      );
      if (!current) {
        current = await models.Announcement.findOne({
          _id: row._id,
          status: ANNOUNCEMENT_STATUSES.PUBLISHED,
          notifiedAt: null,
        });
      } else {
        published += 1;
      }
    } else {
      current = await models.Announcement.findById(row._id);
    }
    if (!current || current.notifiedAt || current.status !== ANNOUNCEMENT_STATUSES.PUBLISHED) continue;
    if (deadline != null && Date.now() >= deadline) break;
    try {
      await notifyAudienceAndMark(models, current);
    } catch (error) {
      if (process.env.NODE_ENV !== "test") {
        console.warn(
          `[announcements] notify failed for ${String(current._id)}:`,
          error?.message || error
        );
      }
      // Leave published; notifiedAt stays null for a later retry. Do not roll back status.
    }
  }
  return published;
}

/** Rotate company list so afterCompanyId's successor is first (fair continuation). */
export function rotateCompaniesAfterId(companies, afterCompanyId) {
  if (!afterCompanyId || !Array.isArray(companies) || companies.length === 0) {
    return companies || [];
  }
  const idx = companies.findIndex((c) => String(c._id) === String(afterCompanyId));
  if (idx < 0) return companies;
  return companies.slice(idx + 1).concat(companies.slice(0, idx + 1));
}

/**
 * F51 — Cross-tenant due publish. One tenant failure must not stop others.
 * F53 — Fleet wall-clock budget + per-tenant cap + rotate-after cursor so slow
 * early tenants cannot starve the rest of the fleet forever.
 */
export async function publishDueForAllCompanies(now = new Date(), options = {}) {
  const companiesRaw = await Company.find({ status: COMPANY_STATUSES.ACTIVE })
    .select("_id slug databaseName status companyName")
    .sort({ _id: 1 })
    .lean();

  const budgetMs = Number.isFinite(options.budgetMs)
    ? Number(options.budgetMs)
    : Number.parseInt(process.env.ANNOUNCEMENT_PUBLISH_BUDGET_MS || "", 10) ||
      DEFAULT_ANNOUNCEMENT_PUBLISH_BUDGET_MS;
  const perCompanyMs = Number.isFinite(options.perCompanyBudgetMs)
    ? Number(options.perCompanyBudgetMs)
    : Number.parseInt(process.env.ANNOUNCEMENT_PER_COMPANY_BUDGET_MS || "", 10) ||
      DEFAULT_ANNOUNCEMENT_PER_COMPANY_BUDGET_MS;
  const deadline = Date.now() + Math.max(0, budgetMs);

  const companies = rotateCompaniesAfterId(companiesRaw, options.afterCompanyId);

  let published = 0;
  const results = [];
  let lastCompletedCompanyId = null;
  const publishForCompany =
    typeof options.publishForCompany === "function"
      ? options.publishForCompany
      : async (company, publishOptions = {}) =>
          runWithTenantConnectionScope(async () => {
            const models = await getCompanyModels(company);
            return publishDueAnnouncements(models, now, publishOptions);
          });

  for (const company of companies) {
    if (Date.now() >= deadline) {
      results.push({
        companyId: String(company._id),
        companySlug: company.slug || "",
        skipped: true,
        reason: "budget_exhausted",
        published: 0,
        pending: true,
      });
      continue;
    }

    const companyDeadline = Math.min(deadline, Date.now() + Math.max(0, perCompanyMs));
    try {
      const count = await publishForCompany(company, { deadline: companyDeadline });
      published += Number(count) || 0;
      lastCompletedCompanyId = String(company._id);
      results.push({
        companyId: String(company._id),
        companySlug: company.slug || "",
        published: Number(count) || 0,
      });
    } catch (error) {
      results.push({
        companyId: String(company._id),
        companySlug: company.slug || "",
        published: 0,
        error: error?.message || String(error),
      });
      if (process.env.NODE_ENV !== "test") {
        console.warn(
          `[announcements] publish-due failed for ${company.slug || company.databaseName}:`,
          error?.message || error
        );
      }
    }
  }

  return {
    companies: companiesRaw.length,
    published,
    results,
    afterCompanyId: lastCompletedCompanyId,
    truncated: results.some((r) => r.reason === "budget_exhausted" || r.pending),
  };
}

export function cronAuthorized(req) {
  const secret = process.env.CRON_SECRET || process.env.ANNOUNCEMENT_CRON_SECRET || "";
  if (!secret) return "unconfigured";
  const header = String(req.get("authorization") || "");
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const left = Buffer.from(token);
  const right = Buffer.from(secret);
  if (left.length !== right.length || left.length === 0) return "denied";
  return crypto.timingSafeEqual(left, right) ? "ok" : "denied";
}

async function resolveDepartments(models, access, departmentIds) {
  const unique = [...new Set(departmentIds.map(String))];
  if (unique.length === 0) throw new HttpError(400, "Choose at least one department.");
  const ids = unique.map((id) => assertObjectId(id, "Choose a valid department."));
  if (access.scopeMode === HR_SCOPE_MODES.CUSTOM && !access.companyWide) {
    const allowed = new Set(access.departmentIds || []);
    if (ids.some((id) => !allowed.has(String(id)))) {
      throw new HttpError(403, "You can only announce to departments in your employee scope.");
    }
  }
  const rows = await models.Department.find({ _id: { $in: ids }, isActive: true }).select("_id name").lean();
  if (rows.length !== ids.length) {
    throw new HttpError(400, "That department is not available.");
  }
  return rows.map((row) => row._id);
}

function parseSchedule(value, { required = false } = {}) {
  if (value == null || value === "") {
    if (required) throw new HttpError(400, "Choose a date and time.");
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new HttpError(400, "Choose a valid date and time.");
  if (date.getTime() > Date.now() + SCHEDULE_HORIZON_MS) {
    throw new HttpError(400, "Schedule the announcement within the next year.");
  }
  return date;
}

function readContent(body, { partial = false } = {}) {
  const hasTitle = Object.prototype.hasOwnProperty.call(body || {}, "title");
  const hasBody = Object.prototype.hasOwnProperty.call(body || {}, "body");
  const hasPriority = Object.prototype.hasOwnProperty.call(body || {}, "priority");
  const title = cleanText(body?.title);
  const text = cleanText(body?.body);
  const priority = cleanText(body?.priority || ANNOUNCEMENT_PRIORITIES.NORMAL).toUpperCase();
  if (!partial || hasTitle) {
    if (!title) throw new HttpError(400, "Enter a title.");
    if (title.length > ANNOUNCEMENT_TITLE_MAX) {
      throw new HttpError(400, `Title cannot be longer than ${ANNOUNCEMENT_TITLE_MAX} characters.`);
    }
  }
  if (!partial || hasBody) {
    if (!text) throw new HttpError(400, "Write the announcement.");
    if (text.length > ANNOUNCEMENT_BODY_MAX) {
      throw new HttpError(400, `Announcement cannot be longer than ${ANNOUNCEMENT_BODY_MAX} characters.`);
    }
  }
  if (!partial || hasPriority) {
    if (!Object.values(ANNOUNCEMENT_PRIORITIES).includes(priority)) {
      throw new HttpError(400, "Choose a priority of Normal, Important, or Urgent.");
    }
  }
  return {
    ...(hasTitle || !partial ? { title } : {}),
    ...(hasBody || !partial ? { body: text } : {}),
    ...(hasPriority || !partial ? { priority } : {}),
  };
}

async function readAudienceChoice(req, access, body, { partial = false } = {}) {
  const hasAudience = Object.prototype.hasOwnProperty.call(body || {}, "audience");
  if (partial && !hasAudience && !Object.prototype.hasOwnProperty.call(body || {}, "departmentIds")) {
    return {};
  }
  const audience = cleanText(body?.audience || ANNOUNCEMENT_AUDIENCES.COMPANY).toUpperCase();
  if (!Object.values(ANNOUNCEMENT_AUDIENCES).includes(audience)) {
    throw new HttpError(400, "Choose the whole company or selected departments.");
  }
  if (audience === ANNOUNCEMENT_AUDIENCES.COMPANY) {
    if (!access.companyWide) {
      throw new HttpError(403, "You can only announce to departments in your employee scope.");
    }
    return { audience, departmentIds: [] };
  }
  const departmentIds = Array.isArray(body?.departmentIds) ? body.departmentIds : [];
  const resolved = await resolveDepartments(req.auth.models, access, departmentIds);
  return { audience, departmentIds: resolved };
}

async function decorate(models, announcements, userId) {
  const list = Array.isArray(announcements) ? announcements : [announcements];
  const departmentIds = list.flatMap((row) => row.departmentIds || []);
  const names = await departmentNameMap(models.Department, departmentIds);
  const publisherIds = [...new Set(list.map((row) => String(row.publishedBy)))];
  const publishers = await models.User.find({ _id: { $in: publisherIds } }).select("fullName email").lean();
  const publisherNames = new Map(publishers.map((user) => [String(user._id), displayName(user, null)]));
  const publishedIds = list
    .filter((row) => row.status === ANNOUNCEMENT_STATUSES.PUBLISHED)
    .map((row) => row._id);
  const reads = publishedIds.length
    ? await models.AnnouncementRead.find({ announcementId: { $in: publishedIds }, userId }).select("announcementId").lean()
    : [];
  const readIds = new Set(reads.map((row) => String(row.announcementId)));
  return list.map((row) => toDto(row, {
    names,
    publisherName: publisherNames.get(String(row.publishedBy)) || "",
    isRead: row.status === ANNOUNCEMENT_STATUSES.PUBLISHED ? readIds.has(String(row._id)) : null,
  }));
}

async function targetableDepartments(models, access) {
  if (!access.canPublish) return [];
  const filter = { isActive: true };
  if (!access.companyWide) {
    filter._id = { $in: (access.departmentIds || []).map((id) => new mongoose.Types.ObjectId(id)) };
  }
  const rows = await models.Department.find(filter).select("name").sort({ name: 1 }).lean();
  return rows.map((row) => ({ id: String(row._id), name: row.name }));
}

export async function listAnnouncements(req) {
  const { models } = req.auth;
  await publishDueAnnouncements(models);
  const access = publisherAccess(req);
  const { page, limit, skip } = pageArgs(req.query);
  const filter = {};
  if (access.canPublish) {
    const status = cleanText(req.query.status).toUpperCase();
    if (status === "ARCHIVED" || status === ANNOUNCEMENT_STATUSES.WITHDRAWN) {
      filter.status = ANNOUNCEMENT_STATUSES.WITHDRAWN;
    } else if (status && Object.values(ANNOUNCEMENT_STATUSES).includes(status)) {
      filter.status = status;
    }
  } else {
    const entry = await viewerEntry(models, req.auth.user);
    const departmentId = viewerDepartmentId(entry);
    filter.status = ANNOUNCEMENT_STATUSES.PUBLISHED;
    filter.publishedAt = { $lte: new Date() };
    filter.$or = [{ audience: ANNOUNCEMENT_AUDIENCES.COMPANY }];
    if (departmentId) {
      filter.$or.push({
        audience: ANNOUNCEMENT_AUDIENCES.DEPARTMENTS,
        departmentIds: new mongoose.Types.ObjectId(departmentId),
      });
    }
  }
  const priority = cleanText(req.query.priority).toUpperCase();
  if (priority && Object.values(ANNOUNCEMENT_PRIORITIES).includes(priority)) filter.priority = priority;
  const audience = cleanText(req.query.audience).toUpperCase();
  if (audience && Object.values(ANNOUNCEMENT_AUDIENCES).includes(audience)) filter.audience = audience;

  const [rows, total] = await Promise.all([
    models.Announcement.find(filter).sort({ publishedAt: -1, scheduledAt: -1, createdAt: -1 }).skip(skip).limit(limit).lean(),
    models.Announcement.countDocuments(filter),
  ]);
  const announcements = await decorate(models, rows, req.auth.user._id);
  return {
    announcements,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
    access: {
      canPublish: access.canPublish,
      companyWide: access.companyWide,
      scopeMode: access.scopeMode,
    },
    departments: await targetableDepartments(models, access),
  };
}

async function loadManaged(models, id) {
  assertObjectId(id, "Announcement not found");
  const announcement = await models.Announcement.findById(id);
  if (!announcement) throw new HttpError(404, "Announcement not found");
  return announcement;
}

export async function getAnnouncement(req, id) {
  const { models, user } = req.auth;
  await publishDueAnnouncements(models);
  const access = publisherAccess(req);
  const announcement = await loadManaged(models, id);
  if (!access.canPublish) {
    const entry = await viewerEntry(models, user);
    if (!recipientCanSee(announcement, entry)) throw new HttpError(404, "Announcement not found");
  }
  const [dto] = await decorate(models, [announcement.toObject()], user._id);
  return { ...dto, body: announcement.body };
}

export async function createAnnouncement(req) {
  const access = assertPublisher(req);
  const { models, user } = req.auth;
  const content = readContent(req.body);
  const targeting = await readAudienceChoice(req, access, req.body);
  const publish = req.body?.publish === true;
  const scheduledAt = parseSchedule(req.body?.scheduledAt, { required: false });
  let status = ANNOUNCEMENT_STATUSES.DRAFT;
  let publishedAt = null;
  if (publish) {
    if (scheduledAt && scheduledAt.getTime() > Date.now()) {
      status = ANNOUNCEMENT_STATUSES.SCHEDULED;
    } else {
      status = ANNOUNCEMENT_STATUSES.PUBLISHED;
      publishedAt = new Date();
    }
  } else if (scheduledAt) {
    throw new HttpError(400, "Choose Publish to schedule this announcement.");
  }
  const created = await models.Announcement.create({
    ...content,
    ...targeting,
    publishedBy: user._id,
    status,
    scheduledAt: status === ANNOUNCEMENT_STATUSES.SCHEDULED ? scheduledAt : null,
    publishedAt,
  });
  if (status === ANNOUNCEMENT_STATUSES.PUBLISHED) {
    try {
      await notifyAudienceAndMark(models, created);
    } catch (error) {
      if (process.env.NODE_ENV !== "test") {
        console.warn("[announcements] notify after create failed:", error?.message || error);
      }
    }
  }
  return getAnnouncement(req, created._id);
}

export async function updateAnnouncement(req, id) {
  const access = assertPublisher(req);
  const announcement = await loadManaged(req.auth.models, id);
  if (announcement.status === ANNOUNCEMENT_STATUSES.WITHDRAWN) {
    throw new HttpError(400, "Withdrawn announcements cannot be edited.");
  }
  const content = readContent(req.body, { partial: true });
  const lockedAudience = announcement.status === ANNOUNCEMENT_STATUSES.PUBLISHED;
  if (lockedAudience && (Object.prototype.hasOwnProperty.call(req.body || {}, "audience") || Object.prototype.hasOwnProperty.call(req.body || {}, "departmentIds"))) {
    throw new HttpError(400, "Audience cannot be changed after publication.");
  }
  const targeting = lockedAudience ? {} : await readAudienceChoice(req, access, { ...announcement.toObject(), ...req.body }, { partial: true });
  let scheduledAt = announcement.scheduledAt;
  if (Object.prototype.hasOwnProperty.call(req.body || {}, "scheduledAt")) {
    if (announcement.status === ANNOUNCEMENT_STATUSES.PUBLISHED) {
      throw new HttpError(400, "A published announcement cannot be rescheduled.");
    }
    scheduledAt = parseSchedule(req.body.scheduledAt);
  }
  const changes = { ...content, ...targeting, editedAt: new Date() };
  if (announcement.status !== ANNOUNCEMENT_STATUSES.PUBLISHED && req.body?.publish === true) {
    const explicitSchedule = Object.prototype.hasOwnProperty.call(req.body || {}, "scheduledAt");
    const when = explicitSchedule ? scheduledAt : null;
    if (when && when.getTime() > Date.now()) {
      changes.status = ANNOUNCEMENT_STATUSES.SCHEDULED;
      changes.scheduledAt = when;
    } else {
      changes.status = ANNOUNCEMENT_STATUSES.PUBLISHED;
      changes.publishedAt = new Date();
      changes.scheduledAt = null;
    }
  } else if (announcement.status === ANNOUNCEMENT_STATUSES.SCHEDULED && Object.prototype.hasOwnProperty.call(req.body || {}, "scheduledAt")) {
    changes.scheduledAt = scheduledAt;
  }
  await req.auth.models.Announcement.updateOne({ _id: announcement._id }, { $set: changes });
  const fresh = await req.auth.models.Announcement.findById(announcement._id);
  if (fresh.status === ANNOUNCEMENT_STATUSES.PUBLISHED && !fresh.notifiedAt) {
    try {
      await notifyAudienceAndMark(req.auth.models, fresh);
    } catch (error) {
      if (process.env.NODE_ENV !== "test") {
        console.warn("[announcements] notify after update failed:", error?.message || error);
      }
    }
  }
  return getAnnouncement(req, announcement._id);
}

export async function publishAnnouncement(req, id) {
  assertPublisher(req);
  const { models } = req.auth;
  const announcement = await loadManaged(models, id);
  if (announcement.status === ANNOUNCEMENT_STATUSES.WITHDRAWN) {
    throw new HttpError(400, "Withdrawn announcements cannot be published again.");
  }
  if (announcement.status === ANNOUNCEMENT_STATUSES.PUBLISHED) {
    return getAnnouncement(req, id);
  }
  const scheduledAt = Object.prototype.hasOwnProperty.call(req.body || {}, "scheduledAt")
    ? parseSchedule(req.body.scheduledAt)
    : announcement.scheduledAt;
  if (scheduledAt && scheduledAt.getTime() > Date.now()) {
    announcement.status = ANNOUNCEMENT_STATUSES.SCHEDULED;
    announcement.scheduledAt = scheduledAt;
    await announcement.save();
    return getAnnouncement(req, id);
  }
  announcement.status = ANNOUNCEMENT_STATUSES.PUBLISHED;
  announcement.publishedAt = new Date();
  announcement.scheduledAt = null;
  await announcement.save();
  try {
    await notifyAudienceAndMark(models, announcement);
  } catch (error) {
    if (process.env.NODE_ENV !== "test") {
      console.warn("[announcements] notify after publish failed:", error?.message || error);
    }
  }
  return getAnnouncement(req, id);
}

export async function withdrawAnnouncement(req, id) {
  assertPublisher(req);
  const announcement = await loadManaged(req.auth.models, id);
  if (announcement.status === ANNOUNCEMENT_STATUSES.DRAFT) {
    throw new HttpError(400, "Drafts are not published yet.");
  }
  if (announcement.status !== ANNOUNCEMENT_STATUSES.WITHDRAWN) {
    announcement.status = ANNOUNCEMENT_STATUSES.WITHDRAWN;
    announcement.withdrawnAt = new Date();
    await announcement.save();
  }
  return getAnnouncement(req, id);
}

export async function markAnnouncementRead(req, id) {
  const { models, user } = req.auth;
  await publishDueAnnouncements(models);
  const announcement = await loadManaged(models, id);
  const entry = await viewerEntry(models, user);
  if (!recipientCanSee(announcement, entry)) {
    throw new HttpError(404, "Announcement not found");
  }
  try {
    await models.AnnouncementRead.updateOne(
      { announcementId: announcement._id, userId: user._id },
      { $setOnInsert: { announcementId: announcement._id, userId: user._id, readAt: new Date() } },
      { upsert: true }
    );
  } catch (error) {
    if (error?.code !== 11000) throw error;
  }
  if (models.Notification) {
    await models.Notification.updateMany(
      {
        userId: user._id,
        type: NOTIFICATION_TYPES.ANNOUNCEMENT,
        "metadata.announcementId": String(announcement._id),
      },
      { $addToSet: { readBy: user._id }, $set: { isRead: true } }
    );
  }
  return { announcementId: String(announcement._id), read: true };
}

export async function announcementReadStatus(req, id) {
  assertPublisher(req);
  const { models } = req.auth;
  const announcement = await loadManaged(models, id);
  const audience = await audienceFor(models, announcement);
  const reads = await models.AnnouncementRead.find({
    announcementId: announcement._id,
    userId: { $in: audience.map((entry) => entry.user._id) },
  }).select("userId readAt").lean();
  const readMap = new Map(reads.map((row) => [String(row.userId), row.readAt]));
  const search = cleanText(req.query.search).toLowerCase();
  let people = audience.map((entry) => ({
    userId: String(entry.user._id),
    displayName: displayName(entry.user, entry.employee),
    employeeCode: entry.employee?.employeeCode || "",
    department: entry.employee?.job?.department || "",
    readAt: readMap.get(String(entry.user._id)) || null,
  }));
  if (search) {
    people = people.filter((person) => `${person.displayName} ${person.employeeCode} ${person.department}`.toLowerCase().includes(search));
  }
  people.sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" }));
  const { page, limit, skip } = pageArgs(req.query, READ_PAGE_MAX);
  const readCount = reads.length;
  const audienceSize = audience.length;
  return {
    announcementId: String(announcement._id),
    audienceSize,
    readCount,
    percentage: audienceSize === 0 ? 0 : Math.round((readCount / audienceSize) * 100),
    people: people.slice(skip, skip + limit),
    pagination: { page, limit, total: people.length, totalPages: Math.ceil(people.length / limit) || 1 },
  };
}
