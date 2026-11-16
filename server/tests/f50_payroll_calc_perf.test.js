process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "f50-payroll-calc-perf-test-secret-32chars!";
process.env.JWT_ISSUER = "hrms-platform";
process.env.JWT_AUDIENCE = "hrms-company-users";
process.env.CENTRAL_DB_NAME = "platform_f50_payroll_calc";
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
  buildEmployeesWithAttendanceSet,
  buildLeaveInfoByEmpAndDate,
  buildOfferSalaryByEmailMap,
  calculatePayrollCycle,
  toDateString,
} from "../services/payrollCalculationService.js";

function legacyAttendanceSome(attendances, empIdStr) {
  return attendances.some((a) => String(a.employeeId) === empIdStr);
}

function legacyOfferFind(acceptedOffers, email) {
  const emailKey = String(email || "").trim().toLowerCase();
  return (acceptedOffers || []).find(
    (o) => String(o.candidate?.email || "").trim().toLowerCase() === emailKey
  );
}

function legacyLeaveFind(empLeaves, dStr) {
  return empLeaves.find((l) => {
    const fromStr = toDateString(l.fromDate);
    const toStr = toDateString(l.toDate);
    return dStr >= fromStr && dStr <= toStr;
  });
}

describe("F50 payroll calculation Set/Map/projection optimizations", () => {
  let mongoServer;
  let company;
  let models;
  let presentEmp;
  let absentEmp;
  let halfDayEmp;
  let paidLeaveEmp;
  let unpaidLeaveEmp;
  let missingCtcEmp;
  let offerCtcEmp;

  before(async () => {
    mongoServer = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongoServer.getUri();
    await connectCentralDB();

    const slug = `f50-payroll-${Date.now()}`;
    company = await Company.create({
      companyName: "F50 Payroll Co",
      slug,
      databaseName: `company_${slug.replace(/-/g, "_")}`,
      status: COMPANY_STATUSES.ACTIVE,
    });

    models = await getCompanyModels(company, { provision: true });
    const password = await hashPassword("F50Pass123!");

    async function makeEmployee({ code, email, name, ctc, offerSalary }) {
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
      if (ctc != null) {
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
      }
      if (offerSalary != null) {
        await models.OfferLetter.create({
          candidate: { fullName: name, email: String(email).trim().toLowerCase() },
          position: "Engineer",
          department: "Engineering",
          monthlySalary: offerSalary,
          status: "ACCEPTED",
          joiningDate: new Date("2026-01-01"),
          content: "<p>F50 offer</p>",
        });
      }
      return emp;
    }

    presentEmp = await makeEmployee({
      code: "F50-P",
      email: "present.f50@example.com",
      name: "Present Emp",
      ctc: 100000,
    });
    absentEmp = await makeEmployee({
      code: "F50-A",
      email: "absent.f50@example.com",
      name: "Absent Emp",
      ctc: 80000,
    });
    halfDayEmp = await makeEmployee({
      code: "F50-H",
      email: "half.f50@example.com",
      name: "HalfDay Emp",
      ctc: 60000,
    });
    paidLeaveEmp = await makeEmployee({
      code: "F50-PL",
      email: "paidleave.f50@example.com",
      name: "PaidLeave Emp",
      ctc: 70000,
    });
    unpaidLeaveEmp = await makeEmployee({
      code: "F50-UL",
      email: "unpaid.f50@example.com",
      name: "UnpaidLeave Emp",
      ctc: 90000,
    });
    missingCtcEmp = await makeEmployee({
      code: "F50-MC",
      email: "missing.f50@example.com",
      name: "MissingCtc Emp",
    });
    offerCtcEmp = await makeEmployee({
      code: "F50-OC",
      email: "offer.f50@example.com",
      name: "OfferCtc Emp",
      offerSalary: 55000,
    });

    // March 2026: Sat/Sun weekends. Working days start Mon Mar 2.
    // Seed attendance only for some employees so "had any punches" semantics apply.
    const seedDays = [];
    for (let d = 1; d <= 31; d++) {
      const dStr = `2026-03-${String(d).padStart(2, "0")}`;
      const dow = new Date(`${dStr}T12:00:00.000Z`).getDay();
      if (dow === 0 || dow === 6) continue;
      seedDays.push(dStr);
    }

    // Present emp: PRESENT every working day
    for (const date of seedDays) {
      await models.Attendance.create({
        employeeId: presentEmp._id,
        date,
        status: "PRESENT",
        checkIn: new Date(`${date}T04:00:00.000Z`),
      });
    }

    // Absent emp: one PRESENT so empHadAnyPunches=true; other working days missing → LOP
    await models.Attendance.create({
      employeeId: absentEmp._id,
      date: seedDays[0],
      status: "PRESENT",
      checkIn: new Date(`${seedDays[0]}T04:00:00.000Z`),
    });
    await models.Attendance.create({
      employeeId: absentEmp._id,
      date: seedDays[1],
      status: "ABSENT",
    });

    // Half-day emp: HALF_DAY on first working day + PRESENT on rest so punches exist
    await models.Attendance.create({
      employeeId: halfDayEmp._id,
      date: seedDays[0],
      status: "HALF_DAY",
    });
    for (const date of seedDays.slice(1)) {
      await models.Attendance.create({
        employeeId: halfDayEmp._id,
        date,
        status: "PRESENT",
        checkIn: new Date(`${date}T04:00:00.000Z`),
      });
    }

    // Paid leave: no attendance punches; approved CASUAL leave Mon–Wed Mar 2–4
    await models.LeaveRequest.create({
      employeeId: paidLeaveEmp._id,
      leaveTypeCode: "CASUAL",
      fromDate: new Date("2026-03-02T00:00:00.000Z"),
      toDate: new Date("2026-03-04T00:00:00.000Z"),
      daysCount: 3,
      status: "APPROVED",
      reason: "Personal",
    });

    // Unpaid / LOP leave: Mar 2–3
    await models.LeaveRequest.create({
      employeeId: unpaidLeaveEmp._id,
      leaveTypeCode: "LOP",
      fromDate: new Date("2026-03-02T00:00:00.000Z"),
      toDate: new Date("2026-03-03T00:00:00.000Z"),
      daysCount: 2,
      status: "APPROVED",
      reason: "Unpaid",
    });
  });

  after(async () => {
    await disconnectAll();
    if (mongoServer) await mongoServer.stop();
  });

  it("attendance Set parity vs Array.some for employee punch presence", () => {
    const attendances = [
      { employeeId: presentEmp._id, date: "2026-03-02" },
      { employeeId: String(absentEmp._id), date: "2026-03-03" },
      { employeeId: presentEmp._id, date: "2026-03-04" },
    ];
    const set = buildEmployeesWithAttendanceSet(attendances);
    const ids = [
      String(presentEmp._id),
      String(absentEmp._id),
      String(halfDayEmp._id),
      new mongoose.Types.ObjectId().toString(),
    ];
    for (const id of ids) {
      assert.equal(set.has(id), legacyAttendanceSome(attendances, id));
    }
  });

  it("offer Map parity including duplicate and normalized emails", () => {
    const acceptedOffers = [
      { candidate: { email: "  Alice@Example.COM " }, monthlySalary: 10000 },
      { candidate: { email: "alice@example.com" }, monthlySalary: 99999 },
      { candidate: { email: "Bob@Example.com" }, monthlySalary: 20000 },
      { candidate: { email: "" }, monthlySalary: 1 },
      { candidate: {}, monthlySalary: 2 },
    ];
    const map = buildOfferSalaryByEmailMap(acceptedOffers);

    for (const email of ["alice@example.com", "  ALICE@example.com  ", "bob@example.com", "nobody@x.com"]) {
      const legacy = legacyOfferFind(acceptedOffers, email);
      const mapped = map.get(String(email || "").trim().toLowerCase());
      assert.equal(mapped ?? undefined, legacy?.monthlySalary);
    }
    // First match wins for duplicates
    assert.equal(map.get("alice@example.com"), 10000);
    assert.equal(map.size, 2);
  });

  it("leave preprocess parity vs find for paid/unpaid overlapping ranges", () => {
    const empId = String(paidLeaveEmp._id);
    const leavesByEmp = new Map([
      [
        empId,
        [
          {
            fromDate: new Date("2026-03-02T00:00:00.000Z"),
            toDate: new Date("2026-03-05T00:00:00.000Z"),
            leaveTypeCode: "CASUAL",
          },
          {
            fromDate: new Date("2026-03-04T00:00:00.000Z"),
            toDate: new Date("2026-03-06T00:00:00.000Z"),
            leaveTypeCode: "LOP",
          },
        ],
      ],
    ]);
    const calendarDayTypes = [];
    for (let d = 1; d <= 10; d++) {
      calendarDayTypes.push({ dateStr: `2026-03-${String(d).padStart(2, "0")}` });
    }
    const pre = buildLeaveInfoByEmpAndDate(leavesByEmp, calendarDayTypes);
    const empLeaves = leavesByEmp.get(empId);

    for (const day of calendarDayTypes) {
      const legacy = legacyLeaveFind(empLeaves, day.dateStr);
      const info = pre.get(`${empId}_${day.dateStr}`);
      if (!legacy) {
        assert.equal(info, undefined);
        continue;
      }
      const expectedUnpaid =
        legacy.leaveTypeCode === "UNPAID" ||
        legacy.leaveTypeCode === "LOP" ||
        legacy.isPaid === false;
      assert.ok(info);
      assert.equal(info.isUnpaidLeave, expectedUnpaid);
    }
  });

  it("calculatePayrollCycle: present / absent / half-day / paid leave / unpaid LOP / missing CTC / offer CTC", async () => {
    const result = await calculatePayrollCycle({
      models,
      company,
      periodMonth: 3,
      periodYear: 2026,
    });

    const byCode = Object.fromEntries(
      result.employeeRecords.map((r) => [r.employeeSnapshot.employeeCode, r])
    );

    assert.ok(byCode["F50-P"]);
    assert.equal(byCode["F50-P"].daysBreakdown.lossOfPayDays, 0);
    assert.ok(byCode["F50-P"].daysBreakdown.presentDays > 0);
    assert.equal(byCode["F50-P"].monthlyCostToCompany, 100000);

    assert.ok(byCode["F50-A"]);
    assert.ok(byCode["F50-A"].daysBreakdown.lossOfPayDays > 0);
    assert.ok(
      byCode["F50-A"].daysBreakdown.payableDays < byCode["F50-A"].daysBreakdown.totalDaysInMonth
    );

    assert.ok(byCode["F50-H"]);
    assert.equal(byCode["F50-H"].daysBreakdown.lossOfPayDays % 1, 0.5);
    assert.ok(byCode["F50-H"].daysBreakdown.presentDays % 1 === 0.5);

    assert.ok(byCode["F50-PL"]);
    assert.equal(byCode["F50-PL"].daysBreakdown.paidLeaveDays, 3);
    assert.equal(byCode["F50-PL"].daysBreakdown.lossOfPayDays, 0);

    assert.ok(byCode["F50-UL"]);
    assert.equal(byCode["F50-UL"].daysBreakdown.lossOfPayDays, 2);
    assert.equal(byCode["F50-UL"].daysBreakdown.paidLeaveDays, 0);

    assert.ok(byCode["F50-OC"]);
    assert.equal(byCode["F50-OC"].monthlyCostToCompany, 55000);

    const missingIssue = result.validationIssues.find(
      (v) => String(v.employeeId) === String(missingCtcEmp._id)
    );
    assert.ok(missingIssue);
    assert.match(missingIssue.issue, /No monthly CTC/i);
    assert.equal(
      result.employeeRecords.some((r) => String(r.employeeId) === String(missingCtcEmp._id)),
      false
    );

    assert.equal(result.cycleSummary.employeeCount, result.employeeRecords.length);
    assert.ok(result.cycleSummary.totalNetPayable > 0);
    assert.equal(
      result.cycleSummary.totalGrossEarnings,
      result.employeeRecords.reduce((s, r) => s + r.grossEarnings, 0)
    );
  });

  it("recalculation yields stable totals for the same period inputs", async () => {
    const first = await calculatePayrollCycle({
      models,
      company,
      periodMonth: 3,
      periodYear: 2026,
    });
    const second = await calculatePayrollCycle({
      models,
      company,
      periodMonth: 3,
      periodYear: 2026,
    });

    assert.equal(first.cycleSummary.totalGrossEarnings, second.cycleSummary.totalGrossEarnings);
    assert.equal(first.cycleSummary.totalNetPayable, second.cycleSummary.totalNetPayable);
    assert.equal(first.cycleSummary.employeeCount, second.cycleSummary.employeeCount);
    assert.equal(first.validationIssues.length, second.validationIssues.length);

    const sortKey = (r) => r.employeeSnapshot.employeeCode;
    const a = [...first.employeeRecords].sort((x, y) => sortKey(x).localeCompare(sortKey(y)));
    const b = [...second.employeeRecords].sort((x, y) => sortKey(x).localeCompare(sortKey(y)));
    for (let i = 0; i < a.length; i++) {
      assert.deepEqual(a[i].daysBreakdown, b[i].daysBreakdown);
      assert.equal(a[i].grossEarnings, b[i].grossEarnings);
      assert.equal(a[i].netPayable, b[i].netPayable);
      assert.equal(a[i].monthlyCostToCompany, b[i].monthlyCostToCompany);
    }
  });

  it("Employee projection still resolves customFields salary fallback", async () => {
    const user = await models.User.create({
      email: "legacy.salary.f50@example.com",
      passwordHash: await hashPassword("F50Pass123!"),
      role: USER_ROLES.EMPLOYEE,
      fullName: "Legacy Salary",
      isActive: true,
    });
    const emp = await models.Employee.create({
      userId: user._id,
      employeeCode: "F50-LEG",
      fullName: "Legacy Salary",
      email: "legacy.salary.f50@example.com",
      status: EMPLOYEE_STATUSES.ACTIVE,
      job: { jobTitle: "Analyst", department: "Ops", joiningDate: new Date("2026-01-01") },
      customFields: { monthlySalary: 42000 },
    });

    const result = await calculatePayrollCycle({
      models,
      company,
      periodMonth: 3,
      periodYear: 2026,
    });
    const rec = result.employeeRecords.find((r) => String(r.employeeId) === String(emp._id));
    assert.ok(rec);
    assert.equal(rec.monthlyCostToCompany, 42000);
  });
});
