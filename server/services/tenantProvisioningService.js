import Company from "../models/Company.js";
import { getCentralDbName, getTenantConnection } from "../config/db.js";
import { getLeaveRequestModel } from "../models/LeaveRequest.js";
import { getCompanyHrPolicyModel, DEFAULT_HR_POLICY } from "../models/CompanyHrPolicy.js";
import { getOfferLetterModel } from "../models/OfferLetter.js";

/**
 * Ensures leave_requests and company_hr_policies collections, approved indexes,
 * and at least one valid policy document exist for a tenant database.
 * Idempotent: safe to run multiple times without duplicating data or dropping indexes.
 */
export async function provisionTenantDatabase(company, connection) {
  if (!company || !company.databaseName) {
    throw new Error("Invalid company object: databaseName is required");
  }

  const centralDb = getCentralDbName();
  if (company.databaseName === centralDb) {
    throw new Error(
      `Production safety check failed: Cannot run tenant provisioning against central platform database '${centralDb}'`
    );
  }

  const conn = connection || (await getTenantConnection(company.databaseName));
  const db = conn.db;

  const outcome = {
    companySlug: company.slug,
    databaseName: company.databaseName,
    collectionsCreated: [],
    indexesCreated: [],
    policyProvisioned: false,
    policyUpdated: false,
    repaired: false,
    needsManualConfiguration: false,
    message: "",
  };

  // 1. List existing collections in the tenant database
  const existingCols = await db.listCollections().toArray();
  const existingColNames = new Set(existingCols.map((c) => c.name));

  // 2. Ensure leave_requests collection exists
  if (!existingColNames.has("leave_requests")) {
    await db.createCollection("leave_requests");
    outcome.collectionsCreated.push("leave_requests");
    outcome.repaired = true;
  }

  // Ensure approved indexes on leave_requests
  const LeaveRequest = getLeaveRequestModel(conn);
  try {
    await LeaveRequest.createIndexes();
    outcome.indexesCreated.push("leave_requests: (employeeId, status, fromDate), (status, fromDate)");
  } catch (idxErr) {
    console.warn(`[TenantProvisioning] Index creation warning on ${company.databaseName}:`, idxErr.message);
  }

  // 3. Ensure company_hr_policies collection exists
  if (!existingColNames.has("company_hr_policies")) {
    await db.createCollection("company_hr_policies");
    outcome.collectionsCreated.push("company_hr_policies");
    outcome.repaired = true;
  }

  const CompanyHrPolicy = getCompanyHrPolicyModel(conn);
  try {
    await CompanyHrPolicy.createIndexes();
    outcome.indexesCreated.push("company_hr_policies: { effectiveFromDate: -1 }");
  } catch (idxErr) {
    console.warn(`[TenantProvisioning] Index creation warning on ${company.databaseName}:`, idxErr.message);
  }

  // 4. Ensure at least one valid policy document exists
  const policyCol = db.collection("company_hr_policies");
  const existingPolicyCount = await policyCol.countDocuments();
  if (existingPolicyCount === 0) {
    // Determine company-configured office start time or approved default
    const configuredOfficeStartTime = company.config?.officeStartTime || "09:30";
    const configuredOfficeEndTime = company.config?.officeEndTime || "18:30";

    const initialPolicy = {
      ...DEFAULT_HR_POLICY,
      effectiveFromDate: new Date("2026-01-01"),
      attendanceRules: {
        officeStartTime: configuredOfficeStartTime,
        officeEndTime: configuredOfficeEndTime,
      },
      schemaVersion: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await policyCol.insertOne(initialPolicy);
    outcome.policyProvisioned = true;
    outcome.repaired = true;
  } else {
    // Policy exists: Never overwrite company-specific settings or leave entitlements!
    // Check if the current applicable policy revision lacks attendanceRules.officeStartTime
    const activePolicy = await policyCol.find().sort({ effectiveFromDate: -1 }).limit(1).next();

    if (
      activePolicy &&
      (!activePolicy.attendanceRules || !activePolicy.attendanceRules.officeStartTime)
    ) {
      // Safely backfill attendanceRules without modifying leave types or rules
      const configuredOfficeStartTime = company.config?.officeStartTime || "09:30";
      const configuredOfficeEndTime = company.config?.officeEndTime || "18:30";

      await policyCol.updateOne(
        { _id: activePolicy._id },
        {
          $set: {
            "attendanceRules.officeStartTime": configuredOfficeStartTime,
            "attendanceRules.officeEndTime": configuredOfficeEndTime,
            updatedAt: new Date(),
          },
        }
      );
      outcome.policyUpdated = true;
      outcome.repaired = true;
    }
  }

  // 5. Ensure offer_letters collection exists
  if (!existingColNames.has("offer_letters")) {
    await db.createCollection("offer_letters");
    outcome.collectionsCreated.push("offer_letters");
    outcome.repaired = true;
  }

  const OfferLetter = getOfferLetterModel(conn);
  try {
    await OfferLetter.createIndexes();
    outcome.indexesCreated.push("offer_letters: { status: 1, createdAt: -1 }, { 'candidate.email': 1 }");
  } catch (idxErr) {
    console.warn(`[TenantProvisioning] Index creation warning on ${company.databaseName}:`, idxErr.message);
  }

  outcome.message = outcome.repaired
    ? `Tenant database '${company.databaseName}' was successfully repaired/provisioned.`
    : `Tenant database '${company.databaseName}' is fully provisioned and up to date.`;

  return outcome;
}

/**
 * Iterates through all companies in the central database and provisions
 * leave collections and policies for every tenant database.
 */
export async function provisionAllTenantDatabases() {
  const centralDb = getCentralDbName();
  const companies = await Company.find({}).lean();

  const report = {
    totalCompanies: companies.length,
    checked: [],
    repaired: [],
    alreadyUpToDate: [],
    needsManualConfiguration: [],
    errors: [],
  };

  for (const company of companies) {
    const slug = company.slug;
    const dbName = company.databaseName;

    if (dbName === centralDb) {
      report.errors.push({
        slug,
        databaseName: dbName,
        error: "Database name matches central database. Skipped for production safety.",
      });
      continue;
    }

    try {
      report.checked.push({ slug, databaseName: dbName });
      const outcome = await provisionTenantDatabase(company);

      if (outcome.repaired) {
        report.repaired.push({
          slug,
          databaseName: dbName,
          collectionsCreated: outcome.collectionsCreated,
          policyProvisioned: outcome.policyProvisioned,
          policyUpdated: outcome.policyUpdated,
        });
      } else {
        report.alreadyUpToDate.push({ slug, databaseName: dbName });
      }

      if (outcome.needsManualConfiguration) {
        report.needsManualConfiguration.push({ slug, databaseName: dbName });
      }
    } catch (err) {
      report.errors.push({
        slug,
        databaseName: dbName,
        error: err.message,
      });
    }
  }

  return report;
}
