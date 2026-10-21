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
  console.log("    HRMS Resend HTTP API Verification Utility    ");
  console.log("=================================================");

  const targetRecipient = process.argv[2] || process.env.TEST_EMAIL_RECIPIENT || process.env.EMAIL_FROM || "sravanikasi14@gmail.com";

  console.log("Checking Resend configuration...");
  if (!emailService.isConfigured()) {
    console.error("\n[Error] Resend credentials are not configured in your environment.");
    console.error("Please add the following variables to server/.env:");
    console.error("  RESEND_API_KEY=re_your_api_key");
    console.error("  EMAIL_FROM=sravanikasi14@gmail.com (or your domain)\n");
    process.exit(1);
  }

  console.log(`[Config] RESEND_API_KEY: Configured`);
  console.log(`[Config] Sender address: ${emailService.getFromAddress()}`);
  console.log(`[Config] Target recipient: ${targetRecipient}\n`);

  console.log("Step 1: Verifying Resend HTTP API credentials...");
  const verifyResult = await emailService.verifyConnection();

  if (!verifyResult.success) {
    console.error(`\n[Failed] ${verifyResult.error}\n`);
    console.error("Troubleshooting tips:");
    console.error("1. Confirm your RESEND_API_KEY begins with 're_'.");
    console.error("2. Verify that your API key has 'Sending access' enabled in https://resend.com/api-keys.");
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
  console.log("[Success] Test email accepted by Resend HTTP API!");
  console.log(`   Message ID : ${sendResult.messageId}`);
  console.log(`   Recipient  : ${sendResult.recipient}`);
  console.log(`   Sent At    : ${sendResult.sentAt.toISOString()}`);
  console.log(`   Provider   : ${sendResult.provider || "resend"}`);
  console.log("=================================================\n");
  process.exit(0);
}

run().catch((err) => {
  console.error("Unexpected script execution error:", emailService.sanitizeError(err));
  process.exit(1);
});
