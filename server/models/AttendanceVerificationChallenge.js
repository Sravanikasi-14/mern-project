import mongoose from "mongoose";

/**
 * Short-lived, single-use server challenges for attendance verification.
 * Binds Wi-Fi / face evidence to a nonce issued by the server (replay protection).
 */
export function createAttendanceVerificationChallengeSchema() {
  const schema = new mongoose.Schema(
    {
      companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
      employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true, index: true },
      userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
      nonce: { type: String, required: true, unique: true },
      purpose: {
        type: String,
        enum: ["PUNCH", "DEVICE_ATTEST", "FACE_ENROLL"],
        default: "PUNCH",
        index: true,
      },
      expiresAt: { type: Date, required: true, index: true },
      consumedAt: { type: Date, default: null, index: true },
      consumedBy: { type: String, default: "", trim: true },
      /** SHA-256 of bound evidence (optional anti-replay of payload). */
      evidenceHash: { type: String, default: null },
    },
    { timestamps: true, collection: "attendance_verification_challenges" }
  );

  schema.index({ employeeId: 1, purpose: 1, consumedAt: 1, expiresAt: 1 });
  return schema;
}

export function getAttendanceVerificationChallengeModel(connection) {
  return (
    connection.models.AttendanceVerificationChallenge ||
    connection.model("AttendanceVerificationChallenge", createAttendanceVerificationChallengeSchema())
  );
}
