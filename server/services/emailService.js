import { Resend } from "resend";
import { isValidEmail, normalizeEmail } from "../utils/email.js";

/**
 * Service handling email dispatch for HRMS invitations, onboarding notifications,
 * system communications, and offer letter delivery via Resend HTTP API.
 */
class EmailService {
  constructor() {
    this.failureSimulation = false;
    this.resendClient = null;
    this._customClient = null;
    this._cachedApiKey = null;
    this.transporter = null;
    this.history = [];
  }

  /**
   * Returns list of dispatched emails (useful for tests and inspection).
   */
  getHistory() {
    return [...this.history];
  }

  /**
   * Clears the dispatched email history.
   */
  clearHistory() {
    this.history = [];
  }

  /**
   * Enables or disables simulated delivery failure (useful for testing error handling).
   * @param {boolean} value
   */
  setSimulateFailure(value) {
    this.failureSimulation = Boolean(value);
  }

  /**
   * Sanitizes error messages to ensure sensitive credentials are never exposed in logs or return values.
   * @param {Error|string} err
   * @returns {string}
   */
  sanitizeError(err) {
    if (!err) return "Unknown email delivery error";
    let msg = typeof err === "string" ? err : err.message || String(err);
    const apiKey = process.env.RESEND_API_KEY;
    if (apiKey && apiKey.length > 0) {
      msg = msg.replaceAll(apiKey, "re_********");
    }
    // Mask any re_ API key tokens
    msg = msg.replace(/re_[A-Za-z0-9_]{10,}/g, "re_********");
    const pass = process.env.SMTP_APP_PASSWORD;
    if (pass && pass.length > 0) {
      msg = msg.replaceAll(pass, "********");
    }
    return msg;
  }

  /**
   * Sets a custom client (useful for testing and message inspection).
   * Pass null to reset to default environment configuration.
   * @param {Object|null} client
   */
  setClient(client) {
    this._customClient = client;
    this.resendClient = client;
    this._cachedApiKey = client ? "custom" : null;
  }

  /**
   * Sets a custom transporter (provided for test adapter backwards compatibility).
   * Pass null to reset.
   * @param {Object|null} transporter
   */
  setTransporter(transporter) {
    this.transporter = transporter;
    if (transporter && typeof transporter.sendMail === "function") {
      this._customClient = {
        emails: {
          send: async (options) => {
            try {
              const res = await transporter.sendMail(options);
              return { data: { id: res.messageId || `msg_${Date.now()}` }, error: null };
            } catch (err) {
              return { data: null, error: err };
            }
          },
        },
      };
      this._cachedApiKey = "custom";
    } else {
      this._customClient = null;
      this._cachedApiKey = null;
    }
  }

  /**
   * Returns whether Resend HTTP delivery credentials are fully configured.
   * @returns {boolean}
   */
  isConfigured() {
    if (this._customClient) {
      return true;
    }
    const apiKey = (process.env.RESEND_API_KEY || "").trim();
    return Boolean(apiKey && apiKey.startsWith("re_"));
  }

  /**
   * Resolves the configured sender address (EMAIL_FROM with safe fallback to onboarding@resend.dev).
   * @returns {string}
   */
  getFromAddress() {
    const from = (process.env.EMAIL_FROM || "").trim();
    if (from) return from;
    return "HRMS Platform <onboarding@resend.dev>";
  }

  /**
   * Resolves sender and reply-to configuration to comply with Resend domain verification requirements.
   * If a public webmail domain (e.g. gmail.com) is configured without domain verification,
   * routes sender through onboarding@resend.dev while preserving reply-to to the administrator's email.
   * @param {string} [from]
   * @returns {{from: string, replyTo?: string}}
   */
  resolveSender(from) {
    const rawSender = (from || this.getFromAddress()).trim();
    const isPublicWebmail = /@(gmail\.com|yahoo\.com|outlook\.com|hotmail\.com)/i.test(rawSender);
    if (isPublicWebmail) {
      const emailOnly = rawSender.includes("<")
        ? rawSender.replace(/^.*?<([^>]+)>.*$/, "$1").trim()
        : rawSender;
      return {
        from: "HRMS Platform <onboarding@resend.dev>",
        replyTo: emailOnly,
      };
    }
    return {
      from: rawSender,
      replyTo: undefined,
    };
  }

  /**
   * Returns an initialized Resend client.
   * Reuses client instance unless API key changes.
   * @returns {Resend|Object|null}
   */
  getClient() {
    if (this._customClient) {
      return this._customClient;
    }
    if (!this.isConfigured()) {
      return null;
    }
    const apiKey = process.env.RESEND_API_KEY.trim();
    if (this.resendClient && this._cachedApiKey === apiKey) {
      return this.resendClient;
    }
    this.resendClient = new Resend(apiKey);
    this._cachedApiKey = apiKey;
    return this.resendClient;
  }

  /**
   * Verifies the Resend HTTP API connection and authentication status.
   * @returns {Promise<{success: boolean, message?: string, error?: string}>}
   */
  async verifyConnection() {
    if (!this.isConfigured()) {
      return {
        success: false,
        error: "Resend API key not configured. Please set RESEND_API_KEY in environment.",
      };
    }

    try {
      const client = this.getClient();
      if (!client) {
        return {
          success: false,
          error: "Failed to initialize Resend client.",
        };
      }

      if (client.apiKeys && typeof client.apiKeys.list === "function") {
        const timeoutMs = parseInt(process.env.EMAIL_TIMEOUT_MS, 10) || 10000;
        const { data, error } = await client.apiKeys.list({ signal: AbortSignal.timeout(timeoutMs) });
        if (error) {
          const safeError = this.sanitizeError(error.message || JSON.stringify(error));
          return {
            success: false,
            error: `Resend authentication failed: ${safeError}`,
          };
        }
      }

      return {
        success: true,
        message: "Resend HTTP API connection established and authenticated successfully.",
      };
    } catch (err) {
      const safeError = this.sanitizeError(err);
      return {
        success: false,
        error: `Resend connection verification failed: ${safeError}`,
      };
    }
  }

  /**
   * Core method to send an email via Resend HTTP API or fallback when unconfigured.
   *
   * @param {Object} options
   * @param {string} options.to
   * @param {string} options.subject
   * @param {string} [options.text]
   * @param {string} [options.html]
   * @param {string} [options.from]
   * @param {string} [options.replyTo]
   * @param {Array} [options.attachments]
   * @returns {Promise<{success: boolean, messageId?: string, error?: string, simulated?: boolean, recipient?: string, sentAt?: Date, provider?: string, providerStatus?: string}>}
   */
  async sendMail({ to, subject, text, html, from, replyTo, attachments, ...extra }) {
    const normalizedRecipient = normalizeEmail(to);
    if (!isValidEmail(normalizedRecipient)) {
      return {
        success: false,
        error: "Invalid recipient email address",
      };
    }

    if (this.failureSimulation || process.env.SIMULATE_EMAIL_FAILURE === "true") {
      return {
        success: false,
        error: "Mail transfer agent unavailable: simulated delivery failure",
      };
    }

    const { from: resolvedFrom, replyTo: fallbackReplyTo } = this.resolveSender(from);
    const finalReplyTo = replyTo || fallbackReplyTo;

    // If Resend is not configured, preserve fallback tracking behavior (safe for test/local environments)
    if (!this.isConfigured()) {
      const messageId = `sim_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      if (process.env.NODE_ENV !== "test") {
        console.log(`[EmailService] Resend not configured. Simulated dispatch to ${normalizedRecipient} with subject "${subject}"`);
      }
      const record = {
        success: true,
        messageId,
        recipient: normalizedRecipient,
        to: normalizedRecipient,
        subject,
        text,
        html,
        attachments,
        sentAt: new Date(),
        simulated: true,
        provider: "simulated",
        ...extra,
      };
      this.history.push(record);
      return {
        success: true,
        messageId,
        recipient: normalizedRecipient,
        sentAt: record.sentAt,
        simulated: true,
        provider: "simulated",
      };
    }

    try {
      const client = this.getClient();
      if (!client || !client.emails || typeof client.emails.send !== "function") {
        return {
          success: false,
          error: "Resend client is not properly initialized",
        };
      }

      const resendPayload = {
        from: resolvedFrom,
        to: normalizedRecipient,
        subject,
        ...(html ? { html } : {}),
        ...(text ? { text } : {}),
        ...(finalReplyTo ? { reply_to: finalReplyTo } : {}),
      };

      if (Array.isArray(attachments) && attachments.length > 0) {
        resendPayload.attachments = attachments.map((att) => ({
          filename: att.filename,
          content: att.content,
          contentType: att.contentType || "application/pdf",
        }));
      }

      const timeoutMs = parseInt(process.env.EMAIL_TIMEOUT_MS, 10) || 15000;
      const { data, error } = await client.emails.send(
        resendPayload,
        { signal: AbortSignal.timeout(timeoutMs) }
      );

      if (error) {
        const safeError = this.sanitizeError(error.message || (typeof error === "string" ? error : JSON.stringify(error)));
        console.error(`[EmailService] Resend HTTP API error delivering to ${normalizedRecipient}:`, safeError);
        return {
          success: false,
          error: safeError,
          provider: "resend",
        };
      }

      const messageId = data?.id || `resend_${Date.now()}`;
      if (process.env.NODE_ENV !== "test") {
        console.log(`[EmailService] Email accepted by Resend HTTP API for ${normalizedRecipient}. Message ID: ${messageId}`);
      }

      const record = {
        success: true,
        messageId,
        recipient: normalizedRecipient,
        to: normalizedRecipient,
        subject,
        text,
        html,
        attachments,
        sentAt: new Date(),
        provider: "resend",
        providerStatus: "accepted",
        ...extra,
      };
      this.history.push(record);

      return {
        success: true,
        messageId,
        recipient: normalizedRecipient,
        sentAt: record.sentAt,
        provider: "resend",
        providerStatus: "accepted",
      };
    } catch (err) {
      const safeError = this.sanitizeError(err);
      console.error(`[EmailService] Error delivering email via Resend to ${normalizedRecipient}:`, safeError);
      return {
        success: false,
        error: safeError,
        provider: "resend",
      };
    }
  }

  /**
   * Dispatches an employee onboarding invitation email.
   *
   * @param {Object} options
   * @param {string} options.companyName
   * @param {string} options.employeeName
   * @param {string} options.email
   * @param {string} options.inviteLink
   * @returns {Promise<{success: boolean, messageId?: string, error?: string, recipient?: string, sentAt?: Date}>}
   */
  async sendEmployeeInvitation({ companyName, employeeName, email, inviteLink }) {
    const normalized = normalizeEmail(email);
    if (!isValidEmail(normalized)) {
      return {
        success: false,
        error: "Invalid recipient email address",
      };
    }

    if (this.failureSimulation || process.env.SIMULATE_EMAIL_FAILURE === "true") {
      return {
        success: false,
        error: "Mail transfer agent unavailable: simulated delivery failure",
      };
    }

    const orgName = companyName || "Your Company";
    const empName = employeeName || "Team Member";
    const subject = `You're invited to join ${orgName} on HRMS`;

    const text = [
      `Hello ${empName},`,
      ``,
      `You have been invited to join ${orgName} on the HRMS platform.`,
      ``,
      `Please complete your account onboarding and profile details using the link below:`,
      `${inviteLink}`,
      ``,
      `Note: This onboarding link is personal to you and will expire in 7 days.`,
      ``,
      `Best regards,`,
      `${orgName} HR Team`,
    ].join("\n");

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #0f172a; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px;">
        <div style="margin-bottom: 24px; border-bottom: 1px solid #e2e8f0; padding-bottom: 16px;">
          <h2 style="margin: 0; color: #2563eb; font-size: 20px; font-weight: 700;">${orgName} · HRMS</h2>
        </div>
        <p style="font-size: 15px; line-height: 1.5; margin: 0 0 16px;">Hello <strong>${empName}</strong>,</p>
        <p style="font-size: 15px; line-height: 1.5; margin: 0 0 20px;">
          You have been invited to join <strong>${orgName}</strong> on the HRMS platform. Please complete your onboarding setup to access your profile, submit details, and access company resources.
        </p>
        <div style="margin: 28px 0; text-align: center;">
          <a href="${inviteLink}" style="background-color: #2563eb; color: #ffffff; padding: 12px 24px; font-size: 14px; font-weight: 600; text-decoration: none; border-radius: 6px; display: inline-block;">
            Complete Onboarding
          </a>
        </div>
        <p style="font-size: 13px; color: #64748b; line-height: 1.5; margin: 0 0 16px;">
          Or copy and paste this link in your browser:<br />
          <a href="${inviteLink}" style="color: #2563eb; word-break: break-all;">${inviteLink}</a>
        </p>
        <p style="font-size: 12px; color: #94a3b8; border-top: 1px solid #f1f5f9; padding-top: 16px; margin-top: 24px;">
          This link will expire in 7 days. If you were not expecting this invitation, please contact your HR administrator.
        </p>
      </div>
    `.trim();

    return this.sendMail({
      to: normalized,
      subject,
      text,
      html,
    });
  }

  /**
   * Dispatches an offer letter email with attached PDF document.
   *
   * @param {Object} options
   * @param {string} options.companyName
   * @param {string} options.candidateName
   * @param {string} options.candidateEmail
   * @param {string} options.position
   * @param {Buffer} [options.pdfBuffer]
   * @param {Date|string} [options.joiningDate]
   * @param {number} [options.monthlySalary]
   * @returns {Promise<{success: boolean, messageId?: string, error?: string, recipient?: string, sentAt?: Date}>}
   */
  async sendOfferLetter({
    companyName,
    candidateName,
    candidateEmail,
    position,
    pdfBuffer,
    joiningDate,
    monthlySalary,
    reviewLink,
  }) {
    const normalized = normalizeEmail(candidateEmail);
    if (!isValidEmail(normalized)) {
      return {
        success: false,
        error: "Invalid recipient email address",
      };
    }

    if (this.failureSimulation || process.env.SIMULATE_EMAIL_FAILURE === "true") {
      return {
        success: false,
        error: "Mail transfer agent unavailable: simulated delivery failure",
      };
    }

    const orgName = companyName || "Our Organization";
    const cName = candidateName || "Candidate";
    const pos = position || "the offered position";
    const subject = `Your Employment Offer from ${orgName}`;

    const formattedJoiningDate = joiningDate
      ? new Date(joiningDate).toLocaleDateString("en-IN", {
          year: "numeric",
          month: "long",
          day: "numeric",
        })
      : "As agreed upon";

    const formattedSalary =
      monthlySalary != null && !isNaN(monthlySalary)
        ? `₹${Number(monthlySalary).toLocaleString("en-IN")} / month`
        : "";

    const text = [
      `Dear ${cName},`,
      ``,
      `We are pleased to extend an offer of employment for the position of ${pos} at ${orgName}.`,
      ``,
      `Key Offer Details:`,
      `- Position: ${pos}`,
      formattedSalary ? `- Monthly Gross Compensation: ${formattedSalary}` : null,
      `- Expected Joining Date: ${formattedJoiningDate}`,
      ``,
      `Your complete formal offer letter document is attached to this email as a PDF. Please review the employment terms, compensation details, and policies carefully.`,
      reviewLink ? `` : null,
      reviewLink ? `You can review and electronically sign this offer letter online at:` : null,
      reviewLink ? `${reviewLink}` : null,
      ``,
      `If you have any questions, please reply directly to this email or reach out to your HR contact.`,
      ``,
      `Warm regards,`,
      `${orgName} HR Team`,
    ]
      .filter((line) => line !== null)
      .join("\n");

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 28px; color: #09090b; background-color: #ffffff; border: 1px solid #e4e4e7; border-radius: 10px;">
        <div style="margin-bottom: 24px; border-bottom: 1px solid #e4e4e7; padding-bottom: 16px;">
          <h2 style="margin: 0; color: #2563eb; font-size: 20px; font-weight: 700;">${orgName}</h2>
          <span style="font-size: 13px; color: #71717a;">Formal Offer of Employment</span>
        </div>
        <p style="font-size: 15px; line-height: 1.5; margin: 0 0 16px;">Dear <strong>${cName}</strong>,</p>
        <p style="font-size: 14px; line-height: 1.6; color: #3f3f46; margin: 0 0 20px;">
          We are pleased to extend an offer of employment with <strong>${orgName}</strong> for the role of <strong>${pos}</strong>.
        </p>

        <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin-bottom: 24px;">
          <h4 style="margin: 0 0 12px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b;">
            Offer Summary
          </h4>
          <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <tr>
              <td style="padding: 6px 0; color: #64748b; width: 40%;">Position:</td>
              <td style="padding: 6px 0; color: #0f172a; font-weight: 600;">${pos}</td>
            </tr>
            ${
              formattedSalary
                ? `<tr>
                    <td style="padding: 6px 0; color: #64748b;">Compensation:</td>
                    <td style="padding: 6px 0; color: #0f172a; font-weight: 600;">${formattedSalary}</td>
                  </tr>`
                : ""
            }
            <tr>
              <td style="padding: 6px 0; color: #64748b;">Joining Date:</td>
              <td style="padding: 6px 0; color: #0f172a; font-weight: 600;">${formattedJoiningDate}</td>
            </tr>
          </table>
        </div>

        <div style="background-color: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 14px 18px; margin-bottom: 24px;">
          <p style="margin: 0; font-size: 13px; color: #1e40af; line-height: 1.5;">
            <strong>Official Document Attached:</strong> Your complete offer letter with detailed terms, compensation structure, and company policies is attached to this email as a PDF document.
          </p>
        </div>

        ${
          reviewLink
            ? `<div style="text-align: center; margin: 26px 0;">
                <a href="${reviewLink}" style="display: inline-block; background-color: #2563eb; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-weight: 600; font-size: 14px;">
                  Review and Sign Offer
                </a>
                <p style="margin-top: 10px; font-size: 12px; color: #64748b;">
                  Direct link: <a href="${reviewLink}" style="color: #2563eb; word-break: break-all;">${reviewLink}</a>
                </p>
              </div>`
            : `<p style="font-size: 13px; color: #52525b; line-height: 1.6; margin: 0 0 20px;">
                Please review the attached document. To proceed, please return your confirmation, or contact our HR team if you have any questions.
              </p>`
        }

        <p style="font-size: 13px; color: #71717a; margin-top: 28px; border-top: 1px solid #f4f4f5; padding-top: 16px;">
          Warm regards,<br />
          <strong>${orgName} HR Team</strong>
        </p>
      </div>
    `.trim();

    // Ensure PDF buffer is present, non-empty, and a valid Node.js Buffer
    if (pdfBuffer && !Buffer.isBuffer(pdfBuffer)) {
      if (pdfBuffer instanceof Uint8Array || ArrayBuffer.isView(pdfBuffer)) {
        pdfBuffer = Buffer.from(pdfBuffer.buffer, pdfBuffer.byteOffset, pdfBuffer.byteLength);
      } else {
        try {
          pdfBuffer = Buffer.from(pdfBuffer);
        } catch {
          pdfBuffer = null;
        }
      }
    }

    if (!pdfBuffer || !Buffer.isBuffer(pdfBuffer) || pdfBuffer.length === 0) {
      return {
        success: false,
        error: "Offer letter PDF attachment is missing, empty, or invalid.",
      };
    }

    const safeCandidate = cName.replace(/[^a-zA-Z0-9_-]/g, "_").trim();
    const filename = safeCandidate ? `Offer_Letter_${safeCandidate}.pdf` : "Offer_Letter_Candidate.pdf";

    const attachments = [
      {
        filename,
        content: pdfBuffer,
        contentType: "application/pdf",
      },
    ];

    return this.sendMail({
      to: normalized,
      subject,
      text,
      html,
      attachments,
      type: "offer_letter",
      reviewLink,
    });
  }

  /**
   * Sends candidate onboarding invitation email with secure onboarding portal link.
   */
  async sendCandidateOnboardingInvite({
    companyName,
    candidateName,
    candidateEmail,
    onboardingLink,
    joiningDate,
    position,
  }) {
    const normalized = normalizeEmail(candidateEmail);
    if (!isValidEmail(normalized)) {
      return { success: false, error: "Invalid recipient email address" };
    }
    const org = companyName || "Our Organization";
    const name = candidateName || "Candidate";
    const subject = `Welcome to ${org} — Complete Your Onboarding`;

    const text = [
      `Dear ${name},`,
      ``,
      `Congratulations on accepting our offer for the position of ${position || "your new role"} at ${org}!`,
      ``,
      `To prepare for your start${joiningDate ? ` on ${new Date(joiningDate).toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric" })}` : ""}, please complete your employee onboarding form and submit your verification documents.`,
      ``,
      `Access Your Onboarding Portal:`,
      `${onboardingLink}`,
      ``,
      `This link is personal and will remain active for 14 days. You can save your progress and return at any time before submitting.`,
      ``,
      `Warm regards,`,
      `${org} HR Team`,
    ].join("\n");

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 28px; color: #09090b; background-color: #ffffff; border: 1px solid #e4e4e7; border-radius: 10px;">
        <div style="margin-bottom: 24px; border-bottom: 1px solid #e4e4e7; padding-bottom: 16px;">
          <h2 style="margin: 0; color: #2563eb; font-size: 20px; font-weight: 700;">${org}</h2>
          <span style="font-size: 13px; color: #71717a;">Employee Onboarding Portal</span>
        </div>
        <p style="font-size: 15px; margin: 0 0 16px;">Dear <strong>${name}</strong>,</p>
        <p style="font-size: 14px; line-height: 1.6; color: #3f3f46; margin: 0 0 20px;">
          Congratulations on accepting our offer! To prepare for your journey with <strong>${org}</strong>, please complete your onboarding form with your personal details, residential address, emergency contact, bank information, and required verification documents.
        </p>
        <div style="text-align: center; margin: 28px 0;">
          <a href="${onboardingLink}" style="display: inline-block; background-color: #2563eb; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-weight: 600; font-size: 14px;">
            Start Onboarding
          </a>
        </div>
        <p style="font-size: 12px; color: #71717a; line-height: 1.5; margin: 0 0 20px;">
          If the button does not work, copy and paste this link into your browser:<br/>
          <a href="${onboardingLink}" style="color: #2563eb; word-break: break-all;">${onboardingLink}</a>
        </p>
        <p style="font-size: 13px; color: #71717a; margin-top: 28px; border-top: 1px solid #f4f4f5; padding-top: 16px;">
          Warm regards,<br />
          <strong>${org} HR Team</strong>
        </p>
      </div>
    `.trim();

    return this.sendMail({
      to: normalized,
      subject,
      text,
      html,
      type: "candidate_onboarding_invite",
      onboardingLink,
    });
  }

  /**
   * Sends email notification when HR requests corrections on submitted onboarding information.
   */
  async sendOnboardingCorrectionRequest({
    companyName,
    candidateName,
    candidateEmail,
    correctionReason,
    updateLink,
  }) {
    const normalized = normalizeEmail(candidateEmail);
    if (!isValidEmail(normalized)) {
      return { success: false, error: "Invalid recipient email address" };
    }
    const org = companyName || "Our Organization";
    const name = candidateName || "Candidate";
    const subject = `Action Required: Updates Needed on Your ${org} Onboarding`;

    const text = [
      `Dear ${name},`,
      ``,
      `Our HR team has reviewed your onboarding submission for ${org}. Some information or documents require correction before we can finalize your profile.`,
      ``,
      `Reason / Notes from HR:`,
      `${correctionReason || "Please review and update the required fields as requested."}`,
      ``,
      `Update Your Onboarding Form:`,
      `${updateLink}`,
      ``,
      `Please update the requested fields and resubmit your form at your earliest convenience.`,
      ``,
      `Warm regards,`,
      `${org} HR Team`,
    ].join("\n");

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 28px; color: #09090b; background-color: #ffffff; border: 1px solid #e4e4e7; border-radius: 10px;">
        <div style="margin-bottom: 24px; border-bottom: 1px solid #e4e4e7; padding-bottom: 16px;">
          <h2 style="margin: 0; color: #d97706; font-size: 20px; font-weight: 700;">${org}</h2>
          <span style="font-size: 13px; color: #71717a;">Onboarding Update Request</span>
        </div>
        <p style="font-size: 15px; margin: 0 0 16px;">Dear <strong>${name}</strong>,</p>
        <p style="font-size: 14px; line-height: 1.6; color: #3f3f46; margin: 0 0 16px;">
          Our HR team has reviewed your onboarding submission. Some items require updates or replacement before we can approve your profile.
        </p>
        <div style="background-color: #fffbeb; border: 1px solid #fef3c7; border-radius: 8px; padding: 16px 20px; margin-bottom: 24px;">
          <strong style="color: #92400e; font-size: 13px; display: block; margin-bottom: 6px;">Notes from HR Reviewer:</strong>
          <p style="margin: 0; font-size: 14px; color: #78350f; line-height: 1.5;">${correctionReason || "Please review and update the requested fields."}</p>
        </div>
        <div style="text-align: center; margin: 28px 0;">
          <a href="${updateLink}" style="display: inline-block; background-color: #2563eb; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-weight: 600; font-size: 14px;">
            Update Onboarding Form
          </a>
        </div>
        <p style="font-size: 12px; color: #71717a; line-height: 1.5; margin: 0 0 20px;">
          Direct link: <a href="${updateLink}" style="color: #2563eb; word-break: break-all;">${updateLink}</a>
        </p>
        <p style="font-size: 13px; color: #71717a; margin-top: 28px; border-top: 1px solid #f4f4f5; padding-top: 16px;">
          Warm regards,<br />
          <strong>${org} HR Team</strong>
        </p>
      </div>
    `.trim();

    return this.sendMail({
      to: normalized,
      subject,
      text,
      html,
      type: "onboarding_correction_request",
      correctionReason,
      updateLink,
    });
  }

  /**
   * Sends candidate onboarding rejection notification email.
   */
  async sendOnboardingRejectionEmail({
    companyName,
    candidateName,
    candidateEmail,
    rejectionReason,
  }) {
    const normalized = normalizeEmail(candidateEmail);
    if (!isValidEmail(normalized)) {
      return { success: false, error: "Invalid recipient email address" };
    }
    const org = companyName || "Our Organization";
    const name = candidateName || "Candidate";
    const subject = `Update Regarding Your Onboarding with ${org}`;

    const text = [
      `Dear ${name},`,
      ``,
      `Thank you for taking the time to share your onboarding documentation with ${org}.`,
      ``,
      `After thorough review, we regret to inform you that we are unable to proceed with your onboarding at this time.`,
      ``,
      rejectionReason ? `Reason / Review Note:\n${rejectionReason}\n` : "",
      `If you have questions, please reach out directly to the HR department.`,
      ``,
      `Best regards,`,
      `${org} People Team`,
    ].filter(Boolean).join("\n");

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 28px; color: #09090b; background-color: #ffffff; border: 1px solid #e4e4e7; border-radius: 10px;">
        <div style="margin-bottom: 24px; border-bottom: 1px solid #e4e4e7; padding-bottom: 16px;">
          <h2 style="margin: 0; color: #b91c1c; font-size: 20px; font-weight: 700;">${org}</h2>
          <span style="font-size: 13px; color: #71717a;">Onboarding Status Update</span>
        </div>
        <p style="font-size: 15px; margin: 0 0 16px;">Dear <strong>${name}</strong>,</p>
        <p style="font-size: 14px; line-height: 1.6; color: #3f3f46; margin: 0 0 20px;">
          Thank you for submitting your onboarding documentation. After careful review, we regret to inform you that we cannot proceed with your onboarding.
        </p>
        ${
          rejectionReason
            ? `<div style="background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px 20px; margin-bottom: 24px;">
                <strong style="color: #991b1b; font-size: 13px; display: block; margin-bottom: 6px;">Reason:</strong>
                <p style="margin: 0; font-size: 14px; color: #7f1d1d; line-height: 1.5;">${rejectionReason}</p>
              </div>`
            : ""
        }
        <p style="font-size: 13px; color: #71717a; margin-top: 28px; border-top: 1px solid #f4f4f5; padding-top: 16px;">
          Warm regards,<br />
          <strong>${org} People Team</strong>
        </p>
      </div>
    `.trim();

    return this.sendMail({
      to: normalized,
      subject,
      text,
      html,
      type: "onboarding_rejection",
      rejectionReason,
    });
  }

  /**
   * Sends employee account activation email after HR approves onboarding and creates the employee.
   */
  async sendEmployeeActivationEmail({
    companyName,
    employeeName,
    email,
    activationLink,
    employeeCode,
  }) {
    const normalized = normalizeEmail(email);
    if (!isValidEmail(normalized)) {
      return { success: false, error: "Invalid recipient email address" };
    }
    const org = companyName || "Our Organization";
    const name = employeeName || "Team Member";
    const subject = `Welcome to the Team! Activate Your ${org} Employee Portal Account`;

    const text = [
      `Dear ${name},`,
      ``,
      `Welcome to ${org}! Your employee onboarding has been fully reviewed and approved.`,
      ``,
      `Your Employee Code: ${employeeCode || "Assigned"}`,
      `Registered Email: ${normalized}`,
      ``,
      `Please use the secure link below to set your password and activate your employee portal account:`,
      `${activationLink}`,
      ``,
      `For security, this activation link is time-limited. Once activated, you will be able to access your profile, track attendance, manage leave, and view payslips.`,
      ``,
      `Welcome aboard!`,
      `${org} People & Culture Team`,
    ].join("\n");

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 28px; color: #09090b; background-color: #ffffff; border: 1px solid #e4e4e7; border-radius: 10px;">
        <div style="margin-bottom: 24px; border-bottom: 1px solid #e4e4e7; padding-bottom: 16px;">
          <h2 style="margin: 0; color: #16a34a; font-size: 20px; font-weight: 700;">${org}</h2>
          <span style="font-size: 13px; color: #71717a;">Employee Portal Account Activation</span>
        </div>
        <p style="font-size: 15px; margin: 0 0 16px;">Dear <strong>${name}</strong>,</p>
        <p style="font-size: 14px; line-height: 1.6; color: #3f3f46; margin: 0 0 20px;">
          Welcome to the team! Your onboarding submission has been approved and your official employee profile is now active.
        </p>
        <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px 20px; margin-bottom: 24px;">
          <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <tr>
              <td style="padding: 4px 0; color: #166534; width: 40%;">Employee ID:</td>
              <td style="padding: 4px 0; color: #0f172a; font-weight: 600;">${employeeCode || "Active"}</td>
            </tr>
            <tr>
              <td style="padding: 4px 0; color: #166534;">Account Email:</td>
              <td style="padding: 4px 0; color: #0f172a; font-weight: 600;">${normalized}</td>
            </tr>
          </table>
        </div>
        <div style="text-align: center; margin: 28px 0;">
          <a href="${activationLink}" style="display: inline-block; background-color: #16a34a; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-weight: 600; font-size: 14px;">
            Set Password & Activate Account
          </a>
        </div>
        <p style="font-size: 12px; color: #71717a; line-height: 1.5; margin: 0 0 20px;">
          Direct link: <a href="${activationLink}" style="color: #16a34a; word-break: break-all;">${activationLink}</a>
        </p>
        <p style="font-size: 13px; color: #71717a; margin-top: 28px; border-top: 1px solid #f4f4f5; padding-top: 16px;">
          Warm regards,<br />
          <strong>${org} People Team</strong>
        </p>
      </div>
    `.trim();

    return this.sendMail({
      to: normalized,
      subject,
      text,
      html,
      type: "employee_activation",
      activationLink,
      employeeCode,
    });
  }

  /**
   * Sends a test email to verify Resend HTTP API delivery.
   *
   * @param {string} [recipient] Defaults to EMAIL_FROM or TEST_EMAIL_RECIPIENT
   * @returns {Promise<{success: boolean, messageId?: string, error?: string, recipient?: string, sentAt?: Date}>}
   */
  async sendTestEmail(recipient) {
    const target = recipient || process.env.TEST_EMAIL_RECIPIENT || process.env.EMAIL_FROM;
    if (!target) {
      return {
        success: false,
        error: "No test email recipient provided and EMAIL_FROM is not set in environment.",
      };
    }

    const timestamp = new Date().toISOString();
    const subject = `HRMS Resend HTTP API Test — ${new Date().toLocaleTimeString()}`;
    const text = `This is a verification email from HRMS.\n\nResend HTTP API delivery is functioning properly.\nTimestamp: ${timestamp}`;
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 550px; margin: 0 auto; padding: 24px; color: #09090b; background-color: #ffffff; border: 1px solid #e4e4e7; border-radius: 8px;">
        <h3 style="margin-top: 0; color: #2563eb;">HRMS Email Verification</h3>
        <p style="font-size: 14px; line-height: 1.5; color: #3f3f46;">
          Your email integration with <strong>Resend HTTP API</strong> is <strong>working successfully</strong>.
        </p>
        <div style="background-color: #f4f4f5; border-radius: 6px; padding: 12px 16px; font-family: monospace; font-size: 12px; color: #27272a; margin: 16px 0;">
          <div><strong>Sender:</strong> ${this.getFromAddress()}</div>
          <div><strong>Recipient:</strong> ${target}</div>
          <div><strong>Timestamp:</strong> ${timestamp}</div>
          <div><strong>Provider:</strong> Resend HTTP API</div>
        </div>
        <p style="font-size: 12px; color: #71717a; margin-bottom: 0;">
          This email was triggered by the HRMS email verification utility.
        </p>
      </div>
    `.trim();

    return this.sendMail({
      to: target,
      subject,
      text,
      html,
    });
  }
}

export const emailService = new EmailService();
export default emailService;
