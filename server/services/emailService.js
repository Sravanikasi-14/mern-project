import crypto from "node:crypto";
import nodemailer from "nodemailer";
import { isValidEmail, normalizeEmail } from "../utils/email.js";
import { decryptSecret } from "../utils/secretCrypto.js";

/**
 * In-process send throttle to avoid Gmail/SMTP burst lockouts.
 */
class SendRateLimiter {
  constructor() {
    this.timestamps = [];
  }

  get maxPerMinute() {
    return parseInt(process.env.EMAIL_RATE_LIMIT_PER_MINUTE, 10) || 20;
  }

  /**
   * @returns {{ allowed: boolean, retryAfterMs?: number, error?: string }}
   */
  tryAcquire() {
    const now = Date.now();
    const windowMs = 60_000;
    this.timestamps = this.timestamps.filter((t) => now - t < windowMs);

    if (this.timestamps.length >= this.maxPerMinute) {
      const oldest = this.timestamps[0];
      const retryAfterMs = Math.max(1000, windowMs - (now - oldest));
      return {
        allowed: false,
        retryAfterMs,
        error: `Email rate limit exceeded (${this.maxPerMinute}/min). Try again in ${Math.ceil(retryAfterMs / 1000)}s.`,
      };
    }

    this.timestamps.push(now);
    return { allowed: true };
  }

  reset() {
    this.timestamps = [];
  }
}

/**
 * Service handling email dispatch for HRMS invitations, onboarding notifications,
 * system communications, and offer letter delivery via Nodemailer (SMTP / Gmail).
 */
class EmailService {
  constructor() {
    this.failureSimulation = false;
    this._customTransporter = null;
    this.transporters = new Map();
    this.history = [];
    this.rateLimiter = new SendRateLimiter();
  }

  get transporter() {
    if (this._customTransporter) return this._customTransporter;
    return this.transporters.values().next().value || null;
  }

  set transporter(val) {
    if (!val) {
      this.invalidateTransporter();
    }
  }

  getHistory() {
    return [...this.history];
  }

  clearHistory() {
    this.history = [];
  }

  setSimulateFailure(value) {
    this.failureSimulation = Boolean(value);
  }

  /**
   * Sanitizes error messages so credentials never leak into logs or API responses.
   */
  sanitizeError(err) {
    if (!err) return "Unknown email delivery error";
    let msg = typeof err === "string" ? err : err.message || String(err);

    const secrets = [
      process.env.SMTP_APP_PASSWORD,
      process.env.SMTP_PASS,
      process.env.RESEND_API_KEY,
    ].filter(Boolean);

    for (const secret of secrets) {
      if (secret.length > 0) {
        msg = msg.replaceAll(secret, "********");
      }
    }

    msg = msg.replace(/re_[A-Za-z0-9_]{10,}/g, "re_********");
    // Mask typical 16-char Google app passwords (with optional spaces)
    msg = msg.replace(/\b([a-z]{4}\s?){4}\b/gi, "********");

    return msg;
  }

  /**
   * Sets a custom transporter (tests / adapters). Pass null to reset.
   */
  setTransporter(transporter) {
    this._customTransporter = transporter || null;
  }

  /**
   * Backward-compatible alias used by older tests (Resend-style client).
   * Adapts client.emails.send → transporter.sendMail.
   */
  setClient(client) {
    if (!client) {
      this.setTransporter(null);
      return;
    }
    if (client.emails && typeof client.emails.send === "function") {
      this.setTransporter({
        sendMail: async (options) => {
          const payload = {
            from: options.from,
            to: options.to,
            subject: options.subject,
            text: options.text,
            html: options.html,
            replyTo: options.replyTo,
            attachments: options.attachments,
          };
          const { data, error } = await client.emails.send(payload);
          if (error) {
            throw typeof error === "string" ? new Error(error) : new Error(error.message || JSON.stringify(error));
          }
          return { messageId: data?.id || `msg_${Date.now()}` };
        },
        verify: async () => true,
      });
      return;
    }
    this.setTransporter(client);
  }

  /**
   * Resolves SMTP configuration strictly from a company document's emailSettings.
   * NEVER falls back to environment variables or another company's credentials.
   * @param {object} company
   * @returns {{ config: object | null, error?: string, code?: string }}
   */
  resolveCompanySmtpConfig(company) {
    if (!company) {
      return {
        config: null,
        error: "Company context is required for company email delivery.",
        code: "COMPANY_REQUIRED",
      };
    }

    const settings = company.emailSettings;
    const fromEmail = (settings?.fromEmail || "").trim();
    const appPasswordEncrypted = (settings?.appPasswordEncrypted || "").trim();

    if (!fromEmail || !appPasswordEncrypted) {
      return {
        config: null,
        error: "Email settings are not configured for this company. Please configure your sender email and password under Settings → Email.",
        code: "COMPANY_EMAIL_NOT_CONFIGURED",
      };
    }

    const normalizedEmail = normalizeEmail(fromEmail);
    if (!isValidEmail(normalizedEmail)) {
      return {
        config: null,
        error: "The company's configured sender email address is invalid.",
        code: "COMPANY_EMAIL_INVALID",
      };
    }

    let pass;
    try {
      pass = decryptSecret(appPasswordEncrypted);
    } catch (err) {
      const safeError = this.sanitizeError(err);
      console.error("[EmailService] Failed to decrypt company SMTP password:", safeError);
      return {
        config: null,
        error: "Company SMTP credentials could not be decrypted. Please update settings under Settings → Email.",
        code: "COMPANY_EMAIL_DECRYPTION_FAILED",
      };
    }

    if (!pass || typeof pass !== "string" || !pass.trim()) {
      return {
        config: null,
        error: "Decrypted company SMTP password is empty. Please update credentials under Settings → Email.",
        code: "COMPANY_EMAIL_PASSWORD_EMPTY",
      };
    }

    const fromName = (settings.fromName || "").trim();
    const host = (settings.smtpHost || "smtp.gmail.com").trim();
    const port = Number(settings.smtpPort) || 587;
    const secure = Boolean(settings.smtpSecure);
    const tenantId = String(company._id || company.slug || "company");

    return {
      config: {
        user: normalizedEmail,
        pass: pass.trim(),
        from: fromName ? `${fromName} <${normalizedEmail}>` : normalizedEmail,
        host,
        port,
        secure,
        tenantId,
      },
    };
  }

  /**
   * Resolves SMTP configuration strictly from platform environment variables.
   * Used ONLY when sending platform-level emails where no company context exists.
   * @returns {{ config: object | null, error?: string, code?: string }}
   */
  resolvePlatformSmtpConfig() {
    const envUser = (process.env.SMTP_USER || process.env.EMAIL_USER || "").trim();
    const envPass = (process.env.SMTP_APP_PASSWORD || process.env.SMTP_PASS || "").trim();

    if (!envUser || !envPass) {
      return {
        config: null,
        error: "Platform SMTP credentials are not configured in environment variables.",
        code: "PLATFORM_EMAIL_NOT_CONFIGURED",
      };
    }

    const user = normalizeEmail(envUser);
    const fromEnv = (process.env.EMAIL_FROM || "").trim();
    const host = (process.env.SMTP_HOST || "smtp.gmail.com").trim();
    const port = parseInt(process.env.SMTP_PORT, 10) || 587;
    const secure = process.env.SMTP_SECURE === "true";

    return {
      config: {
        user,
        pass: envPass,
        from: fromEnv || user,
        host,
        port,
        secure,
        tenantId: "platform",
      },
    };
  }

  /**
   * Resolves SMTP configuration.
   * If company is provided, resolves STRICTLY from company settings.
   * If company is not provided, resolves from platform environment variables.
   */
  resolveSmtpConfig(company) {
    if (company) {
      return this.resolveCompanySmtpConfig(company).config;
    }
    return this.resolvePlatformSmtpConfig().config;
  }

  /**
   * Returns whether SMTP delivery credentials are configured.
   * If company is passed, checks whether that company has emailSettings configured.
   * If no company is passed, checks platform configuration or test mock.
   * @param {object} [company]
   */
  isConfigured(company) {
    if (company) {
      return Boolean(this.resolveCompanySmtpConfig(company).config);
    }
    if (this._customTransporter) return true;
    return Boolean(this.resolvePlatformSmtpConfig().config);
  }

  getFromAddress(company) {
    if (company) {
      const resolution = this.resolveCompanySmtpConfig(company);
      if (resolution.config?.from) return resolution.config.from;
      if (company.emailSettings?.fromEmail) {
        const fromName = (company.emailSettings.fromName || "").trim();
        const user = normalizeEmail(company.emailSettings.fromEmail);
        return fromName ? `${fromName} <${user}>` : user;
      }
      return `${company.companyName || company.slug || "Company"} <noreply@localhost>`;
    }

    const platform = this.resolvePlatformSmtpConfig().config;
    if (platform?.from) return platform.from;
    const from = (process.env.EMAIL_FROM || "").trim();
    if (from) return from;
    return "HRMS Platform <noreply@localhost>";
  }

  /**
   * Sender resolution.
   */
  resolveSender(from, company) {
    const rawSender = (from || this.getFromAddress(company)).trim();
    return { from: rawSender, replyTo: undefined };
  }

  /**
   * Generates a deterministic, secure cache key for transporter caching.
   * Combines tenantId, host, port, TLS setting, and a cryptographic SHA-256 hash
   * of the credentials so passwords are never logged or exposed, yet any credential
   * change immediately invalidates the cache key.
   */
  _cacheKeyForConfig(config) {
    if (!config) return null;
    const { tenantId = "default", host = "", port = 587, secure = false, user = "", pass = "" } = config;
    const credHash = crypto
      .createHash("sha256")
      .update(`${host.toLowerCase()}:${port}:${Boolean(secure)}:${user.toLowerCase()}:${pass}`)
      .digest("hex");

    return `${tenantId}:${host.toLowerCase()}:${port}:${Boolean(secure)}:${credHash.substring(0, 32)}`;
  }

  /**
   * Returns or creates a cached Nodemailer transporter for the given configuration.
   */
  getTransporterForConfig(config) {
    if (this._customTransporter) {
      return this._customTransporter;
    }
    if (!config) return null;

    const cacheKey = this._cacheKeyForConfig(config);
    if (!cacheKey) return null;

    if (this.transporters.has(cacheKey)) {
      return this.transporters.get(cacheKey);
    }

    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.user,
        pass: config.pass,
      },
      connectionTimeout: parseInt(process.env.EMAIL_TIMEOUT_MS, 10) || 15000,
      greetingTimeout: parseInt(process.env.EMAIL_TIMEOUT_MS, 10) || 15000,
      socketTimeout: parseInt(process.env.EMAIL_TIMEOUT_MS, 10) || 20000,
    });

    // Guard against unbounded memory growth in long-running processes (LRU-like eviction)
    if (this.transporters.size >= 50) {
      const oldestKey = this.transporters.keys().next().value;
      const oldTransporter = this.transporters.get(oldestKey);
      try {
        oldTransporter?.close?.();
      } catch {}
      this.transporters.delete(oldestKey);
    }

    this.transporters.set(cacheKey, transporter);
    return transporter;
  }

  /**
   * Returns a Nodemailer transporter for the given company or platform config.
   */
  getTransporter(company) {
    if (this._customTransporter) {
      return this._customTransporter;
    }

    const config = this.resolveSmtpConfig(company);
    if (!config) return null;

    return this.getTransporterForConfig(config);
  }

  /**
   * Invalidate cached transporters for a specific company or all companies.
   * @param {string|object} [companyOrId] - company document, company id, or null for all
   */
  invalidateTransporter(companyOrId) {
    if (!companyOrId) {
      for (const [, tr] of this.transporters) {
        try {
          tr.close?.();
        } catch {}
      }
      this.transporters.clear();
      return;
    }

    const tenantId = String(companyOrId._id || companyOrId.slug || companyOrId);
    const prefix = `${tenantId}:`;

    for (const [key, tr] of this.transporters.entries()) {
      if (key.startsWith(prefix)) {
        try {
          tr.close?.();
        } catch {}
        this.transporters.delete(key);
      }
    }
  }

  /**
   * Verifies SMTP credentials (AUTH) against the mail server.
   * @param {object} [company]
   * @param {{ user: string, pass: string, host?: string, port?: number, secure?: boolean }} [overrideConfig]
   */
  async verifyConnection(company, overrideConfig) {
    try {
      let transporter;
      if (this._customTransporter) {
        // In test suites where a custom transporter mock is injected, verify via mock
        transporter = this._customTransporter;
      } else if (overrideConfig?.user && overrideConfig?.pass) {
        transporter = nodemailer.createTransport({
          host: (overrideConfig.host || "smtp.gmail.com").trim(),
          port: Number(overrideConfig.port) || 587,
          secure: Boolean(overrideConfig.secure),
          auth: {
            user: normalizeEmail(overrideConfig.user),
            pass: overrideConfig.pass,
          },
          connectionTimeout: parseInt(process.env.EMAIL_TIMEOUT_MS, 10) || 15000,
          greetingTimeout: parseInt(process.env.EMAIL_TIMEOUT_MS, 10) || 15000,
          socketTimeout: parseInt(process.env.EMAIL_TIMEOUT_MS, 10) || 20000,
        });
      } else if (company) {
        const resolution = this.resolveCompanySmtpConfig(company);
        if (!resolution.config) {
          return {
            success: false,
            error: resolution.error || "Company SMTP is not configured.",
          };
        }
        transporter = this.getTransporterForConfig(resolution.config);
      } else if (!this.isConfigured()) {
        return {
          success: false,
          error:
            "SMTP is not configured. Set your Gmail address and app password under Settings → Email.",
        };
      } else {
        transporter = this.getTransporter();
      }

      if (!transporter) {
        return { success: false, error: "Failed to initialize SMTP transporter." };
      }

      if (typeof transporter.verify === "function") {
        await transporter.verify();
      }

      return {
        success: true,
        message: "SMTP connection verified successfully. You can send emails to any recipient.",
        provider: "nodemailer",
      };
    } catch (err) {
      const safeError = this.sanitizeError(err);
      return {
        success: false,
        error: `SMTP verification failed: ${safeError}`,
        provider: "nodemailer",
      };
    }
  }

  /**
   * Core method to send an email via Nodemailer SMTP.
   */
  async sendMail({
    to,
    subject,
    text,
    html,
    from,
    replyTo,
    attachments,
    company,
    skipRateLimit = false,
    ...extra
  }) {
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

    if (!skipRateLimit && process.env.NODE_ENV !== "test") {
      const gate = this.rateLimiter.tryAcquire();
      if (!gate.allowed) {
        return {
          success: false,
          error: gate.error,
          provider: "nodemailer",
          rateLimited: true,
          retryAfterMs: gate.retryAfterMs,
        };
      }
    }

    // Resolve credentials based on context
    let config = null;
    if (company) {
      const resolution = this.resolveCompanySmtpConfig(company);
      if (!resolution.config) {
        return {
          success: false,
          error: resolution.error || "Email settings are not configured for this company. Please configure your sender email and password under Settings → Email.",
          code: resolution.code || "COMPANY_EMAIL_NOT_CONFIGURED",
          provider: "nodemailer",
        };
      }
      config = resolution.config;
    } else {
      // Platform-level email delivery
      const resolution = this.resolvePlatformSmtpConfig();
      if (!resolution.config && !this._customTransporter) {
        // In automated tests where no company and no platform credentials are provided,
        // allow simulation fallback for legacy platform tests without mocks
        if (process.env.NODE_ENV === "test") {
          const messageId = `sim_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
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

        return {
          success: false,
          error: resolution.error || "Platform SMTP credentials are not configured in environment variables.",
          code: resolution.code || "PLATFORM_EMAIL_NOT_CONFIGURED",
          provider: "nodemailer",
        };
      }
      config = resolution.config;
    }

    const resolvedFrom = from || config?.from || this.getFromAddress(company);
    const finalReplyTo = replyTo || undefined;

    try {
      const transporter = this._customTransporter || this.getTransporterForConfig(config);
      if (!transporter || typeof transporter.sendMail !== "function") {
        return {
          success: false,
          error: "SMTP transporter is not properly initialized",
          provider: "nodemailer",
        };
      }

      const mailOptions = {
        from: resolvedFrom,
        to: normalizedRecipient,
        subject,
        ...(html ? { html } : {}),
        ...(text ? { text } : {}),
        ...(finalReplyTo ? { replyTo: finalReplyTo } : {}),
      };

      if (Array.isArray(attachments) && attachments.length > 0) {
        mailOptions.attachments = attachments.map((att) => ({
          filename: att.filename,
          content: att.content,
          contentType: att.contentType || "application/pdf",
        }));
      }

      const info = await transporter.sendMail(mailOptions);
      const messageId = info?.messageId || `smtp_${Date.now()}`;

      if (process.env.NODE_ENV !== "test") {
        console.log(
          `[EmailService] Email accepted by SMTP for ${normalizedRecipient}. Message ID: ${messageId}`
        );
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
        provider: "nodemailer",
        providerStatus: "accepted",
        ...extra,
      };
      this.history.push(record);

      return {
        success: true,
        messageId,
        recipient: normalizedRecipient,
        sentAt: record.sentAt,
        provider: "nodemailer",
        providerStatus: "accepted",
      };
    } catch (err) {
      const safeError = this.sanitizeError(err);
      console.error(
        `[EmailService] Error delivering email via SMTP to ${normalizedRecipient}:`,
        safeError
      );
      return {
        success: false,
        error: safeError,
        provider: "nodemailer",
      };
    }
  }

  async sendEmployeeInvitation({ companyName, employeeName, email, inviteLink, company }) {
    const normalized = normalizeEmail(email);
    if (!isValidEmail(normalized)) {
      return { success: false, error: "Invalid recipient email address" };
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
      company,
    });
  }

  async sendOfferLetter({
    companyName,
    candidateName,
    candidateEmail,
    position,
    pdfBuffer,
    joiningDate,
    monthlySalary,
    reviewLink,
    company,
  }) {
    const normalized = normalizeEmail(candidateEmail);
    if (!isValidEmail(normalized)) {
      return { success: false, error: "Invalid recipient email address" };
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
    const filename = safeCandidate
      ? `Offer_Letter_${safeCandidate}.pdf`
      : "Offer_Letter_Candidate.pdf";

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
      company,
    });
  }

  async sendCandidateOnboardingInvite({
    companyName,
    candidateName,
    candidateEmail,
    onboardingLink,
    joiningDate,
    position,
    company,
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
      company,
    });
  }

  async sendOnboardingCorrectionRequest({
    companyName,
    candidateName,
    candidateEmail,
    correctionReason,
    updateLink,
    company,
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
      company,
    });
  }

  async sendOnboardingRejectionEmail({
    companyName,
    candidateName,
    candidateEmail,
    rejectionReason,
    company,
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
    ]
      .filter(Boolean)
      .join("\n");

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
      company,
    });
  }

  async sendEmployeeActivationEmail({
    companyName,
    employeeName,
    email,
    activationLink,
    employeeCode,
    company,
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
      company,
    });
  }

  /**
   * Sends a test email to verify SMTP delivery.
   */
  async sendTestEmail(recipient, company) {
    const config = this.resolveSmtpConfig(company);
    const target =
      recipient ||
      process.env.TEST_EMAIL_RECIPIENT ||
      config?.user ||
      process.env.EMAIL_FROM;

    if (!target) {
      return {
        success: false,
        error:
          "No test email recipient provided and SMTP from-address is not set.",
      };
    }

    const timestamp = new Date().toISOString();
    const subject = `HRMS SMTP Test — ${new Date().toLocaleTimeString()}`;
    const text = `This is a verification email from HRMS.\n\nNodemailer SMTP delivery is functioning properly.\nTimestamp: ${timestamp}`;
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 550px; margin: 0 auto; padding: 24px; color: #09090b; background-color: #ffffff; border: 1px solid #e4e4e7; border-radius: 8px;">
        <h3 style="margin-top: 0; color: #2563eb;">HRMS Email Verification</h3>
        <p style="font-size: 14px; line-height: 1.5; color: #3f3f46;">
          Your email integration with <strong>Nodemailer (SMTP)</strong> is <strong>working successfully</strong>.
        </p>
        <div style="background-color: #f4f4f5; border-radius: 6px; padding: 12px 16px; font-family: monospace; font-size: 12px; color: #27272a; margin: 16px 0;">
          <div><strong>Sender:</strong> ${this.getFromAddress(company)}</div>
          <div><strong>Recipient:</strong> ${target}</div>
          <div><strong>Timestamp:</strong> ${timestamp}</div>
          <div><strong>Provider:</strong> Nodemailer SMTP</div>
        </div>
        <p style="font-size: 12px; color: #71717a; margin-bottom: 0;">
          This email was triggered from HRMS Settings.
        </p>
      </div>
    `.trim();

    return this.sendMail({
      to: target,
      subject,
      text,
      html,
      company,
    });
  }
}

export const emailService = new EmailService();
export default emailService;
