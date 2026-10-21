import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { emailService } from "../services/emailService.js";

// Load environment variables via existing server pattern
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config();

async function run() {
  console.log("=================================================");
  console.log("       HRMS Gmail SMTP Verification Utility      ");
  console.log("=================================================");

  const targetRecipient = process.argv[2] || process.env.SMTP_USER;

  console.log("Checking SMTP configuration...");
  if (!emailService.isConfigured()) {
    console.error("\n[Error] SMTP credentials are not configured in your environment.");
    console.error("Please add the following variables to server/.env:");
    console.error("  SMTP_USER=your-email@gmail.com");
    console.error("  SMTP_APP_PASSWORD=your-16-char-app-password");
    console.error("  EMAIL_FROM=HRMS Platform <your-email@gmail.com> (optional)\n");
    process.exit(1);
  }

  console.log(`✓ SMTP_USER is set: ${process.env.SMTP_USER}`);
  console.log(`✓ Sender address: ${emailService.getFromAddress()}`);
  console.log(`✓ Target recipient: ${targetRecipient}\n`);

  console.log("Step 1: Verifying SMTP connection to Gmail...");
  const verifyResult = await emailService.verifyConnection();

  if (!verifyResult.success) {
    console.error(`\n[Failed] ${verifyResult.error}\n`);
    console.error("Troubleshooting tips:");
    console.error("1. Confirm you generated a 16-character Google App Password (not your standard Gmail account password).");
    console.error("2. Ensure 2-Step Verification is turned ON for your Google Account.");
    console.error("3. Remove any spaces in your app password (e.g. 'abcd efgh ijkl mnop' -> 'abcdefghijklmnop').");
    process.exit(1);
  }

  console.log(`✓ ${verifyResult.message}\n`);

  console.log(`Step 2: Sending test email to ${targetRecipient}...`);
  const sendResult = await emailService.sendTestEmail(targetRecipient);

  if (!sendResult.success) {
    console.error(`\n[Failed] Could not deliver test email: ${sendResult.error}\n`);
    process.exit(1);
  }

  console.log("\n=================================================");
  console.log("✓ Test email delivered successfully!");
  console.log(`   Message ID : ${sendResult.messageId}`);
  console.log(`   Recipient  : ${sendResult.recipient}`);
  console.log(`   Sent At    : ${sendResult.sentAt.toISOString()}`);
  if (sendResult.response) {
    console.log(`   Response   : ${sendResult.response}`);
  }
  console.log("=================================================\n");
  process.exit(0);
}

run().catch((err) => {
  console.error("Unexpected script execution error:", emailService.sanitizeError(err));
  process.exit(1);
});
