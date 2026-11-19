/**
 * Announcements detect-only adapter — counts due rows; never publishes or notifies.
 */

import Company, { COMPANY_STATUSES } from "../../../models/Company.js";
import { ANNOUNCEMENT_STATUSES } from "../../../models/Announcement.js";
import { getCompanyModels, runWithTenantConnectionScope } from "../../../config/db.js";

/**
 * Count announcements that would be processed by publish-due, without mutations.
 */
export async function countDueAnnouncements(models, now = new Date()) {
  if (!models?.Announcement) return 0;
  return models.Announcement.countDocuments({
    $or: [
      { status: ANNOUNCEMENT_STATUSES.SCHEDULED, scheduledAt: { $lte: now } },
      { status: ANNOUNCEMENT_STATUSES.PUBLISHED, notifiedAt: null, publishedAt: { $ne: null } },
    ],
  });
}

/**
 * @param {{ budgetMs?: number, now?: Date, trackTenantOpen?: Function, maxCompanies?: number }} options
 */
export async function runAnnouncementsDetectAdapter(options = {}) {
  const started = Date.now();
  const now = options.now || new Date();
  const budgetMs = Number.isFinite(options.budgetMs) ? Math.max(0, Number(options.budgetMs)) : 15_000;
  const deadline = started + budgetMs;
  const maxCompanies =
    Number.isFinite(options.maxCompanies) && options.maxCompanies > 0
      ? Math.floor(options.maxCompanies)
      : 0;

  if (budgetMs < 500) {
    return {
      status: "skipped",
      executionMode: "detect-only",
      reason: "insufficient_budget",
      durationMs: Date.now() - started,
      tenantConnectionsOpened: 0,
      summary: {
        mode: "detect-only",
        companiesScanned: 0,
        dueCount: 0,
        truncated: false,
      },
    };
  }

  const companiesRaw = await Company.find({ status: COMPANY_STATUSES.ACTIVE })
    .select("_id databaseName status")
    .sort({ _id: 1 })
    .lean();

  let companies = companiesRaw;
  if (maxCompanies > 0 && companies.length > maxCompanies) {
    companies = companies.slice(0, maxCompanies);
  }

  let dueCount = 0;
  let companiesScanned = 0;
  let companiesWithDue = 0;
  let tenantConnectionsOpened = 0;
  let truncated = false;
  let errorCount = 0;

  for (const company of companies) {
    if (Date.now() >= deadline) {
      truncated = true;
      break;
    }
    try {
      const count = await runWithTenantConnectionScope(async () => {
        tenantConnectionsOpened += 1;
        if (typeof options.trackTenantOpen === "function") {
          options.trackTenantOpen(1);
        }
        const models = await getCompanyModels(company);
        return countDueAnnouncements(models, now);
      });
      companiesScanned += 1;
      const n = Number(count) || 0;
      dueCount += n;
      if (n > 0) companiesWithDue += 1;
    } catch {
      errorCount += 1;
      companiesScanned += 1;
    }
  }

  return {
    status: errorCount > 0 && companiesScanned === errorCount ? "error" : "ok",
    executionMode: "detect-only",
    reason: truncated ? "budget_exhausted" : undefined,
    durationMs: Date.now() - started,
    tenantConnectionsOpened,
    summary: {
      mode: "detect-only",
      published: 0,
      notified: 0,
      companies: companiesRaw.length,
      companiesScanned,
      companiesWithDue,
      dueCount,
      errorCount,
      truncated,
      // Explicit: detect-only never mutates.
      mutations: false,
    },
  };
}
