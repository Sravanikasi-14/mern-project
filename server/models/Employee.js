import mongoose from "mongoose";

export const EMPLOYEE_STATUSES = Object.freeze({
  ACTIVE: "ACTIVE",
  INACTIVE: "INACTIVE",
});

export const DOCUMENT_TYPES = Object.freeze({
  APPOINTMENT_LETTER: "APPOINTMENT_LETTER",
  OFFER_LETTER: "OFFER_LETTER",
  EMPLOYMENT_CONTRACT: "EMPLOYMENT_CONTRACT",
  ID_PROOF: "ID_PROOF",
  RELIEVING_LETTER: "RELIEVING_LETTER",
  NO_DUES_CERTIFICATE: "NO_DUES_CERTIFICATE",
  TAX_DOCUMENT: "TAX_DOCUMENT",
  OTHER: "OTHER",
});

export function createEmployeeSchema() {
  const employeeSchema = new mongoose.Schema(
    {
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
      /** Public API path used by existing selects (e.g. /api/employees/:id/avatar?v=...). Never raw bytes. */
      avatar: { type: String, trim: true, default: "" },
      avatarMimeType: { type: String, trim: true, default: "" },
      avatarData: { type: Buffer, select: false },
      employeeCode: {
        type: String,
        required: true,
        unique: true,
        trim: true,
      },
      uniqueId: {
        type: String,
        trim: true,
        default: "",
      },
      fullName: {
        type: String,
        required: true,
        trim: true,
      },
      email: {
        type: String,
        required: true,
        lowercase: true,
        trim: true,
        unique: true,
      },
      phoneNumber: {
        type: String,
        trim: true,
        default: "",
      },
      dateOfBirth: {
        type: Date,
        default: null,
      },
      city: {
        type: String,
        trim: true,
        default: "",
      },
      status: {
        type: String,
        enum: Object.values(EMPLOYEE_STATUSES),
        default: EMPLOYEE_STATUSES.ACTIVE,
        required: true,
      },
      job: {
        jobTitle: {
          type: String,
          trim: true,
          default: "",
        },
        department: {
          type: String,
          trim: true,
          default: "",
        },
        /**
         * Phase A3 optional stable Department ref. Legacy job.department string is preserved.
         * Not mandatory until backfill reconciliation completes.
         */
        departmentId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Department",
          default: null,
          index: true,
        },
        jobGrade: {
          type: String,
          trim: true,
          default: "",
        },
        employmentType: {
          type: String,
          trim: true,
          default: "Full-time",
        },
        workLocation: {
          type: String,
          trim: true,
          default: "",
        },
        /**
         * Attendance work arrangement (Version 1 location-based attendance).
         * OFFICE | WFH | HYBRID. Default OFFICE preserves historical behaviour.
         */
        workArrangement: {
          mode: {
            type: String,
            enum: ["OFFICE", "WFH", "HYBRID"],
            default: "OFFICE",
          },
          homeLocation: {
            label: { type: String, default: "Home", trim: true },
            address: { type: String, default: "", trim: true },
            latitude: { type: Number, default: null },
            longitude: { type: Number, default: null },
            radiusMeters: { type: Number, default: 200 },
            approved: { type: Boolean, default: false },
            approvedAt: { type: Date, default: null },
            approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
          },
          updatedAt: { type: Date, default: null },
          updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        },
        joiningDate: {
          type: Date,
          default: null,
        },
        terminationDate: {
          type: Date,
          default: null,
        },
        reportingManagerId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Employee",
          default: null,
        },
        project: {
          projectName: {
            type: String,
            trim: true,
            default: "",
          },
          projectType: {
            type: String,
            enum: ["MANDATE", "RETAIL", "BENCH", "INTERNAL", ""],
            default: "",
          },
          /**
           * Phase A3 optional stable Project ref for the primary embedded project.
           * Multi-project membership lives in ProjectMembership. Legacy strings preserved.
           */
          projectId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Project",
            default: null,
          },
        },
      },
      documents: {
        type: [
          {
            documentType: {
              type: String,
              enum: Object.values(DOCUMENT_TYPES),
              required: true,
            },
            title: { type: String, required: true },
            content: { type: String, default: "" },
            fileUrl: { type: String, default: "" },
            fileName: { type: String, default: "" },
            fileSize: { type: Number, default: 0 },
            mimeType: { type: String, default: "" },
            storageKey: { type: String, default: "" },
            uploadedBy: {
              type: mongoose.Schema.Types.ObjectId,
              ref: "User",
              default: null,
            },
            uploadedByRole: {
              type: String,
              enum: ["HR_ADMIN", "EMPLOYEE", "SYSTEM"],
              default: "HR_ADMIN",
            },
            createdAt: { type: Date, default: Date.now },
            emailedAt: { type: Date, default: null },
          },
        ],
        default: [],
      },
      invitation: {
        status: {
          type: String,
          enum: ["PENDING", "ACCEPTED", "EXPIRED", "DELIVERY_FAILED"],
          default: "PENDING",
        },
        token: { type: String, default: "" },
        sentAt: { type: Date, default: null },
        acceptedAt: { type: Date, default: null },
      },
      exit: {
        inactiveDate: { type: Date, default: null },
        reason: { type: String, default: "" },
        fullAndFinalGeneratedAt: { type: Date, default: null },
        anonymizedAt: { type: Date, default: null },
      },
      previousEmploymentPeriods: {
        type: [
          {
            joiningDate: { type: Date },
            inactiveDate: { type: Date },
            reason: { type: String },
          },
        ],
        default: [],
      },
      preferredName: {
        type: String,
        trim: true,
        default: "",
      },
      personalEmail: {
        type: String,
        trim: true,
        lowercase: true,
        default: "",
      },
      personalPhone: {
        type: String,
        trim: true,
        default: "",
      },
      gender: {
        type: String,
        trim: true,
        default: "",
      },
      residentialAddress: {
        street: { type: String, default: "" },
        city: { type: String, default: "" },
        state: { type: String, default: "" },
        postalCode: { type: String, default: "" },
        country: { type: String, default: "India" },
      },
      workAddress: {
        street: { type: String, default: "" },
        city: { type: String, default: "" },
        state: { type: String, default: "" },
        postalCode: { type: String, default: "" },
        country: { type: String, default: "India" },
      },
      emergencyContact: {
        name: { type: String, default: "" },
        relationship: { type: String, default: "" },
        phone: { type: String, default: "" },
      },
      bankDetails: {
        accountHolderName: { type: String, default: "" },
        accountNumber: { type: String, default: "" },
        bankName: { type: String, default: "" },
        ifscCode: { type: String, default: "" },
        accountType: { type: String, default: "SAVINGS" },
      },
      taxDetails: {
        panNumber: { type: String, default: "" },
        taxRegime: { type: String, default: "NEW" },
      },
      identityDetails: {
        idType: { type: String, default: "PAN / AADHAAR" },
        idNumber: { type: String, default: "" },
        isVerified: { type: Boolean, default: true },
      },
      attendance: {
        totalWorkingDays: { type: Number, default: 22 },
        daysPresent: { type: Number, default: 21 },
        leaveBalance: {
          casual: { type: Number, default: 8 },
          sick: { type: Number, default: 6 },
          earned: { type: Number, default: 12 },
        },
      },
      /**
       * Optional skill tags for backup recommendations (Phase 2).
       * Empty means skill matching is unavailable — never invent skills.
       */
      skills: {
        type: [{ type: String, trim: true }],
        default: [],
      },
      customFields: {
        type: mongoose.Schema.Types.Mixed,
        default: {},
      },
      schemaVersion: {
        type: Number,
        default: 1,
      },
    },
    {
      timestamps: true,
      collection: "employees",
    }
  );

  employeeSchema.index({ status: 1 });
  employeeSchema.index({ createdAt: -1 });
  employeeSchema.index({ status: 1, createdAt: -1 });
  employeeSchema.index({ "job.reportingManagerId": 1 });
  employeeSchema.index({ "job.department": 1, status: 1 });
  employeeSchema.index({ "job.departmentId": 1, status: 1 });
  employeeSchema.index({ "job.project.projectName": 1, status: 1 });
  employeeSchema.index({ "job.project.projectId": 1, status: 1 });
  employeeSchema.index({ fullName: 1 });
  employeeSchema.index({ skills: 1 });
  employeeSchema.index(
    { userId: 1 },
    { unique: true, partialFilterExpression: { userId: { $type: "objectId" } } }
  );

  return employeeSchema;
}

export function getEmployeeModel(connection) {
  return (
    connection.models.Employee ||
    connection.model("Employee", createEmployeeSchema())
  );
}
