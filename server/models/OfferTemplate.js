import mongoose from "mongoose";

export const OFFER_TEMPLATE_TYPES = Object.freeze({
  DEFAULT_BUILDER: "DEFAULT_BUILDER",
  UPLOADED_DOCX: "UPLOADED_DOCX",
});

export const OFFER_TEMPLATE_SOURCES = Object.freeze({
  HRMS_MASTER: "HRMS_MASTER",
  COMPANY: "COMPANY",
});

export const OFFER_TEMPLATE_STATUSES = Object.freeze({
  DRAFT: "DRAFT",
  ACTIVE: "ACTIVE",
  ARCHIVED: "ARCHIVED",
});

export const StorageRefSchema = new mongoose.Schema(
  {
    provider: { type: String, default: "gridfs" },
    bucket: { type: String, default: "offer_docs" },
    /** GridFS files._id (primary locator). */
    fileId: { type: mongoose.Schema.Types.ObjectId, default: null },
    /** Legacy / opaque string form of fileId (or former R2 key if ever present). */
    key: { type: String, default: "" },
    filename: { type: String, default: "" },
    contentType: { type: String, default: "" },
    byteSize: { type: Number, default: 0 },
    checksumSha256: { type: String, default: "" },
    etag: { type: String, default: "" },
    uploadedAt: { type: Date, default: null },
  },
  { _id: false }
);

export const PlaceholderMappingSchema = new mongoose.Schema(
  {
    placeholder: { type: String, required: true, trim: true },
    field: { type: String, default: "", trim: true },
    required: { type: Boolean, default: true },
    defaultValue: { type: String, default: "" },
    format: { type: String, default: "" },
  },
  { _id: false }
);

const templateVersionSchema = new mongoose.Schema(
  {
    version: { type: Number, required: true, min: 1 },
    snapshot: { type: mongoose.Schema.Types.Mixed, default: {} },
    storage: { type: StorageRefSchema, default: undefined },
    placeholderMappings: { type: [PlaceholderMappingSchema], default: [] },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

export function createOfferTemplateSchema() {
  const offerTemplateSchema = new mongoose.Schema(
    {
      name: { type: String, required: [true, "Template name is required"], trim: true },
      type: {
        type: String,
        enum: Object.values(OFFER_TEMPLATE_TYPES),
        required: true,
        default: OFFER_TEMPLATE_TYPES.DEFAULT_BUILDER,
      },
      source: {
        type: String,
        enum: Object.values(OFFER_TEMPLATE_SOURCES),
        default: OFFER_TEMPLATE_SOURCES.COMPANY,
      },
      masterCode: { type: String, default: null, trim: true },
      masterVersion: { type: Number, default: null },
      status: {
        type: String,
        enum: Object.values(OFFER_TEMPLATE_STATUSES),
        default: OFFER_TEMPLATE_STATUSES.DRAFT,
      },
      isDefault: { type: Boolean, default: false },
      isSystemDefault: { type: Boolean, default: false },
      // 0 = UPLOADED_DOCX shell before first source upload; otherwise ≥ 1.
      version: { type: Number, default: 1, min: 0 },
      versions: { type: [templateVersionSchema], default: [] },
      /** Primary stored source for UPLOADED_DOCX (current version). */
      storage: { type: StorageRefSchema, default: undefined },
      placeholders: { type: [String], default: [] },
      placeholderMappings: { type: [PlaceholderMappingSchema], default: [] },
      settings: { type: mongoose.Schema.Types.Mixed, default: {} },
      createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      updatedAt: { type: Date, default: Date.now },
    },
    {
      collection: "offer_templates",
      timestamps: true,
    }
  );

  offerTemplateSchema.index({ status: 1 });
  offerTemplateSchema.index({ type: 1 });
  offerTemplateSchema.index({ source: 1, masterCode: 1 });
  // At most one system-default copy of a given master per tenant database.
  offerTemplateSchema.index(
    { masterCode: 1 },
    {
      unique: true,
      partialFilterExpression: { isSystemDefault: true },
      name: "uniq_system_default_per_master",
    }
  );
  // At most one default template per tenant database.
  offerTemplateSchema.index(
    { isDefault: 1 },
    { unique: true, partialFilterExpression: { isDefault: true }, name: "uniq_default_template" }
  );

  return offerTemplateSchema;
}

export function getOfferTemplateModel(connection) {
  if (connection.models && connection.models.OfferTemplate) {
    return connection.models.OfferTemplate;
  }
  return connection.model("OfferTemplate", createOfferTemplateSchema());
}
