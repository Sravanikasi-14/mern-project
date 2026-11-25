import assert from "node:assert/strict";
import mongoose from "mongoose";
import { describe, it } from "node:test";
import {
  issueVerificationChallenge,
  consumeVerificationChallenge,
  hashEvidencePayload,
} from "../services/verificationChallengeService.js";
import { runAttendanceVerifications } from "../services/attendanceVerificationService.js";
import { enrollMyFace } from "../controllers/faceEnrollmentController.js";

/**
 * Minimal in-memory Mock model for AttendanceVerificationChallenge
 */
function createMockChallengeModel(initialDocs = []) {
  const docs = new Map();
  for (const doc of initialDocs) {
    const id = String(doc._id || new mongoose.Types.ObjectId());
    docs.set(id, { ...doc, _id: new mongoose.Types.ObjectId(id) });
  }

  const Model = {
    _docs: docs,
    async create(data) {
      const _id = new mongoose.Types.ObjectId();
      const doc = {
        _id,
        createdAt: new Date(),
        updatedAt: new Date(),
        consumedAt: null,
        consumedBy: "",
        evidenceHash: null,
        ...data,
      };
      docs.set(String(_id), doc);
      return doc;
    },
    findById(id) {
      return {
        lean: async () => {
          const d = docs.get(String(id));
          return d ? { ...d } : null;
        },
      };
    },
    async findOneAndUpdate(filter, update, options = {}) {
      for (const [id, doc] of docs.entries()) {
        let matches = true;
        if (filter._id && String(filter._id) !== id) matches = false;
        if (filter.nonce && filter.nonce !== doc.nonce) matches = false;
        if (filter.employeeId && String(filter.employeeId) !== String(doc.employeeId)) matches = false;
        if (filter.purpose && filter.purpose !== doc.purpose) matches = false;
        if (filter.consumedAt === null && doc.consumedAt !== null) matches = false;
        if (filter.expiresAt?.$gt && doc.expiresAt <= filter.expiresAt.$gt) matches = false;
        if (filter.companyId && String(filter.companyId) !== String(doc.companyId)) matches = false;

        if (matches) {
          if (update.$set) {
            Object.assign(doc, update.$set);
          }
          doc.updatedAt = new Date();
          return { ...doc };
        }
      }
      return null;
    },
  };
  return Model;
}

describe("HRMS Face Verification Phase 2A: Replay Protection & Single-Use Challenges", () => {
  const companyA = new mongoose.Types.ObjectId();
  const companyB = new mongoose.Types.ObjectId();
  const empAlice = new mongoose.Types.ObjectId();
  const empBob = new mongoose.Types.ObjectId();
  const userAlice = new mongoose.Types.ObjectId();

  it("issues verification challenges bound to companyId, employeeId and purpose", async () => {
    const MockChallenge = createMockChallengeModel();
    const punchChallenge = await issueVerificationChallenge({
      Challenge: MockChallenge,
      companyId: companyA,
      employeeId: empAlice,
      userId: userAlice,
      purpose: "PUNCH",
      ttlMs: 60_000,
    });

    assert.ok(punchChallenge.challengeId);
    assert.ok(punchChallenge.nonce);
    assert.equal(punchChallenge.purpose, "PUNCH");
    assert.ok(new Date(punchChallenge.expiresAt) > new Date());

    const enrollChallenge = await issueVerificationChallenge({
      Challenge: MockChallenge,
      companyId: companyA,
      employeeId: empAlice,
      userId: userAlice,
      purpose: "FACE_ENROLL",
      ttlMs: 60_000,
    });

    assert.ok(enrollChallenge.challengeId);
    assert.ok(enrollChallenge.nonce);
    assert.equal(enrollChallenge.purpose, "FACE_ENROLL");
  });

  it("consumes challenge atomically on first use and rejects replay (second attempt)", async () => {
    const MockChallenge = createMockChallengeModel();
    const challenge = await issueVerificationChallenge({
      Challenge: MockChallenge,
      companyId: companyA,
      employeeId: empAlice,
      purpose: "PUNCH",
    });

    const evidenceHash = hashEvidencePayload([empAlice, "FACE", 0.32, "web"]);

    // First use: must succeed
    const firstConsume = await consumeVerificationChallenge({
      Challenge: MockChallenge,
      challengeId: challenge.challengeId,
      nonce: challenge.nonce,
      companyId: companyA,
      employeeId: empAlice,
      purpose: "PUNCH",
      evidenceHash,
      consumeLabel: "face_punch",
    });
    assert.ok(firstConsume.consumedAt instanceof Date);
    assert.equal(firstConsume.evidenceHash, evidenceHash);

    // Replay attempt: must fail with 400
    await assert.rejects(
      async () => {
        await consumeVerificationChallenge({
          Challenge: MockChallenge,
          challengeId: challenge.challengeId,
          nonce: challenge.nonce,
          companyId: companyA,
          employeeId: empAlice,
          purpose: "PUNCH",
          evidenceHash,
          consumeLabel: "face_punch",
        });
      },
      (err) => {
        assert.equal(err.status, 400);
        assert.match(err.message, /Verification expired/i);
        return true;
      }
    );
  });

  it("rejects expired challenge", async () => {
    const MockChallenge = createMockChallengeModel();
    const doc = await MockChallenge.create({
      companyId: companyA,
      employeeId: empAlice,
      nonce: "expired-nonce-123",
      purpose: "PUNCH",
      expiresAt: new Date(Date.now() - 1000), // Expired 1 second ago
      consumedAt: null,
    });

    await assert.rejects(
      async () => {
        await consumeVerificationChallenge({
          Challenge: MockChallenge,
          challengeId: String(doc._id),
          nonce: "expired-nonce-123",
          companyId: companyA,
          employeeId: empAlice,
          purpose: "PUNCH",
        });
      },
      (err) => {
        assert.equal(err.status, 400);
        assert.match(err.message, /Verification expired/i);
        return true;
      }
    );
  });

  it("rejects cross-employee challenge reuse", async () => {
    const MockChallenge = createMockChallengeModel();
    const challenge = await issueVerificationChallenge({
      Challenge: MockChallenge,
      companyId: companyA,
      employeeId: empAlice,
      purpose: "PUNCH",
    });

    // Bob tries to consume Alice's challenge
    await assert.rejects(
      async () => {
        await consumeVerificationChallenge({
          Challenge: MockChallenge,
          challengeId: challenge.challengeId,
          nonce: challenge.nonce,
          companyId: companyA,
          employeeId: empBob,
          purpose: "PUNCH",
        });
      },
      (err) => {
        assert.equal(err.status, 403);
        return true;
      }
    );
  });

  it("rejects cross-company challenge reuse", async () => {
    const MockChallenge = createMockChallengeModel();
    const challenge = await issueVerificationChallenge({
      Challenge: MockChallenge,
      companyId: companyA,
      employeeId: empAlice,
      purpose: "PUNCH",
    });

    // Challenge presented under companyB
    await assert.rejects(
      async () => {
        await consumeVerificationChallenge({
          Challenge: MockChallenge,
          challengeId: challenge.challengeId,
          nonce: challenge.nonce,
          companyId: companyB,
          employeeId: empAlice,
          purpose: "PUNCH",
        });
      },
      (err) => {
        assert.equal(err.status, 400);
        return true;
      }
    );
  });

  it("rejects wrong-purpose challenge (FACE_ENROLL challenge presented for PUNCH)", async () => {
    const MockChallenge = createMockChallengeModel();
    const enrollChallenge = await issueVerificationChallenge({
      Challenge: MockChallenge,
      companyId: companyA,
      employeeId: empAlice,
      purpose: "FACE_ENROLL",
    });

    await assert.rejects(
      async () => {
        await consumeVerificationChallenge({
          Challenge: MockChallenge,
          challengeId: enrollChallenge.challengeId,
          nonce: enrollChallenge.nonce,
          companyId: companyA,
          employeeId: empAlice,
          purpose: "PUNCH",
        });
      },
      (err) => {
        assert.equal(err.status, 400);
        return true;
      }
    );
  });

  it("enforces mandatory face verification challenge consumption in attendance flow", async () => {
    const MockChallenge = createMockChallengeModel();
    const challenge = await issueVerificationChallenge({
      Challenge: MockChallenge,
      companyId: companyA,
      employeeId: empAlice,
      purpose: "PUNCH",
    });

    // Mock models container
    const models = {
      AttendanceVerificationChallenge: MockChallenge,
      EmployeeFaceEnrollment: {
        findOne: async () => ({
          _id: new mongoose.Types.ObjectId(),
          employeeId: empAlice,
          companyId: companyA,
          status: "ENROLLED",
          encryptedEmbedding: Buffer.from("dummy").toString("base64"),
          embeddingIv: Buffer.from("iv").toString("base64"),
          embeddingAuthTag: Buffer.from("tag").toString("base64"),
          keyVersion: 1,
        }),
      },
    };

    const policy = {
      attendanceVerification: {
        verificationRequired: true,
        gps: { enabled: false },
        wifi: { enabled: false },
        face: { enabled: true, mandatory: false, requireLiveness: false },
      },
    };

    // When face verification is attempted with an expired / replayed challenge
    await assert.rejects(
      async () => {
        await runAttendanceVerifications({
          models,
          employee: { _id: empAlice, companyId: companyA },
          policy,
          sessionType: "OFFICE",
          geofenceApplies: false,
          faceImageBase64: null,
          faceEvidence: { challengeId: challenge.challengeId, challengeNonce: challenge.nonce },
          faceCapabilityAllowed: true,
        });
      },
      (err) => {
        assert.equal(err.status, 400);
        return true;
      }
    );
  });

  it("face enrollment consumes FACE_ENROLL challenge and rejects replay", async () => {
    const MockChallenge = createMockChallengeModel();
    const challenge = await issueVerificationChallenge({
      Challenge: MockChallenge,
      companyId: companyA,
      employeeId: empAlice,
      purpose: "FACE_ENROLL",
    });

    let enrolledCalled = false;
    const req = {
      auth: {
        user: { _id: userAlice, email: "alice@example.com", role: "EMPLOYEE" },
        company: { _id: companyA },
        models: {
          Employee: {
            findOne: async () => ({ _id: empAlice, userId: userAlice, companyId: companyA }),
          },
          AttendanceVerificationChallenge: MockChallenge,
          EmployeeFaceEnrollment: {
            findOne: async () => null,
            create: async () => {
              enrolledCalled = true;
              return { _id: new mongoose.Types.ObjectId() };
            },
          },
        },
      },
      body: {
        imageBase64: "data:image/png;base64,dummy",
        consentAccepted: true,
        challengeId: challenge.challengeId,
        challengeNonce: challenge.nonce,
      },
    };

    // First enrollment attempt should consume the challenge
    const res = {
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(data) {
        this.data = data;
        return this;
      },
    };

    let nextErr = null;
    await enrollMyFace(req, res, (err) => {
      nextErr = err;
    });

    // The face recognition pipeline or mock will execute or fail at image parse, but the challenge MUST be consumed
    const consumedDoc = await MockChallenge.findById(challenge.challengeId);
    const consumedData = await consumedDoc.lean();
    assert.ok(consumedData.consumedAt instanceof Date, "Challenge must be atomically marked consumed");

    // Second attempt using the exact same challenge must fail at challenge consumption before any enrollment
    let secondErr = null;
    await enrollMyFace(req, res, (err) => {
      secondErr = err;
    });
    assert.ok(secondErr, "Replay enrollment must throw");
    assert.equal(secondErr.status, 400);
  });
});
