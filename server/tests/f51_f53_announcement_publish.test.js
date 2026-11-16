process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "f51-f53-announcement-publish-test-secret-32!";
process.env.JWT_ISSUER = "hrms-platform";
process.env.JWT_AUDIENCE = "hrms-company-users";
process.env.CENTRAL_DB_NAME = "platform_f51_f53_announce";
process.env.CLIENT_URL = "http://localhost:5173";
process.env.BCRYPT_ROUNDS = "4";
process.env.AUTH_COOKIE_NAME = "hrms_auth";
process.env.ANNOUNCEMENT_CRON_SECRET = "f51-announcement-cron-secret";
process.env.CRON_SECRET = "f51-announcement-cron-secret";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { connectCentralDB, disconnectAll, getCompanyModels, runWithTenantConnectionScope } from "../config/db.js";
import Company, { COMPANY_STATUSES } from "../models/Company.js";
import { ANNOUNCEMENT_STATUSES } from "../models/Announcement.js";
import { EMPLOYEE_STATUSES } from "../models/Employee.js";
import { NOTIFICATION_TYPES } from "../models/Notification.js";
import { USER_ROLES } from "../models/User.js";
import { hashPassword } from "../utils/password.js";
import {
  buildAnnouncementNotificationDocs,
  cronAuthorized,
  insertAnnouncementNotificationDocs,
  loadPortalAudiencePage,
  notifyAudience,
  publishDueAnnouncements,
  publishDueForAllCompanies,
} from "../services/announcementService.js";

function cookieFrom(response) {
  const cookies = response.headers["set-cookie"] || [];
  return cookies.find((value) => value.startsWith(`${process.env.AUTH_COOKIE_NAME}=`));
}

describe("F51/F53 announcement publish-due + batched notify", () => {
  let mongoServer;
  let app;
  let acme;
  let globex;
  let broken;
  let acmeModels;
  let globexModels;
  let acmeAdmin;
  let acmeUsers = [];
  let globexAdmin;
  let adminCookie;

  before(async () => {
    mongoServer = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongoServer.getUri();
    await connectCentralDB();
    app = createApp();

    const password = await hashPassword("AnnouncePass123!");
    const stamp = Date.now();

    acme = await Company.create({
      companyName: "F51 Acme",
      slug: `f51-acme-${stamp}`,
      databaseName: `company_f51_acme_${stamp}`,
      status: COMPANY_STATUSES.ACTIVE,
    });
    globex = await Company.create({
      companyName: "F51 Globex",
      slug: `f51-globex-${stamp}`,
      databaseName: `company_f51_globex_${stamp}`,
      status: COMPANY_STATUSES.ACTIVE,
    });
    broken = await Company.create({
      companyName: "F51 Broken",
      slug: `f51-broken-${stamp}`,
      databaseName: `company_f51_broken_${stamp}`,
      status: COMPANY_STATUSES.ACTIVE,
    });

    acmeModels = await getCompanyModels(acme, { provision: true });
    globexModels = await getCompanyModels(globex, { provision: true });
    await getCompanyModels(broken, { provision: true });

    acmeAdmin = await acmeModels.User.create({
      email: "admin@f51-acme.test",
      passwordHash: password,
      role: USER_ROLES.COMPANY_ADMIN,
      fullName: "Acme Admin",
      isActive: true,
    });

    for (let i = 0; i < 25; i++) {
      const user = await acmeModels.User.create({
        email: `emp${i}@f51-acme.test`,
        passwordHash: password,
        role: USER_ROLES.EMPLOYEE,
        fullName: `Emp ${i}`,
        isActive: true,
      });
      const emp = await acmeModels.Employee.create({
        userId: user._id,
        employeeCode: `F51-${i}`,
        fullName: `Emp ${i}`,
        email: user.email,
        status: EMPLOYEE_STATUSES.ACTIVE,
        job: { jobTitle: "Staff", department: "Ops", joiningDate: new Date("2026-01-01") },
      });
      user.employeeId = emp._id;
      await user.save();
      acmeUsers.push(user);
    }

    globexAdmin = await globexModels.User.create({
      email: "admin@f51-globex.test",
      passwordHash: password,
      role: USER_ROLES.COMPANY_ADMIN,
      fullName: "Globex Admin",
      isActive: true,
    });

    const login = await request(app)
      .post("/api/auth/login")
      .send({ companyCode: acme.slug, email: "admin@f51-acme.test", password: "AnnouncePass123!" });
    assert.equal(login.status, 200);
    adminCookie = cookieFrom(login);
  });

  after(async () => {
    await disconnectAll();
    if (mongoServer) await mongoServer.stop();
  });

  it("cronAuthorized accepts Bearer secret and rejects missing/wrong", () => {
    assert.equal(
      cronAuthorized({ get: () => `Bearer ${process.env.ANNOUNCEMENT_CRON_SECRET}` }),
      "ok"
    );
    assert.equal(cronAuthorized({ get: () => "Bearer wrong" }), "denied");
    assert.equal(cronAuthorized({ get: () => "" }), "denied");
  });

  it("publish-due HTTP requires cron auth", async () => {
    const denied = await request(app).post("/api/announcements/publish-due");
    assert.equal(denied.status, 401);
    const ok = await request(app)
      .post("/api/announcements/publish-due")
      .set("Authorization", `Bearer ${process.env.ANNOUNCEMENT_CRON_SECRET}`);
    assert.equal(ok.status, 200);
    assert.equal(typeof ok.body.published, "number");
    assert.equal(typeof ok.body.companies, "number");
    assert.ok(Array.isArray(ok.body.results));
  });

  it("batches audience notifications with one insertMany and payload parity", async () => {
    const announcement = await acmeModels.Announcement.create({
      title: "Batch parity",
      body: "Hello everyone on the floor today.",
      priority: "NORMAL",
      audience: "COMPANY",
      publishedBy: acmeAdmin._id,
      status: ANNOUNCEMENT_STATUSES.PUBLISHED,
      publishedAt: new Date(),
      notifiedAt: null,
    });

    const audienceEntries = [
      { user: acmeAdmin },
      ...acmeUsers.map((user) => ({ user })),
    ];
    const docs = buildAnnouncementNotificationDocs(announcement, audienceEntries);
    assert.equal(docs.length, 1 + acmeUsers.length);
    assert.equal(docs[0].type, NOTIFICATION_TYPES.ANNOUNCEMENT);
    assert.equal(docs[0].metadata.event, "published");
    assert.equal(docs[0].metadata.announcementId, String(announcement._id));
    assert.equal(docs[1].link.startsWith("/app/messages"), true);
    assert.equal(docs[0].link.startsWith("/admin/messages"), true);

    let insertCalls = 0;
    let insertDocs = 0;
    const original = acmeModels.Notification.insertMany.bind(acmeModels.Notification);
    acmeModels.Notification.insertMany = async (batch, opts) => {
      insertCalls += 1;
      insertDocs = batch.length;
      assert.equal(opts?.ordered, false);
      return original(batch, opts);
    };

    try {
      const result = await notifyAudience(acmeModels, announcement);
      assert.equal(insertCalls, 1);
      assert.equal(insertDocs, docs.length);
      assert.equal(result.writeCount, 1);
      // F51: audience cursor + dedupe + coverage count (≥2; exact count varies by page size).
      assert.ok(result.queryCount >= 2);
      assert.equal(result.complete, true);
      assert.equal(result.delivered, docs.length);
      assert.equal(
        await acmeModels.Notification.countDocuments({
          type: NOTIFICATION_TYPES.ANNOUNCEMENT,
          "metadata.announcementId": String(announcement._id),
        }),
        docs.length
      );
    } finally {
      acmeModels.Notification.insertMany = original;
    }
  });

  it("F51: portal audience loads by cursor pages (no single full-user find)", async () => {
    const first = await loadPortalAudiencePage(acmeModels, { limit: 2 });
    assert.ok(first.entries.length >= 1);
    assert.ok(first.nextAfterId);
    assert.equal(first.hasMore, true);

    const second = await loadPortalAudiencePage(acmeModels, {
      afterId: first.nextAfterId,
      limit: 2,
    });
    assert.ok(second.entries.length >= 1);
    const firstIds = new Set(first.entries.map((e) => String(e.user._id)));
    for (const entry of second.entries) {
      assert.equal(firstIds.has(String(entry.user._id)), false);
    }
  });

  it("dedupes on retry and concurrent claims do not double-notify", async () => {
    const announcement = await acmeModels.Announcement.create({
      title: "Concurrent",
      body: "Only once.",
      priority: "IMPORTANT",
      audience: "COMPANY",
      publishedBy: acmeAdmin._id,
      status: ANNOUNCEMENT_STATUSES.PUBLISHED,
      publishedAt: new Date(),
      notifiedAt: null,
    });

    const [a, b] = await Promise.all([
      publishDueAnnouncements(acmeModels),
      publishDueAnnouncements(acmeModels),
    ]);
    assert.equal(a + b, 0); // already PUBLISHED — published counter stays 0
    const count = await acmeModels.Notification.countDocuments({
      type: NOTIFICATION_TYPES.ANNOUNCEMENT,
      "metadata.announcementId": String(announcement._id),
      "metadata.event": "published",
    });
    const expectedAudience = 1 + acmeUsers.length;
    assert.equal(count, expectedAudience);

    const fresh = await acmeModels.Announcement.findById(announcement._id).lean();
    assert.ok(fresh.notifiedAt);
    assert.equal(fresh.notifyLockToken, "");

    await publishDueAnnouncements(acmeModels);
    assert.equal(
      await acmeModels.Notification.countDocuments({
        type: NOTIFICATION_TYPES.ANNOUNCEMENT,
        "metadata.announcementId": String(announcement._id),
      }),
      expectedAudience
    );
  });

  it("publishes scheduled announcements idempotently across tenants", async () => {
    const past = new Date(Date.now() - 60_000);
    await acmeModels.Announcement.create({
      title: "Acme due",
      body: "Acme body",
      priority: "NORMAL",
      audience: "COMPANY",
      publishedBy: acmeAdmin._id,
      status: ANNOUNCEMENT_STATUSES.SCHEDULED,
      scheduledAt: past,
    });
    await globexModels.Announcement.create({
      title: "Globex due",
      body: "Globex body",
      priority: "NORMAL",
      audience: "COMPANY",
      publishedBy: globexAdmin._id,
      status: ANNOUNCEMENT_STATUSES.SCHEDULED,
      scheduledAt: past,
    });

    const first = await publishDueForAllCompanies(new Date());
    assert.ok(first.published >= 2);
    const acmeRow = first.results.find((r) => r.companyId === String(acme._id));
    const globexRow = first.results.find((r) => r.companyId === String(globex._id));
    assert.ok(acmeRow.published >= 1);
    assert.ok(globexRow.published >= 1);

    const second = await publishDueForAllCompanies(new Date());
    assert.equal(second.published, 0);

    assert.equal(
      await acmeModels.Announcement.countDocuments({
        title: "Acme due",
        status: ANNOUNCEMENT_STATUSES.PUBLISHED,
        notifiedAt: { $ne: null },
      }),
      1
    );
    assert.equal(
      await globexModels.Announcement.countDocuments({
        title: "Globex due",
        status: ANNOUNCEMENT_STATUSES.PUBLISHED,
        notifiedAt: { $ne: null },
      }),
      1
    );
  });

  it("continues other tenants when one tenant publish throws", async () => {
    const past = new Date(Date.now() - 60_000);
    await acmeModels.Announcement.create({
      title: "Survive failure",
      body: "Still publish me",
      priority: "NORMAL",
      audience: "COMPANY",
      publishedBy: acmeAdmin._id,
      status: ANNOUNCEMENT_STATUSES.SCHEDULED,
      scheduledAt: past,
    });

    const result = await publishDueForAllCompanies(new Date(), {
      publishForCompany: async (company) => {
        if (String(company._id) === String(broken._id)) {
          throw new Error("simulated tenant failure");
        }
        return runWithTenantConnectionScope(async () => {
          const models = await getCompanyModels(company);
          return publishDueAnnouncements(models, new Date());
        });
      },
    });

    const brokenRow = result.results.find((r) => r.companyId === String(broken._id));
    assert.ok(brokenRow?.error);
    assert.match(brokenRow.error, /simulated tenant failure/);
    assert.ok(result.published >= 1);
    assert.equal(
      await acmeModels.Announcement.countDocuments({
        title: "Survive failure",
        status: ANNOUNCEMENT_STATUSES.PUBLISHED,
        notifiedAt: { $ne: null },
      }),
      1
    );
  });

  it("does not mark notifiedAt when insertMany fails completely (retryable)", async () => {
    const announcement = await acmeModels.Announcement.create({
      title: "Retryable notify",
      body: "Keep unlocked",
      priority: "NORMAL",
      audience: "COMPANY",
      publishedBy: acmeAdmin._id,
      status: ANNOUNCEMENT_STATUSES.PUBLISHED,
      publishedAt: new Date(),
      notifiedAt: null,
    });

    const original = acmeModels.Notification.insertMany;
    acmeModels.Notification.insertMany = async () => {
      throw new Error("bulk write exploded");
    };
    try {
      await publishDueAnnouncements(acmeModels);
      const row = await acmeModels.Announcement.findById(announcement._id).lean();
      assert.equal(row.status, ANNOUNCEMENT_STATUSES.PUBLISHED);
      assert.equal(row.notifiedAt, null);
      assert.equal(row.notifyLockToken, "");
    } finally {
      acmeModels.Notification.insertMany = original;
    }

    await publishDueAnnouncements(acmeModels);
    const after = await acmeModels.Announcement.findById(announcement._id).lean();
    assert.ok(after.notifiedAt);
    assert.ok(
      (await acmeModels.Notification.countDocuments({
        "metadata.announcementId": String(announcement._id),
      })) >= 1
    );
  });

  it("soft budget skips remaining tenants without failing the run", async () => {
    const result = await publishDueForAllCompanies(new Date(), {
      budgetMs: 0,
      publishForCompany: async () => 1,
    });
    assert.equal(result.published, 0);
    assert.ok(result.results.every((r) => r.reason === "budget_exhausted"));
  });

  it("insertAnnouncementNotificationDocs returns 0 for empty docs", async () => {
    assert.equal(await insertAnnouncementNotificationDocs(acmeModels, []), 0);
  });

  it("immediate publish via API still notifies with batch path", async () => {
    const created = await request(app)
      .post("/api/announcements")
      .set("Cookie", adminCookie)
      .send({
        title: "Live publish",
        body: "Published now",
        priority: "NORMAL",
        audience: "COMPANY",
        publish: true,
      });
    assert.equal(created.status, 201);
    const id = created.body.announcement.id;
    const notes = await acmeModels.Notification.countDocuments({
      type: NOTIFICATION_TYPES.ANNOUNCEMENT,
      "metadata.announcementId": id,
    });
    assert.ok(notes >= 1);
    const row = await acmeModels.Announcement.findById(id).lean();
    assert.ok(row.notifiedAt);
  });
});
