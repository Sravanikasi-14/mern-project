import mongoose from "mongoose";

export const USER_ROLES = Object.freeze({
  COMPANY_ADMIN: "COMPANY_ADMIN",
  HR_ADMIN: "HR_ADMIN",
  EMPLOYEE: "EMPLOYEE",
  CANDIDATE: "CANDIDATE",
});

/** Company Admin and HR Admin share the company HR portal. Permission limits apply only to HR Admin. */
export function isHrPortalOperator(role) {
  return role === USER_ROLES.HR_ADMIN || role === USER_ROLES.COMPANY_ADMIN;
}

export const ONBOARDING_STATUSES = Object.freeze({
  PENDING: "PENDING",
  IN_PROGRESS: "IN_PROGRESS",
  DRAFT: "DRAFT",
  SUBMITTED: "SUBMITTED",
  CHANGES_REQUESTED: "CHANGES_REQUESTED",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  PROCESSING_APPROVAL: "PROCESSING_APPROVAL",
  ACCOUNT_SETUP_SENT: "ACCOUNT_SETUP_SENT",
  ACCOUNT_SETUP_PENDING: "ACCOUNT_SETUP_PENDING",
  ACTIVATED: "ACTIVATED",
});

/** Statuses after final HR approval where the candidate can no longer edit onboarding data. */
export const ONBOARDING_FROZEN_STATUSES = Object.freeze([
  ONBOARDING_STATUSES.PROCESSING_APPROVAL,
  ONBOARDING_STATUSES.APPROVED,
  ONBOARDING_STATUSES.ACCOUNT_SETUP_SENT,
  ONBOARDING_STATUSES.ACCOUNT_SETUP_PENDING,
  ONBOARDING_STATUSES.ACTIVATED,
  ONBOARDING_STATUSES.REJECTED,
]);

/** Statuses where an account-setup (activation) invitation is valid. */
export const ONBOARDING_ACCOUNT_SETUP_STATUSES = Object.freeze([
  ONBOARDING_STATUSES.APPROVED,
  ONBOARDING_STATUSES.ACCOUNT_SETUP_SENT,
  ONBOARDING_STATUSES.ACCOUNT_SETUP_PENDING,
]);

export const ONBOARDING_SECTION_KEYS = Object.freeze({
  PERSONAL_DETAILS: "personalDetails",
  RESIDENTIAL_ADDRESS: "residentialAddress",
  EMERGENCY_CONTACT: "emergencyContact",
  BANK_AND_TAX: "bankAndTax",
  DOCUMENTS: "documents",
});

export const SECTION_REVIEW_STATUSES = Object.freeze({
  NOT_SUBMITTED: "NOT_SUBMITTED",
  PENDING_REVIEW: "PENDING_REVIEW",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  CORRECTION_REQUESTED: "CORRECTION_REQUESTED",
  RESUBMITTED: "RESUBMITTED",
});

export const ONBOARDING_DOCUMENT_TYPES = Object.freeze({
  ID_PROOF: "ID_PROOF",
  ADDRESS_PROOF: "ADDRESS_PROOF",
  RESUME: "RESUME",
  EDUCATION_CERTIFICATE: "EDUCATION_CERTIFICATE",
  PREVIOUS_RELIEVING: "PREVIOUS_RELIEVING",
  OTHER: "OTHER",
});

const SectionReviewSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: Object.values(SECTION_REVIEW_STATUSES),
      default: SECTION_REVIEW_STATUSES.NOT_SUBMITTED,
    },
    note: { type: String, trim: true, default: "" },
    reviewedAt: { type: Date, default: null },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    revision: { type: Number, default: 0 },
  },
  { _id: false }
);

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
          reviewStatus: {
            type: String,
            enum: Object.values(SECTION_REVIEW_STATUSES),
            default: undefined,
          },
          reviewNote: { type: String, trim: true, default: undefined },
        },
      ],
      default: [],
    },
    sectionReviews: {
      personalDetails: { type: SectionReviewSchema, default: () => ({}) },
      residentialAddress: { type: SectionReviewSchema, default: () => ({}) },
      emergencyContact: { type: SectionReviewSchema, default: () => ({}) },
      bankAndTax: { type: SectionReviewSchema, default: () => ({}) },
      documents: { type: SectionReviewSchema, default: () => ({}) },
    },
    invitationSentAt: {
      type: Date,
      default: null,
    },
    // Short-lived mutex used by account activation so Employee is created exactly once.
    activationLockedAt: {
      type: Date,
      default: null,
    },
    accountActivatedAt: {
      type: Date,
      default: null,
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
          section: { type: String, default: "" },
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
      /** Account-level profile photo (used when no employee link). Bytes never serialized. */
      avatar: { type: String, trim: true, default: "" },
      avatarMimeType: { type: String, trim: true, default: "" },
      avatarData: { type: Buffer, select: false },
      /**
       * Company Admin → HR Admin invitation lifecycle (Phase CA3).
       * Absent for non–HR-Admin users and for legacy HR Admins created without invite.
       */
      hrInvitation: {
        status: {
          type: String,
          enum: ["PENDING", "ACCEPTED", "EXPIRED", "REVOKED"],
          default: undefined,
        },
        sentAt: { type: Date, default: null },
        acceptedAt: { type: Date, default: null },
        revokedAt: { type: Date, default: null },
        expiresAt: { type: Date, default: null },
        invitedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          default: null,
        },
      },
      /**
       * Phase CA4-B — Company Admin configured access for HR_ADMIN users.
       * Absent/null = unconfigured (legacy HR continues to operate until enforcement phases).
       * Enforcement of this config on operational HR routes is deferred.
       */
      hrAccess: {
        version: { type: Number, default: undefined },
        configuredAt: { type: Date, default: null },
        updatedAt: { type: Date, default: null },
        updatedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          default: null,
        },
        employeeScope: {
          mode: {
            type: String,
            enum: ["COMPANY", "CUSTOM"],
            default: undefined,
          },
          departmentIds: {
            type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Department" }],
            default: undefined,
          },
          employeeIds: {
            type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Employee" }],
            default: undefined,
          },
        },
        /** Sparse allow-list of catalog keys, e.g. "people.view", "leave.approve". */
        permissions: {
          type: [String],
          default: undefined,
        },
      },
      preferences: {
        emailNotifications: { type: Boolean, default: true },
        weeklyDigest: { type: Boolean, default: true },
        compactView: { type: Boolean, default: false },
        readNotificationIds: { type: [String], default: [] },
        readAllNotificationsAt: { type: Date, default: null },
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
  /**
   * Exactly one active Company Admin per company tenant DB.
   * All matching docs share role "COMPANY_ADMIN", so uniqueness permits only one.
   * Inactive Company Admins are excluded from the filter (recovery / replacement).
   * Trusted ops: deactivate the current active Company Admin, then create/activate
   * the replacement; duplicate-key (11000) means a concurrent race lost.
   */
  userSchema.index(
    { role: 1 },
    {
      unique: true,
      name: "unique_active_company_admin",
      partialFilterExpression: {
        role: USER_ROLES.COMPANY_ADMIN,
        isActive: true,
      },
    }
  );
  userSchema.index({ "onboarding.status": 1 });
  userSchema.index({ "onboarding.offerLetterId": 1 });
  // Onboarding list sorts by submittedAt desc (HR review queue).
  userSchema.index({ "onboarding.submittedAt": -1 });
  userSchema.index({ "onboarding.employeeId": 1 });

  userSchema.set("toJSON", {
    transform(_doc, ret) {
      delete ret.passwordHash;
      delete ret.avatarData;
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
  delete json.avatarData;
  json.avatar = typeof json.avatar === "string" ? json.avatar : "";
  if (json.onboarding) {
    delete json.onboarding.onboardingTokenHash;
  }
  return json;
}

