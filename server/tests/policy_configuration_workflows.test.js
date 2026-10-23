import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../app.js";
import { connectCentralDB, disconnectAll, getCompanyModels } from "../config/db.js";
import Company, { COMPANY_STATUSES } from "../models/Company.js";
import { EMPLOYEE_STATUSES } from "../models/Employee.js";
import { USER_ROLES } from "../models/User.js";
import { getAuthCookieName } from "../utils/authCookie.js";
import { hashPassword } from "../utils/password.js";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-jwt-secret-that-is-at-least-32-chars";
process.env.JWT_ISSUER = "hrms-platform";
process.env.JWT_AUDIENCE = "hrms-company-users";
process.env.CENTRAL_DB_NAME = "platform";
process.env.CLIENT_URL = "http://localhost:5173";
process.env.BCRYPT_ROUNDS = "4";
process.env.AUTH_COOKIE_NAME = "hrms_auth";

let mongo;
let app;
let company;
let hrCookie;
let employeeCookie;
let employeeDoc;
let activePolicyId;

function cookieFrom(response) {
  const cookies = response.headers["set-cookie"] || [];
  return cookies.find((val) => val.startsWith(`${getAuthCookieName()}=`));
}

before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongo.getUri();
  await connectCentralDB();
  app = createApp();

  company = await Company.create({
    companyName: "Nexus Corp",
    slug: "nexus",
    databaseName: "company_nexus_policies_workflow_test",
    status: COMPANY_STATUSES.ACTIVE,
  });

  const { User, Employee, CompanyHrPolicy } = await getCompanyModels(company);

  const hrUser = await User.create({
    email: "hr@nexus.test",
    passwordHash: await hashPassword("NexusPass123!"),
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
  });

  const empUser = await User.create({
    email: "emp@nexus.test",
    passwordHash: await hashPassword("NexusPass123!"),
    role: USER_ROLES.EMPLOYEE,
    isActive: true,
  });

  employeeDoc = await Employee.create({
    userId: empUser._id,
    employeeCode: "NEX-001",
    fullName: "Charlie Brown",
    email: "emp@nexus.test",
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: {
      jobTitle: "Senior Architect",
      department: "Platform",
      joiningDate: new Date("2026-01-01"),
    },
    attendance: {
      totalWorkingDays: 22,
      daysPresent: 20,
      leaveBalance: { casual: 10, sick: 10, earned: 15 },
    },
  });

  await CompanyHrPolicy.deleteMany({});
  const policy = await CompanyHrPolicy.create({
    effectiveFromDate: new Date("2026-01-01"),
    leaveTypes: [
      { code: "CASUAL", name: "Casual Leave", yearlyDays: 10, isActive: true, isPaid: true },
      { code: "SICK", name: "Sick Leave", yearlyDays: 10, isActive: true, isPaid: true },
      { code: "MATERNITY", name: "Maternity Leave", yearlyDays: 182, isActive: true, isPaid: true },
    ],
    leaveRules: {
      probationMonths: 3,
      maxConsecutiveDays: 5,
      carryForwardLimitDays: 10,
    },
    locationRules: {
      requireLocationForPunch: true,
      allowWebTracking: true,
      geofenceEnabled: true,
      geofenceRadiusMeters: 300,
      officeLatitude: 17.448293,
      officeLongitude: 78.374628,
      officeAddress: "Nexus Tech Tower, Madhapur, Hyderabad",
    },
    salaryComponentRules: {
      allowances: [
        { name: "Basic Salary", code: "BASIC", taxable: true, percentageOfCtc: 45 },
        { name: "House Rent Allowance", code: "HRA", taxable: true, percentageOfCtc: 25 },
        { name: "Conveyance Allowance", code: "CONVEYANCE", taxable: false, percentageOfCtc: 10 },
        { name: "Special Allowance", code: "SPECIAL", taxable: true, percentageOfCtc: 20 },
      ],
      deductions: [
        { name: "Provident Fund", code: "EPF", ratePercent: 12 },
        { name: "Health Insurance", code: "HEALTH_INS", ratePercent: 2 },
      ],
    },
    recruitmentRules: {
      offerValidityDays: 5,
      requireCandidateSignature: true,
      autoExpireOffers: true,
    },
    documentRules: {
      mandatoryDocumentTypes: ["ID_PROOF", "OFFER_LETTER", "NDA"],
      maxFileSizeMB: 8,
      allowedFileFormats: ["pdf", "jpg", "png"],
    },
  });

  activePolicyId = policy._id.toString();

  // Login HR Admin
  const resHrLogin = await request(app)
    .post("/api/auth/login")
    .send({ companyCode: "nexus", email: "hr@nexus.test", password: "NexusPass123!" });
  hrCookie = cookieFrom(resHrLogin);

  // Login Employee
  const resEmpLogin = await request(app)
    .post("/api/auth/login")
    .send({ companyCode: "nexus", email: "emp@nexus.test", password: "NexusPass123!" });
  employeeCookie = cookieFrom(resEmpLogin);
});

after(async () => {
  await disconnectAll();
  if (mongo) await mongo.stop();
});

describe("HR Policies Configuration & Real Downstream Workflows Integration", () => {
  it("1. Successfully saves custom allowances, deductions, and custom document types into tenant database", async () => {
    const updateRes = await request(app)
      .put(`/api/policies/${activePolicyId}`)
      .set("Cookie", hrCookie)
      .send({
        salaryComponentRules: {
          allowances: [
            { name: "Basic Salary", code: "BASIC", taxable: true, percentageOfCtc: 40 },
            { name: "House Rent Allowance", code: "HRA", taxable: true, percentageOfCtc: 20 },
            { name: "Conveyance Allowance", code: "CONVEYANCE", taxable: false, percentageOfCtc: 10 },
            { name: "Internet Allowance", code: "INTERNET", taxable: false, percentageOfCtc: 5 },
            { name: "Special Allowance", code: "SPECIAL", taxable: true, percentageOfCtc: 25 },
          ],
          deductions: [
            { name: "Provident Fund", code: "EPF", ratePercent: 12 },
            { name: "Professional Tax", code: "PT", ratePercent: 0 },
            { name: "Voluntary Provident Fund", code: "VPF", ratePercent: 5 },
          ],
        },
        documentRules: {
          mandatoryDocumentTypes: [
            "ID_PROOF",
            "OFFER_LETTER",
            "NDA",
            "ACADEMIC_CERTIFICATE",
            "CLIENT_SECURITY_AGREEMENT",
          ],
          maxFileSizeMB: 5,
          allowedFileFormats: ["pdf", "png"],
        },
        recruitmentRules: {
          offerValidityDays: 3, // Expedited 3 days
          requireCandidateSignature: true,
          autoExpireOffers: true,
        },
        leaveRules: {
          maxConsecutiveDays: 4,
          probationMonths: 3,
        },
      });

    assert.equal(updateRes.status, 200);
    assert.equal(updateRes.body.success, true);
    const updated = updateRes.body.policy;

    assert.equal(updated.salaryComponentRules.allowances.length, 5);
    assert.ok(updated.salaryComponentRules.allowances.some((a) => a.code === "INTERNET"));
    assert.equal(updated.salaryComponentRules.deductions.length, 3);
    assert.ok(updated.salaryComponentRules.deductions.some((d) => d.code === "VPF"));
    assert.ok(updated.documentRules.mandatoryDocumentTypes.includes("CLIENT_SECURITY_AGREEMENT"));
    assert.equal(updated.documentRules.maxFileSizeMB, 5);
    assert.equal(updated.recruitmentRules.offerValidityDays, 3);
    assert.equal(updated.leaveRules.maxConsecutiveDays, 4);
  });

  it("2. Downstream Integration: Leave application enforces policy maxConsecutiveDays", async () => {
    // Charlie applies for 6 consecutive working days, but policy restricts to max 4 days
    const resOverLimit = await request(app)
      .post("/api/employees/me/leave-requests")
      .set("Cookie", employeeCookie)
      .send({
        leaveType: "CASUAL",
        startDate: "2026-11-09", // Mon
        endDate: "2026-11-16",   // Mon next week (6 working days)
        reason: "Extended family vacation",
      });

    assert.equal(resOverLimit.status, 400);
    assert.match(resOverLimit.body.message, /exceeds the company maximum limit of 4 consecutive days/i);
  });

  it("3. Downstream Integration: Document upload enforces policy maxFileSizeMB and allowedFileFormats", async () => {
    // 3a. Disallowed file format (.exe)
    const resBadFormat = await request(app)
      .post("/api/employees/me/documents")
      .set("Cookie", employeeCookie)
      .send({
        fileName: "malicious_script.exe",
        fileData: Buffer.from("dummy binary content").toString("base64"),
        mimeType: "application/octet-stream",
        documentType: "OTHER",
      });

    assert.equal(resBadFormat.status, 400);
    assert.match(resBadFormat.body.message, /not permitted by company policy/i);

    // 3b. File size exceeding configured 5 MB limit
    const resTooLarge = await request(app)
      .post("/api/employees/me/documents")
      .set("Cookie", employeeCookie)
      .send({
        fileName: "giant_report.pdf",
        fileData: Buffer.from("dummy content").toString("base64"),
        fileSize: 7 * 1024 * 1024, // 7 MB
        mimeType: "application/pdf",
        documentType: "ID_PROOF",
      });

    assert.equal(resTooLarge.status, 400);
    assert.match(resTooLarge.body.message, /exceeds the company policy maximum limit of 5 MB/i);
  });

  it("4. Downstream Integration: Attendance punch-in enforces policy geofence radius", async () => {
    // Office is at (17.448293, 78.374628).
    // Employee tries to punch in from Bangalore (12.9716, 77.5946) -> ~500 km away!
    const resOutGeofence = await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", employeeCookie)
      .send({
        latitude: 12.971599,
        longitude: 77.594566,
        accuracy: 10,
      });

    assert.equal(resOutGeofence.status, 400);
    assert.match(resOutGeofence.body.message, /Punch-in rejected.*exceeds the permitted geofence radius/i);

    // Employee punches in within 50m of office coordinates
    const resInGeofence = await request(app)
      .post("/api/employees/me/attendance/punch-in")
      .set("Cookie", employeeCookie)
      .send({
        latitude: 17.448300,
        longitude: 78.374635,
        accuracy: 5,
      });

    assert.equal(resInGeofence.status, 200);
    assert.equal(resInGeofence.body.success, true);
    assert.equal(resInGeofence.body.today.status, "CHECKED_IN");
  });

  it("5. Downstream Integration: Offer Letter expiration dynamically honors policy offerValidityDays", async () => {
    const { OfferLetter } = await getCompanyModels(company);

    // Create an offer letter draft
    const createRes = await request(app)
      .post("/api/offer-letters")
      .set("Cookie", hrCookie)
      .send({
        candidate: {
          fullName: "David Miller",
          email: "david.miller@example.com",
        },
        position: "Security Lead",
        department: "InfoSec",
        monthlySalary: 85000,
        joiningDate: "2026-12-01",
      });

    assert.equal(createRes.status, 201);
    const offerId = createRes.body.offerLetter._id;

    // Send the offer letter (policy offerValidityDays was configured to 3 days in test 1)
    const sendRes = await request(app)
      .post(`/api/offer-letters/${offerId}/send`)
      .set("Cookie", hrCookie)
      .send({});

    assert.equal(sendRes.status, 200);

    const updatedOffer = await OfferLetter.findById(offerId).lean();
    assert.ok(updatedOffer.signingTokenExpiresAt);

    const diffHours = (new Date(updatedOffer.signingTokenExpiresAt) - Date.now()) / (1000 * 60 * 60);
    // 3 days = 72 hours (allow small tolerance between 71 and 73 hours)
    assert.ok(diffHours >= 71 && diffHours <= 73, `Expected ~72 hours (3 days), got ${diffHours}`);
  });

  it("6. Downstream Integration: Payroll calculates unitemized components from company policy allowance percentages", async () => {
    const { Employee, EmployeeCompensation, Attendance, LeaveRequest, CompanyHrPolicy } =
      await getCompanyModels(company);

    // Add compensation for Charlie: 100,000 monthly CTC with 0 itemized components
    await EmployeeCompensation.create({
      employeeId: employeeDoc._id,
      revisions: [
        {
          effectiveFromDate: new Date("2026-01-01"),
          monthlyCostToCompany: 100000,
          salaryComponents: {
            basicSalary: 0,
            houseRentAllowance: 0,
            conveyanceAllowance: 0,
            specialAllowance: 0,
          },
        },
      ],
    });

    // In Test 1, policy was updated to:
    // BASIC: 40%, HRA: 20%, CONVEYANCE: 10%, SPECIAL: 25% (or remainder)
    const { calculatePayrollCycle } = await import("../services/payrollCalculationService.js");

    const result = await calculatePayrollCycle({
      periodYear: 2026,
      periodMonth: 10,
      models: { Employee, EmployeeCompensation, Attendance, LeaveRequest, CompanyHrPolicy },
      company,
    });

    assert.equal(result.employeeRecords.length, 1);
    const charlieRecord = result.employeeRecords[0];

    // Because attendance was recorded for part of the month, gross earnings is prorated.
    // The policy's configured percentages (40% basic, 20% HRA, 10% conveyance) must be maintained:
    assert.ok(charlieRecord.grossEarnings > 0);
    const basicEarn = charlieRecord.earnings.find((e) => e.code === "BASIC");
    const hraEarn = charlieRecord.earnings.find((e) => e.code === "HRA");
    const convEarn = charlieRecord.earnings.find((e) => e.code === "CONVEYANCE");

    assert.ok(basicEarn, "Expected BASIC earning item");
    assert.ok(hraEarn, "Expected HRA earning item");
    assert.ok(convEarn, "Expected CONVEYANCE earning item");

    const basicPct = Math.round((basicEarn.amount / charlieRecord.grossEarnings) * 100);
    const hraPct = Math.round((hraEarn.amount / charlieRecord.grossEarnings) * 100);
    const convPct = Math.round((convEarn.amount / charlieRecord.grossEarnings) * 100);

    assert.equal(basicPct, 40, `Expected basic to be 40% of gross, got ${basicPct}%`);
    assert.equal(hraPct, 20, `Expected HRA to be 20% of gross, got ${hraPct}%`);
    assert.equal(convPct, 10, `Expected conveyance to be 10% of gross, got ${convPct}%`);
  });
});
