import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../../.env'), quiet: true });

const jwtConfigSchema = z.object({
  JWT_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().min(1),
  JWT_AUDIENCE: z.string().min(1),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().max(900)
});

const parsedConfig = jwtConfigSchema.safeParse(process.env);
if (!parsedConfig.success) {
  throw new Error('Invalid JWT configuration. Set a JWT_SECRET of at least 32 characters.');
}

const jwtConfig = parsedConfig.data;
const secret = Buffer.from(jwtConfig.JWT_SECRET, 'utf8');
export const ACCESS_TOKEN_TTL_SECONDS = jwtConfig.ACCESS_TOKEN_TTL_SECONDS;
export const randomTokenId = randomUUID;

export function createAccessToken(user, tokenId = randomUUID(), now = Date.now()) {
  const issuedAt = Math.floor(now / 1000);
  return jwt.sign({
    userId: user.id,
    username: user.username,
    role: user.role,
    tv: user.token_version || 0,
    jti: tokenId,
    iss: jwtConfig.JWT_ISSUER,
    aud: jwtConfig.JWT_AUDIENCE,
    iat: issuedAt
  }, secret, {
    algorithm: 'HS256',
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    subject: String(user.id)
  });
}

export function verifyAccessToken(token, now = Date.now()) {
  if (typeof token !== 'string') return null;

  try {
    const claims = jwt.verify(token, secret, {
      algorithms: ['HS256'],
      issuer: jwtConfig.JWT_ISSUER,
      audience: jwtConfig.JWT_AUDIENCE,
      clockTimestamp: Math.floor(now / 1000)
    });
    if (!claims || typeof claims !== 'object' ||
        !Number.isSafeInteger(claims.userId) ||
        claims.sub !== String(claims.userId) ||
        typeof claims.username !== 'string' ||
        !['admin', 'user'].includes(claims.role) ||
        !Number.isSafeInteger(claims.tv) ||
        typeof claims.jti !== 'string' ||
        !Number.isInteger(claims.iat) ||
        !Number.isInteger(claims.exp)) {
      return null;
    }
    return claims;
  } catch {
    return null;
  }
}
