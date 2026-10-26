import mongoose from "mongoose";
import Company from "../models/Company.js";
import { getAuthSessionModel } from "../models/AuthSession.js";
import { getAuthTokenModel } from "../models/AuthToken.js";
import { getEmployeeModel } from "../models/Employee.js";
import { getEmployeeCompensationModel } from "../models/EmployeeCompensation.js";
import { getUserModel } from "../models/User.js";
import { getAuditLogModel } from "../models/AuditLog.js";
import { getLeaveRequestModel } from "../models/LeaveRequest.js";
import { getCompanyHrPolicyModel } from "../models/CompanyHrPolicy.js";
import { getOfferLetterModel } from "../models/OfferLetter.js";
import { getSettlementModel } from "../models/Settlement.js";
import { getAttendanceModel } from "../models/Attendance.js";
import { getLiveTrackingSessionModel } from "../models/LiveTrackingSession.js";
import { getPayrollCycleModel } from "../models/PayrollCycle.js";
import { getPayslipModel } from "../models/Payslip.js";
import { getCompanyAssetModel } from "../models/CompanyAsset.js";
import { getTaskModel } from "../models/Task.js";
import { getImpactPointTransactionModel } from "../models/ImpactPointTransaction.js";
import { HttpError } from "../utils/httpError.js";

const tenantConnections = new Map();

const DATABASE_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;

export function getCentralDbName() {
  return process.env.CENTRAL_DB_NAME || "platform";
}

export function getMongoUri() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error("MONGO_URI is not set");
  }
  return uri;
}

let centralConnectionPromise = null;

export async function connectCentralDB() {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  if (centralConnectionPromise) {
    return centralConnectionPromise;
  }

  centralConnectionPromise = (async () => {
    try {
      await mongoose.connect(getMongoUri(), {
        dbName: getCentralDbName(),
        serverSelectionTimeoutMS: 8000,
      });
      if (process.env.NODE_ENV !== "test") {
        console.log("Central MongoDB connected");
      }
      return mongoose.connection;
    } catch (error) {
      centralConnectionPromise = null;
      console.error("MongoDB connection failed:", error.message || error);
      throw error;
    }
  })();

  return centralConnectionPromise;
}

export async function getTenantConnection(databaseName) {
  if (typeof databaseName !== "string" || !DATABASE_NAME_PATTERN.test(databaseName)) {
    throw new HttpError(500, "Company database is not available");
  }

  const cached = tenantConnections.get(databaseName);
  if (cached) {
    if (cached.readyState === 1) {
      return cached;
    }
    if (cached.readyState === 2) {
      await cached.asPromise();
      return cached;
    }
    tenantConnections.delete(databaseName);
  }

  try {
    const connection = mongoose.createConnection(getMongoUri(), {
      dbName: databaseName,
      serverSelectionTimeoutMS: 8000,
    });
    tenantConnections.set(databaseName, connection);
    await connection.asPromise();
    return connection;
  } catch (error) {
    tenantConnections.delete(databaseName);
    throw new HttpError(503, "Company database is not available");
  }
}

const provisionedTenantDbs = new Set();

export async function getCompanyModels(company, { provision = false } = {}) {
  const connection = await getTenantConnection(company.databaseName);

  // In serverless production execution, skip automatic tenant provisioning on cold start.
  // Tenant collections, indexes, and initial policies are maintained via explicit provisioning
  // scripts (e.g. provisionCompany, provisionAllTenants) or registration workflows.
  const isServerlessProd =
    Boolean(process.env.VERCEL) ||
    Boolean(process.env.VERCEL_ENV) ||
    (process.env.NODE_ENV === "production" && process.env.ENABLE_AUTO_PROVISIONING !== "true");

  if ((!isServerlessProd || provision) && !provisionedTenantDbs.has(company.databaseName)) {
    try {
      const { provisionTenantDatabase } = await import("../services/tenantProvisioningService.js");
      await provisionTenantDatabase(company, connection);
      provisionedTenantDbs.add(company.databaseName);
    } catch (provErr) {
      console.warn(`[db] Tenant provisioning check warning for ${company.databaseName}:`, provErr.message);
    }
  }

  return {
    connection,
    User: getUserModel(connection),
    AuthSession: getAuthSessionModel(connection),
    AuthToken: getAuthTokenModel(connection),
    Employee: getEmployeeModel(connection),
    EmployeeCompensation: getEmployeeCompensationModel(connection),
    AuditLog: getAuditLogModel(connection),
    LeaveRequest: getLeaveRequestModel(connection),
    CompanyHrPolicy: getCompanyHrPolicyModel(connection),
    OfferLetter: getOfferLetterModel(connection),
    Settlement: getSettlementModel(connection),
    Attendance: getAttendanceModel(connection),
    LiveTrackingSession: getLiveTrackingSessionModel(connection),
    PayrollCycle: getPayrollCycleModel(connection),
    Payslip: getPayslipModel(connection),
    CompanyAsset: getCompanyAssetModel(connection),
    Task: getTaskModel(connection),
    ImpactPointTransaction: getImpactPointTransactionModel(connection),
  };
}

export async function findCompanyBySlug(slug) {
  return Company.findOne({ slug });
}

export async function findCompanyById(companyId) {
  return Company.findById(companyId);
}

export async function disconnectAll() {
  centralConnectionPromise = null;
  await Promise.all(
    [...tenantConnections.values()].map(async (connection) => {
      if (connection.readyState !== 0) {
        await connection.close();
      }
    })
  );
  tenantConnections.clear();

  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}
