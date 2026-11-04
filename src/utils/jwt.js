import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

const TOKEN_ISSUER = 'hotel-modbus-system';
const TOKEN_AUDIENCE = 'hotel-modbus-frontend';
export const ACCESS_TOKEN_TTL_SECONDS = 24 * 60 * 60;

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET must be set to at least 32 characters in the backend .env file');
  }
  return secret;
}

function encodeJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function sign(input) {
  return createHmac('sha256', getSecret()).update(input).digest();
}

export function createAccessToken(username, tokenId = randomUUID(), now = Date.now()) {
  const issuedAt = Math.floor(now / 1000);
  const header = encodeJson({ alg: 'HS256', typ: 'JWT' });
  const payload = encodeJson({
    sub: username,
    jti: tokenId,
    iss: TOKEN_ISSUER,
    aud: TOKEN_AUDIENCE,
    iat: issuedAt,
    exp: issuedAt + ACCESS_TOKEN_TTL_SECONDS
  });
  const unsignedToken = `${header}.${payload}`;
  const signature = sign(unsignedToken).toString('base64url');
  return `${unsignedToken}.${signature}`;
}

export function verifyAccessToken(token, now = Date.now()) {
  if (typeof token !== 'string') return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8'));
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    if (header.alg !== 'HS256' || header.typ !== 'JWT') return null;

    const expectedSignature = sign(`${encodedHeader}.${encodedPayload}`);
    const suppliedSignature = Buffer.from(encodedSignature, 'base64url');
    if (suppliedSignature.length !== expectedSignature.length ||
        !timingSafeEqual(suppliedSignature, expectedSignature)) {
      return null;
    }

    const nowSeconds = Math.floor(now / 1000);
    if (payload.iss !== TOKEN_ISSUER ||
        payload.aud !== TOKEN_AUDIENCE ||
        typeof payload.sub !== 'string' ||
        typeof payload.jti !== 'string' ||
        !Number.isInteger(payload.exp) ||
        payload.exp <= nowSeconds ||
        !Number.isInteger(payload.iat) ||
        payload.iat > nowSeconds + 60) {
      return null;
    }
    return { username: payload.sub, tokenId: payload.jti };
  } catch {
    return null;
  }
}

export { randomUUID };
