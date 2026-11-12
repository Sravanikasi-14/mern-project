import crypto from "node:crypto";
import mongoose from "mongoose";
import { HttpError } from "../utils/httpError.js";

const DEFAULT_TTL_MS = 2 * 60 * 1000;

export function hashEvidencePayload(parts) {
  const h = crypto.createHash("sha256");
  for (const part of parts) {
    h.update(String(part ?? ""));
    h.update("|");
  }
  return h.digest("hex");
}

export async function issueVerificationChallenge({
  Challenge,
  companyId,
  employeeId,
  userId = null,
  purpose = "PUNCH",
  ttlMs = DEFAULT_TTL_MS,
}) {
  if (!Challenge) throw new HttpError(500, "Verification challenge store is unavailable.");
  const nonce = crypto.randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + Math.max(30_000, Math.min(ttlMs, 5 * 60 * 1000)));
  const doc = await Challenge.create({
    companyId,
    employeeId,
    userId,
    nonce,
    purpose,
    expiresAt,
  });
  return {
    challengeId: String(doc._id),
    nonce: doc.nonce,
    purpose: doc.purpose,
    expiresAt: doc.expiresAt.toISOString(),
  };
}

/**
 * Atomically consume a challenge. Rejects missing, expired, wrong purpose, or already used.
 */
export async function consumeVerificationChallenge({
  Challenge,
  challengeId,
  nonce,
  companyId,
  employeeId,
  purpose = "PUNCH",
  evidenceHash = null,
  consumeLabel = "punch",
}) {
  if (!Challenge) throw new HttpError(500, "Verification challenge store is unavailable.");
  if (!challengeId || !nonce) {
    throw new HttpError(400, "Verification expired. Please try again.");
  }
  if (!mongoose.isValidObjectId(String(challengeId))) {
    throw new HttpError(400, "Verification expired. Please try again.");
  }

  const now = new Date();
  const filter = {
    _id: challengeId,
    nonce: String(nonce),
    employeeId,
    purpose,
    consumedAt: null,
    expiresAt: { $gt: now },
  };
  if (companyId) filter.companyId = companyId;

  const updated = await Challenge.findOneAndUpdate(
    filter,
    {
      $set: {
        consumedAt: now,
        consumedBy: String(consumeLabel).slice(0, 80),
        ...(evidenceHash ? { evidenceHash } : {}),
      },
    },
    { new: true }
  );

  if (!updated) {
    const existing = await Challenge.findById(challengeId).lean();
    if (!existing) throw new HttpError(400, "Verification expired. Please try again.");
    if (existing.consumedAt) throw new HttpError(400, "Verification expired. Please try again.");
    if (existing.expiresAt && new Date(existing.expiresAt) <= now) {
      throw new HttpError(400, "Verification expired. Please try again.");
    }
    if (String(existing.employeeId) !== String(employeeId)) {
      throw new HttpError(403, "Verification expired. Please try again.");
    }
    if (existing.purpose !== purpose) {
      throw new HttpError(400, "Verification expired. Please try again.");
    }
    if (existing.nonce !== String(nonce)) {
      throw new HttpError(400, "Verification expired. Please try again.");
    }
    throw new HttpError(400, "Verification expired. Please try again.");
  }

  return updated;
}
