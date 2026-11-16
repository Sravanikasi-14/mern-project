/**
 * Secure bootstrap for the singleton Platform Admin.
 *
 * Usage:
 *   node scripts/bootstrapPlatformAdmin.js --email admin@example.com --password '...' --name 'Platform Admin'
 *
 * Env:
 *   PLATFORM_JWT_SECRET (or JWT_SECRET) ≥ 32 chars
 *   PLATFORM_ADMIN_EMAIL / PLATFORM_ADMIN_PASSWORD / PLATFORM_ADMIN_NAME (optional alternatives to flags)
 *
 * Never hardcodes credentials. Refuses to create a second active admin.
 */
import dotenv from "dotenv";
import { connectCentralDB, disconnectAll } from "../config/db.js";
import PlatformAdmin from "../models/PlatformAdmin.js";
import { isValidEmail, normalizeEmail } from "../utils/email.js";
import { hashPassword } from "../utils/password.js";

dotenv.config();

function getArg(flag, envVar, fallback = "") {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return process.env[envVar] || fallback;
}

async function run() {
  const email = normalizeEmail(getArg("--email", "PLATFORM_ADMIN_EMAIL"));
  const password = getArg("--password", "PLATFORM_ADMIN_PASSWORD", "");
  const fullName = getArg("--name", "PLATFORM_ADMIN_NAME", "Platform Admin").trim();

  if (!isValidEmail(email)) {
    throw new Error("Provide a valid --email (or PLATFORM_ADMIN_EMAIL)");
  }
  if (!password || password.length < 12) {
    throw new Error("Provide --password (or PLATFORM_ADMIN_PASSWORD) with at least 12 characters");
  }
  if (!process.env.PLATFORM_JWT_SECRET && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)) {
    throw new Error("Set PLATFORM_JWT_SECRET (preferred) or JWT_SECRET (≥32 chars) before bootstrap");
  }

  await connectCentralDB();

  const existingActive = await PlatformAdmin.findOne({ isActive: true }).select("_id email");
  if (existingActive) {
    if (existingActive.email === email) {
      console.log("----------------------------------------------------------------");
      console.log("ℹ️  Active Platform Admin already exists for this email.");
      console.log(`   id: ${existingActive._id}`);
      console.log(`   email: ${existingActive.email}`);
      console.log("   To reset the password in development: npm run reset:platform-admin-password");
      console.log("----------------------------------------------------------------");
      return;
    }
    throw new Error(
      `Singleton violation: an active Platform Admin already exists (${existingActive.email}). ` +
        "Deactivate it explicitly before bootstrapping another identity."
    );
  }

  const passwordHash = await hashPassword(password);
  const admin = await PlatformAdmin.create({
    singletonKey: "default",
    email,
    passwordHash,
    fullName,
    isActive: true,
    mfaEnabled: false,
  });

  console.log("----------------------------------------------------------------");
  console.log("✅ Platform Admin created (MFA enrollment required on first login)");
  console.log(`   id: ${admin._id}`);
  console.log(`   email: ${admin.email}`);
  console.log(`   name: ${admin.fullName}`);
  console.log("   Password and MFA secret are not printed.");
  console.log("----------------------------------------------------------------");
}

run()
  .catch((err) => {
    console.error("❌ Bootstrap failed:", err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectAll();
  });
