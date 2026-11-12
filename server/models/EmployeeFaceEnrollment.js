import mongoose from "mongoose";
import crypto from "crypto";
import { getBiometricEncryptionKeyBytes } from "../utils/biometricKey.js";

export const FACE_ENROLLMENT_STATUSES = Object.freeze({
  ACTIVE: "ACTIVE",
  REVOKED: "REVOKED",
  SUPERSEDED: "SUPERSEDED",
});

/**
 * Tenant-scoped biometric enrollment.
 * Stores encrypted face embeddings only — never raw images or plaintext vectors in API responses.
 */
export function createEmployeeFaceEnrollmentSchema() {
  const schema = new mongoose.Schema(
    {
      companyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Company",
        required: true,
        index: true,
      },
      employeeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Employee",
        required: true,
        index: true,
      },
      status: {
        type: String,
        enum: Object.values(FACE_ENROLLMENT_STATUSES),
        default: FACE_ENROLLMENT_STATUSES.ACTIVE,
        index: true,
      },
      /** AES-GCM ciphertext of Float32 embedding (base64). */
      embeddingCiphertext: { type: String, required: true },
      embeddingIv: { type: String, required: true },
      embeddingAuthTag: { type: String, required: true },
      embeddingDim: { type: Number, required: true },
      modelId: { type: String, default: "face-api-ssd-mobilenetv1-facenet", trim: true },
      modelVersion: { type: String, default: "1", trim: true },
      consentAcceptedAt: { type: Date, required: true },
      consentTextVersion: { type: String, default: "v1", trim: true },
      enrolledAt: { type: Date, default: Date.now },
      enrolledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      revokedAt: { type: Date, default: null },
      revokedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      revokeReason: { type: String, default: "", trim: true },
      qualityScore: { type: Number, default: null },
      /** Non-sensitive metadata for HR status views */
      lastVerifiedAt: { type: Date, default: null },
      verifySuccessCount: { type: Number, default: 0 },
      verifyFailCount: { type: Number, default: 0 },
    },
    {
      timestamps: true,
      collection: "employee_face_enrollments",
    }
  );

  schema.index({ employeeId: 1, status: 1 });
  schema.index({ companyId: 1, employeeId: 1, status: 1 });

  return schema;
}

export function getEmployeeFaceEnrollmentModel(connection) {
  return (
    connection.models.EmployeeFaceEnrollment ||
    connection.model("EmployeeFaceEnrollment", createEmployeeFaceEnrollmentSchema())
  );
}

export function getBiometricEncryptionKey() {
  return getBiometricEncryptionKeyBytes();
}

export function encryptEmbedding(float32Array) {
  const key = getBiometricEncryptionKey();
  const iv = crypto.randomBytes(12);
  const buf = Buffer.from(new Float32Array(float32Array).buffer);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(buf), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    embeddingCiphertext: ciphertext.toString("base64"),
    embeddingIv: iv.toString("base64"),
    embeddingAuthTag: authTag.toString("base64"),
    embeddingDim: float32Array.length,
  };
}

export function decryptEmbedding({ embeddingCiphertext, embeddingIv, embeddingAuthTag, embeddingDim }) {
  const key = getBiometricEncryptionKey();
  const iv = Buffer.from(embeddingIv, "base64");
  const authTag = Buffer.from(embeddingAuthTag, "base64");
  const ciphertext = Buffer.from(embeddingCiphertext, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  const floats = new Float32Array(plain.buffer, plain.byteOffset, embeddingDim || plain.length / 4);
  return Array.from(floats);
}
