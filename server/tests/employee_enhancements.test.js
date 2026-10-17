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
let companyA;
let companyB;
let hrCookieA;
let hrCookieB;
let employeeCookieA;

function cookieFrom(response) {
  const cookies = response.headers["set-cookie"] || [];
  return cookies.find((val) => val.startsWith(`${getAuthCookieName()}=`));
}

before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongo.getUri();
  await connectCentralDB();
  app = createApp();

  companyA = await Company.create({
    companyName: "Stark Industries",
    slug: "stark",
    databaseName: "company_stark",
    status: COMPANY_STATUSES.ACTIVE,
  });

  companyB = await Company.create({
    companyName: "Wayne Enterprises",
    slug: "wayne",
    databaseName: "company_wayne",
    status: COMPANY_STATUSES.ACTIVE,
  });

  const { User: UserA } = await getCompanyModels(companyA);
  await UserA.create({
    email: "hr@stark.test",
    passwordHash: await hashPassword("StarkPass123!"),
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
  });

  const { User: UserB } = await getCompanyModels(companyB);
  await UserB.create({
    email: "hr@wayne.test",
    passwordHash: await hashPassword("WaynePass123!"),
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
  });

  const loginA = await request(app).post("/api/auth/login").send({
    companyCode: "stark",
    email: "hr@stark.test",
    password: "StarkPass123!",
  });
  hrCookieA = cookieFrom(loginA);

  const loginB = await request(app).post("/api/auth/login").send({
    companyCode: "wayne",
    email: "hr@wayne.test",
    password: "WaynePass123!",
  });
  hrCookieB = cookieFrom(loginB);
});

after(async () => {
  await disconnectAll();
  if (mongo) {
    await mongo.stop();
  }
});

describe("HRMS Employee Management Enhancements", () => {
  let createdEmployeeId;
  let onboardingToken;
  let createdDocId;

  it("1. HR creates an employee with simplified fields, issuing an onboarding invitation", async () => {
    const res = await request(app)
      .post("/api/employees")
      .set("Cookie", hrCookieA)
      .send({
        fullName: "Peter Parker",
        email: "peter@stark.test",
        employeeCode: "STK-101",
        jobTitle: "Research Scientist",
        department: "Advanced Technology",
        employmentType: "Full-time",
        joiningDate: "2025-06-01",
        monthlySalary: 75000,
      });

    if (res.status !== 201) {
      console.error("TEST 1 FAILED RESPONSE:", res.status, res.body);
    }
    assert.equal(res.status, 201);
    assert.equal(res.body.employee.fullName, "Peter Parker");
    assert.equal(res.body.employee.employeeCode, "STK-101");
    assert.equal(res.body.invitation.status, "PENDING");
    assert.ok(res.body.invitation.inviteLink.includes("/onboard?token="));

    createdEmployeeId = res.body.employee._id;
    const url = new URL(res.body.invitation.inviteLink);
    onboardingToken = url.searchParams.get("token");
    assert.ok(onboardingToken);

    // Audit logs checked
    const { AuditLog } = await getCompanyModels(companyA);
    const logs = await AuditLog.find({ targetId: createdEmployeeId }).lean();
    assert.ok(logs.some((l) => l.action === "EMPLOYEE_CREATED"));
    assert.ok(logs.some((l) => l.action === "INVITATION_SENT"));
  });

  it("2. Rejects duplicate employee creation (code or email)", async () => {
    const dupRes = await request(app)
      .post("/api/employees")
      .set("Cookie", hrCookieA)
      .send({
        fullName: "Duplicate Peter",
        email: "peter@stark.test",
        employeeCode: "STK-999",
      });
    assert.equal(dupRes.status, 409);

    const dupCodeRes = await request(app)
      .post("/api/employees")
      .set("Cookie", hrCookieA)
      .send({
        fullName: "Different Peter",
        email: "another.peter@stark.test",
        employeeCode: "STK-101",
      });
    assert.equal(dupCodeRes.status, 409);
  });

  it("3. HR can resend an invitation without creating duplicate employee records", async () => {
    const resendRes = await request(app)
      .post(`/api/employees/${createdEmployeeId}/resend-invite`)
      .set("Cookie", hrCookieA)
      .send();

    assert.equal(resendRes.status, 200);
    assert.equal(resendRes.body.invitation.status, "PENDING");
    assert.ok(resendRes.body.invitation.inviteLink);

    const url = new URL(resendRes.body.invitation.inviteLink);
    onboardingToken = url.searchParams.get("token");

    const { AuditLog } = await getCompanyModels(companyA);
    const resendLog = await AuditLog.findOne({
      targetId: createdEmployeeId,
      action: "INVITATION_RESENT",
    }).lean();
    assert.ok(resendLog);
  });

  it("4. Employee onboarding token verification returns employee and company details", async () => {
    const verifyRes = await request(app)
      .get(`/api/auth/onboard/verify?token=${encodeURIComponent(onboardingToken)}`);

    assert.equal(verifyRes.status, 200);
    assert.equal(verifyRes.body.email, "peter@stark.test");
    assert.equal(verifyRes.body.employee?.fullName, "Peter Parker");
    assert.equal(verifyRes.body.company?.name, "Stark Industries");
  });

  it("5. Employee completes self-service onboarding and establishes credentials", async () => {
    const onboardRes = await request(app)
      .post("/api/auth/onboard/complete")
      .send({
        token: onboardingToken,
        password: "WebSlinger123!",
        preferredName: "Spidey",
        phoneNumber: "+1 555-0199",
        personalEmail: "peter.private@webmail.test",
        residentialAddress: {
          street: "20 Ingram Street",
          city: "Queens",
          state: "New York",
          postalCode: "11375",
          country: "USA",
        },
        emergencyContact: {
          name: "May Parker",
          relationship: "Aunt",
          phone: "+1 555-0188",
        },
        bankDetails: {
          accountHolderName: "Peter Parker",
          accountNumber: "123456789012",
          bankName: "Queens Community Bank",
          ifscCode: "QCB0001",
          accountType: "Checking",
        },
        taxDetails: {
          panNumber: "SSN-123-45",
          taxRegime: "Standard",
        },
      });

    if (onboardRes.status !== 200 && onboardRes.status !== 201) {
      console.error("ONBOARD COMPLETE FAILED:", onboardRes.status, onboardRes.body);
    }
    assert.ok(onboardRes.status === 200 || onboardRes.status === 201);
    assert.equal(onboardRes.body.user.email, "peter@stark.test");
    employeeCookieA = cookieFrom(onboardRes);
    assert.ok(employeeCookieA, "Expected session cookie issued upon completing onboarding");

    // Verify employee record updated
    const { Employee } = await getCompanyModels(companyA);
    const emp = await Employee.findById(createdEmployeeId).lean();
    assert.equal(emp.invitation.status, "ACCEPTED");
    assert.equal(emp.preferredName, "Spidey");
    assert.equal(emp.residentialAddress.city, "Queens");
    assert.equal(emp.bankDetails.bankName, "Queens Community Bank");
  });

  it("6. Rejects reuse of consumed onboarding token", async () => {
    const reuseRes = await request(app)
      .post("/api/auth/onboard/complete")
      .send({
        token: onboardingToken,
        password: "WebSlinger123!",
      });
    assert.equal(reuseRes.status, 409);
  });

  it("7. Authenticated employee views their self-service profile via /me", async () => {
    const meRes = await request(app)
      .get("/api/employees/me")
      .set("Cookie", employeeCookieA);

    assert.equal(meRes.status, 200);
    assert.equal(meRes.body.employee.fullName, "Peter Parker");
    assert.equal(meRes.body.employee.preferredName, "Spidey");
    assert.equal(meRes.body.employee.residentialAddress.city, "Queens");
    assert.equal(meRes.body.employee.bankDetails.bankName, "Queens Community Bank");
    assert.equal(meRes.body.employee.compensation?.monthlyCostToCompany, 75000);
  });

  it("8. Employee updates permitted self-service fields (address, personal contact, emergency contact)", async () => {
    const patchRes = await request(app)
      .patch("/api/employees/me")
      .set("Cookie", employeeCookieA)
      .send({
        preferredName: "Peter B. Parker",
        personalPhone: "+1 555-9999",
        emergencyContact: {
          name: "Mary Jane Watson",
          relationship: "Spouse",
          phone: "+1 555-8888",
        },
      });

    assert.equal(patchRes.status, 200);
    assert.equal(patchRes.body.employee.preferredName, "Peter B. Parker");
    assert.equal(patchRes.body.employee.personalPhone, "+1 555-9999");
    assert.equal(patchRes.body.employee.emergencyContact.name, "Mary Jane Watson");

    const { AuditLog } = await getCompanyModels(companyA);
    const selfLog = await AuditLog.findOne({
      targetId: createdEmployeeId,
      action: "EMPLOYEE_SELF_UPDATED",
    }).lean();
    assert.ok(selfLog);
  });

  it("9. Server strictly blocks employee from updating HR-controlled fields", async () => {
    // Attempting to change salary
    const badSalaryRes = await request(app)
      .patch("/api/employees/me")
      .set("Cookie", employeeCookieA)
      .send({ monthlySalary: 150000 });
    assert.equal(badSalaryRes.status, 403);

    // Attempting to change employeeCode
    const badCodeRes = await request(app)
      .patch("/api/employees/me")
      .set("Cookie", employeeCookieA)
      .send({ employeeCode: "HACK-001" });
    assert.equal(badCodeRes.status, 403);

    // Attempting to change status
    const badStatusRes = await request(app)
      .patch("/api/employees/me")
      .set("Cookie", employeeCookieA)
      .send({ status: "INACTIVE" });
    assert.equal(badStatusRes.status, 403);

    // Attempting to change jobTitle
    const badJobRes = await request(app)
      .patch("/api/employees/me")
      .set("Cookie", employeeCookieA)
      .send({ jobTitle: "Director of Technology" });
    assert.equal(badJobRes.status, 403);
  });

  it("10. HR uploads a document to the employee record with type, title, and metadata", async () => {
    const samplePdfBase64 = Buffer.from("%PDF-1.4 sample test document").toString("base64");
    const docRes = await request(app)
      .post(`/api/employees/${createdEmployeeId}/documents`)
      .set("Cookie", hrCookieA)
      .send({
        documentType: "OFFER_LETTER",
        title: "Official Offer Letter - Research Scientist",
        fileName: "offer_letter.pdf",
        mimeType: "application/pdf",
        fileData: samplePdfBase64,
      });

    assert.equal(docRes.status, 201);
    assert.equal(docRes.body.document.documentType, "OFFER_LETTER");
    assert.equal(docRes.body.document.title, "Official Offer Letter - Research Scientist");
    assert.equal(docRes.body.document.fileName, "offer_letter.pdf");
    assert.ok(docRes.body.document.storageKey);

    createdDocId = docRes.body.document._id;

    const { AuditLog } = await getCompanyModels(companyA);
    const docLog = await AuditLog.findOne({
      targetId: createdEmployeeId,
      action: "DOCUMENT_UPLOADED",
    }).lean();
    assert.ok(docLog);
  });

  it("11. Upload rejects disallowed file extensions (e.g. .exe)", async () => {
    const fakeExe = Buffer.from("MZ malicious payload").toString("base64");
    const badUploadRes = await request(app)
      .post(`/api/employees/${createdEmployeeId}/documents`)
      .set("Cookie", hrCookieA)
      .send({
        fileName: "malware.exe",
        fileData: fakeExe,
      });
    assert.equal(badUploadRes.status, 400);
  });

  it("12. HR can download the uploaded document", async () => {
    const downloadRes = await request(app)
      .get(`/api/employees/${createdEmployeeId}/documents/${createdDocId}/download`)
      .set("Cookie", hrCookieA);

    assert.equal(downloadRes.status, 200);
    assert.equal(downloadRes.headers["content-type"], "application/pdf");
    const content = downloadRes.text || downloadRes.body?.toString() || "";
    assert.ok(content.includes("%PDF-1.4 sample test document"));
  });

  it("13. Employee can download their own uploaded document", async () => {
    const downloadRes = await request(app)
      .get(`/api/employees/${createdEmployeeId}/documents/${createdDocId}/download`)
      .set("Cookie", employeeCookieA);

    assert.equal(downloadRes.status, 200);
    const content = downloadRes.text || downloadRes.body?.toString() || "";
    assert.ok(content.includes("%PDF-1.4 sample test document"));
  });

  it("14. Tenant isolation: HR of company B cannot access or download documents of company A", async () => {
    const badDownloadRes = await request(app)
      .get(`/api/employees/${createdEmployeeId}/documents/${createdDocId}/download`)
      .set("Cookie", hrCookieB);

    // In tenant isolated architecture, the employee does not exist in company B's database
    assert.equal(badDownloadRes.status, 404);
  });
});
