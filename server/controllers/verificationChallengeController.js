import { HttpError } from "../utils/httpError.js";
import { issueVerificationChallenge } from "../services/verificationChallengeService.js";

async function getTargetEmployee(req) {
  const { Employee } = req.auth.models;
  const employee = await Employee.findOne({
    $or: [{ userId: req.auth.user._id }, { email: req.auth.user.email }],
  });
  if (!employee) {
    throw new HttpError(404, "Employee record not found for the authenticated user.");
  }
  return employee;
}

/**
 * POST /api/employees/me/attendance/verification-challenge
 * Issues a PUNCH challenge for Wi-Fi (and related) evidence binding.
 */
export async function issuePunchVerificationChallenge(req, res, next) {
  try {
    const { AttendanceVerificationChallenge } = req.auth.models;
    if (!AttendanceVerificationChallenge) {
      throw new HttpError(500, "Verification challenge store is unavailable.");
    }
    const employee = await getTargetEmployee(req);
    const challenge = await issueVerificationChallenge({
      Challenge: AttendanceVerificationChallenge,
      companyId: req.auth.company._id,
      employeeId: employee._id,
      userId: req.auth.user._id,
      purpose: "PUNCH",
      ttlMs: 2 * 60 * 1000,
    });

    res.status(200).json({
      success: true,
      ...challenge,
      notes: {
        wifi:
          "Include challengeId and challengeNonce with wifiEvidence on punch. " +
          "SSID/BSSID remain OS-reported best-effort evidence, not 802.1X proof.",
      },
    });
  } catch (error) {
    next(error);
  }
}
