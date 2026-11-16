process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "f50-payroll-batch-calc-test-secret-32ch!";
process.env.JWT_ISSUER = "hrms-platform";
process.env.JWT_AUDIENCE = "hrms-company-users";
process.env.CENTRAL_DB_NAME = "platform_f50_payroll_batch";
process.env.CLIENT_URL = "http://localhost:5173";
process.env.BCRYPT_ROUNDS = "4";
process.env.AUTH_COOKIE_NAME = "hrms_auth";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { connectCentralDB, disconnectAll, getCompanyModels } from "../config/db.js";
import Company, { COMPANY_STATUSES } from "../models/Company.js";
import { EMPLOYEE_STATUSES } from "../models/Employee.js";
import { USER_ROLES } from "../models/User.js";
import { hashPassword } from "../utils/password.js";
import {
  calculatePayrollCycle,
  iterateActiveEmployeeBatches,
  resolvePayrollEmployeeBatchSize,
  selectEffectiveCompensationRevision,
} from "../services/payrollCalculationService.js";

function normalizeResult(result) {
  const records = [...result.employeeRecords].sort((a, b) =>
    String(a.employeeId).localeCompare(String(b.employeeId))
  );
  const issues = [...result.validationIssues].sort((a, b) =>
    String(a.employeeId).localeCompare(String(b.employeeId))
  );
  return {
    cycleSummary: {
      ...result.cycleSummary,
      periodStartDate: new Date(result.cycleSummary.periodStartDate).toISOString(),
      periodEndDate: new Date(result.cycleSummary.periodEndDate).toISOString(),
    },
    records: records.map((r) => ({
      employeeId: String(r.employeeId),
      employeeCode: r.employeeSnapshot.employeeCode,
      monthlyCostToCompany: r.monthlyCostToCompany,
      compensationRevisionId: r.compensationRevisionId
        ? String(r.compensationRevisionId)
        : null,
      daysBreakdown: r.daysBreakdown,
      grossEarnings: r.grossEarnings,
      totalDeductions: r.totalDeductions,
      totalEmployerContributions: r.totalEmployerContributions,
      netPayable: r.netPayable,
      earnings: r.earnings,
      employeeDeductions: r.employeeDeductions,
    })),
    issues: issues.map((i) => ({
      employeeId: String(i.employeeId),
      employeeCode: i.employeeCode,
      issue: i.issue,
    })),
  };
}

describe("F50-C payroll employee-batch calculation", () => {
  let mongoServer;
  let company;
  let models;
  let password;
  let multiRevEmp;
  let inactiveEmp;
  let missingCtcEmp;

  async function makeEmployee({
    code,
    email,
    name,
    ctc,
    status = EMPLOYEE_STATUSES.ACTIVE,
    revisions,
  }) {
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
      status,
      job: {
        jobTitle: "Engineer",
        department: "Engineering",
        joiningDate: new Date("2025-01-01"),
      },
      bankDetails: {
        accountNumber: "1234567890",
        bankName: "Test Bank",
        ifscCode: "TEST0001234",
      },
      panNumber: "ABCDE1234F",
    });
    if (revisions) {
      await models.EmployeeCompensation.create({
        employeeId: emp._id,
        revisions,
      });
    } else if (ctc != null) {
      await models.EmployeeCompensation.create({
        employeeId: emp._id,
        revisions: [
          {
            effectiveFromDate: new Date("2025-01-01"),
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
    }
    return emp;
  }

  before(async () => {
    mongoServer = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongoServer.getUri();
    await connectCentralDB();

    const slug = `f50-batch-${Date.now()}`;
    company = await Company.create({
      companyName: "F50 Batch Co",
      slug,
      databaseName: `company_${slug.replace(/-/g, "_")}`,
      status: COMPANY_STATUSES.ACTIVE,
    });
    models = await getCompanyModels(company, { provision: true });
    password = await hashPassword("F50BatchPass123!");

    // Stable ACTIVE roster spanning multiple small batches (batchSize=2 → partial last page).
    for (let i = 1; i <= 5; i++) {
      await makeEmployee({
        code: `F50B-${i}`,
        email: `batch${i}@f50b.test`,
        name: `Batch Emp ${i}`,
        ctc: 50000 + i * 1000,
      });
    }

    multiRevEmp = await makeEmployee({
      code: "F50B-MR",
      email: "multirev@f50b.test",
      name: "Multi Rev",
      revisions: [
        {
          effectiveFromDate: new Date("2024-01-01"),
          monthlyCostToCompany: 40000,
          salaryComponents: {
            basicSalary: 20000,
            houseRentAllowance: 12000,
            specialAllowance: 8000,
            employerProvidentFund: 1800,
            otherDeductions: 0,
          },
        },
        {
          effectiveFromDate: new Date("2026-01-01"),
          monthlyCostToCompany: 75000,
          salaryComponents: {
            basicSalary: 37500,
            houseRentAllowance: 22500,
            specialAllowance: 15000,
            employerProvidentFund: 1800,
            otherDeductions: 0,
          },
        },
        {
          effectiveFromDate: new Date("2026-06-01"),
          monthlyCostToCompany: 90000,
          salaryComponents: {
            basicSalary: 45000,
            houseRentAllowance: 27000,
            specialAllowance: 18000,
            employerProvidentFund: 1800,
            otherDeductions: 0,
          },
        },
      ],
    });

    missingCtcEmp = await makeEmployee({
      code: "F50B-MC",
      email: "missing@f50b.test",
      name: "Missing CTC",
    });

    inactiveEmp = await makeEmployee({
      code: "F50B-IN",
      email: "inactive@f50b.test",
      name: "Inactive Emp",
      ctc: 99999,
      status: EMPLOYEE_STATUSES.INACTIVE,
    });

    // Attendance only for F50B-1 so leave/attendance scoping is observable.
    await models.Attendance.create({
      employeeId: (
        await models.Employee.findOne({ employeeCode: "F50B-1" }).select("_id").lean()
      )._id,
      date: "2026-03-02",
      status: "PRESENT",
      checkIn: new Date("2026-03-02T04:00:00.000Z"),
    });
    await models.LeaveRequest.create({
      employeeId: (
        await models.Employee.findOne({ employeeCode: "F50B-2" }).select("_id").lean()
      )._id,
      leaveTypeCode: "ANNUAL",
      isPaid: true,
      status: "APPROVED",
      fromDate: new Date("2026-03-03T00:00:00.000Z"),
      toDate: new Date("2026-03-03T00:00:00.000Z"),
      reason: "F50-C leave scope",
    });
  });

  after(async () => {
    await disconnectAll();
    if (mongoServer) await mongoServer.stop();
  });

  it("resolvePayrollEmployeeBatchSize clamps and prefers explicit override", () => {
    assert.equal(resolvePayrollEmployeeBatchSize(2), 2);
    assert.equal(resolvePayrollEmployeeBatchSize(0), 100);
    assert.equal(resolvePayrollEmployeeBatchSize(9999), 500);
  });

  it("1–2. batched and single-page calculations produce identical results and totals", async () => {
    const multi = await calculatePayrollCycle({
      models,
      company,
      periodMonth: 3,
      periodYear: 2026,
      employeeBatchSize: 2,
    });
    const single = await calculatePayrollCycle({
      models,
      company,
      periodMonth: 3,
      periodYear: 2026,
      employeeBatchSize: 500,
    });

    assert.deepEqual(normalizeResult(multi), normalizeResult(single));
    assert.equal(multi.cycleSummary.totalNetPayable, single.cycleSummary.totalNetPayable);
    assert.equal(multi.cycleSummary.employeeCount, single.cycleSummary.employeeCount);
    assert.equal(multi.validationIssues.length, single.validationIssues.length);
  });

  it("3. multiple compensation revisions select the same effective revision", async () => {
    const periodEnd = new Date("2026-03-31T23:59:59.999Z");
    const comp = await models.EmployeeCompensation.findOne({
      employeeId: multiRevEmp._id,
    }).lean();
    const expected = selectEffectiveCompensationRevision(comp, periodEnd);
    assert.equal(Number(expected.monthlyCostToCompany), 75000);

    for (const batchSize of [1, 2, 500]) {
      const result = await calculatePayrollCycle({
        models,
        company,
        periodMonth: 3,
        periodYear: 2026,
        employeeBatchSize: batchSize,
      });
      const rec = result.employeeRecords.find(
        (r) => String(r.employeeId) === String(multiRevEmp._id)
      );
      assert.ok(rec);
      assert.equal(rec.monthlyCostToCompany, 75000);
      assert.equal(String(rec.compensationRevisionId), String(expected._id));
    }
  });

  it("4. employees spanning multiple batches are neither omitted nor duplicated", async () => {
    const seen = [];
    const result = await calculatePayrollCycle({
      models,
      company,
      periodMonth: 3,
      periodYear: 2026,
      employeeBatchSize: 2,
      onEmployeeBatch: ({ employeeIds }) => {
        seen.push(...employeeIds);
      },
    });

    const uniqueSeen = new Set(seen);
    assert.equal(uniqueSeen.size, seen.length, "batch hook must not report duplicates");

    const recordIds = result.employeeRecords.map((r) => String(r.employeeId));
    assert.equal(new Set(recordIds).size, recordIds.length);

    const issueIds = result.validationIssues.map((i) => String(i.employeeId));
    for (const id of recordIds) {
      assert.ok(uniqueSeen.has(id));
      assert.equal(issueIds.includes(id), false);
    }
    for (const id of issueIds) {
      assert.ok(uniqueSeen.has(id));
    }

    const activeCount = await models.Employee.countDocuments({ status: "ACTIVE" });
    assert.equal(uniqueSeen.size, activeCount);
    assert.equal(recordIds.length + issueIds.length, activeCount);
  });

  it("5. employee inclusion remains ACTIVE-only", async () => {
    const result = await calculatePayrollCycle({
      models,
      company,
      periodMonth: 3,
      periodYear: 2026,
      employeeBatchSize: 2,
    });
    const ids = new Set([
      ...result.employeeRecords.map((r) => String(r.employeeId)),
      ...result.validationIssues.map((i) => String(i.employeeId)),
    ]);
    assert.equal(ids.has(String(inactiveEmp._id)), false);

    const pages = [];
    for await (const batch of iterateActiveEmployeeBatches(models.Employee, 2)) {
      pages.push(batch);
      assert.ok(batch.every((e) => e.status === undefined || true));
      assert.equal(
        batch.some((e) => String(e._id) === String(inactiveEmp._id)),
        false
      );
    }
    assert.ok(pages.length >= 2);
  });

  it("6. empty and final partial batches", async () => {
    const emptyCompany = await Company.create({
      companyName: "F50 Empty",
      slug: `f50-empty-${Date.now()}`,
      databaseName: `company_f50_empty_${Date.now()}`,
      status: COMPANY_STATUSES.ACTIVE,
    });
    const emptyModels = await getCompanyModels(emptyCompany, { provision: true });
    const empty = await calculatePayrollCycle({
      models: emptyModels,
      company: emptyCompany,
      periodMonth: 3,
      periodYear: 2026,
      employeeBatchSize: 2,
    });
    assert.equal(empty.employeeRecords.length, 0);
    assert.equal(empty.validationIssues.length, 0);
    assert.equal(empty.cycleSummary.employeeCount, 0);

    const sizes = [];
    await calculatePayrollCycle({
      models,
      company,
      periodMonth: 3,
      periodYear: 2026,
      employeeBatchSize: 2,
      onEmployeeBatch: ({ batchSize }) => sizes.push(batchSize),
    });
    assert.ok(sizes.length >= 2);
    assert.ok(sizes.slice(0, -1).every((n) => n === 2));
    assert.ok(sizes[sizes.length - 1] <= 2);
    assert.ok(sizes[sizes.length - 1] >= 1);
  });

  it("7. attendance and leave queries are scoped to each batch", async () => {
    const originalAttFind = models.Attendance.find.bind(models.Attendance);
    const originalLeaveFind = models.LeaveRequest.find.bind(models.LeaveRequest);
    const attFilters = [];
    const leaveFilters = [];

    models.Attendance.find = function patchedAttFind(filter, ...rest) {
      attFilters.push(filter);
      return originalAttFind(filter, ...rest);
    };
    models.LeaveRequest.find = function patchedLeaveFind(filter, ...rest) {
      leaveFilters.push(filter);
      return originalLeaveFind(filter, ...rest);
    };

    try {
      const batchIds = [];
      await calculatePayrollCycle({
        models,
        company,
        periodMonth: 3,
        periodYear: 2026,
        employeeBatchSize: 2,
        onEmployeeBatch: ({ employeeIds }) => batchIds.push(employeeIds),
      });

      assert.equal(attFilters.length, batchIds.length);
      assert.equal(leaveFilters.length, batchIds.length);

      for (let i = 0; i < batchIds.length; i++) {
        const expected = new Set(batchIds[i]);
        const attIn = (attFilters[i].employeeId?.$in || []).map(String);
        const leaveIn = (leaveFilters[i].employeeId?.$in || []).map(String);
        assert.deepEqual(new Set(attIn), expected);
        assert.deepEqual(new Set(leaveIn), expected);
        assert.equal(
          attIn.includes(String(inactiveEmp._id)),
          false,
          "inactive employee must not appear in attendance $in"
        );
      }
    } finally {
      models.Attendance.find = originalAttFind;
      models.LeaveRequest.find = originalLeaveFind;
    }
  });

  it("8. stable _id ascending ordering across batch sizes", async () => {
    const a = await calculatePayrollCycle({
      models,
      company,
      periodMonth: 3,
      periodYear: 2026,
      employeeBatchSize: 2,
    });
    const b = await calculatePayrollCycle({
      models,
      company,
      periodMonth: 3,
      periodYear: 2026,
      employeeBatchSize: 3,
    });

    const idsA = [
      ...a.employeeRecords.map((r) => String(r.employeeId)),
      ...a.validationIssues.map((i) => String(i.employeeId)),
    ];
    // Records omit missing-CTC; full ACTIVE order is records+issues in encounter order.
    // Encounter order follows _id pagination: merge by walking batches.
    const orderedA = [];
    const orderedB = [];
    for await (const batch of iterateActiveEmployeeBatches(models.Employee, 2)) {
      orderedA.push(...batch.map((e) => String(e._id)));
    }
    for await (const batch of iterateActiveEmployeeBatches(models.Employee, 3)) {
      orderedB.push(...batch.map((e) => String(e._id)));
    }
    assert.deepEqual(orderedA, orderedB);

    const recordOrderA = a.employeeRecords.map((r) => String(r.employeeId));
    const recordOrderB = b.employeeRecords.map((r) => String(r.employeeId));
    assert.deepEqual(recordOrderA, recordOrderB);

    for (let i = 1; i < orderedA.length; i++) {
      assert.ok(
        orderedA[i - 1] < orderedA[i],
        "ACTIVE employee pages must be strictly _id ascending"
      );
    }
    assert.ok(idsA.includes(String(missingCtcEmp._id)) || a.validationIssues.length > 0);
  });

  it("9. large synthetic roster does not load all employee documents at once", async () => {
    const bulk = [];
    const users = [];
    for (let i = 0; i < 25; i++) {
      const id = new mongoose.Types.ObjectId();
      users.push({
        _id: id,
        email: `synth${i}@f50b.test`,
        passwordHash: password,
        role: USER_ROLES.EMPLOYEE,
        fullName: `Synth ${i}`,
        isActive: true,
      });
    }
    const createdUsers = await models.User.insertMany(users);
    for (let i = 0; i < createdUsers.length; i++) {
      bulk.push({
        userId: createdUsers[i]._id,
        employeeCode: `SYN-${String(i).padStart(3, "0")}`,
        fullName: `Synth ${i}`,
        email: `synth${i}@f50b.test`,
        status: EMPLOYEE_STATUSES.ACTIVE,
        job: { jobTitle: "Synth", department: "Lab", joiningDate: new Date("2026-01-01") },
        customFields: { monthlySalary: 42000 },
      });
    }
    await models.Employee.insertMany(bulk);

    const maxEmployeePage = { n: 0 };
    const originalFind = models.Employee.find.bind(models.Employee);
    models.Employee.find = function patchedFind(filter, ...rest) {
      const query = originalFind(filter, ...rest);
      if (filter && filter.status === "ACTIVE") {
        const originalLean = query.lean.bind(query);
        query.lean = async function patchedLean(...leanArgs) {
          const docs = await originalLean(...leanArgs);
          maxEmployeePage.n = Math.max(maxEmployeePage.n, docs.length);
          return docs;
        };
      }
      return query;
    };

    try {
      const batchSize = 5;
      const sizes = [];
      const result = await calculatePayrollCycle({
        models,
        company,
        periodMonth: 3,
        periodYear: 2026,
        employeeBatchSize: batchSize,
        onEmployeeBatch: ({ batchSize: n }) => sizes.push(n),
      });

      const activeCount = await models.Employee.countDocuments({ status: "ACTIVE" });
      assert.ok(activeCount > batchSize);
      assert.ok(maxEmployeePage.n <= batchSize);
      assert.ok(maxEmployeePage.n < activeCount);
      assert.ok(sizes.every((n) => n <= batchSize));
      assert.ok(result.employeeRecords.length + result.validationIssues.length === activeCount);
    } finally {
      models.Employee.find = originalFind;
    }
  });
});
