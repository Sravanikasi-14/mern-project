import dotenv from "dotenv";
import { connectCentralDB, disconnectAll, getCompanyModels } from "../config/db.js";
import Company, { COMPANY_STATUSES } from "../models/Company.js";
import { USER_ROLES } from "../models/User.js";
import { isValidEmail, normalizeEmail } from "../utils/email.js";
import { hashPassword } from "../utils/password.js";

dotenv.config();

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required to seed authentication data`);
  }
  return value;
}

async function upsertUser(User, { email, password, role, isActive = true }) {
  const normalizedEmail = normalizeEmail(email);
  if (!isValidEmail(normalizedEmail)) {
    throw new Error(`Invalid seed email: ${email}`);
  }

  const passwordHash = await hashPassword(password);
  await User.findOneAndUpdate(
    { email: normalizedEmail },
    {
      email: normalizedEmail,
      passwordHash,
      role,
      isActive,
      schemaVersion: 1,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

async function seed() {
  const rawCode = process.env.SEED_COMPANY_CODE || process.env.SEED_COMPANY_SLUG;
  if (!rawCode) {
    throw new Error("SEED_COMPANY_CODE (or SEED_COMPANY_SLUG) is required to seed authentication data");
  }
  const slug = rawCode.trim().toLowerCase();
  const companyName = requiredEnv("SEED_COMPANY_NAME");
  const databaseName = requiredEnv("SEED_DATABASE_NAME");
  const hrAdminEmail = requiredEnv("SEED_HR_ADMIN_EMAIL");
  const hrAdminPassword = requiredEnv("SEED_HR_ADMIN_PASSWORD");
  const employeeEmail = requiredEnv("SEED_EMPLOYEE_EMAIL");
  const employeePassword = requiredEnv("SEED_EMPLOYEE_PASSWORD");

  await connectCentralDB();

  const company = await Company.findOneAndUpdate(
    { slug },
    {
      companyName,
      slug,
      databaseName,
      migrationVersion: 0,
      status: COMPANY_STATUSES.ACTIVE,
      branding: { displayName: companyName, logoUrl: "", primaryColor: "#4338ca" },
      config: {
        timezone: "Asia/Kolkata",
        currencyCode: "INR",
        enabledModules: [],
      },
      primaryContact: {
        fullName: "HR Admin",
        email: normalizeEmail(hrAdminEmail),
        phoneNumber: "",
      },
      schemaVersion: 1,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  const { User } = await getCompanyModels(company);

  await upsertUser(User, {
    email: hrAdminEmail,
    password: hrAdminPassword,
    role: USER_ROLES.HR_ADMIN,
  });

  await upsertUser(User, {
    email: employeeEmail,
    password: employeePassword,
    role: USER_ROLES.EMPLOYEE,
  });

  if (process.env.SEED_INACTIVE_EMAIL && process.env.SEED_INACTIVE_PASSWORD) {
    await upsertUser(User, {
      email: process.env.SEED_INACTIVE_EMAIL,
      password: process.env.SEED_INACTIVE_PASSWORD,
      role: USER_ROLES.EMPLOYEE,
      isActive: false,
    });
  }

  console.log(`Seeded company "${slug}" with HR Admin and Employee login accounts.`);
}

seed()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectAll();
  });
