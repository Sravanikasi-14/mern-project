import assert from "node:assert/strict";
import fs from "node:fs";
import { after, before, describe, it } from "node:test";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import {
  buildBaseStages,
  buildHiringSummaryFromCounts,
  buildLegacyHiringListPipeline,
  buildLightStageStages,
  buildOptimizedHiringListPipeline,
  deriveHiringStage,
  HIRING_STAGES,
} from "../controllers/hiringWorkspaceController.js";
import { connectCentralDB, disconnectAll, getCompanyModels } from "../config/db.js";
import Company, { COMPANY_STATUSES } from "../models/Company.js";
import { OFFER_LETTER_STATUSES } from "../models/OfferLetter.js";
import {
  ONBOARDING_ACCOUNT_SETUP_STATUSES,
  ONBOARDING_STATUSES,
  USER_ROLES,
} from "../models/User.js";

process.env.NODE_ENV = "test";
process.env.CENTRAL_DB_NAME = "platform_f36_hiring";
process.env.JWT_SECRET = "f36-hiring-summary-test-secret-32chars!!";

/** @type {import("mongodb-memory-server").MongoMemoryServer} */
let mongo;
let companyA;
let companyB;
let modelsA;
let modelsB;

async function seedOffer(models, overrides = {}) {
  const { OfferLetter } = models;
  return OfferLetter.create({
    candidate: {
      fullName: overrides.fullName || "Cand Name",
      email: overrides.email || `cand_${new mongoose.Types.ObjectId()}@example.test`,
    },
    position: overrides.position || "Engineer",
    department: overrides.department || "Eng",
    monthlySalary: 50000,
    joiningDate: new Date("2030-01-15"),
    content: "<p>offer</p>",
    status: overrides.status || OFFER_LETTER_STATUSES.DRAFT,
    employeeId: overrides.employeeId || undefined,
    candidateUserId: overrides.candidateUserId || undefined,
    onboardingId: overrides.onboardingId || undefined,
    schemaVersion: 1,
  });
}

async function seedUser(models, overrides = {}) {
  const { User } = models;
  return User.create({
    email: overrides.email || `user_${new mongoose.Types.ObjectId()}@example.test`,
    passwordHash: "x",
    role: overrides.role || USER_ROLES.CANDIDATE,
    isActive: true,
    employeeId: overrides.employeeId || undefined,
    onboarding: overrides.onboarding,
    schemaVersion: 1,
  });
}

async function runSummary(models, pipelineBuilder, rowMatch = { stage: { $ne: HIRING_STAGES.WITHDRAWN } }) {
  const { OfferLetter, User } = models;
  const [result] = await OfferLetter.aggregate(
    pipelineBuilder(User.collection.name, { rowMatch, skip: 0, limit: 100 })
  ).allowDiskUse(true);
  return {
    summary: buildHiringSummaryFromCounts(result?.counts),
    total: result?.total?.[0]?.n || 0,
    rowCount: (result?.rows || result?.pageIds || []).length,
    counts: result?.counts || [],
  };
}

before(async () => {
  fs.mkdirSync("D:/tmp/hrms-mongo/f36-hiring-summary", { recursive: true });
  mongo = await MongoMemoryServer.create({
    instance: { dbPath: "D:/tmp/hrms-mongo/f36-hiring-summary" },
  });
  process.env.MONGO_URI = mongo.getUri();
  await connectCentralDB();

  // Persistent dbPath can retain companies across runs — clear + unique slugs.
  await Company.deleteMany({});
  const suffix = `${Date.now()}`;
  companyA = await Company.create({
    companyName: "F36 Acme",
    slug: `f36-acme-${suffix}`,
    databaseName: `company_f36_acme_${suffix}`,
    status: COMPANY_STATUSES.ACTIVE,
    schemaVersion: 1,
    migrationVersion: 0,
  });
  companyB = await Company.create({
    companyName: "F36 Globex",
    slug: `f36-globex-${suffix}`,
    databaseName: `company_f36_globex_${suffix}`,
    status: COMPANY_STATUSES.ACTIVE,
    schemaVersion: 1,
    migrationVersion: 0,
  });
  modelsA = await getCompanyModels(companyA, { provision: true });
  modelsB = await getCompanyModels(companyB, { provision: true });
});

after(async () => {
  await disconnectAll();
  if (mongo) await mongo.stop();
});

describe("F36 hiring summary — stage derivation parity", () => {
  it("covers every hiring stage via deriveHiringStage (JS source of truth)", () => {
    assert.equal(
      deriveHiringStage({ offerStatus: OFFER_LETTER_STATUSES.WITHDRAWN }),
      HIRING_STAGES.WITHDRAWN
    );
    assert.equal(
      deriveHiringStage({ offerStatus: OFFER_LETTER_STATUSES.DRAFT }),
      HIRING_STAGES.OFFERS
    );
    assert.equal(
      deriveHiringStage({ offerStatus: OFFER_LETTER_STATUSES.SENT }),
      HIRING_STAGES.OFFERS
    );
    assert.equal(
      deriveHiringStage({
        offerStatus: OFFER_LETTER_STATUSES.ACCEPTED,
        onboardingStatus: ONBOARDING_STATUSES.DRAFT,
      }),
      HIRING_STAGES.ONBOARDING
    );
    assert.equal(
      deriveHiringStage({
        offerStatus: OFFER_LETTER_STATUSES.ACCEPTED,
        onboardingStatus: ONBOARDING_STATUSES.SUBMITTED,
      }),
      HIRING_STAGES.HR_REVIEW
    );
    assert.equal(
      deriveHiringStage({
        offerStatus: OFFER_LETTER_STATUSES.ACCEPTED,
        onboardingStatus: ONBOARDING_STATUSES.PROCESSING_APPROVAL,
      }),
      HIRING_STAGES.HR_REVIEW
    );
    assert.equal(
      deriveHiringStage({
        offerStatus: OFFER_LETTER_STATUSES.ACCEPTED,
        onboardingStatus: ONBOARDING_STATUSES.CHANGES_REQUESTED,
      }),
      HIRING_STAGES.CORRECTIONS
    );
    for (const status of ONBOARDING_ACCOUNT_SETUP_STATUSES) {
      assert.equal(
        deriveHiringStage({
          offerStatus: OFFER_LETTER_STATUSES.ACCEPTED,
          onboardingStatus: status,
        }),
        HIRING_STAGES.ACCOUNT_SETUP,
        status
      );
    }
    assert.equal(
      deriveHiringStage({
        offerStatus: OFFER_LETTER_STATUSES.ACCEPTED,
        onboardingStatus: ONBOARDING_STATUSES.REJECTED,
      }),
      HIRING_STAGES.REJECTED
    );
    assert.equal(
      deriveHiringStage({
        offerStatus: OFFER_LETTER_STATUSES.ACCEPTED,
        onboardingStatus: ONBOARDING_STATUSES.ACTIVATED,
      }),
      HIRING_STAGES.COMPLETED
    );
    assert.equal(
      deriveHiringStage({
        offerStatus: OFFER_LETTER_STATUSES.ACCEPTED,
        hasOnboardingEmployee: true,
      }),
      HIRING_STAGES.COMPLETED
    );
    assert.equal(
      deriveHiringStage({
        offerStatus: OFFER_LETTER_STATUSES.ACCEPTED,
        offerHasEmployee: true,
      }),
      HIRING_STAGES.COMPLETED
    );
  });

  it("light and legacy pipelines produce identical summaries for a full fixture set", async () => {
    await modelsA.OfferLetter.deleteMany({});
    await modelsA.User.deleteMany({ role: USER_ROLES.CANDIDATE });

    const empId = new mongoose.Types.ObjectId();

    // OFFERS (draft + sent)
    await seedOffer(modelsA, {
      fullName: "Draft D",
      email: "draft@f36.test",
      status: OFFER_LETTER_STATUSES.DRAFT,
    });
    await seedOffer(modelsA, {
      fullName: "Sent S",
      email: "sent@f36.test",
      status: OFFER_LETTER_STATUSES.SENT,
    });

    // ONBOARDING
    const uOn = await seedUser(modelsA, {
      email: "on@f36.test",
      onboarding: { status: ONBOARDING_STATUSES.DRAFT, offerLetterId: null },
    });
    const oOn = await seedOffer(modelsA, {
      email: "on@f36.test",
      status: OFFER_LETTER_STATUSES.ACCEPTED,
      candidateUserId: uOn._id,
    });
    uOn.onboarding.offerLetterId = oOn._id;
    await uOn.save();

    // HR_REVIEW
    const uHr = await seedUser(modelsA, {
      email: "hrrev@f36.test",
      onboarding: { status: ONBOARDING_STATUSES.SUBMITTED, offerLetterId: null },
    });
    const oHr = await seedOffer(modelsA, {
      email: "hrrev@f36.test",
      status: OFFER_LETTER_STATUSES.ACCEPTED,
      candidateUserId: uHr._id,
    });
    uHr.onboarding.offerLetterId = oHr._id;
    await uHr.save();

    // CORRECTIONS
    const uCorr = await seedUser(modelsA, {
      email: "corr@f36.test",
      onboarding: { status: ONBOARDING_STATUSES.CHANGES_REQUESTED, offerLetterId: null },
    });
    const oCorr = await seedOffer(modelsA, {
      email: "corr@f36.test",
      status: OFFER_LETTER_STATUSES.ACCEPTED,
      candidateUserId: uCorr._id,
    });
    uCorr.onboarding.offerLetterId = oCorr._id;
    await uCorr.save();

    // ACCOUNT_SETUP
    const uSetup = await seedUser(modelsA, {
      email: "setup@f36.test",
      onboarding: { status: ONBOARDING_STATUSES.APPROVED, offerLetterId: null },
    });
    const oSetup = await seedOffer(modelsA, {
      email: "setup@f36.test",
      status: OFFER_LETTER_STATUSES.ACCEPTED,
      candidateUserId: uSetup._id,
    });
    uSetup.onboarding.offerLetterId = oSetup._id;
    await uSetup.save();

    // COMPLETED via activated
    const uDone = await seedUser(modelsA, {
      email: "done@f36.test",
      onboarding: {
        status: ONBOARDING_STATUSES.ACTIVATED,
        offerLetterId: null,
        employeeId: empId,
      },
      employeeId: empId,
    });
    const oDone = await seedOffer(modelsA, {
      email: "done@f36.test",
      status: OFFER_LETTER_STATUSES.ACCEPTED,
      candidateUserId: uDone._id,
      employeeId: empId,
    });
    uDone.onboarding.offerLetterId = oDone._id;
    await uDone.save();

    // REJECTED
    const uRej = await seedUser(modelsA, {
      email: "rej@f36.test",
      onboarding: { status: ONBOARDING_STATUSES.REJECTED, offerLetterId: null },
    });
    const oRej = await seedOffer(modelsA, {
      email: "rej@f36.test",
      status: OFFER_LETTER_STATUSES.ACCEPTED,
      candidateUserId: uRej._id,
    });
    uRej.onboarding.offerLetterId = oRej._id;
    await uRej.save();

    // WITHDRAWN
    await seedOffer(modelsA, {
      email: "wd@f36.test",
      status: OFFER_LETTER_STATUSES.WITHDRAWN,
    });

    // Missing related user (accepted, no user) → ONBOARDING default
    await seedOffer(modelsA, {
      email: "orphan@f36.test",
      status: OFFER_LETTER_STATUSES.ACCEPTED,
      candidateUserId: new mongoose.Types.ObjectId(),
    });

    // Invalid / mismatched onboarding offerLetterId → treated as no onboarding match → ONBOARDING
    const uMismatch = await seedUser(modelsA, {
      email: "mismatch@f36.test",
      onboarding: {
        status: ONBOARDING_STATUSES.SUBMITTED,
        offerLetterId: new mongoose.Types.ObjectId(),
      },
    });
    await seedOffer(modelsA, {
      email: "mismatch@f36.test",
      status: OFFER_LETTER_STATUSES.ACCEPTED,
      candidateUserId: uMismatch._id,
    });

    const legacy = await runSummary(modelsA, buildLegacyHiringListPipeline);
    const optimized = await runSummary(modelsA, buildOptimizedHiringListPipeline);

    assert.deepEqual(optimized.summary, legacy.summary);
    assert.equal(optimized.summary.offers, 2);
    assert.equal(optimized.summary.onboarding, 3); // on + orphan + mismatch
    assert.equal(optimized.summary.hrReview, 1);
    assert.equal(optimized.summary.corrections, 1);
    assert.equal(optimized.summary.accountSetup, 1);
    assert.equal(optimized.summary.completed, 1);
    assert.equal(optimized.summary.rejected, 1);
    assert.equal(optimized.summary.withdrawn, 1);
    assert.equal(optimized.summary.all, 10); // excludes withdrawn
    assert.equal(optimized.total, legacy.total);
  });

  it("keeps stage transitions reflected in summary without denormalized fields", async () => {
    await modelsA.OfferLetter.deleteMany({});
    await modelsA.User.deleteMany({ role: USER_ROLES.CANDIDATE });

    const user = await seedUser(modelsA, {
      email: "transition@f36.test",
      onboarding: { status: ONBOARDING_STATUSES.DRAFT, offerLetterId: null },
    });
    const offer = await seedOffer(modelsA, {
      email: "transition@f36.test",
      status: OFFER_LETTER_STATUSES.DRAFT,
    });

    let optimized = await runSummary(modelsA, buildOptimizedHiringListPipeline);
    assert.equal(optimized.summary.offers, 1);

    offer.status = OFFER_LETTER_STATUSES.SENT;
    await offer.save();
    optimized = await runSummary(modelsA, buildOptimizedHiringListPipeline);
    assert.equal(optimized.summary.offers, 1);

    offer.status = OFFER_LETTER_STATUSES.ACCEPTED;
    offer.candidateUserId = user._id;
    await offer.save();
    user.onboarding.offerLetterId = offer._id;
    user.onboarding.status = ONBOARDING_STATUSES.DRAFT;
    await user.save();
    optimized = await runSummary(modelsA, buildOptimizedHiringListPipeline);
    assert.equal(optimized.summary.onboarding, 1);
    assert.equal(optimized.summary.offers, 0);

    user.onboarding.status = ONBOARDING_STATUSES.SUBMITTED;
    await user.save();
    optimized = await runSummary(modelsA, buildOptimizedHiringListPipeline);
    assert.equal(optimized.summary.hrReview, 1);

    user.onboarding.status = ONBOARDING_STATUSES.CHANGES_REQUESTED;
    await user.save();
    optimized = await runSummary(modelsA, buildOptimizedHiringListPipeline);
    assert.equal(optimized.summary.corrections, 1);

    user.onboarding.status = ONBOARDING_STATUSES.APPROVED;
    await user.save();
    optimized = await runSummary(modelsA, buildOptimizedHiringListPipeline);
    assert.equal(optimized.summary.accountSetup, 1);

    user.onboarding.status = ONBOARDING_STATUSES.REJECTED;
    await user.save();
    optimized = await runSummary(modelsA, buildOptimizedHiringListPipeline);
    assert.equal(optimized.summary.rejected, 1);

    offer.status = OFFER_LETTER_STATUSES.WITHDRAWN;
    await offer.save();
    optimized = await runSummary(modelsA, buildOptimizedHiringListPipeline);
    assert.equal(optimized.summary.withdrawn, 1);
    assert.equal(optimized.summary.all, 0);

    // Soft-delete style: remove offer → counts drop
    await modelsA.OfferLetter.deleteOne({ _id: offer._id });
    optimized = await runSummary(modelsA, buildOptimizedHiringListPipeline);
    assert.deepEqual(optimized.summary, buildHiringSummaryFromCounts([]));
  });

  it("isolates tenants even when offer/user ObjectIds collide across DBs", async () => {
    await modelsA.OfferLetter.deleteMany({});
    await modelsB.OfferLetter.deleteMany({});
    await modelsA.User.deleteMany({ role: USER_ROLES.CANDIDATE });
    await modelsB.User.deleteMany({ role: USER_ROLES.CANDIDATE });

    const sharedId = new mongoose.Types.ObjectId();

    await modelsA.OfferLetter.collection.insertOne({
      _id: sharedId,
      candidate: { fullName: "Acme Shared", email: "shared@acme.test" },
      position: "A",
      department: "A",
      monthlySalary: 1,
      joiningDate: new Date("2030-01-01"),
      content: "<p>a</p>",
      status: OFFER_LETTER_STATUSES.DRAFT,
      createdAt: new Date(),
      updatedAt: new Date(),
      schemaVersion: 1,
    });
    await modelsB.OfferLetter.collection.insertOne({
      _id: sharedId,
      candidate: { fullName: "Globex Shared", email: "shared@globex.test" },
      position: "B",
      department: "B",
      monthlySalary: 1,
      joiningDate: new Date("2030-01-01"),
      content: "<p>b</p>",
      status: OFFER_LETTER_STATUSES.WITHDRAWN,
      createdAt: new Date(),
      updatedAt: new Date(),
      schemaVersion: 1,
    });

    const sumA = await runSummary(modelsA, buildOptimizedHiringListPipeline);
    const sumB = await runSummary(modelsB, buildOptimizedHiringListPipeline);
    assert.equal(sumA.summary.offers, 1);
    assert.equal(sumA.summary.withdrawn, 0);
    assert.equal(sumB.summary.offers, 0);
    assert.equal(sumB.summary.withdrawn, 1);
  });

  it("handles accepted offers with null lookup user and null onboarding object", async () => {
    await modelsA.OfferLetter.deleteMany({});
    await modelsA.User.deleteMany({ role: USER_ROLES.CANDIDATE });

    await seedOffer(modelsA, {
      email: "nolookup@f36.test",
      status: OFFER_LETTER_STATUSES.ACCEPTED,
      candidateUserId: null,
      onboardingId: null,
    });

    const userNoOb = await modelsA.User.create({
      email: "noob@f36.test",
      passwordHash: "x",
      role: USER_ROLES.CANDIDATE,
      isActive: true,
      schemaVersion: 1,
    });
    await seedOffer(modelsA, {
      email: "noob@f36.test",
      status: OFFER_LETTER_STATUSES.ACCEPTED,
      candidateUserId: userNoOb._id,
    });

    const legacy = await runSummary(modelsA, buildLegacyHiringListPipeline);
    const optimized = await runSummary(modelsA, buildOptimizedHiringListPipeline);
    assert.deepEqual(optimized.summary, legacy.summary);
    assert.equal(optimized.summary.onboarding, 2);
  });

  it("page hydration preserves sort order and list row stages", async () => {
    await modelsA.OfferLetter.deleteMany({});
    await modelsA.User.deleteMany({ role: USER_ROLES.CANDIDATE });

    const older = await seedOffer(modelsA, {
      email: "older@f36.test",
      status: OFFER_LETTER_STATUSES.DRAFT,
    });
    await modelsA.OfferLetter.updateOne(
      { _id: older._id },
      { $set: { updatedAt: new Date("2020-01-01") } }
    );
    const newer = await seedOffer(modelsA, {
      email: "newer@f36.test",
      status: OFFER_LETTER_STATUSES.SENT,
    });
    await modelsA.OfferLetter.updateOne(
      { _id: newer._id },
      { $set: { updatedAt: new Date("2025-06-01") } }
    );

    const { OfferLetter, User } = modelsA;
    const [facet] = await OfferLetter.aggregate(
      buildOptimizedHiringListPipeline(User.collection.name, {
        rowMatch: { stage: { $ne: HIRING_STAGES.WITHDRAWN } },
        skip: 0,
        limit: 10,
      })
    );
    const pageIds = (facet.pageIds || []).map((r) => r._id);
    assert.equal(String(pageIds[0]), String(newer._id));
    assert.equal(String(pageIds[1]), String(older._id));

    const docs = await OfferLetter.aggregate(
      buildBaseStages(User.collection.name, { _id: { $in: pageIds } })
    );
    const byId = new Map(docs.map((d) => [String(d._id), d]));
    const ordered = pageIds.map((id) => byId.get(String(id)));
    assert.equal(ordered[0].stage, HIRING_STAGES.OFFERS);
    assert.equal(ordered[1].stage, HIRING_STAGES.OFFERS);
    assert.equal(ordered[0].candidate.email, "newer@f36.test");
  });
});

describe("F36 hiring summary — structural explain evidence", () => {
  it("light stage lookup projects only stage-critical user fields", () => {
    const light = buildLightStageStages("users");
    const heavy = buildBaseStages("users");
    const lightLookup = light.find((s) => s.$lookup);
    const heavyLookup = heavy.find((s) => s.$lookup);
    assert.ok(lightLookup);
    assert.ok(heavyLookup);
    assert.equal(lightLookup.$lookup.localField, "_lookupUserId");
    assert.equal(lightLookup.$lookup.foreignField, "_id");

    const lightProject = JSON.stringify(lightLookup.$lookup.pipeline);
    assert.equal(lightProject.includes("sectionReviews"), false);
    assert.equal(lightProject.includes("documents"), false);
    assert.equal(lightProject.includes("personalDetails"), false);

    const heavyProject = JSON.stringify(heavyLookup.$lookup.pipeline);
    assert.ok(heavyProject.includes("sectionReviews") || heavyProject.includes("sections"));
    assert.ok(heavyProject.includes("documents"));
  });

  it("optimized facet does not embed full list rows (page ids only)", () => {
    const optimized = buildOptimizedHiringListPipeline("users", {
      rowMatch: { stage: HIRING_STAGES.OFFERS },
      skip: 0,
      limit: 20,
    });
    const facet = optimized.find((s) => s.$facet);
    assert.ok(facet.$facet.pageIds);
    assert.equal(facet.$facet.rows, undefined);
    assert.ok(facet.$facet.counts);
    assert.ok(facet.$facet.total);
  });

  it("explain(executionStats) runs for light and legacy pipelines (structural, not a perf claim)", async () => {
    await modelsA.OfferLetter.deleteMany({});
    for (let i = 0; i < 5; i += 1) {
      await seedOffer(modelsA, {
        email: `explain_${i}@f36.test`,
        status: i % 2 === 0 ? OFFER_LETTER_STATUSES.DRAFT : OFFER_LETTER_STATUSES.SENT,
      });
    }

    const { OfferLetter, User } = modelsA;
    const lightPipeline = buildOptimizedHiringListPipeline(User.collection.name, {
      rowMatch: { stage: { $ne: HIRING_STAGES.WITHDRAWN } },
      skip: 0,
      limit: 20,
    });
    const legacyPipeline = buildLegacyHiringListPipeline(User.collection.name, {
      rowMatch: { stage: { $ne: HIRING_STAGES.WITHDRAWN } },
      skip: 0,
      limit: 20,
    });

    const lightExplain = await OfferLetter.collection
      .aggregate(lightPipeline)
      .explain("executionStats");
    const legacyExplain = await OfferLetter.collection
      .aggregate(legacyPipeline)
      .explain("executionStats");

    assert.ok(lightExplain);
    assert.ok(legacyExplain);
    // Presence of explain output confirms pipelines are valid; do not assert timings.
    const lightOk =
      lightExplain.ok === 1 ||
      lightExplain.stages ||
      lightExplain.executionStats ||
      lightExplain.command;
    const legacyOk =
      legacyExplain.ok === 1 ||
      legacyExplain.stages ||
      legacyExplain.executionStats ||
      legacyExplain.command;
    assert.ok(lightOk);
    assert.ok(legacyOk);
  });
});
