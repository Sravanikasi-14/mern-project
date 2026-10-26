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

    const normalizedEmail = normalizeEmail(fromEmail || "");
    if (!normalizedEmail || !isValidEmail(normalizedEmail)) {
      throw new HttpError(400, "A valid sender email address is required.", {
        field: "fromEmail",
      });
    }

    const cleanHost =
      typeof smtpHost === "string" && smtpHost.trim()
        ? smtpHost.trim().toLowerCase()
        : (company.emailSettings?.smtpHost || "smtp.gmail.com").toLowerCase();

    if (!cleanHost || cleanHost.length > 255 || /[\s<>]/.test(cleanHost) || !/^[a-z0-9.-]+$/i.test(cleanHost)) {
      throw new HttpError(400, "A valid SMTP host (e.g. smtp.gmail.com) is required.", {
        field: "smtpHost",
      });
    }

    let cleanPort = company.emailSettings?.smtpPort || 587;
    if (smtpPort != null && smtpPort !== "") {
      const portNum = Number(smtpPort);
      if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
        throw new HttpError(400, "SMTP port must be an integer between 1 and 65535.", {
          field: "smtpPort",
        });
      }
      cleanPort = portNum;
    }

    const cleanSecure =
      typeof smtpSecure === "boolean"
        ? smtpSecure
        : Boolean(company.emailSettings?.smtpSecure);

    const existingPassword = company.emailSettings?.appPasswordEncrypted || "";
    const passwordInput =
      typeof appPassword === "string" ? appPassword.trim() : "";

    if (!passwordInput && !existingPassword) {
      throw new HttpError(
        400,
        "SMTP / Gmail app password is required. Generate one at https://myaccount.google.com/apppasswords",
        { field: "appPassword" }
      );
    }

    let plainPasswordToVerify = "";
    let newPasswordEncrypted = null;

    if (passwordInput) {
      const compact = passwordInput.replace(/\s+/g, "");
      if (compact.length < 6) {
        throw new HttpError(400, "SMTP password must be at least 6 characters.", {
          field: "appPassword",
        });
      }
      plainPasswordToVerify = passwordInput;
      newPasswordEncrypted = encryptSecret(passwordInput);
    } else {
      try {
        plainPasswordToVerify = decryptSecret(existingPassword);
      } catch (err) {
        throw new HttpError(
          400,
          "Existing SMTP password cannot be decrypted. Please enter a new password.",
          { field: "appPassword" }
        );
      }
    }

    // Verify SMTP connection before persisting changes to protect against invalid credentials
    const candidateConfig = {
      user: normalizedEmail,
      pass: plainPasswordToVerify,
      host: cleanHost,
      port: cleanPort,
      secure: cleanSecure,
    };

    const verifyResult = await emailService.verifyConnection(null, candidateConfig);
    if (!verifyResult.success) {
      throw new HttpError(
        400,
        verifyResult.error ||
          "Could not verify SMTP credentials. Check your email and password.",
        { code: "SMTP_VERIFY_FAILED" }
      );
    }

    // Only mutate and persist after successful verification
    if (!company.emailSettings) {
      company.emailSettings = {};
    }

    company.emailSettings.fromEmail = normalizedEmail;
    company.emailSettings.fromName =
      typeof fromName === "string"
        ? fromName.trim()
        : company.emailSettings.fromName || "";
    company.emailSettings.smtpHost = cleanHost;
    company.emailSettings.smtpPort = cleanPort;
    company.emailSettings.smtpSecure = cleanSecure;

    if (newPasswordEncrypted) {
      company.emailSettings.appPasswordEncrypted = newPasswordEncrypted;
    }

    company.emailSettings.isConfigured = Boolean(
      company.emailSettings.fromEmail && company.emailSettings.appPasswordEncrypted
    );
    company.emailSettings.lastVerifiedAt = new Date();
    company.emailSettings.updatedAt = new Date();

    company.markModified("emailSettings");
    await company.save();

    // Refresh auth company reference for this request lifecycle
    if (req.auth?.company) {
      req.auth.company.emailSettings = company.emailSettings;
    }

    // Invalidate cached transporter for this company so next send uses new credentials
    emailService.invalidateTransporter(company._id);

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
