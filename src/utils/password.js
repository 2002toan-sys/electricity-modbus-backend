import bcrypt from 'bcryptjs';

const BCRYPT_ROUNDS = 12;

export async function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password, passwordHash) {
  if (typeof password !== 'string' || typeof passwordHash !== 'string' ||
      !/^\$2[aby]\$\d{2}\$/.test(passwordHash)) {
    return false;
  }
  return bcrypt.compare(password, passwordHash);
}
