import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const HASH_ALGORITHM = 'scrypt';
const SALT_BYTES = 16;
const KEY_LENGTH = 64;

export function hashPassword(password) {
  const salt = randomBytes(SALT_BYTES).toString('hex');
  const hash = scryptSync(password, salt, KEY_LENGTH).toString('hex');
  return `${HASH_ALGORITHM}$${salt}$${hash}`;
}

export function isPasswordHashed(value) {
  return typeof value === 'string' && value.startsWith(`${HASH_ALGORITHM}$`);
}

export function verifyPassword(password, encodedHash) {
  if (typeof password !== 'string' || typeof encodedHash !== 'string') return false;

  const [algorithm, salt, storedHash] = encodedHash.split('$');
  if (algorithm !== HASH_ALGORITHM || !salt || !storedHash) return false;

  try {
    const storedBuffer = Buffer.from(storedHash, 'hex');
    const suppliedBuffer = scryptSync(password, salt, storedBuffer.length);
    return storedBuffer.length === suppliedBuffer.length &&
      timingSafeEqual(storedBuffer, suppliedBuffer);
  } catch {
    return false;
  }
}
