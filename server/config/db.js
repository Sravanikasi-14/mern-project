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

export async function connectCentralDB() {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  try {
    await mongoose.connect(getMongoUri(), { dbName: getCentralDbName() });
    if (process.env.NODE_ENV !== "test") {
      console.log("Central MongoDB connected");
    }
    return mongoose.connection;
  } catch (error) {
    console.error("MongoDB connection failed");
    throw error;
  }
}

export async function getTenantConnection(databaseName) {
  if (typeof databaseName !== "string" || !DATABASE_NAME_PATTERN.test(databaseName)) {
    throw new HttpError(500, "Company database is not available");
  }

  const cached = tenantConnections.get(databaseName);
  if (cached && cached.readyState === 1) {
    return cached;
  }

  try {
    const connection = mongoose.createConnection(getMongoUri(), {
      dbName: databaseName,
    });
    await connection.asPromise();
    tenantConnections.set(databaseName, connection);
    return connection;
  } catch (error) {
    throw new HttpError(503, "Company database is not available");
  }
}

const provisionedTenantDbs = new Set();

export async function getCompanyModels(company) {
  const connection = await getTenantConnection(company.databaseName);

  if (!provisionedTenantDbs.has(company.databaseName)) {
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
  };
}

export async function findCompanyBySlug(slug) {
  return Company.findOne({ slug });
}

export async function findCompanyById(companyId) {
  return Company.findById(companyId);
}

export async function disconnectAll() {
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
