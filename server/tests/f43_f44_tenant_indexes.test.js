import assert from "node:assert/strict";
import fs from "node:fs";
import { after, before, beforeEach, describe, it } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  connectCentralDB,
  disconnectAll,
  getCentralDbName,
  getTenantConnection,
} from "../config/db.js";
import Company, { COMPANY_STATUSES } from "../models/Company.js";
import {
  provisionTenantDatabase,
  TENANT_INDEX_SCHEMA_VERSION,
  __setEnsureOfferLetterEmployeeIdIndexForTests,
} from "../services/tenantProvisioningService.js";
import {
  inventoryTenantConnection,
  expectedIndexesFromSchema,
  actualMatchesExpected,
  serializeIndexKey,
  getRequiredIndexModelSpecs,
} from "../services/tenantIndexInventory.js";
import { getEmployeeModel } from "../models/Employee.js";
import { getMessageModel } from "../models/Message.js";
import { getSettlementModel } from "../models/Settlement.js";
import { getConversationModel } from "../models/Conversation.js";

process.env.NODE_ENV = "test";
process.env.CENTRAL_DB_NAME = "platform_f43_f44";
process.env.JWT_SECRET = "f43-f44-tenant-index-test-secret-32ch!";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** @type {import("mongodb-memory-server").MongoMemoryServer} */
let mongo;

before(async () => {
  fs.mkdirSync("D:/tmp/hrms-mongo/f43-f44-indexes", { recursive: true });
  mongo = await MongoMemoryServer.create({
    instance: { dbPath: "D:/tmp/hrms-mongo/f43-f44-indexes" },
  });
  process.env.MONGO_URI = mongo.getUri();
  await connectCentralDB();
});

after(async () => {
  await disconnectAll();
  if (mongo) await mongo.stop();
});

beforeEach(async () => {
  await disconnectAll();
  process.env.MONGO_URI = mongo.getUri();
  process.env.CENTRAL_DB_NAME = "platform_f43_f44";
  await connectCentralDB();
  await Company.deleteMany({});
});

async function createCompany(slug) {
  return Company.create({
    companyName: slug,
    slug,
    databaseName: `company_${slug.replace(/-/g, "_")}`,
    migrationVersion: 0,
    status: COMPANY_STATUSES.ACTIVE,
    schemaVersion: 1,
  });
}

describe("F43/F44 index matcher correctness", () => {
  it("preserves compound key order (does not sort fields)", () => {
    assert.equal(serializeIndexKey({ a: 1, b: 1 }), "a:1|b:1");
    assert.equal(serializeIndexKey({ b: 1, a: 1 }), "b:1|a:1");
    assert.notEqual(serializeIndexKey({ a: 1, b: 1 }), serializeIndexKey({ b: 1, a: 1 }));
  });

  it("rejects incorrect uniqueness, sparse, partial filters, key order, and text weights", () => {
    const expectedUnique = {
      key: { employeeId: 1 },
      unique: true,
      sparse: false,
    };
    assert.equal(
      actualMatchesExpected({ key: { employeeId: 1 }, unique: false, name: "employeeId_1" }, expectedUnique),
      false,
      "non-unique must not satisfy unique expectation"
    );
    assert.equal(
      actualMatchesExpected({ key: { employeeId: 1 }, unique: true, name: "employeeId_1" }, expectedUnique),
      true
    );

    const expectedSparse = { key: { dedupeKey: 1 }, unique: false, sparse: true };
    assert.equal(
      actualMatchesExpected({ key: { dedupeKey: 1 }, sparse: false, name: "dedupeKey_1" }, expectedSparse),
      false,
      "non-sparse must not satisfy sparse expectation"
    );

    const expectedPartial = {
      key: { directKey: 1 },
      unique: true,
      sparse: false,
      partialFilterExpression: { type: "DIRECT", directKey: { $type: "string" } },
    };
    assert.equal(
      actualMatchesExpected(
        { key: { directKey: 1 }, unique: true, name: "directKey_1" },
        expectedPartial
      ),
      false,
      "missing partialFilterExpression must not match"
    );
    assert.equal(
      actualMatchesExpected(
        {
          key: { directKey: 1 },
          unique: true,
          name: "directKey_1",
          partialFilterExpression: { type: "DIRECT", directKey: { $type: "string" } },
        },
        expectedPartial
      ),
      true
    );

    const expectedCompound = { key: { employeeId: 1, date: 1 }, unique: true, sparse: false };
    assert.equal(
      actualMatchesExpected(
        { key: { date: 1, employeeId: 1 }, unique: true, name: "wrong_order" },
        expectedCompound
      ),
      false,
      "reversed compound key order must not match"
    );

    const expectedText = {
      key: { body: "text", "attachments.fileName": "text" },
      text: true,
      name: "message_text_search",
      weights: { body: 5, "attachments.fileName": 5 },
      unique: false,
      sparse: false,
    };
    assert.equal(
      actualMatchesExpected(
        {
          key: { _fts: "text", _ftsx: 1 },
          name: "message_text_search",
          textIndexVersion: 3,
          weights: { body: 1, "attachments.fileName": 1 },
        },
        expectedText
      ),
      false,
      "wrong text weights must not match"
    );
    assert.equal(
      actualMatchesExpected(
        {
          key: { _fts: "text", _ftsx: 1 },
          name: "other_text",
          textIndexVersion: 3,
          weights: { body: 5, "attachments.fileName": 5 },
        },
        expectedText
      ),
      false,
      "wrong text index name must not match"
    );
    assert.equal(
      actualMatchesExpected(
        {
          key: { _fts: "text", _ftsx: 1 },
          name: "message_text_search",
          textIndexVersion: 3,
          weights: { body: 5, "attachments.fileName": 5 },
        },
        expectedText
      ),
      true
    );
  });

  it("includes all getCompanyModels tenant models with schema indexes", async () => {
    const specs = await getRequiredIndexModelSpecs();
    const ids = new Set(specs.map((s) => s.id));
    for (const required of [
      "employees",
      "settlements",
      "messages",
      "conversations",
      "conversationMembers",
      "remote_work_requests",
      "location_exceptions",
      "announcements",
      "announcementReads",
      "chat_files",
      "designations",
      "authTokens",
      "audit_logs",
      "employee_compensation",
    ]) {
      assert.ok(ids.has(required), `missing inventory model ${required}`);
    }
  });
});

describe("F43/F44 tenant index provision + inventory", () => {
  it("source contracts: additive createIndexes only; no OfferLetter.syncIndexes; Vercel still skips auto-provision", () => {
    const provisioner = readFileSync(
      join(root, "services/tenantProvisioningService.js"),
      "utf8"
    );
    const apiIndex = readFileSync(join(root, "api/index.js"), "utf8");
    const inventoryScript = readFileSync(
      join(root, "scripts/inventoryTenantIndexes.js"),
      "utf8"
    );

    assert.match(provisioner, /getEmployeeModel/);
    assert.match(provisioner, /getRemoteWorkRequestModel/);
    assert.match(provisioner, /getAnnouncementReadModel/);
    assert.match(provisioner, /indexFailures\.length === 0/);
    assert.match(provisioner, /TENANT_INDEX_SCHEMA_VERSION/);

    const provisionerCode = provisioner
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(provisionerCode, /\.syncIndexes\s*\(/);
    assert.doesNotMatch(provisionerCode, /\.dropIndex\s*\(/);
    assert.doesNotMatch(provisionerCode, /\.dropIndexes\s*\(/);

    assert.match(apiIndex, /VERCEL !== "1"/);
    assert.match(apiIndex, /Never run expensive tenant provisioning automatically on Vercel/);

    const inventoryCode = inventoryScript
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    assert.match(inventoryScript, /Read-only/);
    assert.doesNotMatch(inventoryCode, /\.createIndexes\s*\(/);
    assert.doesNotMatch(inventoryCode, /provisionTenantDatabase/);
  });

  it("provisions F44 model indexes, verifies, stamps schema version, and is idempotent", async () => {
    const company = await createCompany("idx-co");
    const connection = await getTenantConnection(company.databaseName);

    const outcome1 = await provisionTenantDatabase(company, connection);
    assert.equal(outcome1.indexFailures.length, 0, JSON.stringify(outcome1.indexFailures));
    assert.equal(outcome1.indexesFullyApplied, true);
    assert.equal(outcome1.fullyProvisioned, true);
    assert.equal(outcome1.tenantIndexSchemaVersionStamped, TENANT_INDEX_SCHEMA_VERSION);
    assert.ok(outcome1.indexesCreated.some((s) => String(s).includes("employees")));
    assert.ok(outcome1.indexesCreated.some((s) => String(s).includes("remote_work")));

    const stamped = await Company.findById(company._id).lean();
    assert.equal(stamped.tenantIndexSchemaVersion, TENANT_INDEX_SCHEMA_VERSION);
    assert.ok(stamped.tenantIndexProvisionedAt);

    const Message = getMessageModel(connection);
    const messageIndexes = await Message.collection.indexes();
    assert.ok(
      messageIndexes.some(
        (idx) =>
          idx.name === "message_text_search" ||
          idx.textIndexVersion != null ||
          Object.prototype.hasOwnProperty.call(idx.key || {}, "_fts")
      )
    );

    const Conversation = getConversationModel(connection);
    const expected = expectedIndexesFromSchema(Conversation.schema);
    const partial = expected.find((e) => e.partialFilterExpression);
    assert.ok(partial, "Conversation schema declares partial index");
    const actual = await Conversation.collection.indexes();
    assert.ok(actual.some((a) => actualMatchesExpected(a, partial)));

    const inventory = await inventoryTenantConnection(connection);
    assert.equal(inventory.ok, true, JSON.stringify(inventory.models.filter((m) => !m.ok)));

    const outcome2 = await provisionTenantDatabase(company, connection);
    assert.equal(outcome2.indexFailures.length, 0, JSON.stringify(outcome2.indexFailures));
    assert.equal(outcome2.tenantIndexSchemaVersionStamped, TENANT_INDEX_SCHEMA_VERSION);
  });

  it("does not stamp when createIndexes fails and indexFailures is non-empty", async () => {
    const company = await createCompany("fail-stamp-co");
    const connection = await getTenantConnection(company.databaseName);

    const baseline = await provisionTenantDatabase(company, connection);
    assert.equal(baseline.fullyProvisioned, true);

    await Company.updateOne(
      { _id: company._id },
      { $unset: { tenantIndexSchemaVersion: 1, tenantIndexProvisionedAt: 1 } }
    );

    const Employee = getEmployeeModel(connection);
    const existing = await Employee.collection.indexes();
    for (const idx of existing) {
      if (idx.name && idx.name !== "_id_") {
        await Employee.collection.dropIndex(idx.name);
      }
    }

    const original = Employee.createIndexes;
    let calls = 0;
    Employee.createIndexes = async function simulatedFail() {
      calls += 1;
      throw new Error("simulated employee index failure");
    };

    try {
      const outcome = await provisionTenantDatabase(company, connection);
      assert.ok(calls >= 1);
      assert.ok(outcome.indexFailures.length >= 1);
      assert.equal(outcome.indexesFullyApplied, false);
      assert.equal(outcome.fullyProvisioned, false);
      assert.equal(outcome.tenantIndexSchemaVersionStamped, null);
      const stamped = await Company.findById(company._id).lean();
      assert.equal(stamped.tenantIndexSchemaVersion ?? null, null);
    } finally {
      Employee.createIndexes = original;
    }
  });

  it("does not stamp when offerLetterEmployeeIdIndex throws (treated as failure)", async () => {
    const company = await createCompany("offer-throw-co");
    const connection = await getTenantConnection(company.databaseName);

    __setEnsureOfferLetterEmployeeIdIndexForTests(async () => {
      throw new Error("simulated offer employeeId index exception");
    });

    try {
      const outcome = await provisionTenantDatabase(company, connection);
      assert.ok(
        outcome.indexFailures.some((f) =>
          String(f.message).includes("simulated offer employeeId index exception")
        ),
        JSON.stringify(outcome.indexFailures)
      );
      assert.equal(outcome.offerLetterEmployeeIdIndex, undefined);
      assert.equal(outcome.indexesFullyApplied, false);
      assert.equal(outcome.fullyProvisioned, false);
      assert.equal(outcome.tenantIndexSchemaVersionStamped, null);
      const stamped = await Company.findById(company._id).lean();
      assert.equal(stamped.tenantIndexSchemaVersion ?? null, null);
    } finally {
      __setEnsureOfferLetterEmployeeIdIndexForTests(null);
    }
  });

  it("does not stamp when offerLetterEmployeeIdIndex result is missing", async () => {
    const company = await createCompany("offer-missing-co");
    const connection = await getTenantConnection(company.databaseName);

    __setEnsureOfferLetterEmployeeIdIndexForTests(async () => undefined);

    try {
      const outcome = await provisionTenantDatabase(company, connection);
      assert.equal(outcome.offerLetterEmployeeIdIndex, undefined);
      assert.ok(
        outcome.indexFailures.some((f) =>
          String(f.message).includes("offerLetterEmployeeIdIndex result missing")
        ),
        JSON.stringify(outcome.indexFailures)
      );
      assert.equal(outcome.fullyProvisioned, false);
      assert.equal(outcome.tenantIndexSchemaVersionStamped, null);
    } finally {
      __setEnsureOfferLetterEmployeeIdIndexForTests(null);
    }
  });

  it("rejects provisioning the central platform database", async () => {
    const central = getCentralDbName();
    await assert.rejects(
      () => provisionTenantDatabase({ slug: "platform", databaseName: central }),
      /Production safety check failed/i
    );
  });

  it("matches live message text index after provision", async () => {
    const company = await createCompany("matcher-co");
    const connection = await getTenantConnection(company.databaseName);
    const outcome = await provisionTenantDatabase(company, connection);
    assert.equal(outcome.fullyProvisioned, true, JSON.stringify(outcome.indexFailures));

    const Message = getMessageModel(connection);
    const expected = expectedIndexesFromSchema(Message.schema);
    const textExpected = expected.find((e) => e.text || e.name === "message_text_search");
    assert.ok(textExpected, "message schema defines text index");
    assert.ok(textExpected.weights);

    const actual = await Message.collection.indexes();
    assert.ok(
      actual.some((a) => actualMatchesExpected(a, textExpected)),
      "actual Mongo text index matches expected schema text index"
    );
  });
});
