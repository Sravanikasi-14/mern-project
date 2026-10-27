import mongoose from "mongoose";

export const USER_ROLES = Object.freeze({
  HR_ADMIN: "HR_ADMIN",
  EMPLOYEE: "EMPLOYEE",
  CANDIDATE: "CANDIDATE",
});

export const ONBOARDING_STATUSES = Object.freeze({
  PENDING: "PENDING",
  IN_PROGRESS: "IN_PROGRESS",
  DRAFT: "DRAFT",
  SUBMITTED: "SUBMITTED",
  CHANGES_REQUESTED: "CHANGES_REQUESTED",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
});

export const ONBOARDING_DOCUMENT_TYPES = Object.freeze({
  ID_PROOF: "ID_PROOF",
  ADDRESS_PROOF: "ADDRESS_PROOF",
  RESUME: "RESUME",
  EDUCATION_CERTIFICATE: "EDUCATION_CERTIFICATE",
  PREVIOUS_RELIEVING: "PREVIOUS_RELIEVING",
  OTHER: "OTHER",
});

export const UserOnboardingSchema = new mongoose.Schema(
  {
    offerLetterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "OfferLetter",
      default: null,
    },
    status: {
      type: String,
      enum: Object.values(ONBOARDING_STATUSES),
      default: ONBOARDING_STATUSES.DRAFT,
    },
    onboardingTokenHash: {
      type: String,
      default: null,
    },
    tokenExpiresAt: {
      type: Date,
      default: null,
    },
    candidate: {
      fullName: { type: String, trim: true, default: "" },
      email: { type: String, trim: true, lowercase: true, default: "" },
      phoneNumber: { type: String, trim: true, default: "" },
    },
    personalDetails: {
      fullName: { type: String, trim: true, default: "" },
      preferredName: { type: String, trim: true, default: "" },
      email: { type: String, trim: true, lowercase: true, default: "" },
      phoneNumber: { type: String, trim: true, default: "" },
      personalPhone: { type: String, trim: true, default: "" },
      dateOfBirth: { type: Date, default: null },
      gender: { type: String, trim: true, default: "" },
      city: { type: String, trim: true, default: "" },
    },
    residentialAddress: {
      street: { type: String, trim: true, default: "" },
      city: { type: String, trim: true, default: "" },
      state: { type: String, trim: true, default: "" },
      postalCode: { type: String, trim: true, default: "" },
      country: { type: String, trim: true, default: "India" },
    },
    emergencyContact: {
      name: { type: String, trim: true, default: "" },
      relationship: { type: String, trim: true, default: "" },
      phone: { type: String, trim: true, default: "" },
    },
    bankDetails: {
      accountHolderName: { type: String, trim: true, default: "" },
      bankName: { type: String, trim: true, default: "" },
      accountNumber: { type: String, trim: true, default: "" },
      ifscCode: { type: String, trim: true, default: "" },
      accountType: { type: String, trim: true, default: "Salary Account" },
    },
    taxDetails: {
      panNumber: { type: String, trim: true, default: "" },
      taxRegime: { type: String, trim: true, default: "New Tax Regime (Sec 115BAC)" },
    },
    identityDetails: {
      idType: { type: String, trim: true, default: "PAN / Aadhaar" },
      idNumber: { type: String, trim: true, default: "" },
    },
    documents: {
      type: [
        {
          _id: {
            type: mongoose.Schema.Types.ObjectId,
            default: () => new mongoose.Types.ObjectId(),
          },
          documentType: {
            type: String,
            enum: Object.values(ONBOARDING_DOCUMENT_TYPES),
            required: true,
          },
          title: { type: String, required: true },
          fileName: { type: String, required: true },
          fileSize: { type: Number, default: 0 },
          mimeType: { type: String, default: "application/octet-stream" },
          storageKey: { type: String, required: true },
          uploadedAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
    correctionReason: {
      type: String,
      trim: true,
      default: "",
    },
    rejectionReason: {
      type: String,
      trim: true,
      default: "",
    },
    reviewNotes: {
      type: String,
      trim: true,
      default: "",
    },
    submittedAt: {
      type: Date,
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    approvedAt: {
      type: Date,
      default: null,
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    rejectedAt: {
      type: Date,
      default: null,
    },
    rejectedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      default: null,
    },
    history: {
      type: [
        {
          action: { type: String, required: true },
          timestamp: { type: Date, default: Date.now },
          actorRole: { type: String, default: "SYSTEM" },
          notes: { type: String, default: "" },
        },
      ],
      default: [],
    },
  },
  { _id: false }
);

export function createUserSchema() {
  const userSchema = new mongoose.Schema(
    {
      email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true,
      },
      passwordHash: {
        type: String,
        required: function () {
          return this.role !== USER_ROLES.CANDIDATE;
        },
        select: false,
      },
      role: {
        type: String,
        enum: Object.values(USER_ROLES),
        required: true,
      },
      isActive: { type: Boolean, required: true, default: true },
      employeeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Employee",
        default: null,
        index: true,
      },
      onboarding: {
        type: UserOnboardingSchema,
        default: null,
      },
      fullName: { type: String, trim: true, default: "" },
      phoneNumber: { type: String, trim: true, default: "" },
      preferences: {
        emailNotifications: { type: Boolean, default: true },
        weeklyDigest: { type: Boolean, default: true },
        compactView: { type: Boolean, default: false },
      },
      lastLoginAt: { type: Date, default: null },
      schemaVersion: { type: Number, default: 1 },
    },
    {
      timestamps: true,
      collection: "users",
    }
  );

  userSchema.index({ role: 1 });
  userSchema.index({ "onboarding.status": 1 });
  userSchema.index({ "onboarding.offerLetterId": 1 });
  userSchema.index({ "onboarding.employeeId": 1 });

  userSchema.set("toJSON", {
    transform(_doc, ret) {
      delete ret.passwordHash;
      if (ret.onboarding) {
        delete ret.onboarding.onboardingTokenHash;
      }
      delete ret.__v;
      return ret;
    },
  });

  return userSchema;
}

export function getUserModel(connection) {
  return connection.models.User || connection.model("User", createUserSchema());
}

export function serializeUser(user) {
  if (!user) {
    return null;
  }

  const json = typeof user.toJSON === "function" ? user.toJSON() : { ...user };
  delete json.passwordHash;
  if (json.onboarding) {
    delete json.onboarding.onboardingTokenHash;
  }
  return json;
}

