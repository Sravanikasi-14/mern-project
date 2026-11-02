/**
 * Idempotent migration: leave_handovers + task_delegations → LeaveRequest.handover (embedded).
 *
 * Does NOT drop source collections. Run verification, then remove obsolete model usage separately.
 *
 * Usage:
 *   node scripts/migrateHandoversToLeaveRequest.js
 *   node scripts/migrateHandoversToLeaveRequest.js --company=slug
 */
import "dotenv/config";
import Company from "../models/Company.js";
import { connectCentralDB, disconnectAll, getTenantConnection, getCentralDbName } from "../config/db.js";
import { getLeaveRequestModel } from "../models/LeaveRequest.js";
import {
  HANDOVER_STATUSES,
  HANDOVER_ITEM_STATUSES,
  DELEGATION_STATUSES,
} from "../constants/handoverConstants.js";

function parseArgs(argv) {
  const out = { company: null };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--company=")) out.company = arg.slice("--company=".length).trim();
  }
  return out;
}

function mapItem(srcItem, delegationByItemId) {
  const itemId = String(srcItem._id);
  const d = delegationByItemId.get(itemId) || null;
  return {
    _id: srcItem._id,
    taskId: srcItem.taskId,
    proposalId: srcItem.proposalId || null,
    backupEmployeeId: srcItem.backupEmployeeId || null,
    status: srcItem.status || HANDOVER_ITEM_STATUSES.DRAFT,
    coverageFrom: srcItem.coverageFrom || null,
    coverageTo: srcItem.coverageTo || null,
    instructions: srcItem.instructions || "",
    outstandingWork: srcItem.outstandingWork || "",
    importantDeadlines: srcItem.importantDeadlines || "",
    dependencies: srcItem.dependencies || "",
    documentLinks: Array.isArray(srcItem.documentLinks) ? srcItem.documentLinks.slice(0, 10) : [],
    attachments: Array.isArray(srcItem.attachments) ? srcItem.attachments.slice(0, 20) : [],
    taskSnapshot: {
      title: srcItem.taskSnapshot?.title || "",
      priority: srcItem.taskSnapshot?.priority || "",
      deadline: srcItem.taskSnapshot?.deadline || null,
      status: srcItem.taskSnapshot?.status || "",
    },
    backupResponse: srcItem.backupResponse || {
      decision: null,
      comment: "",
      respondedAt: null,
      respondedByUserId: null,
    },
    managerDecision: srcItem.managerDecision || {
      decision: null,
      reason: "",
      decidedAt: null,
      decidedByUserId: null,
    },
    delegation: d
      ? {
          originalAssigneeId: d.originalAssigneeId,
          delegateEmployeeId: d.delegateEmployeeId,
          fromDate: d.fromDate,
          toDate: d.toDate,
          status: d.status || null,
          activatedAt: d.activatedAt || null,
          endedAt: d.endedAt || null,
          endReason: d.endReason || null,
          createdByUserId: d.createdByUserId || null,
          endedByUserId: d.endedByUserId || null,
          outcomeNote: d.outcomeNote || "",
          migratedFromDelegationId: d._id,
        }
      : null,
  };
}

export async function migrateTenant(company) {
  const report = {
    databaseName: company.databaseName,
    leaveHandoversSeen: 0,
    migrated: 0,
    skippedAlreadyMigrated: 0,
    skippedMissingLeave: 0,
    skippedUnsafe: 0,
    delegationsLinked: 0,
    errors: [],
  };

  const conn = await getTenantConnection(company.databaseName);
  const db = conn.db;
  const colNames = new Set((await db.listCollections().toArray()).map((c) => c.name));

  if (!colNames.has("leave_handovers")) {
    report.note = "No leave_handovers collection — nothing to migrate.";
    return report;
  }

  const handovers = await db.collection("leave_handovers").find({}).toArray();
  report.leaveHandoversSeen = handovers.length;

  const delegations = colNames.has("task_delegations")
    ? await db.collection("task_delegations").find({}).toArray()
    : [];

  const LeaveRequest = getLeaveRequestModel(conn);

  for (const ho of handovers) {
    try {
      if (!ho.leaveRequestId) {
        report.skippedUnsafe += 1;
        report.errors.push({ handoverId: String(ho._id), reason: "Missing leaveRequestId" });
        continue;
      }

      const leave = await LeaveRequest.findById(ho.leaveRequestId);
      if (!leave) {
        report.skippedMissingLeave += 1;
        report.errors.push({
          handoverId: String(ho._id),
          leaveRequestId: String(ho.leaveRequestId),
          reason: "LeaveRequest not found — stopped mapping this record (data preserved in source collection).",
        });
        continue;
      }

      // Idempotent skip: already migrated from this exact source row
      if (
        leave.handover?.migratedFromHandoverId &&
        String(leave.handover.migratedFromHandoverId) === String(ho._id)
      ) {
        report.skippedAlreadyMigrated += 1;
        continue;
      }
      if (leave.handover?.status) {
        // Native or conflicting embedded handover — never overwrite; source untouched
        report.skippedAlreadyMigrated += 1;
        report.errors.push({
          handoverId: String(ho._id),
          leaveRequestId: String(leave._id),
          reason: "LeaveRequest already has an embedded handover; source leave_handovers row left untouched.",
        });
        continue;
      }

      const related = delegations.filter((d) => String(d.handoverId) === String(ho._id));
      const byItem = new Map();
      for (const d of related) {
        if (d.handoverItemId) byItem.set(String(d.handoverItemId), d);
        report.delegationsLinked += 1;
      }

      const embedded = {
        status: ho.status || HANDOVER_STATUSES.DRAFT,
        managerEmployeeId: ho.managerEmployeeId || null,
        generalNotes: String(ho.generalNotes || "").slice(0, 4000),
        items: (ho.items || []).map((it) => mapItem(it, byItem)),
        createdByUserId: ho.createdByUserId || null,
        submittedAt: ho.submittedAt || null,
        submittedByUserId: ho.submittedByUserId || null,
        approvedAt: ho.approvedAt || null,
        approvedByUserId: ho.approvedByUserId || null,
        activatedAt: ho.activatedAt || null,
        completedAt: ho.completedAt || null,
        cancelledAt: ho.cancelledAt || null,
        cancelReason: ho.cancelReason || "",
        revisionReason: ho.revisionReason || "",
        migratedFromHandoverId: ho._id,
        schemaVersion: ho.schemaVersion || 1,
      };

      // Atomic write only when handover is still empty — safe under concurrent re-runs
      const updated = await LeaveRequest.findOneAndUpdate(
        {
          _id: ho.leaveRequestId,
          $or: [{ handover: null }, { handover: { $exists: false } }],
        },
        { $set: { handover: embedded } },
        { returnDocument: "after" }
      );

      if (!updated) {
        report.skippedAlreadyMigrated += 1;
        continue;
      }
      report.migrated += 1;
    } catch (err) {
      report.skippedUnsafe += 1;
      report.errors.push({
        handoverId: String(ho._id),
        reason: err.message,
      });
    }
  }

  return report;
}

async function main() {
  const args = parseArgs(process.argv);
  await connectCentralDB();

  const central = getCentralDbName();
  const query = args.company
    ? { $or: [{ slug: args.company }, { databaseName: args.company }] }
    : {};
  const companies = await Company.find(query).lean();

  const summary = {
    tenants: 0,
    migrated: 0,
    skippedAlreadyMigrated: 0,
    skippedMissingLeave: 0,
    skippedUnsafe: 0,
    reports: [],
  };

  for (const company of companies) {
    if (!company.databaseName || company.databaseName === central) continue;
    summary.tenants += 1;
    const report = await migrateTenant(company);
    summary.migrated += report.migrated;
    summary.skippedAlreadyMigrated += report.skippedAlreadyMigrated;
    summary.skippedMissingLeave += report.skippedMissingLeave;
    summary.skippedUnsafe += report.skippedUnsafe;
    summary.reports.push(report);
    console.log(
      `[migrate] ${company.databaseName}: seen=${report.leaveHandoversSeen} migrated=${report.migrated} skipped=${report.skippedAlreadyMigrated + report.skippedMissingLeave + report.skippedUnsafe}`
    );
    if (report.errors.length) {
      console.warn(`[migrate] issues for ${company.databaseName}:`, report.errors.slice(0, 10));
    }
  }

  console.log(JSON.stringify(summary, null, 2));

  if (summary.skippedMissingLeave > 0 || summary.skippedUnsafe > 0) {
    console.error(
      "Migration completed with unmapped records. Source collections were NOT dropped. Resolve issues before removing obsolete collections."
    );
    process.exitCode = 2;
  } else {
    console.log(
      "Migration verified clean for processed tenants. Source collections retained; remove model registrations only after API verification."
    );
  }

  await disconnectAll();
}

const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith("migrateHandoversToLeaveRequest.js") ||
    process.argv[1].includes("migrateHandoversToLeaveRequest"));

if (isDirectRun) {
  main().catch(async (err) => {
    console.error(err);
    await disconnectAll().catch(() => {});
    process.exit(1);
  });
}
