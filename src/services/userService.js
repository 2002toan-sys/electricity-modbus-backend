import db from '../database/db.js';
import { hashPassword } from '../utils/password.js';

const publicUserFields = 'id, username, role, full_name, created_at';
const USERNAME_PATTERN = /^[A-Za-z0-9._-]{3,32}$/;

class UserServiceError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function validateUser({ username, role, full_name: fullName }, { requirePassword, password } = {}) {
  if (typeof username !== 'string' || !USERNAME_PATTERN.test(username)) {
    throw new UserServiceError(
      'Username must be 3-32 characters and contain only letters, numbers, dots, underscores, or hyphens',
      400
    );
  }
  if (role !== 'admin' && role !== 'user') {
    throw new UserServiceError('Role must be admin or user', 400);
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

  createUser({ username, role, fullName, password }) {
    validateUser({ username, role, full_name: fullName }, { requirePassword: true, password });
    const result = db.prepare(`
      INSERT INTO users (username, password_hash, role, full_name)
      VALUES (?, ?, ?, ?)
    `).run(username.trim(), hashPassword(password), role, fullName?.trim() || null);
    return this.getUserById(result.lastInsertRowid);
  }

  getUserById(id) {
    return db.prepare(`
      SELECT ${publicUserFields} FROM users WHERE id = ?
    `).get(id);
  }

  getUserIdentityById(id) {
    return db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(id);
  }

  countAdmins() {
    return db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'").get().count;
  }

  updateUser(id, { username, role, fullName, password }) {
    const existing = this.getUserIdentityById(id);
    if (!existing) throw new UserServiceError('User not found', 404);
    validateUser({ username, role, full_name: fullName }, { password });
    if (password !== undefined && password !== '' &&
        (typeof password !== 'string' || password.length < 8 || password.length > 128)) {
      throw new UserServiceError('Password must be between 8 and 128 characters', 400);
    }
    const updateUser = db.transaction(() => {
      if (existing.username !== username.trim() || password) {
        db.prepare(`
          UPDATE auth_tokens SET revoked_at = CURRENT_TIMESTAMP
          WHERE username = ? AND revoked_at IS NULL
        `).run(existing.username);
      }
      if (password) {
        db.prepare(`
          UPDATE users
          SET username = ?, role = ?, full_name = ?, password_hash = ?
          WHERE id = ?
        `).run(username.trim(), role, fullName?.trim() || null, hashPassword(password), id);
      } else {
        db.prepare(`
          UPDATE users
          SET username = ?, role = ?, full_name = ?
          WHERE id = ?
        `).run(username.trim(), role, fullName?.trim() || null, id);
      }
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
