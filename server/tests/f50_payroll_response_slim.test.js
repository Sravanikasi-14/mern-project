process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "f50-payroll-response-slim-secret-32ch!";
process.env.JWT_ISSUER = "hrms-platform";
process.env.JWT_AUDIENCE = "hrms-company-users";
process.env.CENTRAL_DB_NAME = "platform_f50_payroll_resp";
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
import {
  PAYSLIP_REGISTER_SELECT,
  mapPayslipForRegister,
  resolvePayslipPagination,
} from "../services/payrollResponseService.js";

function cookieFrom(response) {
  const cookies = response.headers["set-cookie"] || [];
  return cookies.find((val) => val.startsWith(`${getAuthCookieName()}=`));
}

describe("F50-D slim payroll API responses", () => {
  let mongo;
  let app;
  let company;
  let models;
  let hrCookie;
  let otherCompany;
  let otherHrCookie;

  before(async () => {
    const dbPath = `D:/tmp/hrms-mongo/f50-payroll-resp/${Date.now()}`;
    fs.mkdirSync(dbPath, { recursive: true });
    mongo = await MongoMemoryReplSet.create({
      replSet: { count: 1 },
      instanceOpts: [{ dbPath }],
    });
    process.env.MONGO_URI = mongo.getUri();
    await connectCentralDB();
    app = createApp();

    const slug = `f50-resp-${Date.now()}`;
    company = await Company.create({
      companyName: "F50 Response Co",
      slug,
      databaseName: `company_${slug.replace(/-/g, "_")}`,
      status: COMPANY_STATUSES.ACTIVE,
    });
    models = await getCompanyModels(company, { provision: true });
    const password = await hashPassword("F50RespPass123!");

    await models.User.create({
      email: "hr@f50resp.test",
      passwordHash: password,
      role: USER_ROLES.HR_ADMIN,
      fullName: "HR Admin",
      isActive: true,
    });

    for (let i = 1; i <= 5; i++) {
      const user = await models.User.create({
        email: `e${i}@f50resp.test`,
        passwordHash: password,
        role: USER_ROLES.EMPLOYEE,
        fullName: `Emp ${i}`,
        isActive: true,
      });
      const emp = await models.Employee.create({
        userId: user._id,
        employeeCode: `R-${i}`,
        fullName: `Emp ${i}`,
        email: `e${i}@f50resp.test`,
        status: EMPLOYEE_STATUSES.ACTIVE,
        job: { jobTitle: "Eng", department: "Engineering", joiningDate: new Date("2026-01-01") },
        bankDetails: { accountNumber: `11112222${i}`, bankName: "Test Bank", ifscCode: "TEST0001" },
      });
      await models.EmployeeCompensation.create({
        employeeId: emp._id,
        revisions: [
          {
            effectiveFromDate: new Date("2026-01-01"),
            monthlyCostToCompany: 50000 + i * 1000,
            salaryComponents: {
              basicSalary: 25000,
              houseRentAllowance: 15000,
              specialAllowance: 10000,
              employerProvidentFund: 1800,
              otherDeductions: 0,
            },
          },
        ],
      });
    }

    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: "hr@f50resp.test", password: "F50RespPass123!", companyCode: company.slug });
    assert.equal(login.status, 200);
    hrCookie = cookieFrom(login);

    otherCompany = await Company.create({
      companyName: "Other Co",
      slug: `f50-other-${Date.now()}`,
      databaseName: `company_f50_other_${Date.now()}`,
      status: COMPANY_STATUSES.ACTIVE,
    });
    const otherModels = await getCompanyModels(otherCompany, { provision: true });
    await otherModels.User.create({
      email: "hr@otherf50.test",
      passwordHash: password,
      role: USER_ROLES.HR_ADMIN,
      fullName: "Other HR",
      isActive: true,
    });
    const otherLogin = await request(app)
      .post("/api/auth/login")
      .send({
        email: "hr@otherf50.test",
        password: "F50RespPass123!",
        companyCode: otherCompany.slug,
      });
    assert.equal(otherLogin.status, 200);
    otherHrCookie = cookieFrom(otherLogin);
  });

  after(async () => {
    await disconnectAll();
    if (mongo) await mongo.stop();
  });

  it("resolvePayslipPagination only activates with valid page+limit", () => {
    assert.equal(resolvePayslipPagination({}), null);
    assert.equal(resolvePayslipPagination({ page: "1" }), null);
    assert.deepEqual(resolvePayslipPagination({ page: "2", limit: "10" }), {
      page: 2,
      limit: 10,
    });
  });

  it("mapPayslipForRegister exposes bankDetails from flat snapshot fields", () => {
    const mapped = mapPayslipForRegister({
      _id: "x",
      employeeId: "e1",
      employeeSnapshot: {
        fullName: "A",
        bankAccountNumber: "999988887777",
        bankName: "HDFC",
        bankIfsc: "HDFC0001",
      },
    });
    assert.equal(mapped.employeeSnapshot.bankDetails.accountNumber, "999988887777");
    assert.equal(mapped.employeeSnapshot.bankDetails.bankName, "HDFC");
    assert.ok(PAYSLIP_REGISTER_SELECT.includes("employeeSnapshot"));
    assert.equal(PAYSLIP_REGISTER_SELECT.includes("schemaVersion"), false);
  });

  it("create response is slim: cycle summary, empty payslips, no employee populate", async () => {
    const created = await request(app)
      .post("/api/payroll/cycles")
      .set("Cookie", hrCookie)
      .send({ periodMonth: 3, periodYear: 2026, notes: "slim-create" });
    assert.equal(created.status, 201);
    assert.equal(created.body.success, true);
    assert.ok(created.body.cycle?._id);
    assert.ok(created.body.cycle.periodMonth === 3);
    assert.ok(typeof created.body.cycle.totalNetPayable === "number");
    assert.ok(Array.isArray(created.body.payslips));
    assert.equal(created.body.payslips.length, 0);
    assert.ok(created.body.employeeCount >= 1 || created.body.payslipCount >= 1);
    assert.ok(Array.isArray(created.body.validationIssues));
    assert.equal(created.body.cycle.avatar, undefined);

    const stored = await models.Payslip.countDocuments({
      payrollCycleId: created.body.cycle._id,
    });
    assert.ok(stored >= 5, "payslips must still be persisted by F50-A write path");
  });

  it("recalculate response is slim and detail still returns projected register", async () => {
    const list = await request(app).get("/api/payroll/cycles").set("Cookie", hrCookie);
    assert.equal(list.status, 200);
    const cycleId = list.body.cycles[0]._id;

    const recalc = await request(app)
      .post(`/api/payroll/cycles/${cycleId}/recalculate`)
      .set("Cookie", hrCookie);
    assert.equal(recalc.status, 200);
    assert.equal(recalc.body.payslips.length, 0);
    assert.ok(recalc.body.cycle);
    assert.match(String(recalc.body.message || ""), /recalculated/i);

    const detail = await request(app)
      .get(`/api/payroll/cycles/${cycleId}`)
      .set("Cookie", hrCookie);
    assert.equal(detail.status, 200);
    assert.ok(Array.isArray(detail.body.payslips));
    assert.ok(detail.body.payslips.length >= 5);
    assert.equal(detail.body.payslipTotal, detail.body.payslips.length);

    const sample = detail.body.payslips[0];
    assert.ok(sample.employeeSnapshot?.fullName);
    assert.ok(sample.grossEarnings != null);
    assert.ok(Array.isArray(sample.earnings));
    // No populated Employee document (avatar/job live fields)
    assert.equal(sample.employeeId?.avatar, undefined);
    assert.equal(sample.employeeId?.job, undefined);
    assert.ok(sample.employeeSnapshot.bankDetails?.accountNumber || sample.employeeSnapshot.bankAccountNumber);
  });

  it("list cycles returns summary fields only (no payslips)", async () => {
    const list = await request(app).get("/api/payroll/cycles").set("Cookie", hrCookie);
    assert.equal(list.status, 200);
    assert.ok(Array.isArray(list.body.cycles));
    assert.ok(list.body.cycles.length >= 1);
    const row = list.body.cycles[0];
    assert.ok(row._id);
    assert.ok(row.periodMonth);
    assert.ok(row.status);
    assert.equal(row.payslips, undefined);
    assert.equal(row.validationIssues, undefined);
  });

  it("detail supports optional payslip pagination with totals", async () => {
    const list = await request(app).get("/api/payroll/cycles").set("Cookie", hrCookie);
    const cycleId = list.body.cycles[0]._id;

    const page1 = await request(app)
      .get(`/api/payroll/cycles/${cycleId}?page=1&limit=2`)
      .set("Cookie", hrCookie);
    assert.equal(page1.status, 200);
    assert.equal(page1.body.payslips.length, 2);
    assert.ok(page1.body.payslipTotal >= 5);
    assert.equal(page1.body.pagination.page, 1);
    assert.equal(page1.body.pagination.limit, 2);
    assert.ok(page1.body.pagination.totalPages >= 3);

    const page2 = await request(app)
      .get(`/api/payroll/cycles/${cycleId}?page=2&limit=2`)
      .set("Cookie", hrCookie);
    assert.equal(page2.body.payslips.length, 2);
    const ids1 = page1.body.payslips.map((p) => String(p._id));
    const ids2 = page2.body.payslips.map((p) => String(p._id));
    assert.equal(ids1.some((id) => ids2.includes(id)), false);
  });

  it("tenant isolation: other company cannot read cycle details", async () => {
    const list = await request(app).get("/api/payroll/cycles").set("Cookie", hrCookie);
    const cycleId = list.body.cycles[0]._id;

    const denied = await request(app)
      .get(`/api/payroll/cycles/${cycleId}`)
      .set("Cookie", otherHrCookie);
    assert.ok(denied.status === 404 || denied.status === 403 || denied.body.payslips?.length === 0);

    const otherList = await request(app).get("/api/payroll/cycles").set("Cookie", otherHrCookie);
    assert.equal(otherList.status, 200);
    assert.equal(
      (otherList.body.cycles || []).some((c) => String(c._id) === String(cycleId)),
      false
    );
  });

  it("F61: registerSummary + CSV export cover full filtered set (not page size)", async () => {
    const list = await request(app).get("/api/payroll/cycles").set("Cookie", hrCookie);
    const cycleId = list.body.cycles[0]._id;

    const page1 = await request(app)
      .get(`/api/payroll/cycles/${cycleId}?page=1&limit=2`)
      .set("Cookie", hrCookie);
    assert.equal(page1.status, 200);
    assert.ok(page1.body.registerSummary);
    assert.ok(page1.body.payslipTotal >= 5);
    assert.equal(page1.body.registerSummary.payslipCount, page1.body.payslipTotal);
    assert.equal(page1.body.payslips.length, 2);
    assert.equal(page1.body.cycle.calcLockToken, undefined);

    const csv = await request(app)
      .get(`/api/payroll/cycles/${cycleId}/export`)
      .set("Cookie", hrCookie);
    assert.equal(csv.status, 200);
    assert.match(String(csv.headers["content-type"] || ""), /csv/i);
    const lines = String(csv.text || "")
      .trim()
      .split(/\r?\n/)
      .filter(Boolean);
    // header + one row per payslip in the filtered register
    assert.ok(lines.length >= page1.body.registerSummary.payslipCount + 1);
  });
});
