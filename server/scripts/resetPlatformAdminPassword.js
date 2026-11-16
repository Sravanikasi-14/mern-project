/**
 * Development-only: reset the singleton Platform Admin password.
 *
 * Usage (PowerShell):
 *   $env:PLATFORM_ADMIN_PASSWORD="YourNewStrongPassword123!"
 *   npm run reset:platform-admin-password
 *
 * Or interactive (hidden prompt, no echo):
 *   npm run reset:platform-admin-password
 *
 * Security:
 *   - NODE_ENV must be development (refused in production)
 *   - Password via PLATFORM_ADMIN_PASSWORD env or hidden TTY prompt only
 *   - Never accepts --password CLI args
 *   - Never prints the password or hash
 *   - Does not create a second admin; does not change MFA/email/status
 */
import dotenv from "dotenv";
import { connectCentralDB, disconnectAll } from "../config/db.js";
import {
  resetActivePlatformAdminPassword,
} from "../services/platformAdminPasswordResetService.js";

dotenv.config();

function rejectPasswordCliArgs() {
  const args = process.argv.slice(2);
  if (args.includes("--password") || args.some((a) => a.startsWith("--password="))) {
    throw new Error(
      "Do not pass the password on the command line. Use PLATFORM_ADMIN_PASSWORD or the interactive prompt."
    );
  }
}

function readHiddenPassword(promptText) {
  if (!process.stdin.isTTY) {
    throw new Error(
      "Interactive prompt requires a TTY. Set PLATFORM_ADMIN_PASSWORD instead."
    );
  }

  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    stdout.write(promptText);

    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    let value = "";

    const cleanup = () => {
      stdin.removeListener("data", onData);
      if (stdin.isTTY) stdin.setRawMode(Boolean(wasRaw));
      stdin.pause();
    };

    const onData = (char) => {
      if (char === "\n" || char === "\r" || char === "\u0004") {
        cleanup();
        stdout.write("\n");
        resolve(value);
        return;
      }
      if (char === "\u0003") {
        cleanup();
        stdout.write("\n");
        reject(new Error("Cancelled"));
        return;
      }
      if (char === "\u007f" || char === "\b") {
        value = value.slice(0, -1);
        return;
      }
      // Ignore escape sequences / control chars other than backspace/enter/ctrl+c
      if (char.length === 1 && char >= " ") {
        value += char;
      }
    };

    stdin.on("data", onData);
  });
}

async function resolveNewPassword() {
  const fromEnv = process.env.PLATFORM_ADMIN_PASSWORD;
  if (typeof fromEnv === "string" && fromEnv.length > 0) {
    return fromEnv;
  }

  const first = await readHiddenPassword("New Platform Admin password (hidden): ");
  const second = await readHiddenPassword("Confirm new password (hidden): ");
  if (first !== second) {
    throw new Error("Passwords do not match");
  }
  return first;
}

async function run() {
  rejectPasswordCliArgs();

  const newPassword = await resolveNewPassword();
  await connectCentralDB();
  const result = await resetActivePlatformAdminPassword(newPassword);

  console.log("----------------------------------------------------------------");
  console.log("Platform Admin password reset succeeded (development only).");
  console.log(`   id: ${result.id}`);
  console.log(`   email: ${result.email}`);
  console.log("   Password and hash are not printed.");
  console.log("   MFA settings, email, and account status were not changed.");
  console.log("----------------------------------------------------------------");
}

run()
  .catch((err) => {
    console.error("Password reset failed:", err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectAll();
    // Avoid leaving the secret in the process env of long-lived shells guidance:
    // callers should clear PLATFORM_ADMIN_PASSWORD after use.
  });
