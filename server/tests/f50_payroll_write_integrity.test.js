process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "f50-payroll-write-integrity-secret-32c!";
process.env.JWT_ISSUER = "hrms-platform";
process.env.JWT_AUDIENCE = "hrms-company-users";
process.env.CENTRAL_DB_NAME = "platform_f50_payroll_write";
process.env.CLIENT_URL = "http://localhost:5173";
process.env.BCRYPT_ROUNDS = "4";
process.env.AUTH_COOKIE_NAME = "hrms_auth";

import assert from "node:assert/strict";
import fs from "node:fs";
import { after, before, describe, it } from "node:test";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { connectCentralDB, disconnectAll, getCompanyModels } from "../config/db.js";
import Company, { COMPANY_STATUSES } from "../models/Company.js";
import { EMPLOYEE_STATUSES } from "../models/Employee.js";
import { USER_ROLES } from "../models/User.js";
import { getAuthCookieName } from "../utils/authCookie.js";
import { hashPassword } from "../utils/password.js";
import { calculatePayrollCycle } from "../services/payrollCalculationService.js";
import {
  PAYROLL_CALC_LOCK_MS,
  acquirePayrollCalcLock,
  createPayrollCycleAtomic,
  finalizePayrollCycleAtomic,
  isPayrollCalcLockActive,
  recalculatePayrollCycleAtomic,
  releasePayrollCalcLock,
} from "../services/payrollWriteService.js";
import { connectionSupportsTransactions } from "../services/onboardingEmployeeService.js";

function cookieFrom(response) {
  const cookies = response.headers["set-cookie"] || [];
  return cookies.find((val) => val.startsWith(`${getAuthCookieName()}=`));
}

describe("F50 payroll write integrity (A + B + F)", () => {
  let mongo;
  let app;
  let company;
  let models;
  let hrCookie;
  let hrUser;
  let empA;
  let empB;

  before(async () => {
    const dbPath = `D:/tmp/hrms-mongo/f50-payroll-write/${Date.now()}`;
    fs.mkdirSync(dbPath, { recursive: true });
    mongo = await MongoMemoryReplSet.create({
      replSet: { count: 1 },
      instanceOpts: [{ dbPath }],
    });
    process.env.MONGO_URI = mongo.getUri();
    await connectCentralDB();
    app = createApp();

    const slug = `f50-write-${Date.now()}`;
    company = await Company.create({
      companyName: "F50 Write Integrity Co",
      slug,
      databaseName: `company_${slug.replace(/-/g, "_")}`,
      status: COMPANY_STATUSES.ACTIVE,
    });
    models = await getCompanyModels(company, { provision: true });
    assert.equal(
      connectionSupportsTransactions(models.connection),
      true,
      "test replica set must support transactions"
    );

    const password = await hashPassword("F50WritePass123!");
    hrUser = await models.User.create({
      email: "hr@f50write.test",
      passwordHash: password,
      role: USER_ROLES.HR_ADMIN,
      fullName: "HR Admin",
      isActive: true,
    });

    async function makeEmployee(code, email, name, ctc) {
      const user = await models.User.create({
        email,
        passwordHash: password,
        role: USER_ROLES.EMPLOYEE,
        fullName: name,
        isActive: true,
      });
      const emp = await models.Employee.create({
        userId: user._id,
        employeeCode: code,
        fullName: name,
        email,
        status: EMPLOYEE_STATUSES.ACTIVE,
        job: {
          jobTitle: "Engineer",
          department: "Engineering",
          joiningDate: new Date("2026-01-01"),
        },
        bankDetails: {
          accountNumber: "1234567890",
          bankName: "Test Bank",
          ifscCode: "TEST0001234",
        },
        panNumber: "ABCDE1234F",
      });
      await models.EmployeeCompensation.create({
        employeeId: emp._id,
        revisions: [
          {
            effectiveFromDate: new Date("2026-01-01"),
            monthlyCostToCompany: ctc,
            salaryComponents: {
              basicSalary: Math.round(ctc * 0.5),
              houseRentAllowance: Math.round(ctc * 0.3),
              specialAllowance: Math.round(ctc * 0.2),
              employerProvidentFund: 1800,
              otherDeductions: 0,
            },
          },
        ],
      });
      return emp;
    }

    empA = await makeEmployee("F50W-A", "a@f50write.test", "Alice Write", 100000);
    empB = await makeEmployee("F50W-B", "b@f50write.test", "Bob Write", 80000);

    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: "hr@f50write.test", password: "F50WritePass123!", companyCode: company.slug });
    assert.equal(login.status, 200);
    hrCookie = cookieFrom(login);
    assert.ok(hrCookie);
  });

  after(async () => {
    await disconnectAll();
    if (mongo) await mongo.stop();
  });

  it("PAYROLL_CALC_LOCK_MS exceeds the 60s Vercel invocation limit", () => {
    assert.ok(PAYROLL_CALC_LOCK_MS > 60_000);
  });

  it("1. create transaction succeeds with matching cycle and payslip records", async () => {
    const { cycle, calculation } = await createPayrollCycleAtomic({
      models,
      company,
      periodMonth: 4,
      periodYear: 2026,
      notes: "create-ok",
      createdBy: hrUser._id,
    });

    assert.equal(cycle.status, "CALCULATED");
    assert.equal(cycle.employeeCount, calculation.cycleSummary.employeeCount);

    const payslips = await models.Payslip.find({ payrollCycleId: cycle._id }).lean();
    assert.equal(payslips.length, calculation.employeeRecords.length);
    assert.ok(payslips.length >= 2);
    assert.ok(payslips.every((p) => p.status === "DRAFT"));
    assert.equal(cycle.totalNetPayable, calculation.cycleSummary.totalNetPayable);
  });

  it("2. create payslip insertion failure rolls back cycle creation", async () => {
    const original = models.Payslip.insertMany.bind(models.Payslip);
    models.Payslip.insertMany = async function failingInsertMany(...args) {
      throw new Error("forced insertMany failure");
    };

    try {
      await assert.rejects(
        () =>
          createPayrollCycleAtomic({
            models,
            company,
            periodMonth: 5,
            periodYear: 2026,
            createdBy: hrUser._id,
          }),
        /forced insertMany failure/
      );
    } finally {
      models.Payslip.insertMany = original;
    }

    const orphan = await models.PayrollCycle.findOne({ periodMonth: 5, periodYear: 2026 }).lean();
    assert.equal(orphan, null);
    const slips = await models.Payslip.countDocuments({ periodMonth: 5, periodYear: 2026 });
    assert.equal(slips, 0);
  });

  it("3. recalculation insertion failure preserves previous payslips and cycle totals", async () => {
    const { cycle } = await createPayrollCycleAtomic({
      models,
      company,
      periodMonth: 6,
      periodYear: 2026,
      createdBy: hrUser._id,
    });

    const beforeCycle = await models.PayrollCycle.findById(cycle._id).lean();
    const beforePayslips = await models.Payslip.find({ payrollCycleId: cycle._id }).lean();
    assert.ok(beforePayslips.length >= 2);
    const beforeIds = new Set(beforePayslips.map((p) => String(p._id)));
    const beforeNet = beforeCycle.totalNetPayable;

    const original = models.Payslip.insertMany.bind(models.Payslip);
    models.Payslip.insertMany = async function failingInsertMany(...args) {
      throw new Error("forced recalc insertMany failure");
    };

    try {
      await assert.rejects(
        () =>
          recalculatePayrollCycleAtomic({
            models,
            company,
            cycleId: cycle._id,
          }),
        /forced recalc insertMany failure/
      );
    } finally {
      models.Payslip.insertMany = original;
    }

    const afterCycle = await models.PayrollCycle.findById(cycle._id).lean();
    const afterPayslips = await models.Payslip.find({ payrollCycleId: cycle._id }).lean();
    assert.equal(afterCycle.totalNetPayable, beforeNet);
    assert.equal(afterCycle.employeeCount, beforeCycle.employeeCount);
    assert.equal(afterPayslips.length, beforePayslips.length);
    for (const p of afterPayslips) {
      assert.ok(beforeIds.has(String(p._id)), "prior payslip docs must survive aborted recalc");
    }
    assert.equal(isPayrollCalcLockActive(afterCycle), false);
  });

  it("4. successful recalculation replaces the complete draft set", async () => {
    const { cycle } = await createPayrollCycleAtomic({
      models,
      company,
      periodMonth: 7,
      periodYear: 2026,
      createdBy: hrUser._id,
    });
    const beforeIds = new Set(
      (await models.Payslip.find({ payrollCycleId: cycle._id }).select("_id").lean()).map((p) =>
        String(p._id)
      )
    );

    const { cycle: updated, calculation } = await recalculatePayrollCycleAtomic({
      models,
      company,
      cycleId: cycle._id,
    });

    const after = await models.Payslip.find({ payrollCycleId: cycle._id }).lean();
    assert.equal(after.length, calculation.employeeRecords.length);
    assert.equal(updated.totalNetPayable, calculation.cycleSummary.totalNetPayable);
    assert.ok(after.every((p) => p.status === "DRAFT"));
    for (const p of after) {
      assert.equal(beforeIds.has(String(p._id)), false, "recalc must insert a fresh draft set");
    }
    assert.equal(updated.calcLockToken, "");
    assert.equal(updated.calcLockUntil, null);
  });

  it("5. two concurrent recalculations: one succeeds, the other receives 409", async () => {
    const createRes = await request(app)
      .post("/api/payroll/cycles")
      .set("Cookie", hrCookie)
      .send({ periodMonth: 8, periodYear: 2026 });
    assert.equal(createRes.status, 201);
    const cycleId = createRes.body.cycle._id;

    const firstLock = await acquirePayrollCalcLock(models.PayrollCycle, cycleId);
    assert.ok(firstLock.token);

    const conflict = await request(app)
      .post(`/api/payroll/cycles/${cycleId}/recalculate`)
      .set("Cookie", hrCookie);
    assert.equal(conflict.status, 409);
    assert.match(String(conflict.body.message || ""), /already in progress/i);

    await releasePayrollCalcLock(models.PayrollCycle, cycleId, firstLock.token);

    const ok = await request(app)
      .post(`/api/payroll/cycles/${cycleId}/recalculate`)
      .set("Cookie", hrCookie);
    assert.equal(ok.status, 200);
  });

  it("6. expired lock can be reacquired", async () => {
    const { cycle } = await createPayrollCycleAtomic({
      models,
      company,
      periodMonth: 9,
      periodYear: 2026,
      createdBy: hrUser._id,
    });

    const expiredAt = new Date(Date.now() - 1000);
    await models.PayrollCycle.updateOne(
      { _id: cycle._id },
      { $set: { calcLockUntil: expiredAt, calcLockToken: "stale-expired-token" } }
    );

    const again = await acquirePayrollCalcLock(models.PayrollCycle, cycle._id);
    assert.ok(again.token);
    assert.notEqual(again.token, "stale-expired-token");
    assert.ok(isPayrollCalcLockActive(again.cycle));
    await releasePayrollCalcLock(models.PayrollCycle, cycle._id, again.token);
  });

  it("7. stale lock token cannot update or release another request's lock", async () => {
    const { cycle } = await createPayrollCycleAtomic({
      models,
      company,
      periodMonth: 10,
      periodYear: 2026,
      createdBy: hrUser._id,
    });

    const owner = await acquirePayrollCalcLock(models.PayrollCycle, cycle._id);
    const released = await releasePayrollCalcLock(
      models.PayrollCycle,
      cycle._id,
      "not-the-owner-token"
    );
    assert.equal(released, false);

    const stillLocked = await models.PayrollCycle.findById(cycle._id).lean();
    assert.equal(stillLocked.calcLockToken, owner.token);
    assert.ok(isPayrollCalcLockActive(stillLocked));

    const cleared = await releasePayrollCalcLock(models.PayrollCycle, cycle._id, owner.token);
    assert.equal(cleared, true);
  });

  it("8. recalculation cannot proceed on FINALIZED, PAID, or PARTIALLY_PAID cycles", async () => {
    for (const [month, status] of [
      [11, "FINALIZED"],
      [12, "PAID"],
      [1, "PARTIALLY_PAID"],
    ]) {
      const year = status === "PARTIALLY_PAID" ? 2027 : 2026;
      const { cycle } = await createPayrollCycleAtomic({
        models,
        company,
        periodMonth: month,
        periodYear: year,
        createdBy: hrUser._id,
      });
      await models.PayrollCycle.updateOne({ _id: cycle._id }, { $set: { status } });

      await assert.rejects(
        () => recalculatePayrollCycleAtomic({ models, company, cycleId: cycle._id }),
        (err) => err?.status === 400
      );
    }
  });

  it("9. finalization failure rolls back both cycle and payslip updates", async () => {
    const { cycle } = await createPayrollCycleAtomic({
      models,
      company,
      periodMonth: 2,
      periodYear: 2027,
      createdBy: hrUser._id,
    });

    const original = models.Payslip.updateMany.bind(models.Payslip);
    models.Payslip.updateMany = async function failingUpdateMany(...args) {
      throw new Error("forced finalize updateMany failure");
    };

    try {
      await assert.rejects(
        () =>
          finalizePayrollCycleAtomic({
            models,
            cycleId: cycle._id,
            finalizedBy: hrUser._id,
            actor: hrUser,
          }),
        /forced finalize updateMany failure/
      );
    } finally {
      models.Payslip.updateMany = original;
    }

    const afterCycle = await models.PayrollCycle.findById(cycle._id).lean();
    const afterPayslips = await models.Payslip.find({ payrollCycleId: cycle._id }).lean();
    assert.equal(afterCycle.status, "CALCULATED");
    assert.ok(afterPayslips.every((p) => p.status === "DRAFT"));
  });

  it("10. concurrent finalization and recalculation cannot produce inconsistent statuses", async () => {
    const { cycle } = await createPayrollCycleAtomic({
      models,
      company,
      periodMonth: 3,
      periodYear: 2027,
      createdBy: hrUser._id,
    });

    const lock = await acquirePayrollCalcLock(models.PayrollCycle, cycle._id);

    await assert.rejects(
      () =>
        finalizePayrollCycleAtomic({
          models,
          cycleId: cycle._id,
          finalizedBy: hrUser._id,
          actor: hrUser,
        }),
      (err) => err?.status === 409
    );

    const mid = await models.PayrollCycle.findById(cycle._id).lean();
    assert.equal(mid.status, "CALCULATED");
    assert.ok(
      (await models.Payslip.find({ payrollCycleId: cycle._id }).lean()).every(
        (p) => p.status === "DRAFT"
      )
    );

    await releasePayrollCalcLock(models.PayrollCycle, cycle._id, lock.token);

    const { cycle: finalized } = await finalizePayrollCycleAtomic({
      models,
      cycleId: cycle._id,
      finalizedBy: hrUser._id,
      actor: hrUser,
    });
    assert.equal(finalized.status, "FINALIZED");

    await assert.rejects(
      () => recalculatePayrollCycleAtomic({ models, company, cycleId: cycle._id }),
      (err) => err?.status === 400
    );

    const slips = await models.Payslip.find({ payrollCycleId: cycle._id }).lean();
    assert.ok(slips.every((p) => p.status === "FINALIZED"));
  });

  it("11. existing payroll calculation results remain unchanged", async () => {
    const first = await calculatePayrollCycle({
      models,
      company,
      periodMonth: 4,
      periodYear: 2026,
    });
    const second = await calculatePayrollCycle({
      models,
      company,
      periodMonth: 4,
      periodYear: 2026,
    });
    assert.equal(first.cycleSummary.totalNetPayable, second.cycleSummary.totalNetPayable);
    assert.equal(first.cycleSummary.totalGrossEarnings, second.cycleSummary.totalGrossEarnings);
    assert.equal(first.employeeRecords.length, second.employeeRecords.length);

    const byCode = (rows) =>
      Object.fromEntries(rows.map((r) => [r.employeeSnapshot.employeeCode, r]));
    const a = byCode(first.employeeRecords);
    const b = byCode(second.employeeRecords);
    for (const code of Object.keys(a)) {
      assert.deepEqual(a[code].daysBreakdown, b[code].daysBreakdown);
      assert.equal(a[code].grossEarnings, b[code].grossEarnings);
      assert.equal(a[code].netPayable, b[code].netPayable);
    }
  });

  it("HTTP create/recalculate/finalize preserve response contract", async () => {
    const created = await request(app)
      .post("/api/payroll/cycles")
      .set("Cookie", hrCookie)
      .send({ periodMonth: 4, periodYear: 2027, notes: "http-contract" });
    assert.equal(created.status, 201);
    assert.equal(created.body.success, true);
    assert.ok(created.body.cycle);
    // F50-D: mutation responses keep payslips as an empty array (register via GET detail).
    assert.ok(Array.isArray(created.body.payslips));
    assert.equal(created.body.payslips.length, 0);
    assert.ok(
      (created.body.employeeCount ?? created.body.payslipCount ?? 0) >= 1 ||
        created.body.cycle.employeeCount >= 1
    );

    const cycleId = created.body.cycle._id;
    const recalc = await request(app)
      .post(`/api/payroll/cycles/${cycleId}/calculate`)
      .set("Cookie", hrCookie);
    assert.equal(recalc.status, 200);
    assert.match(String(recalc.body.message || ""), /recalculated/i);
    assert.equal(recalc.body.payslips.length, 0);

    const fin = await request(app)
      .post(`/api/payroll/cycles/${cycleId}/finalize`)
      .set("Cookie", hrCookie);
    assert.equal(fin.status, 200);
    assert.equal(fin.body.cycle.status, "FINALIZED");
  });
});
