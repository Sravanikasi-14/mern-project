import jwt from "jsonwebtoken";

function requiredSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("JWT_SECRET must be set to at least 32 characters");
  }
  return secret;
}

export function signAuthToken({ userId, companyId }) {
  return jwt.sign(
    {
      sub: String(userId),
      companyId: String(companyId),
    },
    requiredSecret(),
    {
      expiresIn: process.env.JWT_EXPIRES_IN || "8h",
      issuer: process.env.JWT_ISSUER || "hrms-platform",
      audience: process.env.JWT_AUDIENCE || "hrms-company-users",
    }
  );
}

export function verifyAuthToken(token) {
  return jwt.verify(token, requiredSecret(), {
    issuer: process.env.JWT_ISSUER || "hrms-platform",
    audience: process.env.JWT_AUDIENCE || "hrms-company-users",
  });
}

export function decodeAuthToken(token) {
  return jwt.decode(token);
}
