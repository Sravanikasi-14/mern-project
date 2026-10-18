import mongoose from "mongoose";

export const DEFAULT_HR_POLICY = Object.freeze({
  effectiveFromDate: new Date("2026-01-01"),
  leaveTypes: [
    { code: "CASUAL", name: "Casual Leave", yearlyDays: 8, isActive: true },
    { code: "SICK", name: "Sick Leave", yearlyDays: 6, isActive: true },
    { code: "EARNED", name: "Earned / Privilege Leave", yearlyDays: 12, isActive: true },
  ],
  leaveRules: {
    probationMonths: 3,
    maxConsecutiveDays: 14,
    leaveYearStartMonth: 1, // January
    carryForwardLimitDays: 10,
    allowEncashment: false,
  },
  weekendRules: {
    saturdayOff: true,
    sundayOff: true,
  },
  holidays: [
    { name: "Republic Day", date: new Date("2026-01-26"), type: "National Holiday" },
    { name: "Holi", date: new Date("2026-03-25"), type: "Gazetted Holiday" },
    { name: "Good Friday", date: new Date("2026-04-03"), type: "Observance" },
    { name: "May Day", date: new Date("2026-05-01"), type: "Gazetted Holiday" },
    { name: "Independence Day", date: new Date("2026-08-15"), type: "National Holiday" },
    { name: "Gandhi Jayanti", date: new Date("2026-10-02"), type: "National Holiday" },
    { name: "Dussehra", date: new Date("2026-10-20"), type: "Gazetted Holiday" },
    { name: "Diwali / Deepavali", date: new Date("2026-11-08"), type: "Festival Holiday" },
    { name: "Guru Nanak Jayanti", date: new Date("2026-11-24"), type: "Gazetted Holiday" },
    { name: "Christmas Day", date: new Date("2026-12-25"), type: "Gazetted Holiday" },
  ],
});

export function createCompanyHrPolicySchema() {
  const policySchema = new mongoose.Schema(
    {
      effectiveFromDate: {
        type: Date,
        required: true,
        default: Date.now,
      },
      leaveTypes: {
        type: [
          {
            code: { type: String, required: true, uppercase: true, trim: true },
            name: { type: String, required: true, trim: true },
            yearlyDays: { type: Number, required: true, default: 0 },
            isActive: { type: Boolean, default: true },
          },
        ],
        default: DEFAULT_HR_POLICY.leaveTypes,
      },
      leaveRules: {
        probationMonths: { type: Number, default: 3 },
        maxConsecutiveDays: { type: Number, default: 14 },
        leaveYearStartMonth: { type: Number, default: 1 },
        carryForwardLimitDays: { type: Number, default: 10 },
        allowEncashment: { type: Boolean, default: false },
      },
      weekendRules: {
        saturdayOff: { type: Boolean, default: true },
        sundayOff: { type: Boolean, default: true },
      },
      holidays: {
        type: [
          {
            name: { type: String, required: true, trim: true },
            date: { type: Date, required: true },
            type: { type: String, default: "Gazetted Holiday" },
          },
        ],
        default: DEFAULT_HR_POLICY.holidays,
      },
      schemaVersion: {
        type: Number,
        default: 1,
      },
    },
    {
      timestamps: true,
      collection: "company_hr_policies",
    }
  );

  policySchema.index({ effectiveFromDate: -1 });

  return policySchema;
}

export function getCompanyHrPolicyModel(connection) {
  return (
    connection.models.CompanyHrPolicy ||
    connection.model("CompanyHrPolicy", createCompanyHrPolicySchema())
  );
}

/**
 * Get active policy for the company as of a given date (defaults to now)
 */
export async function getActiveCompanyHrPolicy(CompanyHrPolicy, asOfDate = new Date()) {
  if (!CompanyHrPolicy) return DEFAULT_HR_POLICY;

  let policy = await CompanyHrPolicy.findOne({
    effectiveFromDate: { $lte: asOfDate },
  })
    .sort({ effectiveFromDate: -1 })
    .lean();

  if (!policy) {
    // If no policy document exists yet in collection, create initial standard policy
    try {
      policy = await CompanyHrPolicy.create({
        ...DEFAULT_HR_POLICY,
        effectiveFromDate: new Date("2026-01-01"),
      });
      policy = policy.toObject ? policy.toObject() : policy;
    } catch {
      policy = DEFAULT_HR_POLICY;
    }
  }

  return policy;
}
