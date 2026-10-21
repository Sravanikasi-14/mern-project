import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { emailService } from "../services/emailService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config();

async function run() {
  console.log("=================================================");
  console.log("    HRMS Nodemailer SMTP Verification Utility    ");
  console.log("=================================================");

  const targetRecipient =
    process.argv[2] ||
    process.env.TEST_EMAIL_RECIPIENT ||
    process.env.SMTP_USER ||
    process.env.EMAIL_FROM;

  console.log("Checking SMTP configuration...");
  if (!emailService.isConfigured()) {
    console.error("\n[Error] SMTP credentials are not configured.");
    console.error("Either configure email in the HRMS Settings UI, or add to server/.env:");
    console.error("  SMTP_USER=your.email@gmail.com");
    console.error("  SMTP_APP_PASSWORD=your_16_char_google_app_password");
    console.error("  EMAIL_FROM=Your Name <your.email@gmail.com>\n");
    process.exit(1);
  }

  console.log(`[Config] Sender address: ${emailService.getFromAddress()}`);
  console.log(`[Config] Target recipient: ${targetRecipient}\n`);

  console.log("Step 1: Verifying SMTP credentials...");
  const verifyResult = await emailService.verifyConnection();

  if (!verifyResult.success) {
    console.error(`\n[Failed] ${verifyResult.error}\n`);
    console.error("Troubleshooting tips:");
    console.error("1. Use a Gmail App Password (not your normal login password).");
    console.error("2. Enable 2-Step Verification, then create an app password at:");
    console.error("   https://myaccount.google.com/apppasswords");
    process.exit(1);
  }

  console.log(`[Success] ${verifyResult.message}\n`);

  console.log(`Step 2: Sending test verification email to ${targetRecipient}...`);
  const sendResult = await emailService.sendTestEmail(targetRecipient);

  if (!sendResult.success) {
    console.error(`\n[Failed] Could not deliver test email: ${sendResult.error}\n`);
    process.exit(1);
  }

  console.log("\n=================================================");
  console.log("[Success] Test email accepted by SMTP!");
  console.log(`   Message ID : ${sendResult.messageId}`);
  console.log(`   Recipient  : ${sendResult.recipient}`);
  console.log(`   Sent At    : ${sendResult.sentAt.toISOString()}`);
  console.log(`   Provider   : ${sendResult.provider || "nodemailer"}`);
  console.log("=================================================\n");
  process.exit(0);
}

run().catch((err) => {
  console.error("Unexpected script execution error:", emailService.sanitizeError(err));
  process.exit(1);
});
