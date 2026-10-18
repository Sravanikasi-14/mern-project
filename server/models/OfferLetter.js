import mongoose from "mongoose";

export const OFFER_LETTER_STATUSES = Object.freeze({
  DRAFT: "DRAFT",
  SENT: "SENT",
  ACCEPTED: "ACCEPTED",
  REJECTED: "REJECTED",
});

export const ClauseItemSchema = new mongoose.Schema(
  {
    id: { type: String, default: "" },
    clauseId: { type: String, default: "" },
    title: { type: String, required: true, trim: true },
    body: { type: String, required: true },
    isIncluded: { type: Boolean, default: true },
    enabled: { type: Boolean, default: true },
    isCustom: { type: Boolean, default: false },
    isRequired: { type: Boolean, default: false },
    order: { type: Number, default: 0 },
  },
  { _id: false }
);

export function createOfferLetterSchema() {
  const offerLetterSchema = new mongoose.Schema(
    {
      candidate: {
        fullName: {
          type: String,
          required: [true, "Candidate full name is required"],
          trim: true,
        },
        email: {
          type: String,
          required: [true, "Candidate email is required"],
          trim: true,
          lowercase: true,
        },
      },
      position: {
        type: String,
        required: [true, "Position is required"],
        trim: true,
      },
      department: {
        type: String,
        trim: true,
        default: "",
      },
      workLocation: {
        type: String,
        trim: true,
        default: "",
      },
      reportingManager: {
        type: String,
        trim: true,
        default: "",
      },
      employmentType: {
        type: String,
        trim: true,
        default: "Full-time Permanent",
      },
      monthlySalary: {
        type: Number,
        required: [true, "Monthly salary is required"],
        min: [0.01, "Monthly salary must be greater than zero"],
      },
      annualSalary: {
        type: Number,
      },
      joiningDate: {
        type: Date,
        required: [true, "Joining date is required"],
      },
      clauses: {
        type: [ClauseItemSchema],
        default: [],
      },
      content: {
        type: String,
        required: [true, "Offer letter rendered content is required"],
      },
      status: {
        type: String,
        enum: Object.values(OFFER_LETTER_STATUSES),
        default: OFFER_LETTER_STATUSES.DRAFT,
        index: true,
      },
      emailedAt: {
        type: Date,
        default: null,
      },
      issuedAt: {
        type: Date,
        default: null,
      },
      decisionAt: {
        type: Date,
        default: null,
      },
      decisionNotes: {
        type: String,
        trim: true,
        default: "",
      },
      employeeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Employee",
        default: null,
        index: true,
      },
      createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    },
    {
      collection: "offer_letters",
      timestamps: true,
    }
  );

  // Compute annualized salary automatically before validation
  offerLetterSchema.pre("validate", function () {
    if (this.monthlySalary != null && !isNaN(this.monthlySalary)) {
      this.annualSalary = Math.round(Number(this.monthlySalary) * 12);
    }
  });

  // Indexes for query performance
  offerLetterSchema.index({ status: 1, createdAt: -1 });
  offerLetterSchema.index({ "candidate.email": 1 });
  offerLetterSchema.index({ "candidate.fullName": 1 });

  return offerLetterSchema;
}

export function getOfferLetterModel(connection) {
  if (connection.models && connection.models.OfferLetter) {
    return connection.models.OfferLetter;
  }
  const schema = createOfferLetterSchema();
  return connection.model("OfferLetter", schema);
}
