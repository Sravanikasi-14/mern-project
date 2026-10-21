import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { emailService } from "../services/emailService.js";
import { generateOfferLetterPdf } from "../services/pdfService.js";
import { renderOfferLetterHtml, DEFAULT_OFFER_CLAUSES } from "../services/offerTemplateService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config();

async function run() {
  console.log("========================================================");
  console.log("   HRMS Real Offer Letter PDF Attachment Verification   ");
  console.log("========================================================");

  const targetRecipient = process.argv[2] || process.env.SMTP_USER;

  if (!emailService.isConfigured()) {
    console.error("[Error] SMTP credentials not configured in server/.env");
    process.exit(1);
  }

  console.log(`[1] SMTP User       : ${process.env.SMTP_USER}`);
  console.log(`[2] Sender Address  : ${emailService.getFromAddress()}`);
  console.log(`[3] Target Candidate: ${targetRecipient}\n`);

  console.log("Step 1: Verifying Gmail SMTP connection...");
  const connResult = await emailService.verifyConnection();
  if (!connResult.success) {
    console.error(`[Failed] SMTP connection error: ${connResult.error}`);
    process.exit(1);
  }
  console.log(`✓ ${connResult.message}\n`);

  console.log("Step 2: Rendering offer letter document HTML...");
  const offerData = {
    candidate: {
      fullName: "Sravani Kasi",
      email: targetRecipient,
    },
    position: "Lead Full Stack Software Engineer",
    department: "Core Engineering",
    workLocation: "Bangalore / Hybrid",
    employmentType: "Full-time Permanent",
    monthlySalary: 175000,
    annualSalary: 2100000,
    joiningDate: new Date(Date.now() + 14 * 86400000),
    clauses: DEFAULT_OFFER_CLAUSES,
    createdAt: new Date(),
  };

  const companyData = {
    companyName: "Acme Cloud Systems",
    email: emailService.getFromAddress(),
    phone: "+91 98765 43210",
    address: "Tech Park Phase 1, Bangalore, Karnataka 560100",
  };

  const renderedHtml = renderOfferLetterHtml(offerData, companyData);
  console.log(`✓ Rendered HTML length: ${renderedHtml.length} characters`);

  console.log("Step 3: Generating PDF buffer via Puppeteer...");
  const pdfBuffer = await generateOfferLetterPdf(renderedHtml);
  console.log(`✓ Generated PDF type: ${typeof pdfBuffer}, Constructor: ${pdfBuffer.constructor.name}`);
  console.log(`✓ Buffer.isBuffer(pdfBuffer): ${Buffer.isBuffer(pdfBuffer)}`);
  console.log(`✓ PDF buffer byte length: ${pdfBuffer.length} bytes\n`);

  if (!Buffer.isBuffer(pdfBuffer) || pdfBuffer.length === 0) {
    console.error("[Failed] PDF buffer is invalid or empty!");
    process.exit(1);
  }

  console.log(`Step 4: Dispatching offer letter with PDF attachment to ${targetRecipient}...`);
  const sendResult = await emailService.sendOfferLetter({
    companyName: companyData.companyName,
    candidateName: offerData.candidate.fullName,
    candidateEmail: targetRecipient,
    position: offerData.position,
    pdfBuffer,
    joiningDate: offerData.joiningDate,
    monthlySalary: offerData.monthlySalary,
  });

  if (!sendResult.success) {
    console.error(`\n[Failed] Email dispatch failed: ${sendResult.error}\n`);
    process.exit(1);
  }

  console.log("\n========================================================");
  console.log("✓ Real Offer Letter email sent successfully via Gmail!");
  console.log(`   Message ID   : ${sendResult.messageId}`);
  console.log(`   Recipient    : ${sendResult.recipient}`);
  console.log(`   Sent At      : ${sendResult.sentAt?.toISOString()}`);
  console.log(`   Attached PDF : Offer_Letter_Sravani_Kasi.pdf (${pdfBuffer.length} bytes)`);
  console.log("========================================================\n");
  process.exit(0);
}

run().catch((err) => {
  console.error("Execution error:", emailService.sanitizeError(err));
  process.exit(1);
});
