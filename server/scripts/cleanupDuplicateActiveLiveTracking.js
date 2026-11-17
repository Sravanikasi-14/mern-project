/**
 * F73 — Inventory / cleanup duplicate ACTIVE live_tracking_sessions.
 *
 * Dry-run (default):
 *   node scripts/cleanupDuplicateActiveLiveTracking.js
 *   node scripts/cleanupDuplicateActiveLiveTracking.js --company=acme
 *
 * Apply (stops older duplicates; keeps newest ACTIVE per employee):
 *   node scripts/cleanupDuplicateActiveLiveTracking.js --apply
 *
 * Does NOT delete session documents (history preserved). Never adds TTL.
 * Staging/prod: run dry-run first; require explicit --apply.
 */
import dotenv from "dotenv";
dotenv.config();

import Company, { COMPANY_STATUSES } from "../models/Company.js";
import {
  connectCentralDB,
  disconnectAll,
  getTenantConnection,
  runWithTenantConnectionScope,
} from "../config/db.js";
import { getLiveTrackingSessionModel } from "../models/LiveTrackingSession.js";
import {
  cleanupDuplicateActiveSessions,
  inventoryDuplicateActiveSessions,
} from "../services/liveTrackingActiveSession.js";

const apply = process.argv.includes("--apply");
const companyArg = process.argv.find((a) => a.startsWith("--company="));
const companyFilter = companyArg
  ? companyArg.slice("--company=".length).trim().toLowerCase()
  : "";

async function main() {
  await connectCentralDB();

  const query = {
    status: {
      $in: [
        COMPANY_STATUSES.ACTIVE,
        COMPANY_STATUSES.SUSPENDED,
        COMPANY_STATUSES.TRIAL,
      ],
    },
  };
  if (companyFilter) {
    query.$or = [{ slug: companyFilter }, { databaseName: companyFilter }];
  }

  const companies = await Company.find(query)
    .select("slug databaseName status")
    .lean();

  console.log(
    apply
      ? "APPLY mode: stopping older duplicate ACTIVE live tracking sessions (keep newest)."
      : "DRY-RUN mode: reporting only. Pass --apply to stop duplicates."
  );

  let totalGroups = 0;
  let totalWouldStop = 0;
  let totalStopped = 0;

  for (const company of companies) {
    if (!company.databaseName) continue;
    await runWithTenantConnectionScope(async () => {
      const conn = await getTenantConnection(company.databaseName);
      const LiveTrackingSession = getLiveTrackingSessionModel(conn);
      if (!LiveTrackingSession) {
        console.log(`\n[${company.slug}] LiveTrackingSession model unavailable — skip`);
        return;
      }

      if (!apply) {
        const dups = await inventoryDuplicateActiveSessions(LiveTrackingSession);
        const wouldStop = dups.reduce((n, d) => n + Math.max(0, d.count - 1), 0);
        totalGroups += dups.length;
        totalWouldStop += wouldStop;
        console.log(
          `\n[${company.slug}] duplicateGroups=${dups.length} wouldStop=${wouldStop}`
        );
        for (const d of dups.slice(0, 20)) {
          console.log(
            `  employee=${d.employeeId} active=${d.count} newest=${d.newestStartedAt?.toISOString?.() || d.newestStartedAt}`
          );
        }
        return;
      }

      const result = await cleanupDuplicateActiveSessions(LiveTrackingSession, {
        apply: true,
      });
      totalGroups += result.duplicateGroups;
      totalWouldStop += result.wouldStop;
      totalStopped += result.stopped;
      console.log(
        `\n[${company.slug}] groups=${result.duplicateGroups} wouldStop=${result.wouldStop} stopped=${result.stopped}`
      );
    });
  }

  console.log(
    `\nSummary: companies=${companies.length} duplicateGroups=${totalGroups} ` +
      `wouldStop=${totalWouldStop} stopped=${totalStopped} apply=${apply}`
  );

  await disconnectAll();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await disconnectAll();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
