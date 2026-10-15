import mongoose from "mongoose";

export const EMPLOYEE_STATUSES = Object.freeze({
  ACTIVE: "ACTIVE",
  INACTIVE: "INACTIVE",
});

export const DOCUMENT_TYPES = Object.freeze({
  APPOINTMENT_LETTER: "APPOINTMENT_LETTER",
  NO_DUES_CERTIFICATE: "NO_DUES_CERTIFICATE",
  RELIEVING_LETTER: "RELIEVING_LETTER",
  ID_PROOF: "ID_PROOF",
  OTHER: "OTHER",
});

export function createEmployeeSchema() {
  const employeeSchema = new mongoose.Schema(
    {
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        unique: true,
        sparse: true,
      },
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
        joiningDate: {
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
            enum: ["MANDATE", "RETAIL", ""],
            default: "",
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
            createdAt: { type: Date, default: Date.now },
            emailedAt: { type: Date, default: null },
          },
        ],
        default: [],
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
  employeeSchema.index({ "job.reportingManagerId": 1 });
  employeeSchema.index({ email: 1 });

  return employeeSchema;
}

export function getEmployeeModel(connection) {
  return (
    connection.models.Employee ||
    connection.model("Employee", createEmployeeSchema())
  );
}
