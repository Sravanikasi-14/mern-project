const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(email) {
  if (typeof email !== "string") {
    return "";
  }

  return email.trim().toLowerCase();
}

export function isValidEmail(email) {
  return EMAIL_PATTERN.test(normalizeEmail(email));
}
