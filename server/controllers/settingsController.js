import fs from "node:fs";
import Company from "../models/Company.js";
import { emailService } from "../services/emailService.js";
import {
  saveCompanyLogoFile,
  getCompanyLogoAbsolutePath,
  deleteCompanyLogoFile,
} from "../services/documentStorage.js";
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

/**
 * GET /api/settings/company
 */
export async function getCompanySettings(req, res, next) {
  try {
    const company = await Company.findById(req.auth.company._id);
    if (!company) {
      throw new HttpError(404, "Company not found");
    }

    res.json({
      success: true,
      company: {
        id: company._id,
        companyName: company.companyName || "",
        slug: company.slug || "",
        status: company.status || "ACTIVE",
        branding: {
          displayName: company.branding?.displayName || "",
          logoUrl: company.branding?.logoUrl || "",
          primaryColor: company.branding?.primaryColor || "#155a37",
        },
        config: {
          timezone: company.config?.timezone || "Asia/Kolkata",
          currencyCode: company.config?.currencyCode || "INR",
          enabledModules: company.config?.enabledModules || [],
        },
        primaryContact: {
          fullName: company.primaryContact?.fullName || "",
          email: company.primaryContact?.email || "",
          phoneNumber: company.primaryContact?.phoneNumber || "",
        },
        subscription: {
          plan: company.subscription?.plan || "ENTERPRISE",
          maxEmployeeSeats: company.subscription?.maxEmployeeSeats || 100,
          startDate: company.subscription?.startDate || null,
          endDate: company.subscription?.endDate || null,
        },
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * PUT /api/settings/company
 */
export async function updateCompanySettings(req, res, next) {
  try {
    const company = await Company.findById(req.auth.company._id);
    if (!company) {
      throw new HttpError(404, "Company not found");
    }

    const {
      companyName,
      displayName,
      timezone,
      currencyCode,
      currency,
      primaryContact,
      contactEmail,
      contactPhone,
    } = req.body || {};

    if (companyName && typeof companyName === "string" && companyName.trim()) {
      company.companyName = companyName.trim();
    }

    if (!company.branding) company.branding = {};
    if (typeof displayName === "string") {
      company.branding.displayName = displayName.trim();
    }

    if (!company.config) company.config = {};
    if (typeof timezone === "string" && timezone.trim()) {
      company.config.timezone = timezone.trim();
    }
    const nextCurrency = currencyCode || currency;
    if (typeof nextCurrency === "string" && nextCurrency.trim()) {
      company.config.currencyCode = nextCurrency.trim().replace(/\s*\(.*$/, "").toUpperCase();
    }

    const contactPayload =
      primaryContact && typeof primaryContact === "object"
        ? primaryContact
        : {
            email: contactEmail,
            phoneNumber: contactPhone,
          };

    if (contactPayload && typeof contactPayload === "object") {
      if (!company.primaryContact) company.primaryContact = {};
      if (typeof contactPayload.fullName === "string") {
        company.primaryContact.fullName = contactPayload.fullName.trim();
      }
      if (typeof contactPayload.email === "string" && contactPayload.email.trim()) {
        const norm = normalizeEmail(contactPayload.email.trim());
        if (norm && isValidEmail(norm)) {
          company.primaryContact.email = norm;
        }
      }
      if (typeof contactPayload.phoneNumber === "string") {
        company.primaryContact.phoneNumber = contactPayload.phoneNumber.trim();
      }
    }

    company.markModified("branding");
    company.markModified("config");
    company.markModified("primaryContact");
    await company.save();

    res.json({
      success: true,
      message: "Company profile settings updated successfully.",
      company: {
        id: company._id,
        companyName: company.companyName,
        slug: company.slug,
        status: company.status,
        branding: company.branding,
        config: company.config,
        primaryContact: company.primaryContact,
        subscription: company.subscription,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/settings/audit-logs
 */
export async function getAuditLogsSettings(req, res, next) {
  try {
    const AuditLog = req.auth.models?.AuditLog;
    if (!AuditLog) {
      return res.json({
        success: true,
        logs: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
      });
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));

    const [logs, total] = await Promise.all([
      AuditLog.find({})
        .sort({ timestamp: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      AuditLog.countDocuments({}),
    ]);

    res.json({
      success: true,
      logs: logs.map((log) => ({
        id: log._id,
        action: log.action,
        actorEmail: log.actorEmail,
        actorRole: log.actorRole,
        targetType: log.targetType,
        targetId: log.targetId,
        timestamp: log.timestamp || log.createdAt,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/settings/company/logo
 * Body: { fileName, fileData, mimeType }
 */
export async function uploadCompanyLogo(req, res, next) {
  try {
    const company = await Company.findById(req.auth.company._id);
    if (!company) {
      throw new HttpError(404, "Company not found");
    }

    const { fileName, fileData, mimeType } = req.body || {};
    if (!fileName || !fileData) {
      throw new HttpError(400, "Please choose a logo image to upload.");
    }

    const saved = await saveCompanyLogoFile({
      databaseName: req.auth.company.databaseName,
      fileName,
      fileData,
      mimeType,
    });

    if (!company.branding) company.branding = {};
    const previousKey = company.branding.logoUrl;
    company.branding.logoUrl = saved.storageKey;
    company.branding.logoMimeType = saved.mimeType;
    company.markModified("branding");
    await company.save();

    if (previousKey && previousKey !== saved.storageKey) {
      await deleteCompanyLogoFile({
        databaseName: req.auth.company.databaseName,
        storageKey: previousKey,
      });
    }

    res.json({
      success: true,
      message: "Company logo saved.",
      branding: {
        displayName: company.branding.displayName || "",
        logoUrl: company.branding.logoUrl,
        logoMimeType: company.branding.logoMimeType,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /api/settings/company/logo
 */
export async function deleteCompanyLogo(req, res, next) {
  try {
    const company = await Company.findById(req.auth.company._id);
    if (!company) {
      throw new HttpError(404, "Company not found");
    }

    const previousKey = company.branding?.logoUrl;
    if (previousKey) {
      await deleteCompanyLogoFile({
        databaseName: req.auth.company.databaseName,
        storageKey: previousKey,
      });
    }

    if (!company.branding) company.branding = {};
    company.branding.logoUrl = "";
    company.branding.logoMimeType = "";
    company.markModified("branding");
    await company.save();

    res.json({
      success: true,
      message: "Company logo removed.",
      branding: {
        displayName: company.branding.displayName || "",
        logoUrl: "",
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/auth/company-logo  (any authenticated company member)
 */
export async function streamCompanyLogo(req, res, next) {
  try {
    const company = await Company.findById(req.auth.company._id);
    if (!company) {
      throw new HttpError(404, "Company not found");
    }

    const storageKey = company.branding?.logoUrl;
    if (!storageKey) {
      throw new HttpError(404, "No company logo has been uploaded.");
    }

    const filePath = getCompanyLogoAbsolutePath({
      databaseName: company.databaseName,
      storageKey,
    });
    if (!filePath) {
      throw new HttpError(404, "Company logo file was not found.");
    }

    const mime =
      company.branding?.logoMimeType ||
      (storageKey.endsWith(".png")
        ? "image/png"
        : storageKey.endsWith(".webp")
          ? "image/webp"
          : "image/jpeg");

    res.setHeader("Content-Type", mime);
    res.setHeader("Cache-Control", "private, max-age=120");
    fs.createReadStream(filePath).pipe(res);
  } catch (error) {
    next(error);
  }
}
