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

export function verifyOnboardingToken(token) {
  if (typeof token !== "string" || !token.trim()) {
    throw new Error("Onboarding token is required");
  }

  const payload = jwt.verify(token, requiredSecret(), {
    issuer: process.env.JWT_ISSUER || "hrms-platform",
    audience: process.env.JWT_AUDIENCE || "hrms-company-users",
  });

  if (payload.purpose !== "hr_admin_onboarding" || !payload.companyId || !payload.sub) {
    throw new Error("Invalid onboarding token purpose or payload");
  }

  return payload;
}
