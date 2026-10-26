import mongoose from "mongoose";

export const DEFAULT_HR_POLICY = Object.freeze({
  effectiveFromDate: new Date("2026-01-01"),
  leaveTypes: [
    { code: "CASUAL", name: "Casual Leave", yearlyDays: 8, isPaid: true, isActive: true },
    { code: "SICK", name: "Sick Leave", yearlyDays: 6, isPaid: true, isActive: true },
    { code: "EARNED", name: "Earned / Privilege Leave", yearlyDays: 12, isPaid: true, isActive: true },
  ],
  leaveRules: {
    probationMonths: 3,
    maxConsecutiveDays: 14,
    leaveYearStartMonth: 1, // January
    carryForwardLimitDays: 10,
    allowEncashment: false,
    encashmentMinBalanceDays: 15,
    accrualFrequency: "YEARLY",
    priorNoticeDays: 1,
  },
  attendanceRules: {
    officeStartTime: "09:30",
    officeEndTime: "18:30",
    gracePeriodMinutes: 15,
    lateArrivalThresholdMinutes: 30,
    breakDurationMinutes: 60,
    halfDayThresholdHours: 4.5,
    fullDayThresholdHours: 8.0,
    autoCheckoutEnabled: false,
    autoCheckoutTime: "",
  },
  workHoursRules: {
    standardDailyHours: 8,
    standardWeeklyHours: 40,
    overtimeAllowed: false,
    overtimeThresholdDailyHours: 9,
    shiftName: "General Day Shift",
  },
  weekendRules: {
    saturdayOff: true,
    sundayOff: true,
    alternateSaturdaysOff: false,
    isPaidWeekend: true,
  },
  holidays: [
    { name: "Republic Day", date: new Date("2026-01-26"), type: "National Holiday", isPaid: true },
    { name: "Holi", date: new Date("2026-03-25"), type: "Gazetted Holiday", isPaid: true },
    { name: "Good Friday", date: new Date("2026-04-03"), type: "Observance", isPaid: true },
    { name: "May Day", date: new Date("2026-05-01"), type: "Gazetted Holiday", isPaid: true },
    { name: "Independence Day", date: new Date("2026-08-15"), type: "National Holiday", isPaid: true },
    { name: "Gandhi Jayanti", date: new Date("2026-10-02"), type: "National Holiday", isPaid: true },
    { name: "Dussehra", date: new Date("2026-10-20"), type: "Gazetted Holiday", isPaid: true },
    { name: "Diwali / Deepavali", date: new Date("2026-11-08"), type: "Festival Holiday", isPaid: true },
    { name: "Guru Nanak Jayanti", date: new Date("2026-11-24"), type: "Gazetted Holiday", isPaid: true },
    { name: "Christmas Day", date: new Date("2026-12-25"), type: "Gazetted Holiday", isPaid: true },
  ],
  locationRules: {
    requireLocationForPunch: true,
    allowWebTracking: true,
    geofenceEnabled: false,
    geofenceRadiusMeters: 200,
    officeLatitude: null,
    officeLongitude: null,
    officeAddress: "",
  },
  payrollRules: {
    currencySymbol: "₹",
    currencyCode: "INR",
    payCycleStartDay: 1,
    salaryCalculationBasis: "ACTUAL_MONTH_DAYS",
    standardWorkingHoursPerWeek: 40,
    deductLopForUnpaidLeave: true,
    lateDeductionGraceCount: 3,
    halfDayDeductionRate: 50,
    areHolidaysPaid: true,
  },
  salaryComponentRules: {
    allowances: [
      { name: "Basic Salary", code: "BASIC", taxable: true, percentageOfCtc: 40 },
      { name: "House Rent Allowance", code: "HRA", taxable: true, percentageOfCtc: 20 },
      { name: "Conveyance Allowance", code: "CONVEYANCE", taxable: false, percentageOfCtc: 10 },
      { name: "Special Allowance", code: "SPECIAL", taxable: true, percentageOfCtc: 30 },
    ],
    deductions: [
      { name: "Provident Fund (EPF)", code: "EPF", ratePercent: 12 },
      { name: "Professional Tax (PT)", code: "PT", ratePercent: 0 },
    ],
  },
  taxStatutoryRules: {
    panRequiredForPayroll: true,
    pfApplicable: true,
    pfDeductionRatePercent: 12,
    esiApplicable: false,
    esiThresholdAmount: 21000,
    ptApplicable: true,
    disclaimer:
      "Company deductions configure baseline statutory payroll rules and do not substitute for formal fiscal counsel.",
  },
  lifecycleRules: {
    probationDurationMonths: 3,
    confirmationReviewRequired: true,
    noticePeriodDays: 30,
    noticePeriodServingRequired: true,
    resignationApprovalLevels: 1,
  },
  recruitmentRules: {
    offerValidityDays: 7,
    requireCandidateSignature: true,
    autoExpireOffers: true,
    approvalRequiredBeforeDispatch: false,
  },
  documentRules: {
    mandatoryDocumentTypes: [
      "ID_PROOF",
      "APPOINTMENT_LETTER",
      "OFFER_LETTER",
      "RELIEVING_LETTER",
      "TAX_DOCUMENT",
    ],
    maxFileSizeMB: 10,
    allowedFileFormats: ["pdf", "png", "jpg", "jpeg"],
  },
  generalRules: {
    policyTitle: "Company Human Resources Operations & Employment Policy",
    policyCode: "POL-HR-2026",
    description: "Standard operating guidelines governing attendance, leaves, lifecycle, and workplace conduct.",
    emergencyContactMandatory: true,
    workFromHomeAllowed: false,
  },
  impactPointRules: {
    enabled: true,
    rules: [
      {
        ruleCode: "ON_TIME_COMPLETION",
        name: "On-Time Completion",
        description: "Awarded when a task is approved and completed on or before its deadline",
        points: 10,
        eventType: "TASK_COMPLETION",
        isEnabled: true,
      },
      {
        ruleCode: "EARLY_COMPLETION_BONUS",
        name: "Early Completion Bonus",
        description: "Additional bonus awarded when a task is submitted and approved before deadline",
        points: 5,
        eventType: "TASK_COMPLETION",
        isEnabled: true,
      },
      {
        ruleCode: "HIGH_PRIORITY_COMPLETION",
        name: "High Priority Task Completion",
        description: "Awarded when a HIGH or CRITICAL priority task is approved and completed",
        points: 20,
        eventType: "TASK_COMPLETION",
        isEnabled: true,
      },
      {
        ruleCode: "MANAGER_RECOGNITION",
        name: "Manager Recognition",
        description: "Points awarded by a manager or HR Admin for outstanding contribution",
        points: 10,
        eventType: "MANAGER_RECOGNITION",
        isEnabled: true,
      },
      {
        ruleCode: "MISSED_DEADLINE_DEDUCTION",
        name: "Verified Missed Deadline",
        description: "Deduction applied for a verified missed deadline without an approved extension or exception",
        points: -5,
        eventType: "DEADLINE_BREACH",
        isEnabled: false,
      },
    ],
    managerMonthlyCap: 100,
    allowRuleStacking: true,
  },
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
            isPaid: { type: Boolean, default: true },
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
        encashmentMinBalanceDays: { type: Number, default: 15 },
        accrualFrequency: { type: String, default: "YEARLY" },
        priorNoticeDays: { type: Number, default: 1 },
      },
      attendanceRules: {
        officeStartTime: { type: String, default: "09:30", trim: true },
        officeEndTime: { type: String, default: "18:30", trim: true },
        gracePeriodMinutes: { type: Number, default: 15 },
        lateArrivalThresholdMinutes: { type: Number, default: 30 },
        breakDurationMinutes: { type: Number, default: 60 },
        halfDayThresholdHours: { type: Number, default: 4.5 },
        fullDayThresholdHours: { type: Number, default: 8.0 },
        autoCheckoutEnabled: { type: Boolean, default: false },
        autoCheckoutTime: { type: String, default: "", trim: true },
      },
      workHoursRules: {
        standardDailyHours: { type: Number, default: 8 },
        standardWeeklyHours: { type: Number, default: 40 },
        overtimeAllowed: { type: Boolean, default: false },
        overtimeThresholdDailyHours: { type: Number, default: 9 },
        shiftName: { type: String, default: "General Day Shift", trim: true },
      },
      weekendRules: {
        saturdayOff: { type: Boolean, default: true },
        sundayOff: { type: Boolean, default: true },
        alternateSaturdaysOff: { type: Boolean, default: false },
        isPaidWeekend: { type: Boolean, default: true },
      },
      holidays: {
        type: [
          {
            name: { type: String, required: true, trim: true },
            date: { type: Date, required: true },
            type: { type: String, default: "Gazetted Holiday" },
            isPaid: { type: Boolean, default: true },
          },
        ],
        default: DEFAULT_HR_POLICY.holidays,
      },
      locationRules: {
        requireLocationForPunch: { type: Boolean, default: true },
        allowWebTracking: { type: Boolean, default: true },
        geofenceEnabled: { type: Boolean, default: false },
        geofenceRadiusMeters: { type: Number, default: 200 },
        officeLatitude: { type: Number, default: null },
        officeLongitude: { type: Number, default: null },
        officeAddress: { type: String, default: "", trim: true },
      },
      payrollRules: {
        currencySymbol: { type: String, default: "₹", trim: true },
        currencyCode: { type: String, default: "INR", trim: true },
        payCycleStartDay: { type: Number, default: 1 },
        salaryCalculationBasis: { type: String, default: "ACTUAL_MONTH_DAYS", trim: true },
        standardWorkingHoursPerWeek: { type: Number, default: 40 },
        deductLopForUnpaidLeave: { type: Boolean, default: true },
        lateDeductionGraceCount: { type: Number, default: 3 },
        halfDayDeductionRate: { type: Number, default: 50 },
        areHolidaysPaid: { type: Boolean, default: true },
      },
      salaryComponentRules: {
        allowances: {
          type: [
            {
              name: { type: String, required: true, trim: true },
              code: { type: String, required: true, trim: true },
              taxable: { type: Boolean, default: true },
              percentageOfCtc: { type: Number, default: 0 },
            },
          ],
          default: DEFAULT_HR_POLICY.salaryComponentRules.allowances,
        },
        deductions: {
          type: [
            {
              name: { type: String, required: true, trim: true },
              code: { type: String, required: true, trim: true },
              ratePercent: { type: Number, default: 0 },
            },
          ],
          default: DEFAULT_HR_POLICY.salaryComponentRules.deductions,
        },
      },
      taxStatutoryRules: {
        panRequiredForPayroll: { type: Boolean, default: true },
        pfApplicable: { type: Boolean, default: true },
        pfDeductionRatePercent: { type: Number, default: 12 },
        esiApplicable: { type: Boolean, default: false },
        esiThresholdAmount: { type: Number, default: 21000 },
        ptApplicable: { type: Boolean, default: true },
        disclaimer: {
          type: String,
          default:
            "Company deductions configure baseline statutory payroll rules and do not substitute for formal fiscal counsel.",
        },
      },
      lifecycleRules: {
        probationDurationMonths: { type: Number, default: 3 },
        confirmationReviewRequired: { type: Boolean, default: true },
        noticePeriodDays: { type: Number, default: 30 },
        noticePeriodServingRequired: { type: Boolean, default: true },
        resignationApprovalLevels: { type: Number, default: 1 },
      },
      recruitmentRules: {
        offerValidityDays: { type: Number, default: 7 },
        requireCandidateSignature: { type: Boolean, default: true },
        autoExpireOffers: { type: Boolean, default: true },
        approvalRequiredBeforeDispatch: { type: Boolean, default: false },
      },
      documentRules: {
        mandatoryDocumentTypes: {
          type: [String],
          default: DEFAULT_HR_POLICY.documentRules.mandatoryDocumentTypes,
        },
        maxFileSizeMB: { type: Number, default: 10 },
        allowedFileFormats: {
          type: [String],
          default: ["pdf", "png", "jpg", "jpeg"],
        },
      },
      generalRules: {
        policyTitle: {
          type: String,
          default: "Company Human Resources Operations & Employment Policy",
          trim: true,
        },
        policyCode: { type: String, default: "POL-HR-2026", trim: true },
        description: {
          type: String,
          default:
            "Standard operating guidelines governing attendance, leaves, lifecycle, and workplace conduct.",
          trim: true,
        },
        emergencyContactMandatory: { type: Boolean, default: true },
        workFromHomeAllowed: { type: Boolean, default: false },
      },
      impactPointRules: {
        enabled: { type: Boolean, default: true },
        rules: {
          type: [
            {
              ruleCode: { type: String, required: true },
              name: { type: String, required: true },
              description: { type: String, default: "" },
              points: { type: Number, required: true },
              eventType: { type: String, required: true },
              isEnabled: { type: Boolean, default: true },
            },
          ],
          default: () => [
            {
              ruleCode: "ON_TIME_COMPLETION",
              name: "On-Time Completion",
              description: "Awarded when a task is approved and completed on or before its deadline",
              points: 10,
              eventType: "TASK_COMPLETION",
              isEnabled: true,
            },
            {
              ruleCode: "EARLY_COMPLETION_BONUS",
              name: "Early Completion Bonus",
              description: "Additional bonus awarded when a task is submitted and approved before deadline",
              points: 5,
              eventType: "TASK_COMPLETION",
              isEnabled: true,
            },
            {
              ruleCode: "HIGH_PRIORITY_COMPLETION",
              name: "High Priority Task Completion",
              description: "Awarded when a HIGH or CRITICAL priority task is approved and completed",
              points: 20,
              eventType: "TASK_COMPLETION",
              isEnabled: true,
            },
            {
              ruleCode: "MANAGER_RECOGNITION",
              name: "Manager Recognition",
              description: "Points awarded by a manager or HR Admin for outstanding contribution",
              points: 10,
              eventType: "MANAGER_RECOGNITION",
              isEnabled: true,
            },
            {
              ruleCode: "MISSED_DEADLINE_DEDUCTION",
              name: "Verified Missed Deadline",
              description: "Deduction applied for a verified missed deadline without an approved extension or exception",
              points: -5,
              eventType: "DEADLINE_BREACH",
              isEnabled: false,
            },
          ],
        },
        managerMonthlyCap: { type: Number, default: 100 },
        allowRuleStacking: { type: Boolean, default: true },
      },
      updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
      notes: {
        type: String,
        trim: true,
        default: "",
      },
      schemaVersion: {
        type: Number,
        default: 2,
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

  if (!policy.impactPointRules) {
    policy.impactPointRules = DEFAULT_HR_POLICY.impactPointRules;
  }

  return policy;
}

/**
 * Get all policy revisions sorted by effectiveFromDate desc
 */
export async function getCompanyHrPolicyHistory(CompanyHrPolicy) {
  if (!CompanyHrPolicy) return [];
  return CompanyHrPolicy.find()
    .sort({ effectiveFromDate: -1, createdAt: -1 })
    .lean();
}
