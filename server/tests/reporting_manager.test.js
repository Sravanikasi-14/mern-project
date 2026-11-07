process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-jwt-secret-that-is-at-least-32-chars";
process.env.JWT_ISSUER = "hrms-platform";
process.env.JWT_AUDIENCE = "hrms-company-users";
process.env.CENTRAL_DB_NAME = "platform";
process.env.CLIENT_URL = "http://localhost:5173";
process.env.BCRYPT_ROUNDS = "4";
process.env.AUTH_COOKIE_NAME = "hrms_auth";

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../app.js";
import { connectCentralDB, disconnectAll, getCompanyModels } from "../config/db.js";
import Company, { COMPANY_STATUSES } from "../models/Company.js";
import { EMPLOYEE_STATUSES } from "../models/Employee.js";
import { USER_ROLES } from "../models/User.js";
import { getAuthCookieName } from "../utils/authCookie.js";
import { hashPassword } from "../utils/password.js";
import {
  buildEmployeePayload,
  createEmployeeFromOnboarding,
} from "../services/onboardingEmployeeService.js";
import { resolveReportingManagerFromOfferHint } from "../services/reportingManagerService.js";
import { OFFER_LETTER_STATUSES } from "../models/OfferLetter.js";
import { ONBOARDING_STATUSES } from "../models/User.js";

let mongo;
let app;
let acme;
let globex;
let acmeHrCookie;
let acmeEmployeeCookie;
let globexHrCookie;

function cookieFrom(response) {
  const cookies = response.headers["set-cookie"] || [];
  return cookies.find((val) => val.startsWith(`${getAuthCookieName()}=`));
}

async function createEmp(company, data) {
  const { Employee } = await getCompanyModels(company);
  return Employee.create({
    status: EMPLOYEE_STATUSES.ACTIVE,
    phoneNumber: "9000000000",
    ...data,
    job: {
      jobTitle: "Engineer",
      department: "Engineering",
      joiningDate: new Date("2024-01-01"),
      ...(data.job || {}),
    },
  });
}

before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongo.getUri();
  await connectCentralDB();
  app = createApp();

  acme = await Company.create({
    companyName: "Acme Corp",
    slug: "acme-rm",
    databaseName: "company_acme_rm",
    status: COMPANY_STATUSES.ACTIVE,
  });
  globex = await Company.create({
    companyName: "Globex Corp",
    slug: "globex-rm",
    databaseName: "company_globex_rm",
    status: COMPANY_STATUSES.ACTIVE,
  });

  const { User: AcmeUser, Employee: AcmeEmployee } = await getCompanyModels(acme);
  await AcmeUser.create({
    email: "hr@acme-rm.test",
    passwordHash: await hashPassword("AcmePass123!"),
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
  });
  const workerUser = await AcmeUser.create({
    email: "worker@acme-rm.test",
    passwordHash: await hashPassword("WorkerPass123!"),
    role: USER_ROLES.EMPLOYEE,
    isActive: true,
  });
  const workerEmp = await AcmeEmployee.create({
    employeeCode: "WRK-001",
    fullName: "Worker Bee",
    email: "worker@acme-rm.test",
    userId: workerUser._id,
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: { jobTitle: "IC", department: "Ops", joiningDate: new Date() },
  });
  workerUser.employeeId = workerEmp._id;
  await workerUser.save();

  const { User: GlobexUser } = await getCompanyModels(globex);
  await GlobexUser.create({
    email: "hr@globex-rm.test",
    passwordHash: await hashPassword("GlobexPass123!"),
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
  });

  acmeHrCookie = cookieFrom(
    await request(app).post("/api/auth/login").send({
      companyCode: "acme-rm",
      email: "hr@acme-rm.test",
      password: "AcmePass123!",
    })
  );
  acmeEmployeeCookie = cookieFrom(
    await request(app).post("/api/auth/login").send({
      companyCode: "acme-rm",
      email: "worker@acme-rm.test",
      password: "WorkerPass123!",
    })
  );
  globexHrCookie = cookieFrom(
    await request(app).post("/api/auth/login").send({
      companyCode: "globex-rm",
      email: "hr@globex-rm.test",
      password: "GlobexPass123!",
    })
  );
});

after(async () => {
  await disconnectAll();
  if (mongo) await mongo.stop();
});

describe("Reporting manager assignment (Phase 1 foundation)", () => {
  let ceo;
  let mgr;
  let ic;
  let peer;

  beforeEach(async () => {
    const { Employee } = await getCompanyModels(acme);
    await Employee.deleteMany({ email: { $ne: "worker@acme-rm.test" } });

    ceo = await createEmp(acme, {
      employeeCode: "CEO-001",
      fullName: "Casey CEO",
      email: "ceo@acme-rm.test",
    });
    mgr = await createEmp(acme, {
      employeeCode: "MGR-001",
      fullName: "Morgan Manager",
      email: "mgr@acme-rm.test",
      job: { reportingManagerId: ceo._id },
    });
    ic = await createEmp(acme, {
      employeeCode: "IC-001",
      fullName: "Ivy Contributor",
      email: "ic@acme-rm.test",
    });
    peer = await createEmp(acme, {
      employeeCode: "PEER-001",
      fullName: "Pat Peer",
      email: "peer@acme-rm.test",
    });
  });

  it("assigns a valid reporting manager", async () => {
    const res = await request(app)
      .patch(`/api/employees/${ic._id}`)
      .set("Cookie", acmeHrCookie)
      .send({ reportingManagerId: mgr._id.toString() });

    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(String(res.body.employee.job.reportingManagerId), String(mgr._id));

    const { Employee } = await getCompanyModels(acme);
    const fresh = await Employee.findById(ic._id).lean();
    assert.equal(String(fresh.job.reportingManagerId), String(mgr._id));
  });

  it("removes a reporting manager when null is sent", async () => {
    await request(app)
      .patch(`/api/employees/${ic._id}`)
      .set("Cookie", acmeHrCookie)
      .send({ reportingManagerId: mgr._id.toString() });

    const res = await request(app)
      .patch(`/api/employees/${ic._id}`)
      .set("Cookie", acmeHrCookie)
      .send({ reportingManagerId: null });

    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.employee.job.reportingManagerId, null);

    const { Employee } = await getCompanyModels(acme);
    const fresh = await Employee.findById(ic._id).lean();
    assert.equal(fresh.job.reportingManagerId, null);
  });

  it("rejects an invalid manager ObjectId", async () => {
    const res = await request(app)
      .patch(`/api/employees/${ic._id}`)
      .set("Cookie", acmeHrCookie)
      .send({ reportingManagerId: "not-an-object-id" });

    assert.equal(res.status, 400);
    assert.match(res.body.message || "", /invalid reporting manager/i);
  });

  it("rejects a nonexistent manager in the same company", async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const res = await request(app)
      .patch(`/api/employees/${ic._id}`)
      .set("Cookie", acmeHrCookie)
      .send({ reportingManagerId: fakeId.toString() });

    assert.equal(res.status, 400);
    assert.match(res.body.message || "", /not found/i);
  });

  it("rejects cross-company manager ids (other tenant DB)", async () => {
    const { Employee: GlobexEmployee } = await getCompanyModels(globex);
    const globexMgr = await GlobexEmployee.create({
      employeeCode: "GX-001",
      fullName: "Globex Boss",
      email: "boss@globex-rm.test",
      status: EMPLOYEE_STATUSES.ACTIVE,
      job: { jobTitle: "Lead", joiningDate: new Date() },
    });

    const res = await request(app)
      .patch(`/api/employees/${ic._id}`)
      .set("Cookie", acmeHrCookie)
      .send({ reportingManagerId: globexMgr._id.toString() });

    assert.equal(res.status, 400);
    assert.match(res.body.message || "", /not found/i);

    // Globex HR cannot patch Acme employee either
    const cross = await request(app)
      .patch(`/api/employees/${ic._id}`)
      .set("Cookie", globexHrCookie)
      .send({ reportingManagerId: globexMgr._id.toString() });
    assert.equal(cross.status, 404);
  });

  it("rejects self-reporting", async () => {
    const res = await request(app)
      .patch(`/api/employees/${ic._id}`)
      .set("Cookie", acmeHrCookie)
      .send({ reportingManagerId: ic._id.toString() });

    assert.equal(res.status, 400);
    assert.match(res.body.message || "", /themselves/i);
  });

  it("rejects a direct circular relationship", async () => {
    // ic → mgr already will be set; then mgr → ic is direct cycle
    await request(app)
      .patch(`/api/employees/${ic._id}`)
      .set("Cookie", acmeHrCookie)
      .send({ reportingManagerId: mgr._id.toString() });

    const res = await request(app)
      .patch(`/api/employees/${mgr._id}`)
      .set("Cookie", acmeHrCookie)
      .send({ reportingManagerId: ic._id.toString() });

    assert.equal(res.status, 400);
    assert.match(res.body.message || "", /circular/i);
  });

  it("rejects an indirect circular relationship", async () => {
    // Chain: ic → mgr → ceo. Setting ceo → ic would cycle.
    await request(app)
      .patch(`/api/employees/${ic._id}`)
      .set("Cookie", acmeHrCookie)
      .send({ reportingManagerId: mgr._id.toString() });

    const res = await request(app)
      .patch(`/api/employees/${ceo._id}`)
      .set("Cookie", acmeHrCookie)
      .send({ reportingManagerId: ic._id.toString() });

    assert.equal(res.status, 400);
    assert.match(res.body.message || "", /circular/i);
  });

  it("blocks EMPLOYEE self-profile from modifying reportingManagerId", async () => {
    const { Employee } = await getCompanyModels(acme);
    const worker = await Employee.findOne({ email: "worker@acme-rm.test" });

    const res = await request(app)
      .patch("/api/employees/me")
      .set("Cookie", acmeEmployeeCookie)
      .send({ reportingManagerId: mgr._id.toString() });

    assert.equal(res.status, 403);
    assert.match(res.body.message || "", /not permitted|HR-controlled/i);

    const fresh = await Employee.findById(worker._id).lean();
    assert.equal(fresh.job?.reportingManagerId ?? null, null);
  });

  it("validates reportingManagerId on create (provision)", async () => {
    const ok = await request(app)
      .post("/api/employees")
      .set("Cookie", acmeHrCookie)
      .send({
        fullName: "New Hire",
        email: "newhire@acme-rm.test",
        employeeCode: "NEW-001",
        reportingManagerId: mgr._id.toString(),
      });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal(String(ok.body.employee.job.reportingManagerId), String(mgr._id));

    const bad = await request(app)
      .post("/api/employees")
      .set("Cookie", acmeHrCookie)
      .send({
        fullName: "Bad Mgr Hire",
        email: "badmgr@acme-rm.test",
        employeeCode: "NEW-002",
        reportingManagerId: new mongoose.Types.ObjectId().toString(),
      });
    assert.equal(bad.status, 400);
  });

  it("never assigns an unresolved offer manager name to reportingManagerId", async () => {
    const { Employee, User, OfferLetter } = await getCompanyModels(acme);

    // Ambiguous / missing name must resolve to null
    assert.equal(await resolveReportingManagerFromOfferHint(Employee, "Nobody Here"), null);
    assert.equal(await resolveReportingManagerFromOfferHint(Employee, "VP of Engineering"), null);

    // Duplicate names → ambiguous → null
    await createEmp(acme, {
      employeeCode: "DUP-1",
      fullName: "Sam Same",
      email: "sam1@acme-rm.test",
    });
    await createEmp(acme, {
      employeeCode: "DUP-2",
      fullName: "Sam Same",
      email: "sam2@acme-rm.test",
    });
    assert.equal(await resolveReportingManagerFromOfferHint(Employee, "Sam Same"), null);

    // Unambiguous exact name match
    const resolved = await resolveReportingManagerFromOfferHint(Employee, "Morgan Manager");
    assert.equal(String(resolved), String(mgr._id));

    // buildEmployeePayload must not stringify a name into the ObjectId field
    const candidateUser = {
      _id: new mongoose.Types.ObjectId(),
      onboarding: {
        personalDetails: {
          fullName: "Cand I Date",
          phoneNumber: "9111111111",
          dateOfBirth: "1990-01-01",
        },
        residentialAddress: { street: "1 St", city: "Pune", state: "MH", postalCode: "411001" },
        emergencyContact: { name: "Kin", phone: "9222222222" },
        bankDetails: { accountNumber: "123", ifscCode: "HDFC0001" },
        taxDetails: { panNumber: "ABCDE1234F" },
        documents: [],
      },
    };
    const offerLetter = {
      position: "Engineer",
      department: "Engineering",
      employmentType: "Full-time",
      workLocation: "Pune",
      joiningDate: new Date(),
      reportingManager: "VP of Engineering",
      monthlySalary: 100000,
    };
    const payload = buildEmployeePayload({
      candidateUser,
      offerLetter,
      employeeCode: "CAND-001",
      candidateEmail: "cand@acme-rm.test",
      uploadedBy: null,
      reportingManagerId: null,
    });
    assert.equal(payload.job.reportingManagerId, null);

    // Full create path with unresolved name leaves null
    const candUser = await User.create({
      email: "onboard.cand@acme-rm.test",
      role: USER_ROLES.CANDIDATE,
      isActive: true,
      onboarding: {
        status: ONBOARDING_STATUSES.APPROVED,
        personalDetails: candidateUser.onboarding.personalDetails,
        residentialAddress: candidateUser.onboarding.residentialAddress,
        emergencyContact: candidateUser.onboarding.emergencyContact,
        bankDetails: {
          accountHolderName: "Cand I Date",
          bankName: "HDFC",
          accountNumber: "1234567890",
          ifscCode: "HDFC0001234",
          accountType: "Salary Account",
        },
        taxDetails: { panNumber: "ABCDE1234F" },
        documents: [],
      },
    });
    const offer = await OfferLetter.create({
      candidate: { fullName: "Cand I Date", email: "onboard.cand@acme-rm.test" },
      position: "Engineer",
      department: "Engineering",
      monthlySalary: 90000,
      joiningDate: new Date(),
      content: "<p>offer</p>",
      status: OFFER_LETTER_STATUSES.ACCEPTED,
      reportingManager: "Some Unresolved Title",
      signature: { signedAt: new Date(), signerName: "Cand I Date", method: "TYPE" },
    });

    const created = await createEmployeeFromOnboarding({
      models: await getCompanyModels(acme),
      company: acme,
      candidateUser: candUser,
      offerLetter: offer,
      candidateEmail: "onboard.cand@acme-rm.test",
      actorUserId: null,
    });
    assert.equal(created.employee.job.reportingManagerId, null);

    // Unambiguous name resolves on create
    const candUser2 = await User.create({
      email: "onboard.cand2@acme-rm.test",
      role: USER_ROLES.CANDIDATE,
      isActive: true,
      onboarding: {
        status: ONBOARDING_STATUSES.APPROVED,
        personalDetails: {
          fullName: "Cand Two",
          phoneNumber: "9111111112",
          dateOfBirth: "1991-02-02",
        },
        residentialAddress: { street: "2 St", city: "Pune", state: "MH", postalCode: "411001" },
        emergencyContact: { name: "Kin", phone: "9222222223" },
        bankDetails: {
          accountHolderName: "Cand Two",
          bankName: "HDFC",
          accountNumber: "1234567891",
          ifscCode: "HDFC0001234",
          accountType: "Salary Account",
        },
        taxDetails: { panNumber: "ABCDE1235F" },
        documents: [],
      },
    });
    const offer2 = await OfferLetter.create({
      candidate: { fullName: "Cand Two", email: "onboard.cand2@acme-rm.test" },
      position: "Engineer",
      department: "Engineering",
      monthlySalary: 90000,
      joiningDate: new Date(),
      content: "<p>offer</p>",
      status: OFFER_LETTER_STATUSES.ACCEPTED,
      reportingManager: "Morgan Manager",
      signature: { signedAt: new Date(), signerName: "Cand Two", method: "TYPE" },
    });
    const created2 = await createEmployeeFromOnboarding({
      models: await getCompanyModels(acme),
      company: acme,
      candidateUser: candUser2,
      offerLetter: offer2,
      candidateEmail: "onboard.cand2@acme-rm.test",
      actorUserId: null,
    });
    assert.equal(String(created2.employee.job.reportingManagerId), String(mgr._id));
  });

  it("allows assigning peer under ceo without affecting work-management field shape", async () => {
    const res = await request(app)
      .patch(`/api/employees/${peer._id}`)
      .set("Cookie", acmeHrCookie)
      .send({ reportingManagerId: ceo._id.toString() });
    assert.equal(res.status, 200);
    assert.equal(String(res.body.employee.job.reportingManagerId), String(ceo._id));
  });
});
