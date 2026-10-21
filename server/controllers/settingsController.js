import Company from "../models/Company.js";
import { emailService } from "../services/emailService.js";
import { encryptSecret } from "../utils/secretCrypto.js";
import { isValidEmail, normalizeEmail } from "../utils/email.js";
import { HttpError } from "../utils/httpError.js";

function serializeEmailSettings(company) {
  const s = company.emailSettings || {};
  const hasAppPassword = Boolean(s.appPasswordEncrypted);
  const isConfigured = Boolean(s.fromEmail && hasAppPassword);

  return {
    fromName: s.fromName || "",
    fromEmail: s.fromEmail || "",
    smtpHost: s.smtpHost || "smtp.gmail.com",
    smtpPort: s.smtpPort || 587,
    smtpSecure: Boolean(s.smtpSecure),
    hasAppPassword,
    isConfigured,
    lastVerifiedAt: s.lastVerifiedAt || null,
    updatedAt: s.updatedAt || null,
    rateLimitPerMinute:
      parseInt(process.env.EMAIL_RATE_LIMIT_PER_MINUTE, 10) || 20,
  };
}

/**
 * GET /api/settings/email
 */
export async function getEmailSettings(req, res, next) {
  try {
    const company = await Company.findById(req.auth.company._id);
    if (!company) {
      throw new HttpError(404, "Company not found");
    }

    res.json({
      success: true,
      emailSettings: serializeEmailSettings(company),
    });
  } catch (error) {
    next(error);
  }
}

/**
 * PUT /api/settings/email
 * Body: { fromEmail, fromName?, appPassword?, smtpHost?, smtpPort?, smtpSecure? }
 */
export async function updateEmailSettings(req, res, next) {
  try {
    const {
      fromEmail,
      fromName,
      appPassword,
      smtpHost,
      smtpPort,
      smtpSecure,
    } = req.body || {};

    const company = await Company.findById(req.auth.company._id);
    if (!company) {
      throw new HttpError(404, "Company not found");
    }

    if (!company.emailSettings) {
      company.emailSettings = {};
    }

    const normalizedEmail = normalizeEmail(fromEmail || "");
    if (!normalizedEmail || !isValidEmail(normalizedEmail)) {
      throw new HttpError(400, "A valid sender email address is required.", {
        field: "fromEmail",
      });
    }

    const existingPassword = company.emailSettings.appPasswordEncrypted || "";
    const passwordInput =
      typeof appPassword === "string" ? appPassword.trim() : "";

    if (!passwordInput && !existingPassword) {
      throw new HttpError(
        400,
        "Gmail app password is required. Generate one at https://myaccount.google.com/apppasswords",
        { field: "appPassword" }
      );
    }

    company.emailSettings.fromEmail = normalizedEmail;
    company.emailSettings.fromName =
      typeof fromName === "string" ? fromName.trim() : company.emailSettings.fromName || "";

    if (typeof smtpHost === "string" && smtpHost.trim()) {
      company.emailSettings.smtpHost = smtpHost.trim();
    } else if (!company.emailSettings.smtpHost) {
      company.emailSettings.smtpHost = "smtp.gmail.com";
    }

    if (smtpPort != null && smtpPort !== "") {
      const port = Number(smtpPort);
      if (!Number.isFinite(port) || port < 1 || port > 65535) {
        throw new HttpError(400, "SMTP port must be between 1 and 65535.", {
          field: "smtpPort",
        });
      }
      company.emailSettings.smtpPort = port;
    } else if (!company.emailSettings.smtpPort) {
      company.emailSettings.smtpPort = 587;
    }

    if (typeof smtpSecure === "boolean") {
      company.emailSettings.smtpSecure = smtpSecure;
    }

    if (passwordInput) {
      // Google app passwords are 16 chars (often shown with spaces)
      const compact = passwordInput.replace(/\s+/g, "");
      if (compact.length < 8) {
        throw new HttpError(400, "App password looks too short.", {
          field: "appPassword",
        });
      }
      company.emailSettings.appPasswordEncrypted = encryptSecret(passwordInput);
    }

    company.emailSettings.isConfigured = Boolean(
      company.emailSettings.fromEmail && company.emailSettings.appPasswordEncrypted
    );
    company.emailSettings.updatedAt = new Date();

    // Verify SMTP before saving so bad credentials are rejected early
    const verifyPass = passwordInput
      ? passwordInput
      : undefined;

    let verifyResult;
    if (verifyPass) {
      verifyResult = await emailService.verifyConnection(null, {
        user: normalizedEmail,
        pass: verifyPass,
        host: company.emailSettings.smtpHost,
        port: company.emailSettings.smtpPort,
        secure: company.emailSettings.smtpSecure,
      });
    } else {
      // Re-verify with stored (encrypted) password via company snapshot
      const snapshot = {
        emailSettings: {
          ...company.emailSettings.toObject?.() || company.emailSettings,
        },
      };
      verifyResult = await emailService.verifyConnection(snapshot);
    }

    if (!verifyResult.success) {
      throw new HttpError(
        400,
        verifyResult.error ||
          "Could not verify SMTP credentials. Check your email and app password.",
        { code: "SMTP_VERIFY_FAILED" }
      );
    }

    company.emailSettings.lastVerifiedAt = new Date();
    company.markModified("emailSettings");
    await company.save();

    // Refresh auth company reference for this request lifecycle
    req.auth.company.emailSettings = company.emailSettings;

    // Invalidate cached transporter so next send uses new credentials
    emailService.setTransporter(null);

    res.json({
      success: true,
      message: "Email settings saved and SMTP verified successfully.",
      emailSettings: serializeEmailSettings(company),
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/settings/email/test
 * Body: { to?: string }
 */
export async function sendTestEmailSettings(req, res, next) {
  try {
    const company = await Company.findById(req.auth.company._id);
    if (!company) {
      throw new HttpError(404, "Company not found");
    }

    if (!emailService.isConfigured(company)) {
      throw new HttpError(
        400,
        "Configure your sender email and app password in Settings before sending a test."
      );
    }

    const to =
      typeof req.body?.to === "string" && req.body.to.trim()
        ? normalizeEmail(req.body.to.trim())
        : company.emailSettings?.fromEmail;

    if (!to || !isValidEmail(to)) {
      throw new HttpError(400, "Provide a valid test recipient email.", {
        field: "to",
      });
    }

    const result = await emailService.sendTestEmail(to, company);

    if (!result.success) {
      const status = result.rateLimited ? 429 : 502;
      throw new HttpError(
        status,
        result.error || "Failed to send test email.",
        { code: result.rateLimited ? "RATE_LIMITED" : "EMAIL_SEND_FAILED" }
      );
    }

    res.json({
      success: true,
      message: `Test email sent to ${result.recipient}`,
      messageId: result.messageId,
      recipient: result.recipient,
      provider: result.provider,
      sentAt: result.sentAt,
    });
  } catch (error) {
    next(error);
  }
}
