process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test_jwt_secret_for_email_service_32chars!!";
import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { emailService } from "../services/emailService.js";
import { encryptSecret } from "../utils/secretCrypto.js";

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

  it("15. Company with missing credentials returns a clear error and NEVER falls back to env", async () => {
    process.env.SMTP_USER = "global@platform.test";
    process.env.SMTP_APP_PASSWORD = "global-secret-password-123";
    process.env.EMAIL_FROM = "Platform <global@platform.test>";

    const unconfiguredCompany = {
      _id: "60c72b2f9b1d8b2badbee101",
      companyName: "Unconfigured Corp",
      slug: "unconfigured",
      emailSettings: {
        fromEmail: "",
        appPasswordEncrypted: "",
        isConfigured: false,
      },
    };

    assert.equal(emailService.isConfigured(unconfiguredCompany), false);

    const result = await emailService.sendMail({
      to: "recipient@example.test",
      subject: "Test Isolation",
      text: "Hello",
      company: unconfiguredCompany,
    });

    assert.equal(result.success, false);
    assert.equal(result.code, "COMPANY_EMAIL_NOT_CONFIGURED");
    assert.ok(result.error.toLowerCase().includes("not configured"));
  });

  it("16. Company with undecryptable credentials returns safe error and NEVER falls back to env", async () => {
    process.env.SMTP_USER = "global@platform.test";
    process.env.SMTP_APP_PASSWORD = "global-secret-password-123";

    const corruptCompany = {
      _id: "60c72b2f9b1d8b2badbee102",
      companyName: "Corrupt Corp",
      slug: "corrupt",
      emailSettings: {
        fromEmail: "hr@corrupt.test",
        appPasswordEncrypted: "invalid.corrupt.payload",
        isConfigured: true,
      },
    };

    assert.equal(emailService.isConfigured(corruptCompany), false);

    const result = await emailService.sendMail({
      to: "recipient@example.test",
      subject: "Test Corrupt",
      text: "Hello",
      company: corruptCompany,
    });

    assert.equal(result.success, false);
    assert.equal(result.code, "COMPANY_EMAIL_DECRYPTION_FAILED");
    assert.ok(result.error.toLowerCase().includes("could not be decrypted"));
  });

  it("17. _cacheKeyForConfig() changes deterministically when host, port, TLS, user, or pass changes", () => {
    const base = {
      tenantId: "compA",
      host: "smtp.example.com",
      port: 587,
      secure: false,
      user: "hr@example.com",
      pass: "SecretPass123!",
    };

    const keyBase = emailService._cacheKeyForConfig(base);
    assert.ok(keyBase);

    // Host change
    const keyHost = emailService._cacheKeyForConfig({ ...base, host: "smtp.other.com" });
    assert.notEqual(keyBase, keyHost);

    // Port change
    const keyPort = emailService._cacheKeyForConfig({ ...base, port: 465 });
    assert.notEqual(keyBase, keyPort);

    // Secure change
    const keySecure = emailService._cacheKeyForConfig({ ...base, secure: true });
    assert.notEqual(keyBase, keySecure);

    // User change
    const keyUser = emailService._cacheKeyForConfig({ ...base, user: "other@example.com" });
    assert.notEqual(keyBase, keyUser);

    // Password change (even with exact same character length)
    const keyPass = emailService._cacheKeyForConfig({ ...base, pass: "OtherPass123!" });
    assert.notEqual(keyBase, keyPass);

    // Tenant change (different company with identical config)
    const keyTenant = emailService._cacheKeyForConfig({ ...base, tenantId: "compB" });
    assert.notEqual(keyBase, keyTenant);
  });

  it("18. Transporter cache key never exposes plaintext password", () => {
    const config = {
      tenantId: "compA",
      host: "smtp.example.com",
      port: 587,
      secure: false,
      user: "hr@example.com",
      pass: "SuperSecretUltraSensitivePassword999",
    };

    const key = emailService._cacheKeyForConfig(config);
    assert.ok(!key.includes("SuperSecretUltraSensitivePassword999"));
    assert.ok(!key.includes("Sensitive"));
  });

  it("19. Transporter isolation: Company A and Company B do not share cached transporters", () => {
    emailService.invalidateTransporter();

    const configA = {
      tenantId: "compA",
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
      user: "hr@compA.test",
      pass: "SecretPassA",
    };

    const configB = {
      tenantId: "compB",
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
      user: "hr@compB.test",
      pass: "SecretPassB",
    };

    const transA = emailService.getTransporterForConfig(configA);
    const transB = emailService.getTransporterForConfig(configB);

    assert.ok(transA);
    assert.ok(transB);
    assert.notEqual(transA, transB);

    assert.equal(emailService.transporters.size, 2);
  });

  it("20. invalidateTransporter(companyId) clears only that company's cached transporter", () => {
    emailService.invalidateTransporter();

    const configA = {
      tenantId: "compA",
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
      user: "hr@compA.test",
      pass: "PassA",
    };

    const configB = {
      tenantId: "compB",
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
      user: "hr@compB.test",
      pass: "PassB",
    };

    emailService.getTransporterForConfig(configA);
    emailService.getTransporterForConfig(configB);
    assert.equal(emailService.transporters.size, 2);

    emailService.invalidateTransporter("compA");
    assert.equal(emailService.transporters.size, 1);

    const remainingKey = emailService.transporters.keys().next().value;
    assert.ok(remainingKey.startsWith("compB:"));
  });

  it("21. Company with valid credentials uses injected custom transporter in tests", async () => {
    let captured = null;
    emailService.setTransporter({
      sendMail: async (options) => {
        captured = options;
        return { messageId: "mock_company_sent_789" };
      },
    });

    const validCompany = {
      _id: "60c72b2f9b1d8b2badbee103",
      companyName: "Valid Corp",
      slug: "valid",
      emailSettings: {
        fromEmail: "hr@valid.test",
        fromName: "Valid HR",
        appPasswordEncrypted: encryptSecret("valid-test-pass-1234"),
        isConfigured: true,
      },
    };

    const result = await emailService.sendEmployeeInvitation({
      companyName: validCompany.companyName,
      employeeName: "Alice Walker",
      email: "alice@valid.test",
      inviteLink: "http://localhost:5173/onboard?token=alice123",
      company: validCompany,
    });

    assert.equal(result.success, true);
    assert.equal(result.messageId, "mock_company_sent_789");
    assert.ok(captured);
    assert.equal(captured.to, "alice@valid.test");
    assert.equal(captured.from, "Valid HR <hr@valid.test>");
  });
});
