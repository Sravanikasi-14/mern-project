import dotenv from "dotenv";
import { connectCentralDB, disconnectAll, getCompanyModels } from "../config/db.js";
import Company, { COMPANY_STATUSES } from "../models/Company.js";
import { USER_ROLES } from "../models/User.js";
import { isValidEmail, normalizeEmail } from "../utils/email.js";
import { signOnboardingToken } from "../utils/onboardingToken.js";
import { hashPassword } from "../utils/password.js";

dotenv.config();

function getArg(flag, envVar, fallback = "") {
  const flagIndex = process.argv.indexOf(flag);
  if (flagIndex !== -1 && process.argv[flagIndex + 1]) {
    return process.argv[flagIndex + 1];
  }
  return process.env[envVar] || fallback;
}

async function run() {
  const companyName = getArg("--name", "COMPANY_NAME", "Acme Corp").trim();
  const companyCode = (
    getArg("--code", "COMPANY_CODE") ||
    getArg("--slug", "COMPANY_SLUG", "acme")
  ).trim().toLowerCase();
  const databaseName = (
    getArg("--db", "DATABASE_NAME", `company_${companyCode}`)
  ).trim();
  const contactName = getArg("--contact", "CONTACT_NAME", "HR Admin").trim();
  const contactEmail = normalizeEmail(
    getArg("--email", "CONTACT_EMAIL") ||
      getArg("--hr-email", "HR_EMAIL", `hr@${companyCode}.test`)
  );
  const contactPhone = getArg("--phone", "CONTACT_PHONE", "").trim();
  const password = getArg("--password", "HR_PASSWORD", "");
  const clientUrl = (process.env.CLIENT_URL || "http://localhost:5173").replace(/\/$/, "");

  if (!isValidEmail(contactEmail)) {
    throw new Error(`Invalid contact email: "${contactEmail}"`);
  }

  await connectCentralDB();

  const company = await Company.findOneAndUpdate(
    { slug: companyCode },
    {
      companyName,
      slug: companyCode,
      databaseName,
      migrationVersion: 0,
      status: COMPANY_STATUSES.ACTIVE,
      branding: {
        displayName: companyName,
        logoUrl: "",
        primaryColor: "#4338ca",
      },
      config: {
        timezone: "Asia/Kolkata",
        currencyCode: "INR",
        enabledModules: [],
      },
      primaryContact: {
        fullName: contactName,
        email: contactEmail,
        phoneNumber: contactPhone,
      },
      schemaVersion: 1,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  console.log("----------------------------------------------------------------");
  console.log("✅ Company Provisioned Successfully");
  console.log(`   Company Name: ${company.companyName}`);
  console.log(`   Company Code: ${company.slug}`);
  console.log(`   Database Name: ${company.databaseName}`);
  console.log(`   Primary Contact: ${contactName} <${contactEmail}>`);
  console.log("----------------------------------------------------------------");

  // Provision leave collections and company HR policy idempotently
  const { provisionTenantDatabase } = await import("../services/tenantProvisioningService.js");
  const provOutcome = await provisionTenantDatabase(company);
  console.log(`📁 Collections & Policies: ${provOutcome.message}`);

  if (password && password.length >= 8) {
    const { User } = await getCompanyModels(company);
    const passwordHash = await hashPassword(password);
    await User.findOneAndUpdate(
      { email: contactEmail },
      {
        email: contactEmail,
        passwordHash,
        role: USER_ROLES.HR_ADMIN,
        isActive: true,
        schemaVersion: 1,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    console.log("✅ Initial HR Admin Account Created Directly");
    console.log(`   Email: ${contactEmail}`);
    console.log(`   Role: ${USER_ROLES.HR_ADMIN}`);
    console.log("   Status: Active");
    console.log("👉 You can now log in at: " + `${clientUrl}/login`);
    console.log(`   Company Code: ${company.slug}`);
    console.log(`   Email: ${contactEmail}`);
  } else {
    const onboardingToken = signOnboardingToken({
      companyId: company._id,
      email: contactEmail,
    });
    const onboardingUrl = `${clientUrl}/onboard?token=${encodeURIComponent(onboardingToken)}`;

    console.log("✉️  Onboarding Invitation Generated for HR Admin");
    console.log(`   Invited Email: ${contactEmail}`);
    console.log("");
    console.log("👉 Invitation URL (open this in your browser to complete setup):");
    console.log(`   ${onboardingUrl}`);
    console.log("");
    console.log(`   After setup, log in with Company Code: "${company.slug}"`);
  }
  console.log("----------------------------------------------------------------");
}

run()
  .catch((error) => {
    console.error("❌ Provisioning failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectAll();
  });
