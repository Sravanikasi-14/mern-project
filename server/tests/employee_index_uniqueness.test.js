process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "employee-index-uniqueness-test-secret-32ch!";
process.env.CENTRAL_DB_NAME = "platform_employee_index_uniq";
process.env.CLIENT_URL = "http://localhost:5173";
process.env.BCRYPT_ROUNDS = "4";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import {
  connectCentralDB,
  disconnectAll,
  getCompanyModels,
} from "../config/db.js";
import Company, { COMPANY_STATUSES } from "../models/Company.js";
import { EMPLOYEE_STATUSES } from "../models/Employee.js";
import { USER_ROLES } from "../models/User.js";
import { hashPassword } from "../utils/password.js";

describe("Employee email/userId index uniqueness (schema)", () => {
  let mongo;
  let models;

  before(async () => {
    mongo = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongo.getUri();
    await connectCentralDB();
    const company = await Company.create({
      companyName: "Idx Co",
      slug: `idx-emp-${Date.now()}`,
      databaseName: `company_idx_emp_${Date.now()}`,
      status: COMPANY_STATUSES.ACTIVE,
    });
    models = await getCompanyModels(company, { provision: true });
  });

  after(async () => {
    await disconnectAll();
    if (mongo) await mongo.stop();
  });

  it("rejects duplicate email", async () => {
    await models.Employee.create({
      employeeCode: "E1",
      fullName: "One",
      email: "dup@idx.test",
      status: EMPLOYEE_STATUSES.ACTIVE,
    });
    await assert.rejects(
      () =>
        models.Employee.create({
          employeeCode: "E2",
          fullName: "Two",
          email: "dup@idx.test",
          status: EMPLOYEE_STATUSES.ACTIVE,
        }),
      (err) => err?.code === 11000
    );
  });

  it("allows multiple unlinked employees (missing/null userId)", async () => {
    const a = await models.Employee.create({
      employeeCode: "U1",
      fullName: "Unlinked A",
      email: "unlinked-a@idx.test",
      status: EMPLOYEE_STATUSES.ACTIVE,
    });
    const b = await models.Employee.create({
      employeeCode: "U2",
      fullName: "Unlinked B",
      email: "unlinked-b@idx.test",
      userId: null,
      status: EMPLOYEE_STATUSES.ACTIVE,
    });
    assert.ok(a._id);
    assert.ok(b._id);
  });

  it("rejects duplicate linked ObjectId userId; allows user-to-employee link", async () => {
    const passwordHash = await hashPassword("IdxPass123!");
    const user = await models.User.create({
      email: "linked@idx.test",
      passwordHash,
      role: USER_ROLES.EMPLOYEE,
      fullName: "Linked",
      isActive: true,
    });
    const emp = await models.Employee.create({
      employeeCode: "L1",
      fullName: "Linked Emp",
      email: "linked@idx.test",
      userId: user._id,
      status: EMPLOYEE_STATUSES.ACTIVE,
    });
    user.employeeId = emp._id;
    await user.save();

    await assert.rejects(
      () =>
        models.Employee.create({
          employeeCode: "L2",
          fullName: "Linked Dup",
          email: "linked-dup@idx.test",
          userId: user._id,
          status: EMPLOYEE_STATUSES.ACTIVE,
        }),
      (err) => err?.code === 11000
    );

    const refreshed = await models.Employee.findById(emp._id);
    refreshed.fullName = "Linked Emp Updated";
    await refreshed.save();
    assert.equal(refreshed.fullName, "Linked Emp Updated");
    assert.equal(String(refreshed.userId), String(user._id));
  });

  it("declares unique email and partial unique userId indexes", async () => {
    const indexes = await models.Employee.collection.indexes();
    const email = indexes.find((i) => i.name === "email_1");
    const userId = indexes.find((i) => i.name === "userId_1");
    assert.equal(email?.unique, true);
    assert.equal(userId?.unique, true);
    assert.deepEqual(userId?.partialFilterExpression, {
      userId: { $type: "objectId" },
    });
  });
});
