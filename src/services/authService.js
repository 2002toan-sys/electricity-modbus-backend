import { createHash, randomBytes, randomUUID } from 'node:crypto';
import db from '../database/db.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { createAccessToken, verifyAccessToken } from '../utils/jwt.js';

const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const publicUserFields = 'users.id, users.username, users.role, users.full_name, users.status, users.token_version, users.created_at, users.updated_at';
const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;

function hashRefreshToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function newRefreshToken() {
  return randomBytes(48).toString('base64url');
}

class AuthService {
  getUserForLogin(username) {
    return db.prepare(`
      SELECT id, username, password_hash, role, status, token_version
      FROM users
      WHERE username = ?
    `).get(username);
  }

  async verifyCredentials(password, user) {
    if (!user) {
      await verifyPassword(password, AuthService.dummyPasswordHash);
      return false;
    }

    const valid = await verifyPassword(password, user.password_hash);
    return valid && user.status === 'active';
  }

  async createSession(user, context = {}) {
    const refreshToken = newRefreshToken();
    const familyId = randomUUID();
    const refreshId = randomUUID();
    const tokenId = randomUUID();
    const now = Date.now();
    const insertSession = db.transaction(() => {
      db.prepare(`
        INSERT INTO refresh_tokens (
          id, user_id, token_hash, family_id, expires_at, created_at, ip, user_agent
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        refreshId,
        user.id,
        hashRefreshToken(refreshToken),
        familyId,
        now + REFRESH_TOKEN_TTL_MS,
        now,
        context.ip || null,
        typeof context.userAgent === 'string' ? context.userAgent.slice(0, 512) : null
      );
      db.prepare('INSERT INTO auth_tokens (token_id, username, last_activity) VALUES (?, ?, ?)')
        .run(tokenId, user.username, now);
    });
    insertSession();

    return {
      accessToken: createAccessToken(user, tokenId, now),
      refreshToken,
      refreshTokenExpiresAt: now + REFRESH_TOKEN_TTL_MS,
      user: this.toPublicUser(user)
    };
  }

  async login(username, password, context = {}) {
    const user = this.getUserForLogin(username.trim());
    const validPassword = await this.verifyCredentials(password, user);
    if (!user || !validPassword) {
      return { status: 'invalid', userId: user?.id ?? null };
    }
    return { status: 'ok', ...(await this.createSession(user, context)) };
  }

  authenticateToken(token, { updateActivity = true } = {}) {
    const claims = verifyAccessToken(token);
    if (!claims) return null;

    const user = db.prepare(`
      SELECT ${publicUserFields}, auth_tokens.last_activity
      FROM auth_tokens
      JOIN users ON users.username = auth_tokens.username
      WHERE auth_tokens.token_id = ?
        AND auth_tokens.username = ?
        AND users.id = ?
        AND users.status = 'active'
        AND users.token_version = ?
        AND auth_tokens.revoked_at IS NULL
    `).get(claims.jti, claims.username, claims.userId, claims.tv);
    if (!user) return null;

    const now = Date.now();
    if (!Number.isFinite(user.last_activity) ||
        now - user.last_activity >= ACCESS_TOKEN_TTL_MS) {
      db.prepare('UPDATE auth_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE token_id = ?')
        .run(claims.jti);
      return null;
    }

    if (updateActivity) {
      db.prepare('UPDATE auth_tokens SET last_activity = ? WHERE token_id = ?')
        .run(now, claims.jti);
    }
    return {
      user: this.toPublicUser(user),
      tokenId: claims.jti
    };
  }

  rotateRefreshToken(rawToken, context = {}) {
    if (typeof rawToken !== 'string' || rawToken.length < 60) return { status: 'invalid' };

    const replacementToken = newRefreshToken();
    const replacementId = randomUUID();
    const accessTokenId = randomUUID();
    const now = Date.now();
    const rotate = db.transaction(() => {
      const current = db.prepare(`
        SELECT id, user_id, family_id, expires_at, revoked_at
        FROM refresh_tokens
        WHERE token_hash = ?
      `).get(hashRefreshToken(rawToken));
      if (!current) return { status: 'invalid' };

      if (current.revoked_at != null) {
        db.prepare(`
          UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, ?)
          WHERE family_id = ?
        `).run(now, current.family_id);
        return { status: 'reuse', userId: current.user_id };
      }
      if (current.expires_at <= now) {
        db.prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE id = ?')
          .run(now, current.id);
        return { status: 'invalid', userId: current.user_id };
      }

      const user = db.prepare(`
        SELECT id, username, role, full_name, status, token_version, created_at, updated_at
        FROM users WHERE id = ? AND status = 'active'
      `).get(current.user_id);
      if (!user) {
        db.prepare(`
          UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, ?)
          WHERE family_id = ?
        `).run(now, current.family_id);
        return { status: 'invalid', userId: current.user_id };
      }

      db.prepare(`
        INSERT INTO refresh_tokens (
          id, user_id, token_hash, family_id, expires_at, created_at, ip, user_agent
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        replacementId,
        user.id,
        hashRefreshToken(replacementToken),
        current.family_id,
        now + REFRESH_TOKEN_TTL_MS,
        now,
        context.ip || null,
        typeof context.userAgent === 'string' ? context.userAgent.slice(0, 512) : null
      );
      const update = db.prepare(`
        UPDATE refresh_tokens
        SET revoked_at = ?, replaced_by_token_id = ?
        WHERE id = ? AND revoked_at IS NULL
      `).run(now, replacementId, current.id);
      if (update.changes !== 1) throw new Error('Refresh token rotation conflicted');
      db.prepare('INSERT INTO auth_tokens (token_id, username, last_activity) VALUES (?, ?, ?)')
        .run(accessTokenId, user.username, now);
      return { status: 'ok', user };
    });
    const result = rotate();
    if (result.status !== 'ok') return result;

    return {
      status: 'ok',
      accessToken: createAccessToken(result.user, accessTokenId, now),
      refreshToken: replacementToken,
      refreshTokenExpiresAt: now + REFRESH_TOKEN_TTL_MS,
      user: this.toPublicUser(result.user)
    };
  }

  revokeRefreshToken(rawToken) {
    if (typeof rawToken !== 'string') return;
    const now = Date.now();
    db.prepare(`
      UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, ?)
      WHERE family_id = (
        SELECT family_id FROM refresh_tokens WHERE token_hash = ?
      )
    `).run(now, hashRefreshToken(rawToken));
  }

  logout(userId, accessTokenId, rawRefreshToken) {
    const now = Date.now();
    const revoke = db.transaction(() => {
      let revokedUserId = Number.isSafeInteger(userId) ? userId : null;
      if (accessTokenId) {
        db.prepare(`
          UPDATE auth_tokens SET revoked_at = CURRENT_TIMESTAMP
          WHERE token_id = ? AND username = (SELECT username FROM users WHERE id = ?)
        `).run(accessTokenId, userId);
      }
      if (typeof rawRefreshToken === 'string') {
        const tokenHash = hashRefreshToken(rawRefreshToken);
        const refreshToken = db.prepare(`
          SELECT user_id FROM refresh_tokens WHERE token_hash = ?
        `).get(tokenHash);
        if (revokedUserId === null && refreshToken) {
          revokedUserId = refreshToken.user_id;
        }
        if (Number.isSafeInteger(userId)) {
          db.prepare(`
            UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, ?)
            WHERE family_id = (
              SELECT family_id FROM refresh_tokens
              WHERE token_hash = ? AND user_id = ?
            )
          `).run(now, tokenHash, userId);
        } else {
          db.prepare(`
            UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, ?)
            WHERE family_id = (
              SELECT family_id FROM refresh_tokens WHERE token_hash = ?
            )
          `).run(now, tokenHash);
        }
      }
      return revokedUserId;
    });
    return revoke();
  }

  logoutAll(userId) {
    const now = Date.now();
    const revoke = db.transaction(() => {
      db.prepare(`
        UPDATE auth_tokens SET revoked_at = CURRENT_TIMESTAMP
        WHERE username = (SELECT username FROM users WHERE id = ?)
          AND revoked_at IS NULL
      `).run(userId);
      db.prepare(`
        UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, ?)
        WHERE user_id = ?
      `).run(now, userId);
      db.prepare(`
        UPDATE users SET token_version = token_version + 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(userId);
    });
    revoke();
  }

  async changePassword(username, currentPassword, newPassword) {
    const user = db.prepare(`
      SELECT id, password_hash FROM users WHERE username = ? AND status = 'active'
    `).get(username);
    if (!user || !(await verifyPassword(currentPassword, user.password_hash))) {
      return false;
    }

    const passwordHash = await hashPassword(newPassword);
    const now = Date.now();
    const updatePassword = db.transaction(() => {
      db.prepare(`
        UPDATE users
        SET password_hash = ?, token_version = token_version + 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(passwordHash, user.id);
      db.prepare(`
        UPDATE auth_tokens SET revoked_at = CURRENT_TIMESTAMP
        WHERE username = (SELECT username FROM users WHERE id = ?) AND revoked_at IS NULL
      `).run(user.id);
      db.prepare(`
        UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, ?)
        WHERE user_id = ?
      `).run(now, user.id);
    });
    updatePassword();
    return true;
  }

  toPublicUser(user) {
    return {
      id: user.id,
      username: user.username,
      role: user.role,
      full_name: user.full_name ?? null
    };
  }
}

AuthService.dummyPasswordHash = '$2b$12$aHLYXOBfp4k5A3lBZZ2gyuJYt35/ZySaE5q29XUR8KFyHODS/6tw6';

export default new AuthService();
