import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { emailService } from "../services/emailService.js";

describe("EmailService SMTP Integration & Safety Suite", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    emailService.setSimulateFailure(false);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    emailService.setSimulateFailure(false);
    emailService.setTransporter(null);
  });

  it("1. isConfigured() accurately reports presence of SMTP credentials", () => {
    delete process.env.SMTP_USER;
    delete process.env.SMTP_APP_PASSWORD;
    assert.equal(emailService.isConfigured(), false);

    process.env.SMTP_USER = "hrms.admin@gmail.com";
    assert.equal(emailService.isConfigured(), false);

    process.env.SMTP_APP_PASSWORD = "abcd efgh ijkl mnop";
    assert.equal(emailService.isConfigured(), true);
  });

  it("2. getFromAddress() respects EMAIL_FROM and falls back to SMTP_USER", () => {
    delete process.env.EMAIL_FROM;
    process.env.SMTP_USER = "sender@gmail.com";
    assert.equal(emailService.getFromAddress(), "sender@gmail.com");

    process.env.EMAIL_FROM = "Acme HR <hr@acme.com>";
    assert.equal(emailService.getFromAddress(), "Acme HR <hr@acme.com>");
  });

  it("3. sanitizeError() completely strips SMTP_APP_PASSWORD from error messages", () => {
    process.env.SMTP_APP_PASSWORD = "super-secret-password-123";
    const rawError = "Error connecting to SMTP with password super-secret-password-123 at host";
    const sanitized = emailService.sanitizeError(rawError);

    assert.ok(!sanitized.includes("super-secret-password-123"));
    assert.ok(sanitized.includes("********"));
  });

  it("4. Rejects invalid recipient email addresses", async () => {
    const result = await emailService.sendMail({
      to: "not-an-email",
      subject: "Test",
      text: "Hello",
    });

    assert.equal(result.success, false);
    assert.equal(result.error, "Invalid recipient email address");
  });

  it("5. Respects setSimulateFailure(true) and returns simulated delivery failure", async () => {
    emailService.setSimulateFailure(true);
    const result = await emailService.sendEmployeeInvitation({
      companyName: "Acme Corp",
      employeeName: "Alice Smith",
      email: "alice@acme.test",
      inviteLink: "http://localhost:5173/onboard?token=test12345",
    });

    assert.equal(result.success, false);
    assert.ok(result.error.includes("simulated delivery failure"));
  });

  it("6. Safely handles unconfigured SMTP in test/local environments with simulation fallback", async () => {
    delete process.env.SMTP_USER;
    delete process.env.SMTP_APP_PASSWORD;

    const result = await emailService.sendEmployeeInvitation({
      companyName: "Acme Corp",
      employeeName: "Bob Jones",
      email: "bob@acme.test",
      inviteLink: "http://localhost:5173/onboard?token=bobtoken789",
    });

    assert.equal(result.success, true);
    assert.ok(result.messageId.startsWith("sim_"));
    assert.equal(result.recipient, "bob@acme.test");
    assert.equal(result.simulated, true);
    assert.ok(result.sentAt instanceof Date);
  });

  it("7. verifyConnection() returns clear failure message when credentials are not configured", async () => {
    delete process.env.SMTP_USER;
    delete process.env.SMTP_APP_PASSWORD;

    const result = await emailService.verifyConnection();
    assert.equal(result.success, false);
    assert.ok(result.error.includes("SMTP credentials not configured"));
  });

  it("8. sendTestEmail() fails cleanly when recipient is missing and SMTP_USER is unset", async () => {
    delete process.env.SMTP_USER;
    delete process.env.SMTP_APP_PASSWORD;

    const result = await emailService.sendTestEmail();
    assert.equal(result.success, false);
    assert.ok(result.error.includes("No test email recipient provided"));
  });

  it("9. sendOfferLetter() attaches PDF with proper filename, application/pdf MIME type, and Buffer content to Nodemailer", async () => {
    let capturedMail = null;
    const mockTransporter = {
      sendMail: async (mailOptions) => {
        capturedMail = mailOptions;
        return { messageId: "msg_offer_pdf_test_123" };
      },
    };

    emailService.setTransporter(mockTransporter);

    const dummyPdf = Buffer.from("%PDF-1.4 sample pdf binary data");
    const result = await emailService.sendOfferLetter({
      companyName: "Acme Innovations Ltd",
      candidateName: "Priya Sharma",
      candidateEmail: "priya.sharma@example.test",
      position: "Staff Engineer",
      pdfBuffer: dummyPdf,
      joiningDate: new Date("2026-11-01"),
      monthlySalary: 150000,
    });

    assert.equal(result.success, true);
    assert.equal(result.messageId, "msg_offer_pdf_test_123");
    assert.ok(capturedMail, "Nodemailer sendMail should have been called");
    assert.equal(capturedMail.to, "priya.sharma@example.test");
    assert.ok(Array.isArray(capturedMail.attachments), "attachments should be an array");
    assert.equal(capturedMail.attachments.length, 1);

    const attachment = capturedMail.attachments[0];
    assert.equal(attachment.filename, "Offer_Letter_Priya_Sharma.pdf");
    assert.equal(attachment.contentType, "application/pdf");
    assert.ok(Buffer.isBuffer(attachment.content), "attachment content must be a Node.js Buffer");
    assert.ok(attachment.content.length > 0, "attachment buffer must be non-empty");
    assert.deepEqual(attachment.content, dummyPdf);
  });

  it("10. sendOfferLetter() fails cleanly without calling transporter when PDF is missing, empty, or invalid", async () => {
    let sendMailCalled = false;
    const mockTransporter = {
      sendMail: async () => {
        sendMailCalled = true;
        return { messageId: "should_not_be_called" };
      },
    };
    emailService.setTransporter(mockTransporter);

    // Missing PDF
    const missingRes = await emailService.sendOfferLetter({
      candidateName: "Jane Doe",
      candidateEmail: "jane@example.test",
      pdfBuffer: null,
    });
    assert.equal(missingRes.success, false);
    assert.ok(missingRes.error.includes("missing, empty, or invalid"));
    assert.equal(sendMailCalled, false);

    // Empty Buffer
    const emptyRes = await emailService.sendOfferLetter({
      candidateName: "Jane Doe",
      candidateEmail: "jane@example.test",
      pdfBuffer: Buffer.alloc(0),
    });
    assert.equal(emptyRes.success, false);
    assert.ok(emptyRes.error.includes("missing, empty, or invalid"));
    assert.equal(sendMailCalled, false);

    // Invalid non-buffer/non-view object
    const invalidRes = await emailService.sendOfferLetter({
      candidateName: "Jane Doe",
      candidateEmail: "jane@example.test",
      pdfBuffer: {},
    });
    assert.equal(invalidRes.success, false);
    assert.ok(invalidRes.error.includes("missing, empty, or invalid"));
    assert.equal(sendMailCalled, false);
  });

  it("11. sendOfferLetter() normalizes Uint8Array (Puppeteer format) to Buffer attachment", async () => {
    let capturedMail = null;
    const mockTransporter = {
      sendMail: async (mailOptions) => {
        capturedMail = mailOptions;
        return { messageId: "msg_uint8_test" };
      },
    };
    emailService.setTransporter(mockTransporter);

    const uint8Pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]); // %PDF-1.4
    const result = await emailService.sendOfferLetter({
      candidateName: "Candidate",
      candidateEmail: "candidate@example.test",
      pdfBuffer: uint8Pdf,
    });

    assert.equal(result.success, true);
    assert.ok(capturedMail);
    assert.equal(capturedMail.attachments[0].filename, "Offer_Letter_Candidate.pdf");
    assert.equal(capturedMail.attachments[0].contentType, "application/pdf");
    assert.ok(Buffer.isBuffer(capturedMail.attachments[0].content));
    assert.equal(capturedMail.attachments[0].content.length, 8);
  });
});
