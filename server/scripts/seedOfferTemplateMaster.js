/**
 * Upsert the global HRMS default offer template master (central DB).
 *
 * Usage:
 *   node scripts/seedOfferTemplateMaster.js
 *   node scripts/seedOfferTemplateMaster.js --bump   # append a new master version (never rewrites old ones)
 *
 * Phase 4B: tenant copies are no longer created. Offers render through the single standard
 * renderer (services/offerStandardRenderService.js). `--provision-tenants` is a no-op.
 */
import "dotenv/config";
import mongoose from "mongoose";
import { connectCentralDB, disconnectAll } from "../config/db.js";
import { ensureMasterTemplate } from "../services/offerTemplateProvisioningService.js";
import { MASTER_TEMPLATE_CODE } from "../assets/offer-templates/hrms-default-master.js";

async function main() {
  const bumpVersion = process.argv.includes("--bump");
  const provisionTenants = process.argv.includes("--provision-tenants");

  await connectCentralDB();
  const { master, created, bumped } = await ensureMasterTemplate({
    bumpVersion,
    notes: bumpVersion ? `Seed bump ${new Date().toISOString()}` : "Seed ensure",
  });

  console.log(
    JSON.stringify(
      {
        code: MASTER_TEMPLATE_CODE,
        masterId: String(master._id),
        currentVersion: master.currentVersion,
        created,
        bumped,
      },
      null,
      2
    )
  );

  if (provisionTenants) {
    console.log(
      "--provision-tenants is disabled (Phase 4B): tenant offer template copies are no longer created."
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectAll();
    await mongoose.disconnect().catch(() => {});
  });
