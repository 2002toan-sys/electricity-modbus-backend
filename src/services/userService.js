import db from '../database/db.js';
import { hashPassword } from '../utils/password.js';

const publicUserFields = 'id, username, role, full_name, status, created_at, updated_at';
const USERNAME_PATTERN = /^[A-Za-z0-9._-]{3,32}$/;

class UserServiceError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function validateUser(
  { username, role, status = 'active', full_name: fullName },
  { requirePassword, password } = {}
) {
  if (typeof username !== 'string' || !USERNAME_PATTERN.test(username)) {
    throw new UserServiceError(
      'Username must be 3-32 characters and contain only letters, numbers, dots, underscores, or hyphens',
      400
    );
  }
  if (role !== 'admin' && role !== 'user') {
    throw new UserServiceError('Role must be admin or user', 400);
  }
  if (!['active', 'disabled'].includes(status)) {
    throw new UserServiceError('Status must be active or disabled', 400);
  }
  if (fullName != null && (typeof fullName !== 'string' || fullName.trim().length > 100)) {
    throw new UserServiceError('Full name must be at most 100 characters', 400);
  }
  if ((requirePassword || password !== undefined) &&
      (typeof password !== 'string' || password.length < 8 || password.length > 128)) {
    throw new UserServiceError('Password must be between 8 and 128 characters', 400);
  }
}

class UserService {
  listUsers() {
    return db.prepare(`
      SELECT ${publicUserFields}
      FROM users
      ORDER BY id
    `).all();
  }

  async createUser({ username, role, status = 'active', fullName, password }) {
    validateUser({ username, role, status, full_name: fullName }, { requirePassword: true, password });
    const passwordHash = await hashPassword(password);
    const result = db.prepare(`
      INSERT INTO users (username, password_hash, role, status, full_name)
      VALUES (?, ?, ?, ?, ?)
    `).run(username.trim(), passwordHash, role, status, fullName?.trim() || null);
    return this.getUserById(result.lastInsertRowid);
  }

  getUserById(id) {
    return db.prepare(`
      SELECT ${publicUserFields} FROM users WHERE id = ?
    `).get(id);
  }

  getUserIdentityById(id) {
    return db.prepare('SELECT id, username, role, status FROM users WHERE id = ?').get(id);
  }

  countAdmins() {
    return db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'").get().count;
  }

  async updateUser(id, { username, role, status, fullName, password }) {
    const existing = this.getUserIdentityById(id);
    if (!existing) throw new UserServiceError('User not found', 404);
    const updatedStatus = status ?? existing.status;
    validateUser({ username, role, status: updatedStatus, full_name: fullName }, { password });
    if (password !== undefined && password !== '' &&
        (typeof password !== 'string' || password.length < 8 || password.length > 128)) {
      throw new UserServiceError('Password must be between 8 and 128 characters', 400);
    }
    const passwordHash = password ? await hashPassword(password) : null;
    const invalidateSessions = existing.username !== username.trim() ||
      existing.role !== role ||
      existing.status !== updatedStatus ||
      Boolean(password);
    const updateUser = db.transaction(() => {
      if (invalidateSessions) {
        db.prepare(`
          UPDATE auth_tokens SET revoked_at = CURRENT_TIMESTAMP
          WHERE username = ? AND revoked_at IS NULL
        `).run(existing.username);
        db.prepare(`
          UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, ?)
          WHERE user_id = ?
        `).run(Date.now(), id);
      }
      db.prepare(`
        UPDATE users
        SET username = ?, role = ?, status = ?, full_name = ?,
            password_hash = COALESCE(?, password_hash),
            token_version = token_version + ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        username.trim(),
        role,
        updatedStatus,
        fullName?.trim() || null,
        passwordHash,
        invalidateSessions ? 1 : 0,
        id
      );
    });
    updateUser();
    return this.getUserById(id);
  }

  updateUserAsAdmin(id, data, requesterUsername) {
    const existing = this.getUserIdentityById(id);
    if (!existing) throw new UserServiceError('User not found', 404);
    validateUser(data, { password: data.password });
    if (existing.username === requesterUsername && data.username !== existing.username) {
      throw new UserServiceError('You cannot change your own username', 400);
    }
    if (existing.username === requesterUsername && data.role !== existing.role) {
      throw new UserServiceError('You cannot change your own role', 400);
    }
    if (existing.role === 'admin' && data.role !== 'admin' && this.countAdmins() <= 1) {
      throw new UserServiceError('Cannot demote the last admin account', 400);
    }
    return this.updateUser(id, {
      username: data.username,
      role: data.role,
      status: data.status ?? existing.status,
      fullName: data.full_name,
      password: data.password
    });
  }

  deleteUserAsAdmin(id, requesterUsername) {
    const user = this.getUserIdentityById(id);
    if (!user) throw new UserServiceError('User not found', 404);
    if (user.username === requesterUsername) {
      throw new UserServiceError('You cannot delete your own account', 400);
    }
    if (user.role === 'admin' && this.countAdmins() <= 1) {
      throw new UserServiceError('Cannot delete the last admin account', 400);
    }
    return db.prepare('DELETE FROM users WHERE id = ?').run(id).changes > 0;
  }
}

export { UserServiceError };
export default new UserService();
