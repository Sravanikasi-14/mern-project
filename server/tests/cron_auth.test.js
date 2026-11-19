process.env.NODE_ENV = "test";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cronAuthorized,
  resolveCronSecret,
  requireCronSecret,
} from "../utils/cronAuth.js";
import { toPublicWorkforceCronSummary } from "../services/workforceScheduler/publicSummary.js";

function fakeReq(authorization) {
  return {
    get(name) {
      if (String(name).toLowerCase() === "authorization") return authorization || "";
      return "";
    },
    headers: authorization ? { authorization } : {},
  };
}

describe("cronAuth utility", () => {
  it("resolveCronSecret prefers CRON_SECRET over announcement fallback", () => {
    const prevCron = process.env.CRON_SECRET;
    const prevAnn = process.env.ANNOUNCEMENT_CRON_SECRET;
    try {
      process.env.CRON_SECRET = "primary-secret-value-aaaaaaaa";
      process.env.ANNOUNCEMENT_CRON_SECRET = "fallback-secret-value-bbbbbbbb";
      assert.equal(resolveCronSecret(), "primary-secret-value-aaaaaaaa");

      delete process.env.CRON_SECRET;
      assert.equal(resolveCronSecret(), "fallback-secret-value-bbbbbbbb");

      delete process.env.ANNOUNCEMENT_CRON_SECRET;
      assert.equal(resolveCronSecret(), "");
    } finally {
      process.env.CRON_SECRET = prevCron;
      process.env.ANNOUNCEMENT_CRON_SECRET = prevAnn;
    }
  });

  it("cronAuthorized returns unconfigured / denied / ok correctly", () => {
    const prevCron = process.env.CRON_SECRET;
    const prevAnn = process.env.ANNOUNCEMENT_CRON_SECRET;
    try {
      delete process.env.CRON_SECRET;
      delete process.env.ANNOUNCEMENT_CRON_SECRET;
      assert.equal(cronAuthorized(fakeReq("Bearer anything")), "unconfigured");

      process.env.CRON_SECRET = "exact-match-secret-32chars-aaaa";
      assert.equal(cronAuthorized(fakeReq("")), "denied");
      assert.equal(cronAuthorized(fakeReq("Bearer wrong-length")), "denied");
      assert.equal(cronAuthorized(fakeReq("Bearer exact-match-secret-32chars-bbbb")), "denied");
      assert.equal(cronAuthorized(fakeReq("Bearer exact-match-secret-32chars-aaaa")), "ok");
      // Query-string style tokens are not accepted — Bearer header only.
      assert.equal(cronAuthorized({ get: () => "", headers: {}, query: { secret: process.env.CRON_SECRET } }), "denied");
    } finally {
      process.env.CRON_SECRET = prevCron;
      process.env.ANNOUNCEMENT_CRON_SECRET = prevAnn;
    }
  });

  it("requireCronSecret middleware maps verdicts to status codes without leaking secrets", async () => {
    const prevCron = process.env.CRON_SECRET;
    try {
      delete process.env.CRON_SECRET;
      delete process.env.ANNOUNCEMENT_CRON_SECRET;
      await new Promise((resolve) => {
        requireCronSecret(fakeReq("Bearer x"), {}, (err) => {
          assert.equal(err.status, 503);
          assert.equal(err.code, "CRON_UNCONFIGURED");
          assert.equal(String(err.message).includes("Bearer"), false);
          resolve();
        });
      });

      process.env.CRON_SECRET = "middleware-secret-value-xxxxxxxx";
      await new Promise((resolve) => {
        requireCronSecret(fakeReq("Bearer no"), {}, (err) => {
          assert.equal(err.status, 401);
          assert.equal(err.code, "CRON_UNAUTHORIZED");
          assert.equal(String(err.message).includes("middleware-secret"), false);
          resolve();
        });
      });

      await new Promise((resolve, reject) => {
        requireCronSecret(fakeReq("Bearer middleware-secret-value-xxxxxxxx"), {}, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    } finally {
      process.env.CRON_SECRET = prevCron;
    }
  });
});

describe("workforce cron public summary", () => {
  it("strips tenant decision payloads and employee details", () => {
    const publicBody = toPublicWorkforceCronSummary({
      skipped: false,
      mode: "dry-run",
      companies: 3,
      discovered: 2,
      attempted: 2,
      successCount: 1,
      errorCount: 0,
      skippedCount: 1,
      truncated: true,
      nextAfterCompanyId: "abc123",
      hops: 1,
      chainDepth: 0,
      durationMs: 1200,
      results: [
        {
          companyId: "abc123",
          companySlug: "acme",
          summary: { autoApplied: 1 },
          decisions: [{ proposal: { employeeId: "emp-secret" } }],
        },
      ],
      fleet: {
        truncated: true,
        afterCompanyId: "abc123",
        waveStartedAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:01:00.000Z",
      },
      continuations: [{ kind: "in_process", afterCompanyId: "abc123" }],
    });

    assert.equal(publicBody.success, true);
    assert.equal(publicBody.mode, "dry-run");
    assert.equal(publicBody.attempted, 2);
    assert.equal(publicBody.truncated, true);
    assert.equal(publicBody.nextAfterCompanyId, "abc123");
    assert.equal(publicBody.results, undefined);
    assert.equal(publicBody.continuations, undefined);
    assert.equal(publicBody.fleet.hasCursor, true);
    assert.equal(publicBody.fleet.afterCompanyId, undefined);
    assert.equal(JSON.stringify(publicBody).includes("emp-secret"), false);
    assert.equal(JSON.stringify(publicBody).includes("acme"), false);
  });
});
