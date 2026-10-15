import bcrypt from "bcryptjs";

const DUMMY_HASH = bcrypt.hashSync("invalid-password-placeholder", 10);

export function getBcryptRounds() {
  const rounds = Number(process.env.BCRYPT_ROUNDS || 12);
  return Number.isFinite(rounds) && rounds >= 4 ? rounds : 12;
}

export async function hashPassword(plaintext) {
  return bcrypt.hash(plaintext, getBcryptRounds());
}

export async function verifyPassword(plaintext, passwordHash) {
  const hashToCompare = passwordHash || DUMMY_HASH;
  const matches = await bcrypt.compare(plaintext, hashToCompare);
  return Boolean(passwordHash) && matches;
}
