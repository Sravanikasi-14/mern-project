import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { emailService } from "../services/emailService.js";

describe("EmailService Resend HTTP API Integration & Safety Suite", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    emailService.setSimulateFailure(false);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    emailService.setSimulateFailure(false);
    emailService.setClient(null);
  });

  it("1. isConfigured() accurately reports presence of Resend API key", () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_APP_PASSWORD;
    assert.equal(emailService.isConfigured(), false);

    process.env.RESEND_API_KEY = "invalid_key_without_prefix";
    assert.equal(emailService.isConfigured(), false);

    process.env.RESEND_API_KEY = "re_test_api_key_123456789";
    assert.equal(emailService.isConfigured(), true);
  });

  it("2. getFromAddress() respects EMAIL_FROM and falls back to onboarding@resend.dev", () => {
    delete process.env.EMAIL_FROM;
    assert.equal(emailService.getFromAddress(), "HRMS Platform <onboarding@resend.dev>");

    process.env.EMAIL_FROM = "Acme HR <hr@acme.com>";
    assert.equal(emailService.getFromAddress(), "Acme HR <hr@acme.com>");
  });

  it("3. resolveSender() redirects public webmail to onboarding@resend.dev with replyTo preserved", () => {
    // If user configured a gmail address
    const gmailSender = emailService.resolveSender("sravanikasi14@gmail.com");
    assert.equal(gmailSender.from, "HRMS Platform <onboarding@resend.dev>");
    assert.equal(gmailSender.replyTo, "sravanikasi14@gmail.com");

    // If user configured a verified custom domain
    const customSender = emailService.resolveSender("Acme HR <recruiting@acme.corp>");
    assert.equal(customSender.from, "Acme HR <recruiting@acme.corp>");
    assert.equal(customSender.replyTo, undefined);
  });

  it("4. sanitizeError() completely strips RESEND_API_KEY and re_ tokens from error messages", () => {
    process.env.RESEND_API_KEY = "re_secret_key_999888777";
    const rawError = "Resend API call failed with key re_secret_key_999888777 at endpoint";
    const sanitized = emailService.sanitizeError(rawError);

    assert.ok(!sanitized.includes("re_secret_key_999888777"));
    assert.ok(sanitized.includes("re_********"));
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

  it("7. Safely handles unconfigured Resend in test/local environments with simulation fallback", async () => {
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
    delete process.env.RESEND_API_KEY;

    const result = await emailService.verifyConnection();
    assert.equal(result.success, false);
    assert.ok(result.error.includes("Resend API key not configured"));
  });

  it("9. sendTestEmail() fails cleanly when recipient is missing and EMAIL_FROM is unset", async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
    delete process.env.TEST_EMAIL_RECIPIENT;

    const result = await emailService.sendTestEmail();
    assert.equal(result.success, false);
    assert.ok(result.error.includes("No test email recipient provided"));
  });

  it("10. sendOfferLetter() attaches PDF with proper filename, contentType, and Buffer content to Resend", async () => {
    let capturedPayload = null;
    const mockClient = {
      emails: {
        send: async (payload) => {
          capturedPayload = payload;
          return { data: { id: "resend_mock_offer_id_123" }, error: null };
        },
      },
    };

    emailService.setClient(mockClient);

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
    assert.equal(result.messageId, "resend_mock_offer_id_123");
    assert.equal(result.provider, "resend");
    assert.equal(result.providerStatus, "accepted");
    assert.ok(capturedPayload, "Resend send should have been called");
    assert.equal(capturedPayload.to, "priya.sharma@example.test");
    assert.ok(Array.isArray(capturedPayload.attachments), "attachments should be an array");
    assert.equal(capturedPayload.attachments.length, 1);

    const attachment = capturedPayload.attachments[0];
    assert.equal(attachment.filename, "Offer_Letter_Priya_Sharma.pdf");
    assert.equal(attachment.contentType, "application/pdf");
    assert.ok(Buffer.isBuffer(attachment.content), "attachment content must be a Node.js Buffer");
    assert.deepEqual(attachment.content, dummyPdf);
  });

  it("11. sendOfferLetter() fails cleanly without calling Resend when PDF is missing, empty, or invalid", async () => {
    let sendCalled = false;
    const mockClient = {
      emails: {
        send: async () => {
          sendCalled = true;
          return { data: { id: "should_not_be_called" }, error: null };
        },
      },
    };
    emailService.setClient(mockClient);

    // Missing PDF
    const missingRes = await emailService.sendOfferLetter({
      candidateName: "Jane Doe",
      candidateEmail: "jane@example.test",
      pdfBuffer: null,
    });
    assert.equal(missingRes.success, false);
    assert.ok(missingRes.error.includes("missing, empty, or invalid"));
    assert.equal(sendCalled, false);

    // Empty Buffer
    const emptyRes = await emailService.sendOfferLetter({
      candidateName: "Jane Doe",
      candidateEmail: "jane@example.test",
      pdfBuffer: Buffer.alloc(0),
    });
    assert.equal(emptyRes.success, false);
    assert.ok(emptyRes.error.includes("missing, empty, or invalid"));
    assert.equal(sendCalled, false);

    // Invalid non-buffer/non-view object
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
    const mockClient = {
      emails: {
        send: async (payload) => {
          capturedPayload = payload;
          return { data: { id: "resend_uint8_id" }, error: null };
        },
      },
    };
    emailService.setClient(mockClient);

    const uint8Pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]); // %PDF-1.4
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

  it("13. Handles Resend provider error responses cleanly without throwing unhandled exceptions", async () => {
    const mockClient = {
      emails: {
        send: async () => {
          return {
            data: null,
            error: {
              name: "validation_error",
              message: "The domain is not verified",
              statusCode: 403,
            },
          };
        },
      },
    };
    emailService.setClient(mockClient);

    const result = await emailService.sendOfferLetter({
      candidateName: "Jane Doe",
      candidateEmail: "jane@example.test",
      pdfBuffer: Buffer.from("%PDF-1.4 test"),
    });

    assert.equal(result.success, false);
    assert.ok(result.error.includes("The domain is not verified"));
  });

  it("14. Backward compatibility adapter setTransporter() works seamlessly", async () => {
    let captured = null;
    const mockTransporter = {
      sendMail: async (options) => {
        captured = options;
        return { messageId: "legacy_msg_id_777" };
      },
    };
    emailService.setTransporter(mockTransporter);

    const result = await emailService.sendMail({
      to: "legacy@example.test",
      subject: "Legacy Test",
      text: "Testing backwards compatibility",
    });

    assert.equal(result.success, true);
    assert.equal(result.messageId, "legacy_msg_id_777");
    assert.ok(captured);
    assert.equal(captured.to, "legacy@example.test");
  });
});
