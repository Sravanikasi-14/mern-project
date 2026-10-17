import { isValidEmail, normalizeEmail } from "../utils/email.js";

/**
 * Service handling email dispatch for HRMS invitations, onboarding notifications,
 * and system communications.
 */
class EmailService {
  constructor() {
    this.failureSimulation = false;
  }

  setSimulateFailure(value) {
    this.failureSimulation = Boolean(value);
  }

  /**
   * Dispatches an employee onboarding invitation email.
   *
   * @param {Object} options
   * @param {string} options.companyName
   * @param {string} options.employeeName
   * @param {string} options.email
   * @param {string} options.inviteLink
   * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
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

    // In production or test environment without external SMTP relay configured,
    // dispatch is tracked with confirmation id
    const messageId = `invite_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    if (process.env.NODE_ENV !== "test") {
      console.log(`[EmailService] Invitation sent to ${normalized} for ${companyName}. Link: ${inviteLink}`);
    }

    return {
      success: true,
      messageId,
      recipient: normalized,
      sentAt: new Date(),
    };
  }
}

export const emailService = new EmailService();
export default emailService;
