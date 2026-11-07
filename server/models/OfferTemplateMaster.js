import mongoose from "mongoose";

/**
 * Central (platform) master offer templates. Lives on the central DB connection
 * (same pattern as Company) in the `offer_template_masters` collection.
 * Tenants copy a version into their own `offer_templates` collection; they never
 * write to this collection.
 */
export const MASTER_TEMPLATE_KINDS = Object.freeze({
  DEFAULT_BUILDER: "DEFAULT_BUILDER",
});

const masterVersionSchema = new mongoose.Schema(
  {
    version: { type: Number, required: true, min: 1 },
    htmlTemplate: { type: String, default: "" },
    sectionConfig: { type: mongoose.Schema.Types.Mixed, default: {} },
    legalSections: { type: [mongoose.Schema.Types.Mixed], default: [] },
    createdAt: { type: Date, default: Date.now },
    notes: { type: String, default: "" },
  },
  { _id: false }
);

const offerTemplateMasterSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, trim: true, uppercase: true },
    title: { type: String, required: true, trim: true },
    kind: {
      type: String,
      enum: Object.values(MASTER_TEMPLATE_KINDS),
      default: MASTER_TEMPLATE_KINDS.DEFAULT_BUILDER,
      required: true,
    },
    currentVersion: { type: Number, required: true, default: 1, min: 1 },
    versions: { type: [masterVersionSchema], default: [] },
    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    collection: "offer_template_masters",
  }
);

offerTemplateMasterSchema.index({ isActive: 1, kind: 1 });

export function getMasterVersion(master, version) {
  if (!master) return null;
  const target = version ?? master.currentVersion;
  return (master.versions || []).find((v) => v.version === target) || null;
}

export default mongoose.models.OfferTemplateMaster ||
  mongoose.model("OfferTemplateMaster", offerTemplateMasterSchema);
