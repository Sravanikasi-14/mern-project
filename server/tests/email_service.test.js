import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { emailService } from "../services/emailService.js";

describe("EmailService Nodemailer SMTP Integration & Safety Suite", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    emailService.setSimulateFailure(false);
    emailService.setTransporter(null);
    emailService.rateLimiter.reset();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    emailService.setSimulateFailure(false);
    emailService.setTransporter(null);
    emailService.rateLimiter.reset();
  });

  it("1. isConfigured() accurately reports presence of SMTP credentials", () => {
    delete process.env.SMTP_USER;
    delete process.env.SMTP_APP_PASSWORD;
    delete process.env.SMTP_PASS;
    delete process.env.EMAIL_USER;
    delete process.env.RESEND_API_KEY;
    assert.equal(emailService.isConfigured(), false);

    process.env.SMTP_USER = "hr@acme.test";
    assert.equal(emailService.isConfigured(), false);

    process.env.SMTP_APP_PASSWORD = "abcd efgh ijkl mnop";
    assert.equal(emailService.isConfigured(), true);
  });

  it("2. getFromAddress() respects EMAIL_FROM and SMTP user fallback", () => {
    delete process.env.EMAIL_FROM;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_APP_PASSWORD;
    assert.equal(
      emailService.getFromAddress(),
      "HRMS Platform <noreply@localhost>"
    );

    process.env.EMAIL_FROM = "Acme HR <hr@acme.com>";
    assert.equal(emailService.getFromAddress(), "Acme HR <hr@acme.com>");
  });

  it("3. resolveSender() uses the configured from address (no Resend rewrite)", () => {
    const gmailSender = emailService.resolveSender("sravanikasi14@gmail.com");
    assert.equal(gmailSender.from, "sravanikasi14@gmail.com");

    const customSender = emailService.resolveSender("Acme HR <recruiting@acme.corp>");
    assert.equal(customSender.from, "Acme HR <recruiting@acme.corp>");
  });

  it("4. sanitizeError() strips SMTP app passwords and Resend tokens", () => {
    process.env.SMTP_APP_PASSWORD = "my-secret-app-pass-99";
    process.env.RESEND_API_KEY = "re_secret_key_999888777";
    const rawError =
      "SMTP failed with key my-secret-app-pass-99 and re_secret_key_999888777";
    const sanitized = emailService.sanitizeError(rawError);

    assert.ok(!sanitized.includes("my-secret-app-pass-99"));
    assert.ok(!sanitized.includes("re_secret_key_999888777"));
    assert.ok(sanitized.includes("********"));
  });

  it("5. Rejects invalid recipient email addresses", async () => {
    const result = await emailService.sendMail({
      to: "not-an-email",
      subject: "Test",
      text: "Hello",
    });

    assert.equal(result.success, false);
    assert.equal(result.error, "Invalid recipient email address");
  });

  it("6. Respects setSimulateFailure(true) and returns simulated delivery failure", async () => {
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

  it("7. Safely handles unconfigured SMTP with simulation fallback", async () => {
    delete process.env.SMTP_USER;
    delete process.env.SMTP_APP_PASSWORD;
    delete process.env.SMTP_PASS;
    delete process.env.EMAIL_USER;
    delete process.env.RESEND_API_KEY;

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

  it("8. verifyConnection() returns clear failure message when credentials are not configured", async () => {
    delete process.env.SMTP_USER;
    delete process.env.SMTP_APP_PASSWORD;
    delete process.env.SMTP_PASS;
    delete process.env.EMAIL_USER;
    emailService.setTransporter(null);

    const result = await emailService.verifyConnection();
    assert.equal(result.success, false);
    assert.ok(result.error.toLowerCase().includes("smtp"));
  });

  it("9. sendTestEmail() fails cleanly when recipient is missing and SMTP is unset", async () => {
    delete process.env.SMTP_USER;
    delete process.env.SMTP_APP_PASSWORD;
    delete process.env.EMAIL_FROM;
    delete process.env.TEST_EMAIL_RECIPIENT;
    emailService.setTransporter(null);

    const result = await emailService.sendTestEmail();
    assert.equal(result.success, false);
    assert.ok(result.error.includes("No test email recipient"));
  });

  it("10. sendOfferLetter() attaches PDF via Nodemailer transporter", async () => {
    let capturedPayload = null;
    const mockTransporter = {
      sendMail: async (options) => {
        capturedPayload = options;
        return { messageId: "smtp_mock_offer_id_123" };
      },
      verify: async () => true,
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
    assert.equal(result.messageId, "smtp_mock_offer_id_123");
    assert.equal(result.provider, "nodemailer");
    assert.equal(result.providerStatus, "accepted");
    assert.ok(capturedPayload, "sendMail should have been called");
    assert.equal(capturedPayload.to, "priya.sharma@example.test");
    assert.ok(Array.isArray(capturedPayload.attachments), "attachments should be an array");
    assert.equal(capturedPayload.attachments.length, 1);

    const attachment = capturedPayload.attachments[0];
    assert.equal(attachment.filename, "Offer_Letter_Priya_Sharma.pdf");
    assert.equal(attachment.contentType, "application/pdf");
    assert.ok(Buffer.isBuffer(attachment.content), "attachment content must be a Node.js Buffer");
    assert.deepEqual(attachment.content, dummyPdf);
  });

  it("11. sendOfferLetter() fails cleanly without calling SMTP when PDF is missing", async () => {
    let sendCalled = false;
    emailService.setTransporter({
      sendMail: async () => {
        sendCalled = true;
        return { messageId: "should_not_be_called" };
      },
    });

    const missingRes = await emailService.sendOfferLetter({
      candidateName: "Jane Doe",
      candidateEmail: "jane@example.test",
      pdfBuffer: null,
    });
    assert.equal(missingRes.success, false);
    assert.ok(missingRes.error.includes("missing, empty, or invalid"));
    assert.equal(sendCalled, false);

    const emptyRes = await emailService.sendOfferLetter({
      candidateName: "Jane Doe",
      candidateEmail: "jane@example.test",
      pdfBuffer: Buffer.alloc(0),
    });
    assert.equal(emptyRes.success, false);
    assert.ok(emptyRes.error.includes("missing, empty, or invalid"));
    assert.equal(sendCalled, false);

    const invalidRes = await emailService.sendOfferLetter({
      candidateName: "Jane Doe",
      candidateEmail: "jane@example.test",
      pdfBuffer: {},
    });
    assert.equal(invalidRes.success, false);
    assert.ok(invalidRes.error.includes("missing, empty, or invalid"));
    assert.equal(sendCalled, false);
  });

  it("12. sendOfferLetter() normalizes Uint8Array (Puppeteer format) to Buffer attachment", async () => {
    let capturedPayload = null;
    emailService.setTransporter({
      sendMail: async (options) => {
        capturedPayload = options;
        return { messageId: "smtp_uint8_id" };
      },
    });

    const uint8Pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
    const result = await emailService.sendOfferLetter({
      candidateName: "Candidate",
      candidateEmail: "candidate@example.test",
      pdfBuffer: uint8Pdf,
    });

    assert.equal(result.success, true);
    assert.ok(capturedPayload);
    assert.equal(capturedPayload.attachments[0].filename, "Offer_Letter_Candidate.pdf");
    assert.equal(capturedPayload.attachments[0].contentType, "application/pdf");
    assert.ok(Buffer.isBuffer(capturedPayload.attachments[0].content));
    assert.equal(capturedPayload.attachments[0].content.length, 8);
  });

  it("13. Handles SMTP provider errors cleanly without throwing", async () => {
    emailService.setTransporter({
      sendMail: async () => {
        throw new Error("Invalid login: 535 Authentication failed");
      },
    });

    const result = await emailService.sendOfferLetter({
      candidateName: "Jane Doe",
      candidateEmail: "jane@example.test",
      pdfBuffer: Buffer.from("%PDF-1.4 test"),
    });

    assert.equal(result.success, false);
    assert.ok(result.error.includes("Authentication failed"));
  });

  it("14. setTransporter() works for direct Nodemailer-style mocks", async () => {
    let captured = null;
    emailService.setTransporter({
      sendMail: async (options) => {
        captured = options;
        return { messageId: "legacy_msg_id_777" };
      },
    });

    const result = await emailService.sendMail({
      to: "legacy@example.test",
      subject: "Legacy Test",
      text: "Testing transporter",
    });

    assert.equal(result.success, true);
    assert.equal(result.messageId, "legacy_msg_id_777");
    assert.ok(captured);
    assert.equal(captured.to, "legacy@example.test");
  });
});
