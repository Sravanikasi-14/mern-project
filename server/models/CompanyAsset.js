import mongoose from "mongoose";

export const ASSET_STATUSES = Object.freeze({
  AVAILABLE: "AVAILABLE",
  ASSIGNED: "ASSIGNED",
  UNDER_MAINTENANCE: "UNDER_MAINTENANCE",
  RETIRED: "RETIRED",
  LOST: "LOST",
});

export const ASSET_CATEGORIES = Object.freeze({
  LAPTOP: "LAPTOP",
  DESKTOP: "DESKTOP",
  MONITOR: "MONITOR",
  PHONE_TABLET: "PHONE_TABLET",
  PERIPHERAL: "PERIPHERAL",
  ACCESS_CARD: "ACCESS_CARD",
  FURNITURE: "FURNITURE",
  OTHER: "OTHER",
});

export const ASSET_CONDITIONS = Object.freeze({
  NEW: "NEW",
  EXCELLENT: "EXCELLENT",
  GOOD: "GOOD",
  FAIR: "FAIR",
  POOR: "POOR",
  DAMAGED: "DAMAGED",
});

export const ACKNOWLEDGEMENT_STATUSES = Object.freeze({
  PENDING: "PENDING",
  ACKNOWLEDGED: "ACKNOWLEDGED",
});

export function createCompanyAssetSchema() {
  const assignmentRecordSchema = new mongoose.Schema(
    {
      employeeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Employee",
        required: true,
      },
      employeeCode: { type: String, trim: true, default: "" },
      employeeName: { type: String, trim: true, default: "" },
      assignedDate: { type: Date, required: true },
      conditionAtAssignment: {
        type: String,
        enum: Object.values(ASSET_CONDITIONS),
        default: ASSET_CONDITIONS.GOOD,
      },
      returnDate: { type: Date, default: null },
      conditionAtReturn: {
        type: String,
        enum: [...Object.values(ASSET_CONDITIONS), ""],
        default: "",
      },
      returnNotes: { type: String, trim: true, default: "" },
      acknowledgementStatus: {
        type: String,
        enum: Object.values(ACKNOWLEDGEMENT_STATUSES),
        default: ACKNOWLEDGEMENT_STATUSES.PENDING,
      },
      acknowledgedAt: { type: Date, default: null },
      assignedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
      returnedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
      notes: { type: String, trim: true, default: "" },
    },
    { _id: true }
  );

  const currentAssignmentSchema = new mongoose.Schema(
    {
      employeeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Employee",
        required: true,
      },
      employeeCode: { type: String, trim: true, default: "" },
      employeeName: { type: String, trim: true, default: "" },
      assignedDate: { type: Date, required: true },
      conditionAtAssignment: {
        type: String,
        enum: Object.values(ASSET_CONDITIONS),
        default: ASSET_CONDITIONS.GOOD,
      },
      acknowledgementStatus: {
        type: String,
        enum: Object.values(ACKNOWLEDGEMENT_STATUSES),
        default: ACKNOWLEDGEMENT_STATUSES.PENDING,
      },
      acknowledgedAt: { type: Date, default: null },
      assignedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
      notes: { type: String, trim: true, default: "" },
    },
    { _id: false }
  );

  const companyAssetSchema = new mongoose.Schema(
    {
      assetTag: {
        type: String,
        required: true,
        trim: true,
        uppercase: true,
      },
      name: {
        type: String,
        required: true,
        trim: true,
      },
      category: {
        type: String,
        enum: Object.values(ASSET_CATEGORIES),
        default: ASSET_CATEGORIES.LAPTOP,
        required: true,
      },
      manufacturer: {
        type: String,
        trim: true,
        default: "",
      },
      modelNumber: {
        type: String,
        trim: true,
        default: "",
      },
      serialNumber: {
        type: String,
        trim: true,
        default: "",
      },
      purchaseDate: {
        type: Date,
        default: null,
      },
      purchaseCost: {
        type: Number,
        min: 0,
        default: null,
      },
      warrantyExpiry: {
        type: Date,
        default: null,
      },
      condition: {
        type: String,
        enum: Object.values(ASSET_CONDITIONS),
        default: ASSET_CONDITIONS.GOOD,
        required: true,
      },
      status: {
        type: String,
        enum: Object.values(ASSET_STATUSES),
        default: ASSET_STATUSES.AVAILABLE,
        required: true,
      },
      location: {
        type: String,
        trim: true,
        default: "",
      },
      department: {
        type: String,
        trim: true,
        default: "",
      },
      notes: {
        type: String,
        trim: true,
        default: "",
      },
      currentAssignment: {
        type: currentAssignmentSchema,
        default: null,
      },
      assignmentHistory: {
        type: [assignmentRecordSchema],
        default: [],
      },
      createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
      updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
      schemaVersion: {
        type: Number,
        default: 1,
      },
    },
    {
      timestamps: true,
      collection: "company_assets",
    }
  );

  // Asset tags are unique within the tenant company database
  companyAssetSchema.index({ assetTag: 1 }, { unique: true });
  companyAssetSchema.index({ status: 1 });
  companyAssetSchema.index({ category: 1 });
  companyAssetSchema.index({ status: 1, category: 1, createdAt: -1 });
  companyAssetSchema.index({ status: 1, condition: 1, createdAt: -1 });
  companyAssetSchema.index({ "currentAssignment.employeeId": 1 });
  companyAssetSchema.index({ "currentAssignment.employeeId": 1, status: 1 });
  companyAssetSchema.index({ "assignmentHistory.employeeId": 1 });
  companyAssetSchema.index({ serialNumber: 1 });
  companyAssetSchema.index({ createdAt: -1 });

  return companyAssetSchema;
}

export function getCompanyAssetModel(connection) {
  return (
    connection.models.CompanyAsset ||
    connection.model("CompanyAsset", createCompanyAssetSchema())
  );
}
