/**
 * Migrate User.preferences.readNotificationIds → notification_read_states.
 *
 * Safe sequence (recommended):
 *   1) node server/scripts/migrateNotificationReadState.js
 *   2) node server/scripts/migrateNotificationReadState.js --apply
 *   3) Re-run step 1 and confirm legacyKeys match migrated counts / dual-read OK in app
 *   4) node server/scripts/migrateNotificationReadState.js --apply --prune
 *
 * --prune only clears a user's legacy array after verifying every key exists in
 * notification_read_states. Verification failure skips prune for that user.
 *
 * Does not delete Notification documents. Idempotent upserts.
 */
import dotenv from "dotenv";
dotenv.config();

import Company, { COMPANY_STATUSES } from "../models/Company.js";
import { connectCentralDB, disconnectAll, getCompanyModels } from "../config/db.js";
import { migrateLegacyReadNotificationIds } from "../services/notificationReadStateService.js";

const apply = process.argv.includes("--apply");
const pruneLegacy = process.argv.includes("--prune");

async function main() {
  if (pruneLegacy && !apply) {
    console.error("--prune requires --apply");
    process.exit(1);
  }

  await connectCentralDB();
  const companies = await Company.find({
    status: { $in: [COMPANY_STATUSES.ACTIVE, COMPANY_STATUSES.SUSPENDED, COMPANY_STATUSES.TRIAL] },
  }).lean();

  console.log(
    apply
      ? `APPLY mode${pruneLegacy ? " with --prune" : ""}: migrating readNotificationIds → notification_read_states.`
      : "DRY-RUN mode: reporting only. Pass --apply to migrate."
  );

  let totalKeys = 0;
  let totalUsers = 0;
  for (const company of companies) {
    if (!company.databaseName) continue;
    const models = await getCompanyModels(company, { provision: true });

    if (!apply) {
      const users = await models.User.find({
        "preferences.readNotificationIds.0": { $exists: true },
      })
        .select("preferences.readNotificationIds")
        .lean();
      const keys = users.reduce(
        (n, u) => n + (u.preferences?.readNotificationIds?.length || 0),
        0
      );
      totalUsers += users.length;
      totalKeys += keys;
      console.log(
        `\n[${company.slug}] usersWithLegacy=${users.length} legacyKeys=${keys}`
      );
      continue;
    }

    const result = await migrateLegacyReadNotificationIds(models, { pruneLegacy });
    totalUsers += result.usersScanned;
    totalKeys += result.keysMigrated;
    console.log(
      `\n[${company.slug}] scanned=${result.usersScanned} migrated=${result.keysMigrated} ` +
        `dupes=${result.duplicatesSkipped} prunedUsers=${result.pruned} ` +
        `pruneSkipped=${result.pruneSkipped || 0} verifyFail=${result.verificationFailures || 0}`
    );
    if ((result.verificationFailures || 0) > 0) {
      process.exitCode = 1;
    }
  }

  console.log(
    `\nSummary: companies=${companies.length}, usersTouched=${totalUsers}, keys=${totalKeys}.`
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
