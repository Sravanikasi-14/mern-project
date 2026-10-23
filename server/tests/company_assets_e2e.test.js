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
let acmeCompany;
let globexCompany;

let acmeHrCookie;
let acmeEmp1Cookie;
let acmeEmp2Cookie;
let globexHrCookie;

let acmeEmp1Id;
let acmeEmp2Id;
let acmeInactiveEmpId;

let createdLaptopId;
let createdMonitorId;

function cookieFrom(response) {
  const cookies = response.headers["set-cookie"] || [];
  return cookies.find((val) => val.startsWith(`${getAuthCookieName()}=`));
}

before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongo.getUri();
  await connectCentralDB();
  app = createApp();

  // 1. Create Acme Company
  acmeCompany = await Company.create({
    companyName: "Acme Corp",
    slug: "acme",
    databaseName: "company_acme_assets_test",
    status: COMPANY_STATUSES.ACTIVE,
  });

  // 2. Create Globex Company for tenant isolation testing
  globexCompany = await Company.create({
    companyName: "Globex Corp",
    slug: "globex",
    databaseName: "company_globex_assets_test",
    status: COMPANY_STATUSES.ACTIVE,
  });

  const acmeModels = await getCompanyModels(acmeCompany, { provision: true });
  const globexModels = await getCompanyModels(globexCompany, { provision: true });

  const pwd = await hashPassword("Password123!");

  // Create Acme HR Admin
  await acmeModels.User.create({
    name: "Acme HR Admin",
    email: "hr@acme.com",
    passwordHash: pwd,
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
  });

  // Create Acme Employee 1
  const acmeEmp1User = await acmeModels.User.create({
    name: "Alice Developer",
    email: "alice@acme.com",
    passwordHash: pwd,
    role: USER_ROLES.EMPLOYEE,
    isActive: true,
  });
  const acmeEmp1 = await acmeModels.Employee.create({
    userId: acmeEmp1User._id,
    employeeCode: "ACM-001",
    firstName: "Alice",
    lastName: "Developer",
    fullName: "Alice Developer",
    email: "alice@acme.com",
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: { jobTitle: "Senior Engineer", department: "Engineering" },
  });
  acmeEmp1Id = acmeEmp1._id.toString();

  // Create Acme Employee 2
  const acmeEmp2User = await acmeModels.User.create({
    name: "Bob Designer",
    email: "bob@acme.com",
    passwordHash: pwd,
    role: USER_ROLES.EMPLOYEE,
    isActive: true,
  });
  const acmeEmp2 = await acmeModels.Employee.create({
    userId: acmeEmp2User._id,
    employeeCode: "ACM-002",
    firstName: "Bob",
    lastName: "Designer",
    fullName: "Bob Designer",
    email: "bob@acme.com",
    status: EMPLOYEE_STATUSES.ACTIVE,
    job: { jobTitle: "Product Designer", department: "Design" },
  });
  acmeEmp2Id = acmeEmp2._id.toString();

  // Create Acme Inactive Employee
  const acmeInactiveEmp = await acmeModels.Employee.create({
    employeeCode: "ACM-099",
    firstName: "Ex",
    lastName: "Employee",
    fullName: "Ex Employee",
    email: "ex@acme.com",
    status: EMPLOYEE_STATUSES.INACTIVE,
    job: { jobTitle: "Contractor", department: "Operations" },
  });
  acmeInactiveEmpId = acmeInactiveEmp._id.toString();

  // Create Globex HR Admin
  await globexModels.User.create({
    name: "Globex HR Admin",
    email: "hr@globex.com",
    passwordHash: pwd,
    role: USER_ROLES.HR_ADMIN,
    isActive: true,
  });

  // Perform logins to obtain session cookies
  const acmeHrRes = await request(app)
    .post("/api/auth/login")
    .send({ email: "hr@acme.com", password: "Password123!", companyCode: "acme" });
  assert.equal(acmeHrRes.status, 200);
  acmeHrCookie = cookieFrom(acmeHrRes);

  const acmeEmp1Res = await request(app)
    .post("/api/auth/login")
    .send({ email: "alice@acme.com", password: "Password123!", companyCode: "acme" });
  assert.equal(acmeEmp1Res.status, 200);
  acmeEmp1Cookie = cookieFrom(acmeEmp1Res);

  const acmeEmp2Res = await request(app)
    .post("/api/auth/login")
    .send({ email: "bob@acme.com", password: "Password123!", companyCode: "acme" });
  assert.equal(acmeEmp2Res.status, 200);
  acmeEmp2Cookie = cookieFrom(acmeEmp2Res);

  const globexHrRes = await request(app)
    .post("/api/auth/login")
    .send({ email: "hr@globex.com", password: "Password123!", companyCode: "globex" });
  assert.equal(globexHrRes.status, 200);
  globexHrCookie = cookieFrom(globexHrRes);
});

after(async () => {
  await disconnectAll();
  if (mongo) {
    await mongo.stop();
  }
});

describe("Company Assets Inventory & Assignment Workflow E2E", () => {
  it("1. HR Admin creates a new asset and verifies initial AVAILABLE state", async () => {
    const res = await request(app)
      .post("/api/assets")
      .set("Cookie", acmeHrCookie)
      .send({
        assetTag: "ast-001",
        name: "MacBook Pro 16 M3 Max",
        category: "LAPTOP",
        manufacturer: "Apple",
        modelNumber: "A2991",
        serialNumber: "C02XYZ12345",
        purchaseCost: 249999,
        condition: "NEW",
        location: "HQ - IT Storage",
      });

    assert.equal(res.status, 201);
    assert.ok(res.body.success);
    assert.equal(res.body.asset.assetTag, "AST-001"); // Case-normalized uppercase
    assert.equal(res.body.asset.status, "AVAILABLE");
    assert.equal(res.body.asset.condition, "NEW");
    assert.equal(res.body.asset.currentAssignment, null);
    createdLaptopId = res.body.asset._id;
  });

  it("2. Rejects duplicate asset tag within the same company with 409 Conflict", async () => {
    const res = await request(app)
      .post("/api/assets")
      .set("Cookie", acmeHrCookie)
      .send({
        assetTag: "AST-001", // Duplicate
        name: "MacBook Pro 14",
        category: "LAPTOP",
      });

    assert.equal(res.status, 409);
    assert.ok(res.body.message.includes("already exists"));
  });

  it("3. HR creates a second asset (Monitor) for multi-asset assignment tests", async () => {
    const res = await request(app)
      .post("/api/assets")
      .set("Cookie", acmeHrCookie)
      .send({
        assetTag: "AST-002",
        name: "Dell UltraSharp 27 4K Monitor",
        category: "MONITOR",
        manufacturer: "Dell",
        modelNumber: "U2723QE",
        serialNumber: "CN0XYZ9876",
        condition: "EXCELLENT",
      });

    assert.equal(res.status, 201);
    createdMonitorId = res.body.asset._id;
  });

  it("4. Lists company asset inventory with summary counts and category filtering", async () => {
    const res = await request(app)
      .get("/api/assets")
      .set("Cookie", acmeHrCookie);

    assert.equal(res.status, 200);
    assert.ok(res.body.success);
    assert.equal(res.body.assets.length, 2);
    assert.equal(res.body.summary.total, 2);
    assert.equal(res.body.summary.available, 2);
    assert.equal(res.body.summary.assigned, 0);

    // Test filter
    const filterRes = await request(app)
      .get("/api/assets?category=LAPTOP")
      .set("Cookie", acmeHrCookie);
    assert.equal(filterRes.status, 200);
    assert.equal(filterRes.body.assets.length, 1);
    assert.equal(filterRes.body.assets[0].assetTag, "AST-001");
  });

  it("5. Rejects assignment to an inactive or non-existent employee", async () => {
    // Inactive employee
    const inactiveRes = await request(app)
      .post(`/api/assets/${createdLaptopId}/assign`)
      .set("Cookie", acmeHrCookie)
      .send({
        employeeId: acmeInactiveEmpId,
      });
    assert.equal(inactiveRes.status, 400);
    assert.ok(inactiveRes.body.message.includes("inactive"));

    // Nonexistent employee ID
    const fakeRes = await request(app)
      .post(`/api/assets/${createdLaptopId}/assign`)
      .set("Cookie", acmeHrCookie)
      .send({
        employeeId: "507f1f77bcf86cd799439011",
      });
    assert.equal(fakeRes.status, 404);
  });

  it("6. Assigns available asset to active employee; verifies ASSIGNED status and PENDING acknowledgement", async () => {
    const res = await request(app)
      .post(`/api/assets/${createdLaptopId}/assign`)
      .set("Cookie", acmeHrCookie)
      .send({
        employeeId: acmeEmp1Id,
        assignedDate: "2026-10-01",
        conditionAtAssignment: "NEW",
        notes: "Supplied with 140W USB-C charger and security cable",
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.asset.status, "ASSIGNED");
    assert.equal(res.body.asset.currentAssignment.employeeName, "Alice Developer");
    assert.equal(res.body.asset.currentAssignment.employeeCode, "ACM-001");
    assert.equal(res.body.asset.currentAssignment.acknowledgementStatus, "PENDING");
    assert.equal(res.body.asset.currentAssignment.acknowledgedAt, null);
  });

  it("7. Prevents duplicate active assignment: Cannot assign an already ASSIGNED asset", async () => {
    const res = await request(app)
      .post(`/api/assets/${createdLaptopId}/assign`)
      .set("Cookie", acmeHrCookie)
      .send({
        employeeId: acmeEmp2Id,
      });

    assert.equal(res.status, 400);
    assert.ok(res.body.message.includes("already assigned"));
  });

  it("8. Employee Portal: Alice accesses /api/assets/my-assets and sees only her assigned laptop", async () => {
    const res = await request(app)
      .get("/api/assets/my-assets")
      .set("Cookie", acmeEmp1Cookie);

    assert.equal(res.status, 200);
    assert.ok(res.body.success);
    assert.equal(res.body.assets.length, 1);
    assert.equal(res.body.assets[0].assetTag, "AST-001");
    assert.equal(res.body.assets[0].name, "MacBook Pro 16 M3 Max");
    assert.equal(res.body.assets[0].currentAssignment.acknowledgementStatus, "PENDING");
  });

  it("9. Bob (Employee 2) accesses /api/assets/my-assets and sees 0 assigned assets", async () => {
    const res = await request(app)
      .get("/api/assets/my-assets")
      .set("Cookie", acmeEmp2Cookie);

    assert.equal(res.status, 200);
    assert.equal(res.body.assets.length, 0);
  });

  it("10. Security: Bob cannot acknowledge receipt of Alice's assigned asset (403 Forbidden)", async () => {
    const res = await request(app)
      .post(`/api/assets/my-assets/${createdLaptopId}/acknowledge`)
      .set("Cookie", acmeEmp2Cookie);

    assert.equal(res.status, 403);
    assert.ok(res.body.message.includes("not authorized"));
  });

  it("11. Alice acknowledges receipt of her laptop; status transitions to ACKNOWLEDGED", async () => {
    const res = await request(app)
      .post(`/api/assets/my-assets/${createdLaptopId}/acknowledge`)
      .set("Cookie", acmeEmp1Cookie);

    assert.equal(res.status, 200);
    assert.equal(res.body.asset.currentAssignment.acknowledgementStatus, "ACKNOWLEDGED");
    assert.ok(res.body.asset.currentAssignment.acknowledgedAt);

    // Idempotent retry returns 200
    const retryRes = await request(app)
      .post(`/api/assets/my-assets/${createdLaptopId}/acknowledge`)
      .set("Cookie", acmeEmp1Cookie);
    assert.equal(retryRes.status, 200);
    assert.ok(retryRes.body.message.includes("already been acknowledged"));
  });

  it("12. Role Protection: Regular employee cannot access HR admin asset management endpoints", async () => {
    const createAttempt = await request(app)
      .post("/api/assets")
      .set("Cookie", acmeEmp1Cookie)
      .send({ assetTag: "HACK-01", name: "Rogue Asset" });
    assert.equal(createAttempt.status, 403);

    const returnAttempt = await request(app)
      .post(`/api/assets/${createdLaptopId}/return`)
      .set("Cookie", acmeEmp1Cookie)
      .send({ returnDate: "2026-10-15" });
    assert.equal(returnAttempt.status, 403);

    const deleteAttempt = await request(app)
      .delete(`/api/assets/${createdLaptopId}`)
      .set("Cookie", acmeEmp1Cookie);
    assert.equal(deleteAttempt.status, 403);
  });

  it("13. Prevents deleting an asset with an active assignment", async () => {
    const res = await request(app)
      .delete(`/api/assets/${createdLaptopId}`)
      .set("Cookie", acmeHrCookie);

    assert.equal(res.status, 400);
    assert.ok(res.body.message.includes("active assignment"));
  });

  it("14. HR records asset return; moves active assignment to assignmentHistory and sets AVAILABLE", async () => {
    const res = await request(app)
      .post(`/api/assets/${createdLaptopId}/return`)
      .set("Cookie", acmeHrCookie)
      .send({
        returnDate: "2026-10-20",
        conditionAtReturn: "EXCELLENT",
        returnNotes: "Returned in original box with all accessories intact",
        nextStatus: "AVAILABLE",
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.asset.status, "AVAILABLE");
    assert.equal(res.body.asset.currentAssignment, null);
    assert.equal(res.body.asset.assignmentHistory.length, 1);
    assert.equal(res.body.asset.assignmentHistory[0].employeeName, "Alice Developer");
    assert.equal(res.body.asset.assignmentHistory[0].conditionAtReturn, "EXCELLENT");
  });

  it("15. Reassigns returned laptop to Bob; previous history is preserved intact", async () => {
    const res = await request(app)
      .post(`/api/assets/${createdLaptopId}/assign`)
      .set("Cookie", acmeHrCookie)
      .send({
        employeeId: acmeEmp2Id,
        assignedDate: "2026-10-21",
        conditionAtAssignment: "EXCELLENT",
        notes: "Reissued to Bob",
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.asset.status, "ASSIGNED");
    assert.equal(res.body.asset.currentAssignment.employeeName, "Bob Designer");
    assert.equal(res.body.asset.assignmentHistory.length, 1);
    assert.equal(res.body.asset.assignmentHistory[0].employeeName, "Alice Developer");

    // Alice now sees it in her historical returned equipment log
    const aliceRes = await request(app)
      .get("/api/assets/my-assets")
      .set("Cookie", acmeEmp1Cookie);
    assert.equal(aliceRes.status, 200);
    assert.equal(aliceRes.body.assets.length, 0); // No active assets
    assert.equal(aliceRes.body.history.length, 1); // 1 past asset in history log
    assert.equal(aliceRes.body.history[0].assetTag, "AST-001");
  });

  it("16. Rejects assignment of assets under maintenance, retired, or lost", async () => {
    // Put monitor under maintenance
    await request(app)
      .put(`/api/assets/${createdMonitorId}`)
      .set("Cookie", acmeHrCookie)
      .send({ status: "UNDER_MAINTENANCE" });

    const res = await request(app)
      .post(`/api/assets/${createdMonitorId}/assign`)
      .set("Cookie", acmeHrCookie)
      .send({ employeeId: acmeEmp1Id });

    assert.equal(res.status, 400);
    assert.ok(res.body.message.includes("maintenance"));
  });

  it("17. Enforces Tenant Isolation: Globex HR cannot view or modify Acme assets", async () => {
    // Globex HR attempts to fetch Acme asset inventory
    const listRes = await request(app)
      .get("/api/assets")
      .set("Cookie", globexHrCookie);

    assert.equal(listRes.status, 200);
    assert.equal(listRes.body.assets.length, 0); // Globex has 0 assets

    // Globex HR attempts to view or modify Acme asset by ID
    const getRes = await request(app)
      .get(`/api/assets/${createdLaptopId}`)
      .set("Cookie", globexHrCookie);
    assert.equal(getRes.status, 404);

    const updateRes = await request(app)
      .put(`/api/assets/${createdLaptopId}`)
      .set("Cookie", globexHrCookie)
      .send({ name: "Compromised" });
    assert.equal(updateRes.status, 404);
  });
});
