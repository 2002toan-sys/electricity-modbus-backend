import db from '../database/db.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  createAccessToken,
  verifyAccessToken,
  randomUUID
} from '../utils/jwt.js';

export const TOKEN_IDLE_TIMEOUT_MS = ACCESS_TOKEN_TTL_SECONDS * 1000;

class AuthService {
  getUserForLogin(username) {
    return db.prepare(`
      SELECT id, username, password_hash, role
      FROM users
      WHERE username = ?
    `).get(username);
  }

  verifyCredentials(password, passwordHash) {
    return verifyPassword(password, passwordHash);
  }

  createToken(username) {
    const now = Date.now();
    db.prepare('DELETE FROM auth_tokens WHERE revoked_at IS NOT NULL OR last_activity <= ?')
      .run(now - TOKEN_IDLE_TIMEOUT_MS);
    const tokenId = randomUUID();
    db.prepare('INSERT INTO auth_tokens (token_id, username, last_activity) VALUES (?, ?, ?)')
      .run(tokenId, username, now);
    return createAccessToken(username, tokenId, now);
  }

  authenticateToken(token, { updateActivity = true } = {}) {
    const claims = verifyAccessToken(token);
    if (!claims) return null;

    const now = Date.now();
    const record = db.prepare(`
      SELECT users.username, users.role, auth_tokens.last_activity
      FROM auth_tokens
      JOIN users ON users.username = auth_tokens.username
      WHERE auth_tokens.token_id = ? AND auth_tokens.username = ? AND auth_tokens.revoked_at IS NULL
    `).get(claims.tokenId, claims.username);
    if (!record) return null;

    if (!Number.isFinite(record.last_activity) || now - record.last_activity >= TOKEN_IDLE_TIMEOUT_MS) {
      db.prepare('UPDATE auth_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE token_id = ?')
        .run(claims.tokenId);
      return null;
    }

    if (updateActivity) {
      db.prepare('UPDATE auth_tokens SET last_activity = ? WHERE token_id = ?')
        .run(now, claims.tokenId);
    }
    return { user: { username: record.username, role: record.role }, tokenId: claims.tokenId };
  }

  refreshToken(tokenId, username) {
    const now = Date.now();
    const result = db.prepare(`
      UPDATE auth_tokens SET last_activity = ?
      WHERE token_id = ? AND username = ? AND revoked_at IS NULL
    `).run(now, tokenId, username);
    if (result.changes !== 1) return null;
    return createAccessToken(username, tokenId, now);
  }

  revokeToken(tokenId) {
    db.prepare('UPDATE auth_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE token_id = ? AND revoked_at IS NULL')
      .run(tokenId);
  }

  changePassword(username, currentPassword, newPassword, currentTokenId) {
    const user = db.prepare(`
      SELECT id, password_hash
      FROM users
      WHERE username = ?
    `).get(username);
    if (!user || !verifyPassword(currentPassword, user.password_hash)) {
      return false;
    }

    const updatePassword = db.transaction(() => {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
        .run(hashPassword(newPassword), user.id);
      db.prepare(`
        UPDATE auth_tokens SET revoked_at = CURRENT_TIMESTAMP
        WHERE username = ? AND token_id != ? AND revoked_at IS NULL
      `).run(username, currentTokenId);
    });
    updatePassword();
    return true;
  }
}

export default new AuthService();
