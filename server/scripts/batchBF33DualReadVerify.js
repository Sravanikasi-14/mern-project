import dotenv from "dotenv";
dotenv.config();

import fs from "node:fs";
import path from "node:path";
import Company from "../models/Company.js";
import {
  connectCentralDB,
  disconnectAll,
  getTenantConnection,
  runWithTenantConnectionScope,
} from "../config/db.js";
import { getUserModel } from "../models/User.js";
import { getNotificationReadStateModel } from "../models/NotificationReadState.js";
import { loadUserReadNotificationKeys } from "../services/notificationReadStateService.js";

async function main() {
  await connectCentralDB();
  const company = await Company.findOne({ slug: "acme" }).lean();
  if (!company?.databaseName) {
    throw new Error("acme company not found");
  }

  const evidence = await runWithTenantConnectionScope(async () => {
    const conn = await getTenantConnection(company.databaseName);
    const User = getUserModel(conn);
    const NotificationReadState = getNotificationReadStateModel(conn);
    const users = await User.find({
      "preferences.readNotificationIds.0": { $exists: true },
    })
      .select("_id email preferences.readNotificationIds")
      .lean();

    const rows = [];
    for (const u of users) {
      const legacy = u.preferences?.readNotificationIds || [];
      const stored = await NotificationReadState.find({ userId: u._id })
        .select("notificationKey")
        .lean();
      const dual = await loadUserReadNotificationKeys(
        { NotificationReadState },
        u
      );
      rows.push({
        userId: String(u._id),
        email: u.email,
        legacyCount: legacy.length,
        readStateCount: stored.length,
        dualReadCount: dual.size,
        dualContainsAllLegacy: legacy.every((k) => dual.has(String(k))),
      });
    }
    return { at: new Date().toISOString(), slug: company.slug, rows };
  });

  const out = path.resolve(process.cwd(), "../tmp-evidence/batch-b-f33-dual-read-verify.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
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
