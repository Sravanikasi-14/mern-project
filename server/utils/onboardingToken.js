import crypto from "node:crypto";
import jwt from "jsonwebtoken";

function requiredSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("JWT_SECRET must be set to at least 32 characters");
  }
  return secret;
}

export function signOnboardingToken({ companyId, email }) {
  return jwt.sign(
    {
      sub: email.trim().toLowerCase(),
      companyId: String(companyId),
      purpose: "hr_admin_onboarding",
    },
    requiredSecret(),
    {
      expiresIn: process.env.ONBOARDING_TOKEN_EXPIRES_IN || "7d",
      issuer: process.env.JWT_ISSUER || "hrms-platform",
      audience: process.env.JWT_AUDIENCE || "hrms-company-users",
    }
  );
}

export function signEmployeeInvitationToken({ companyId, employeeId, email }) {
  return jwt.sign(
    {
      sub: email.trim().toLowerCase(),
      companyId: String(companyId),
      employeeId: String(employeeId),
      role: "EMPLOYEE",
      purpose: "employee_onboarding",
      jti: crypto.randomUUID(),
    },
    requiredSecret(),
    {
      expiresIn: process.env.EMPLOYEE_INVITATION_EXPIRES_IN || "7d",
      issuer: process.env.JWT_ISSUER || "hrms-platform",
      audience: process.env.JWT_AUDIENCE || "hrms-company-users",
    }
  );
}

export function verifyEmployeeInvitationToken(token) {
  if (typeof token !== "string" || !token.trim()) {
    throw new Error("Invitation token is required");
  }

  const payload = jwt.verify(token, requiredSecret(), {
    issuer: process.env.JWT_ISSUER || "hrms-platform",
    audience: process.env.JWT_AUDIENCE || "hrms-company-users",
  });

  if (payload.purpose !== "employee_onboarding" || !payload.companyId || !payload.sub || !payload.employeeId) {
    throw new Error("Invalid employee invitation token purpose or payload");
  }

  return payload;
}

export function signOfferSigningToken({ companyId, offerId, email }) {
  return jwt.sign(
    {
      sub: email.trim().toLowerCase(),
      companyId: String(companyId),
      offerId: String(offerId),
      purpose: "offer_signing",
      jti: crypto.randomUUID(),
    },
    requiredSecret(),
    {
      expiresIn: process.env.OFFER_SIGNING_TOKEN_EXPIRES_IN || "14d",
      issuer: process.env.JWT_ISSUER || "hrms-platform",
      audience: process.env.JWT_AUDIENCE || "hrms-company-users",
    }
  );
}

export function verifyOfferSigningToken(token) {
  if (typeof token !== "string" || !token.trim()) {
    throw new Error("Offer signing token is required");
  }

  const payload = jwt.verify(token, requiredSecret(), {
    issuer: process.env.JWT_ISSUER || "hrms-platform",
    audience: process.env.JWT_AUDIENCE || "hrms-company-users",
  });

  if (payload.purpose !== "offer_signing" || !payload.companyId || !payload.sub || !payload.offerId) {
    throw new Error("Invalid offer signing token purpose or payload");
  }

  return payload;
}

export function signCandidateOnboardingToken({ companyId, onboardingId, userId, email }) {
  const candidateId = String(userId || onboardingId);
  return jwt.sign(
    {
      sub: email.trim().toLowerCase(),
      companyId: String(companyId),
      userId: candidateId,
      onboardingId: candidateId,
      purpose: "candidate_onboarding",
      jti: crypto.randomUUID(),
    },
    requiredSecret(),
    {
      expiresIn: process.env.CANDIDATE_ONBOARDING_TOKEN_EXPIRES_IN || "14d",
      issuer: process.env.JWT_ISSUER || "hrms-platform",
      audience: process.env.JWT_AUDIENCE || "hrms-company-users",
    }
  );
}

export function verifyCandidateOnboardingToken(token) {
  if (typeof token !== "string" || !token.trim()) {
    throw new Error("Candidate onboarding token is required");
  }

  const payload = jwt.verify(token, requiredSecret(), {
    issuer: process.env.JWT_ISSUER || "hrms-platform",
    audience: process.env.JWT_AUDIENCE || "hrms-company-users",
  });

  const candidateId = payload.userId || payload.onboardingId;
  if (
    payload.purpose !== "candidate_onboarding" ||
    !payload.companyId ||
    !payload.sub ||
    !candidateId
  ) {
    throw new Error("Invalid candidate onboarding token purpose or payload");
  }

  payload.userId = candidateId;
  payload.onboardingId = candidateId;
  return payload;
}

export function signEmployeeActivationToken({ companyId, employeeId, userId, email }) {
  return jwt.sign(
    {
      sub: email.trim().toLowerCase(),
      companyId: String(companyId),
      employeeId: String(employeeId),
      userId: String(userId),
      purpose: "employee_activation",
      jti: crypto.randomUUID(),
    },
    requiredSecret(),
    {
      expiresIn: process.env.EMPLOYEE_ACTIVATION_EXPIRES_IN || "7d",
      issuer: process.env.JWT_ISSUER || "hrms-platform",
      audience: process.env.JWT_AUDIENCE || "hrms-company-users",
    }
  );
}

export function verifyEmployeeActivationToken(token) {
  if (typeof token !== "string" || !token.trim()) {
    throw new Error("Employee activation token is required");
  }

  const payload = jwt.verify(token, requiredSecret(), {
    issuer: process.env.JWT_ISSUER || "hrms-platform",
    audience: process.env.JWT_AUDIENCE || "hrms-company-users",
  });

  if (
    payload.purpose !== "employee_activation" ||
    !payload.companyId ||
    !payload.sub ||
    !payload.employeeId ||
    !payload.userId
  ) {
    throw new Error("Invalid employee activation token purpose or payload");
  }

  return payload;
}

export function verifyOnboardingToken(token) {
  if (typeof token !== "string" || !token.trim()) {
    throw new Error("Onboarding token is required");
  }

  const payload = jwt.verify(token, requiredSecret(), {
    issuer: process.env.JWT_ISSUER || "hrms-platform",
    audience: process.env.JWT_AUDIENCE || "hrms-company-users",
  });

  if (
    (payload.purpose !== "hr_admin_onboarding" &&
      payload.purpose !== "employee_onboarding" &&
      payload.purpose !== "candidate_onboarding" &&
      payload.purpose !== "employee_activation") ||
    !payload.companyId ||
    !payload.sub
  ) {
    throw new Error("Invalid onboarding token purpose or payload");
  }

  return payload;
}
