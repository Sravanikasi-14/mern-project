import {
  getActiveCompanyHrPolicy,
  getCompanyHrPolicyHistory,
  DEFAULT_HR_POLICY,
} from "../models/CompanyHrPolicy.js";
import { AUDIT_ACTIONS } from "../models/AuditLog.js";
import { HttpError } from "../utils/httpError.js";
import { parseTimeToMinutes, toDateString, parseDateOnly } from "../services/leaveService.js";

async function recordPolicyAudit(AuditLog, req, action, policyId, changes) {
  try {
    if (!AuditLog || !req.auth?.user) return;
    await AuditLog.create({
      actorUserId: req.auth.user._id,
      actorEmail: req.auth.user.email,
      actorRole: req.auth.user.role,
      action,
      targetType: "CompanyHrPolicy",
      targetId: policyId,
      changes: changes || {},
      ipAddress: req.ip || "",
      timestamp: new Date(),
    });
  } catch (err) {
    console.error("Policy audit log error:", err.message);
  }
}

/**
 * Validates and sanitizes HR Policy payload with support for partial section updates
 */
export function validatePolicyPayload(body, existingPolicy = null) {
  if (!body || typeof body !== "object") {
    throw new HttpError(400, "Request body must be a valid policy object.");
  }

  // 1. Effective Date
  const rawEffectiveDate = body.effectiveFromDate || existingPolicy?.effectiveFromDate;
  if (!rawEffectiveDate) {
    throw new HttpError(400, "Effective from date (effectiveFromDate) is required.");
  }
  const effectiveDate = new Date(rawEffectiveDate);
  if (isNaN(effectiveDate.getTime())) {
    throw new HttpError(400, "Effective from date must be a valid date.");
  }

  // 2. Leave Types
  const rawLeaveTypes =
    body.leaveTypes !== undefined
      ? body.leaveTypes
      : existingPolicy?.leaveTypes || DEFAULT_HR_POLICY.leaveTypes;

  if (!Array.isArray(rawLeaveTypes) || rawLeaveTypes.length === 0) {
    throw new HttpError(400, "At least one leave type must be configured.");
  }

  const seenCodes = new Set();
  const sanitizedLeaveTypes = [];
  let hasActiveType = false;

  for (let i = 0; i < rawLeaveTypes.length; i++) {
    const lt = rawLeaveTypes[i];
    if (!lt || typeof lt !== "object") {
      throw new HttpError(400, `Invalid leave type entry at index ${i}.`);
    }

    const code = String(lt.code || "").trim().toUpperCase();
    if (!code || !/^[A-Z0-9_]{2,20}$/.test(code)) {
      throw new HttpError(
        400,
        `Leave type code '${lt.code}' is invalid. Code must be 2-20 uppercase alphanumeric characters or underscores.`
      );
    }

    if (seenCodes.has(code)) {
      throw new HttpError(400, `Duplicate leave type code '${code}' in policy configuration.`);
    }
    seenCodes.add(code);

    const name = String(lt.name || "").trim();
    if (!name || name.length < 2 || name.length > 60) {
      throw new HttpError(400, `Leave type name for '${code}' must be between 2 and 60 characters.`);
    }

    const yearlyDays = Number(lt.yearlyDays);
    if (isNaN(yearlyDays) || yearlyDays < 0 || yearlyDays > 365) {
      throw new HttpError(400, `Annual entitlement (yearlyDays) for '${code}' must be between 0 and 365.`);
    }

    const isPaid = lt.isPaid !== undefined ? Boolean(lt.isPaid) : true;
    const isActive = lt.isActive !== undefined ? Boolean(lt.isActive) : true;
    if (isActive) hasActiveType = true;

    sanitizedLeaveTypes.push({
      code,
      name,
      yearlyDays,
      isPaid,
      isActive,
    });
  }

  if (!hasActiveType) {
    throw new HttpError(400, "At least one active leave type is required in the policy.");
  }

  // 3. Leave Rules
  const rawRules =
    body.leaveRules !== undefined
      ? body.leaveRules
      : existingPolicy?.leaveRules || DEFAULT_HR_POLICY.leaveRules;

  const probationMonths =
    rawRules.probationMonths !== undefined ? Number(rawRules.probationMonths) : 3;
  if (isNaN(probationMonths) || probationMonths < 0 || probationMonths > 24) {
    throw new HttpError(400, "Probation duration must be between 0 and 24 months.");
  }

  const maxConsecutiveDays =
    rawRules.maxConsecutiveDays !== undefined ? Number(rawRules.maxConsecutiveDays) : 14;
  if (isNaN(maxConsecutiveDays) || maxConsecutiveDays < 1 || maxConsecutiveDays > 180) {
    throw new HttpError(400, "Maximum consecutive leave days must be between 1 and 180 days.");
  }

  const leaveYearStartMonth =
    rawRules.leaveYearStartMonth !== undefined ? parseInt(rawRules.leaveYearStartMonth, 10) : 1;
  if (isNaN(leaveYearStartMonth) || leaveYearStartMonth < 1 || leaveYearStartMonth > 12) {
    throw new HttpError(400, "Leave-year start month must be an integer between 1 and 12.");
  }

  const carryForwardLimitDays =
    rawRules.carryForwardLimitDays !== undefined ? Number(rawRules.carryForwardLimitDays) : 10;
  if (isNaN(carryForwardLimitDays) || carryForwardLimitDays < 0 || carryForwardLimitDays > 365) {
    throw new HttpError(400, "Carry-forward limit must be between 0 and 365 days.");
  }

  const allowEncashment = Boolean(rawRules.allowEncashment);
  const encashmentMinBalanceDays =
    rawRules.encashmentMinBalanceDays !== undefined ? Number(rawRules.encashmentMinBalanceDays) : 15;
  const accrualFrequency = ["YEARLY", "MONTHLY", "QUARTERLY"].includes(rawRules.accrualFrequency)
    ? rawRules.accrualFrequency
    : "YEARLY";
  const priorNoticeDays =
    rawRules.priorNoticeDays !== undefined ? Number(rawRules.priorNoticeDays) : 1;

  const sanitizedLeaveRules = {
    probationMonths,
    maxConsecutiveDays,
    leaveYearStartMonth,
    carryForwardLimitDays,
    allowEncashment,
    encashmentMinBalanceDays,
    accrualFrequency,
    priorNoticeDays,
  };

  // 4. Attendance Rules
  const rawAttendance =
    body.attendanceRules !== undefined
      ? body.attendanceRules
      : existingPolicy?.attendanceRules || DEFAULT_HR_POLICY.attendanceRules;

  const officeStartTime = String(rawAttendance.officeStartTime || "09:30").trim();
  const officeEndTime = String(rawAttendance.officeEndTime || "18:30").trim();

  const startMinutes = parseTimeToMinutes(officeStartTime);
  if (startMinutes === null) {
    throw new HttpError(400, `Office start time '${officeStartTime}' is invalid. Expected HH:mm 24-hour format.`);
  }

  const endMinutes = parseTimeToMinutes(officeEndTime);
  if (endMinutes === null) {
    throw new HttpError(400, `Office end time '${officeEndTime}' is invalid. Expected HH:mm 24-hour format.`);
  }

  if (startMinutes >= endMinutes) {
    throw new HttpError(400, `Office start time (${officeStartTime}) must be earlier than office end time (${officeEndTime}).`);
  }

  const gracePeriodMinutes =
    rawAttendance.gracePeriodMinutes !== undefined ? Number(rawAttendance.gracePeriodMinutes) : 15;
  const lateArrivalThresholdMinutes =
    rawAttendance.lateArrivalThresholdMinutes !== undefined ? Number(rawAttendance.lateArrivalThresholdMinutes) : 30;
  const breakDurationMinutes =
    rawAttendance.breakDurationMinutes !== undefined ? Number(rawAttendance.breakDurationMinutes) : 60;
  const halfDayThresholdHours =
    rawAttendance.halfDayThresholdHours !== undefined ? Number(rawAttendance.halfDayThresholdHours) : 4.5;
  const fullDayThresholdHours =
    rawAttendance.fullDayThresholdHours !== undefined ? Number(rawAttendance.fullDayThresholdHours) : 8.0;
  const autoCheckoutEnabled = Boolean(rawAttendance.autoCheckoutEnabled);
  const autoCheckoutTime = String(rawAttendance.autoCheckoutTime || "").trim();

  const sanitizedAttendanceRules = {
    officeStartTime,
    officeEndTime,
    gracePeriodMinutes,
    lateArrivalThresholdMinutes,
    breakDurationMinutes,
    halfDayThresholdHours,
    fullDayThresholdHours,
    autoCheckoutEnabled,
    autoCheckoutTime,
  };

  // 5. Work Hours & Shifts Rules
  const rawWorkHours =
    body.workHoursRules !== undefined
      ? body.workHoursRules
      : existingPolicy?.workHoursRules || DEFAULT_HR_POLICY.workHoursRules;

  const standardDailyHours =
    rawWorkHours.standardDailyHours !== undefined ? Number(rawWorkHours.standardDailyHours) : 8;
  const standardWeeklyHours =
    rawWorkHours.standardWeeklyHours !== undefined ? Number(rawWorkHours.standardWeeklyHours) : 40;
  const overtimeAllowed = Boolean(rawWorkHours.overtimeAllowed);
  const overtimeThresholdDailyHours =
    rawWorkHours.overtimeThresholdDailyHours !== undefined ? Number(rawWorkHours.overtimeThresholdDailyHours) : 9;
  const shiftName = String(rawWorkHours.shiftName || "General Day Shift").trim();

  const sanitizedWorkHoursRules = {
    standardDailyHours,
    standardWeeklyHours,
    overtimeAllowed,
    overtimeThresholdDailyHours,
    shiftName,
  };

  // 6. Weekend Rules
  const rawWeekends =
    body.weekendRules !== undefined
      ? body.weekendRules
      : existingPolicy?.weekendRules || DEFAULT_HR_POLICY.weekendRules;

  const sanitizedWeekendRules = {
    saturdayOff: rawWeekends.saturdayOff !== undefined ? Boolean(rawWeekends.saturdayOff) : true,
    sundayOff: rawWeekends.sundayOff !== undefined ? Boolean(rawWeekends.sundayOff) : true,
    alternateSaturdaysOff: Boolean(rawWeekends.alternateSaturdaysOff),
    isPaidWeekend: rawWeekends.isPaidWeekend !== undefined ? Boolean(rawWeekends.isPaidWeekend) : true,
  };

  // 7. Company Holidays
  const rawHolidays =
    body.holidays !== undefined
      ? body.holidays
      : existingPolicy?.holidays || DEFAULT_HR_POLICY.holidays;

  const sanitizedHolidays = [];
  const seenHolidays = new Set();

  for (let i = 0; i < rawHolidays.length; i++) {
    const h = rawHolidays[i];
    if (!h || typeof h !== "object") {
      throw new HttpError(400, `Invalid holiday entry at index ${i}.`);
    }

    const name = String(h.name || "").trim();
    if (!name || name.length < 2 || name.length > 80) {
      throw new HttpError(400, `Holiday name at index ${i} must be between 2 and 80 characters.`);
    }

    if (!h.date) {
      throw new HttpError(400, `Holiday date is required for '${name}'.`);
    }
    const holidayDate = new Date(h.date);
    if (isNaN(holidayDate.getTime())) {
      throw new HttpError(400, `Invalid holiday date for '${name}'.`);
    }

    const dateStr = toDateString(holidayDate);
    const key = `${dateStr}:${name.toLowerCase()}`;
    if (seenHolidays.has(key)) {
      throw new HttpError(
        400,
        `Duplicate holiday entry for date '${dateStr}' and name '${name}'. A holiday with this date and name already exists.`
      );
    }
    seenHolidays.add(key);

    const type = String(h.type || "Gazetted Holiday").trim();
    const isPaid = h.isPaid !== undefined ? Boolean(h.isPaid) : true;

    sanitizedHolidays.push({
      name,
      date: holidayDate,
      type: type || "Gazetted Holiday",
      isPaid,
    });
  }

  sanitizedHolidays.sort((a, b) => a.date - b.date);

  // 8. Location & Geofence Rules
  const rawLoc =
    body.locationRules !== undefined
      ? body.locationRules
      : existingPolicy?.locationRules || DEFAULT_HR_POLICY.locationRules;

  const sanitizedLocationRules = {
    requireLocationForPunch:
      rawLoc.requireLocationForPunch !== undefined ? Boolean(rawLoc.requireLocationForPunch) : true,
    allowWebTracking: rawLoc.allowWebTracking !== undefined ? Boolean(rawLoc.allowWebTracking) : true,
    geofenceEnabled: Boolean(rawLoc.geofenceEnabled),
    geofenceRadiusMeters:
      rawLoc.geofenceRadiusMeters !== undefined ? Number(rawLoc.geofenceRadiusMeters) : 200,
    officeLatitude: rawLoc.officeLatitude !== undefined ? rawLoc.officeLatitude : null,
    officeLongitude: rawLoc.officeLongitude !== undefined ? rawLoc.officeLongitude : null,
    officeAddress: String(rawLoc.officeAddress || "").trim(),
  };

  // 9. Payroll Rules
  const rawPayroll =
    body.payrollRules !== undefined
      ? body.payrollRules
      : existingPolicy?.payrollRules || DEFAULT_HR_POLICY.payrollRules;

  const sanitizedPayrollRules = {
    currencySymbol: String(rawPayroll.currencySymbol || "₹").trim(),
    currencyCode: String(rawPayroll.currencyCode || "INR").trim().toUpperCase(),
    payCycleStartDay:
      rawPayroll.payCycleStartDay !== undefined ? Number(rawPayroll.payCycleStartDay) : 1,
    salaryCalculationBasis: String(rawPayroll.salaryCalculationBasis || "ACTUAL_MONTH_DAYS").trim(),
    standardWorkingHoursPerWeek:
      rawPayroll.standardWorkingHoursPerWeek !== undefined
        ? Number(rawPayroll.standardWorkingHoursPerWeek)
        : 40,
    deductLopForUnpaidLeave:
      rawPayroll.deductLopForUnpaidLeave !== undefined
        ? Boolean(rawPayroll.deductLopForUnpaidLeave)
        : true,
    lateDeductionGraceCount:
      rawPayroll.lateDeductionGraceCount !== undefined
        ? Number(rawPayroll.lateDeductionGraceCount)
        : 3,
    halfDayDeductionRate:
      rawPayroll.halfDayDeductionRate !== undefined ? Number(rawPayroll.halfDayDeductionRate) : 50,
    areHolidaysPaid:
      rawPayroll.areHolidaysPaid !== undefined ? Boolean(rawPayroll.areHolidaysPaid) : true,
  };

  // 10. Salary Component Rules
  const rawSalComp =
    body.salaryComponentRules !== undefined
      ? body.salaryComponentRules
      : existingPolicy?.salaryComponentRules || DEFAULT_HR_POLICY.salaryComponentRules;

  const rawAllowances = Array.isArray(rawSalComp.allowances)
    ? rawSalComp.allowances
    : DEFAULT_HR_POLICY.salaryComponentRules.allowances;

  const seenAllowanceCodes = new Set();
  const sanitizedAllowances = [];
  for (let i = 0; i < rawAllowances.length; i++) {
    const a = rawAllowances[i];
    if (!a || typeof a !== "object") continue;
    const name = String(a.name || "").trim();
    const code = String(a.code || "").trim().toUpperCase();
    if (!name || name.length < 2) {
      throw new HttpError(400, `Allowance name at index ${i} must be at least 2 characters.`);
    }
    if (!code || !/^[A-Z0-9_]{2,20}$/.test(code)) {
      throw new HttpError(400, `Allowance code '${code || a.code}' must be 2-20 uppercase letters, numbers, or underscores.`);
    }
    if (seenAllowanceCodes.has(code)) {
      throw new HttpError(400, `Duplicate allowance code '${code}' in salary component configuration.`);
    }
    seenAllowanceCodes.add(code);
    const percentageOfCtc = Number(a.percentageOfCtc);
    if (isNaN(percentageOfCtc) || percentageOfCtc < 0 || percentageOfCtc > 100) {
      throw new HttpError(400, `Allowance percentage for '${code}' must be between 0 and 100.`);
    }
    sanitizedAllowances.push({
      name,
      code,
      taxable: a.taxable !== undefined ? Boolean(a.taxable) : true,
      percentageOfCtc,
    });
  }

  const rawDeductions = Array.isArray(rawSalComp.deductions)
    ? rawSalComp.deductions
    : DEFAULT_HR_POLICY.salaryComponentRules.deductions;

  const seenDeductionCodes = new Set();
  const sanitizedDeductions = [];
  for (let i = 0; i < rawDeductions.length; i++) {
    const d = rawDeductions[i];
    if (!d || typeof d !== "object") continue;
    const name = String(d.name || "").trim();
    const code = String(d.code || "").trim().toUpperCase();
    if (!name || name.length < 2) {
      throw new HttpError(400, `Deduction name at index ${i} must be at least 2 characters.`);
    }
    if (!code || !/^[A-Z0-9_]{2,20}$/.test(code)) {
      throw new HttpError(400, `Deduction code '${code || d.code}' must be 2-20 uppercase letters, numbers, or underscores.`);
    }
    if (seenDeductionCodes.has(code)) {
      throw new HttpError(400, `Duplicate deduction code '${code}' in salary component configuration.`);
    }
    seenDeductionCodes.add(code);
    const ratePercent = Number(d.ratePercent);
    if (isNaN(ratePercent) || ratePercent < 0 || ratePercent > 100) {
      throw new HttpError(400, `Deduction rate percentage for '${code}' must be between 0 and 100.`);
    }
    sanitizedDeductions.push({
      name,
      code,
      ratePercent,
    });
  }

  const sanitizedSalaryComponentRules = {
    allowances: sanitizedAllowances,
    deductions: sanitizedDeductions,
  };

  // 11. Tax & Statutory Rules
  const rawTax =
    body.taxStatutoryRules !== undefined
      ? body.taxStatutoryRules
      : existingPolicy?.taxStatutoryRules || DEFAULT_HR_POLICY.taxStatutoryRules;

  const sanitizedTaxStatutoryRules = {
    panRequiredForPayroll:
      rawTax.panRequiredForPayroll !== undefined ? Boolean(rawTax.panRequiredForPayroll) : true,
    pfApplicable: rawTax.pfApplicable !== undefined ? Boolean(rawTax.pfApplicable) : true,
    pfDeductionRatePercent:
      rawTax.pfDeductionRatePercent !== undefined ? Number(rawTax.pfDeductionRatePercent) : 12,
    esiApplicable: Boolean(rawTax.esiApplicable),
    esiThresholdAmount:
      rawTax.esiThresholdAmount !== undefined ? Number(rawTax.esiThresholdAmount) : 21000,
    ptApplicable: rawTax.ptApplicable !== undefined ? Boolean(rawTax.ptApplicable) : true,
    disclaimer: String(
      rawTax.disclaimer ||
        "Company deductions configure baseline statutory payroll rules and do not substitute for formal fiscal counsel."
    ).trim(),
  };

  // 12. Lifecycle Rules
  const rawLife =
    body.lifecycleRules !== undefined
      ? body.lifecycleRules
      : existingPolicy?.lifecycleRules || DEFAULT_HR_POLICY.lifecycleRules;

  const sanitizedLifecycleRules = {
    probationDurationMonths:
      rawLife.probationDurationMonths !== undefined ? Number(rawLife.probationDurationMonths) : 3,
    confirmationReviewRequired:
      rawLife.confirmationReviewRequired !== undefined ? Boolean(rawLife.confirmationReviewRequired) : true,
    noticePeriodDays: rawLife.noticePeriodDays !== undefined ? Number(rawLife.noticePeriodDays) : 30,
    noticePeriodServingRequired:
      rawLife.noticePeriodServingRequired !== undefined
        ? Boolean(rawLife.noticePeriodServingRequired)
        : true,
    resignationApprovalLevels:
      rawLife.resignationApprovalLevels !== undefined ? Number(rawLife.resignationApprovalLevels) : 1,
  };

  // 13. Recruitment Rules
  const rawRec =
    body.recruitmentRules !== undefined
      ? body.recruitmentRules
      : existingPolicy?.recruitmentRules || DEFAULT_HR_POLICY.recruitmentRules;

  const sanitizedRecruitmentRules = {
    offerValidityDays:
      rawRec.offerValidityDays !== undefined ? Math.max(1, Math.min(90, Number(rawRec.offerValidityDays) || 7)) : 7,
    requireCandidateSignature:
      rawRec.requireCandidateSignature !== undefined
        ? Boolean(rawRec.requireCandidateSignature)
        : true,
    autoExpireOffers:
      rawRec.autoExpireOffers !== undefined ? Boolean(rawRec.autoExpireOffers) : true,
    approvalRequiredBeforeDispatch: Boolean(rawRec.approvalRequiredBeforeDispatch),
  };

  // 14. Document Rules
  const rawDoc =
    body.documentRules !== undefined
      ? body.documentRules
      : existingPolicy?.documentRules || DEFAULT_HR_POLICY.documentRules;

  const rawDocTypes = Array.isArray(rawDoc.mandatoryDocumentTypes)
    ? rawDoc.mandatoryDocumentTypes
    : DEFAULT_HR_POLICY.documentRules.mandatoryDocumentTypes;

  const sanitizedDocTypes = Array.from(
    new Set(rawDocTypes.map((t) => String(t || "").trim().toUpperCase()).filter(Boolean))
  );

  const rawFormats = Array.isArray(rawDoc.allowedFileFormats)
    ? rawDoc.allowedFileFormats
    : DEFAULT_HR_POLICY.documentRules.allowedFileFormats;

  const sanitizedFormats = Array.from(
    new Set(rawFormats.map((f) => String(f || "").trim().toLowerCase().replace(/^\./, "")).filter(Boolean))
  );

  const sanitizedDocumentRules = {
    mandatoryDocumentTypes: sanitizedDocTypes,
    maxFileSizeMB:
      rawDoc.maxFileSizeMB !== undefined ? Math.max(1, Math.min(100, Number(rawDoc.maxFileSizeMB) || 10)) : 10,
    allowedFileFormats: sanitizedFormats.length > 0 ? sanitizedFormats : ["pdf", "png", "jpg", "jpeg"],
  };

  // 15. General Rules
  const rawGen =
    body.generalRules !== undefined
      ? body.generalRules
      : existingPolicy?.generalRules || DEFAULT_HR_POLICY.generalRules;

  const sanitizedGeneralRules = {
    policyTitle: String(
      rawGen.policyTitle || "Company Human Resources Operations & Employment Policy"
    ).trim(),
    policyCode: String(rawGen.policyCode || "POL-HR-2026").trim(),
    description: String(
      rawGen.description ||
        "Standard operating guidelines governing attendance, leaves, lifecycle, and workplace conduct."
    ).trim(),
    emergencyContactMandatory:
      rawGen.emergencyContactMandatory !== undefined
        ? Boolean(rawGen.emergencyContactMandatory)
        : true,
    workFromHomeAllowed: Boolean(rawGen.workFromHomeAllowed),
  };

  return {
    effectiveFromDate: effectiveDate,
    leaveTypes: sanitizedLeaveTypes,
    leaveRules: sanitizedLeaveRules,
    attendanceRules: sanitizedAttendanceRules,
    workHoursRules: sanitizedWorkHoursRules,
    weekendRules: sanitizedWeekendRules,
    holidays: sanitizedHolidays,
    locationRules: sanitizedLocationRules,
    payrollRules: sanitizedPayrollRules,
    salaryComponentRules: sanitizedSalaryComponentRules,
    taxStatutoryRules: sanitizedTaxStatutoryRules,
    lifecycleRules: sanitizedLifecycleRules,
    recruitmentRules: sanitizedRecruitmentRules,
    documentRules: sanitizedDocumentRules,
    generalRules: sanitizedGeneralRules,
    notes: typeof body.notes === "string" ? body.notes.trim() : (existingPolicy?.notes || ""),
  };
}

/**
 * GET /api/policies/active
 * Accessible to both HR_ADMIN and EMPLOYEE
 */
export async function getActivePolicy(req, res, next) {
  try {
    const { CompanyHrPolicy } = req.auth.models;
    const asOfParam = req.query.asOfDate;
    const asOfDate = asOfParam ? new Date(asOfParam) : new Date();

    const policy = await getActiveCompanyHrPolicy(
      CompanyHrPolicy,
      isNaN(asOfDate.getTime()) ? new Date() : asOfDate
    );

    res.json({
      success: true,
      policy,
      asOfDate: toDateString(isNaN(asOfDate.getTime()) ? new Date() : asOfDate),
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/policies/history
 * Strictly requires HR_ADMIN
 */
export async function getPolicyHistory(req, res, next) {
  try {
    const { CompanyHrPolicy } = req.auth.models;
    let policies = await getCompanyHrPolicyHistory(CompanyHrPolicy);

    if (policies.length === 0) {
      // Auto-provision default policy if none exist
      const active = await getActiveCompanyHrPolicy(CompanyHrPolicy);
      policies = [active];
    }

    res.json({
      success: true,
      policies,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/policies/leave-types/:code/in-use
 * Checks if a leave type code is referenced by any existing leave requests
 */
export async function checkLeaveTypeInUse(req, res, next) {
  try {
    const { LeaveRequest } = req.auth.models;
    const code = String(req.params.code || "").toUpperCase().trim();

    if (!code) {
      throw new HttpError(400, "Leave type code is required.");
    }

    const count = LeaveRequest
      ? await LeaveRequest.countDocuments({ leaveTypeCode: code })
      : 0;

    res.json({
      success: true,
      code,
      inUse: count > 0,
      count,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/policies/:id
 */
export async function getPolicyById(req, res, next) {
  try {
    const { CompanyHrPolicy } = req.auth.models;
    const policy = await CompanyHrPolicy.findById(req.params.id).lean();

    if (!policy) {
      throw new HttpError(404, "HR Policy revision not found.");
    }

    res.json({
      success: true,
      policy,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/policies
 * Create a new policy revision (e.g. for a future effective date)
 */
export async function createPolicyRevision(req, res, next) {
  try {
    const { CompanyHrPolicy, AuditLog } = req.auth.models;
    const sanitized = validatePolicyPayload(req.body);

    const targetDateStr = toDateString(sanitized.effectiveFromDate);
    const dayStart = parseDateOnly(targetDateStr);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000 - 1);

    // Check if a revision with the same effective date already exists
    const existing = await CompanyHrPolicy.findOne({
      effectiveFromDate: { $gte: dayStart, $lte: dayEnd },
    });

    if (existing) {
      throw new HttpError(
        409,
        `A policy revision with effective date '${targetDateStr}' already exists (ID: ${existing._id}). Please update that revision or select a different effective date.`
      );
    }

    const newPolicy = await CompanyHrPolicy.create({
      ...sanitized,
      updatedBy: req.auth.user._id,
      schemaVersion: 2,
    });

    await recordPolicyAudit(AuditLog, req, AUDIT_ACTIONS.HR_POLICY_CREATED, newPolicy._id, {
      effectiveFromDate: sanitized.effectiveFromDate,
      leaveTypesCount: sanitized.leaveTypes.length,
      holidaysCount: sanitized.holidays.length,
      officeStartTime: sanitized.attendanceRules.officeStartTime,
      officeEndTime: sanitized.attendanceRules.officeEndTime,
    });

    res.status(201).json({
      success: true,
      message: "New HR policy revision created successfully.",
      policy: newPolicy,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * PUT /api/policies/:id
 * Update an existing policy revision with safe leave-type deletion guard and section updates
 */
export async function updatePolicyRevision(req, res, next) {
  try {
    const { CompanyHrPolicy, LeaveRequest, AuditLog } = req.auth.models;
    const { id } = req.params;

    const existingPolicy = await CompanyHrPolicy.findById(id);
    if (!existingPolicy) {
      throw new HttpError(404, "HR Policy revision not found.");
    }

    const sanitized = validatePolicyPayload(req.body, existingPolicy);

    // Safe leave-type deletion check:
    // Determine which leave types from the existing policy are missing in the updated leaveTypes array
    const newCodeSet = new Set(sanitized.leaveTypes.map((t) => t.code));
    const missingCodes = (existingPolicy.leaveTypes || [])
      .map((t) => t.code)
      .filter((code) => !newCodeSet.has(code));

    if (missingCodes.length > 0 && LeaveRequest) {
      for (const code of missingCodes) {
        const usageCount = await LeaveRequest.countDocuments({ leaveTypeCode: code });
        if (usageCount > 0) {
          throw new HttpError(
            400,
            `Cannot remove leave type '${code}' because it is referenced by ${usageCount} existing leave request(s) or record(s). To discontinue this leave type, please deactivate it (set Active to No) instead of deleting it.`
          );
        }
      }
    }

    // Check if updating effectiveFromDate conflicts with another policy revision
    const targetDateStr = toDateString(sanitized.effectiveFromDate);
    const dayStart = parseDateOnly(targetDateStr);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000 - 1);

    const conflicting = await CompanyHrPolicy.findOne({
      _id: { $ne: existingPolicy._id },
      effectiveFromDate: { $gte: dayStart, $lte: dayEnd },
    });

    if (conflicting) {
      throw new HttpError(
        409,
        `Another policy revision already exists for effective date '${targetDateStr}'. Please choose a different date.`
      );
    }

    // Update document fields
    existingPolicy.effectiveFromDate = sanitized.effectiveFromDate;
    existingPolicy.leaveTypes = sanitized.leaveTypes;
    existingPolicy.leaveRules = sanitized.leaveRules;
    existingPolicy.attendanceRules = sanitized.attendanceRules;
    existingPolicy.workHoursRules = sanitized.workHoursRules;
    existingPolicy.weekendRules = sanitized.weekendRules;
    existingPolicy.holidays = sanitized.holidays;
    existingPolicy.locationRules = sanitized.locationRules;
    existingPolicy.payrollRules = sanitized.payrollRules;
    existingPolicy.salaryComponentRules = sanitized.salaryComponentRules;
    existingPolicy.taxStatutoryRules = sanitized.taxStatutoryRules;
    existingPolicy.lifecycleRules = sanitized.lifecycleRules;
    existingPolicy.recruitmentRules = sanitized.recruitmentRules;
    existingPolicy.documentRules = sanitized.documentRules;
    existingPolicy.generalRules = sanitized.generalRules;
    existingPolicy.notes = sanitized.notes;
    existingPolicy.updatedBy = req.auth.user._id;

    await existingPolicy.save();

    await recordPolicyAudit(AuditLog, req, AUDIT_ACTIONS.HR_POLICY_UPDATED, existingPolicy._id, {
      effectiveFromDate: sanitized.effectiveFromDate,
      leaveTypesCount: sanitized.leaveTypes.length,
      holidaysCount: sanitized.holidays.length,
      officeStartTime: sanitized.attendanceRules.officeStartTime,
      officeEndTime: sanitized.attendanceRules.officeEndTime,
    });

    res.json({
      success: true,
      message: "HR policy settings updated successfully.",
      policy: existingPolicy,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /api/policies/:id
 * Delete a policy revision (only if more than 1 revision exists)
 */
export async function deletePolicyRevision(req, res, next) {
  try {
    const { CompanyHrPolicy, AuditLog } = req.auth.models;
    const { id } = req.params;

    const count = await CompanyHrPolicy.countDocuments();
    if (count <= 1) {
      throw new HttpError(400, "Cannot delete the only HR policy revision. At least one policy revision must remain.");
    }

    const policy = await CompanyHrPolicy.findById(id);
    if (!policy) {
      throw new HttpError(404, "HR Policy revision not found.");
    }

    await CompanyHrPolicy.findByIdAndDelete(id);

    await recordPolicyAudit(AuditLog, req, AUDIT_ACTIONS.HR_POLICY_DELETED, policy._id, {
      effectiveFromDate: policy.effectiveFromDate,
      deletedAt: new Date(),
    });

    res.json({
      success: true,
      message: "HR policy revision deleted successfully.",
    });
  } catch (error) {
    next(error);
  }
}
