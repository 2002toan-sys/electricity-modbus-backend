import logger from '../utils/logger.js';
import authService from '../services/authService.js';

/**
 * Login handler: authenticate user and return JWT token
 */
export async function login(req, res) {
  try {
    const { username, password } = req.body || {};

    if (typeof username !== 'string' || !username ||
        typeof password !== 'string' || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const user = authService.getUserForLogin(username);

    if (!user || !authService.verifyCredentials(password, user.password_hash)) {
      logger.warn(`Login failed for user: ${username}`);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const accessToken = authService.createToken(user.username);
    logger.info(`User logged in with 24-hour JWT idle timeout: ${username} (role: ${user.role})`);
    return res.status(200).json({
      success: true,
      accessToken,
      user: { username: user.username, role: user.role }
    });
  } catch (error) {
    logger.error(`Login error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
}

/**
 * Verify token endpoint
 */
export async function verifyToken(req, res) {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    res.status(200).json({ success: true, user });
  } catch (error) {
    logger.error(`JWT verify error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
}

export function recordActivity(req, res) {
  const accessToken = authService.refreshToken(req.authTokenId, req.user.username);
  if (!accessToken) return res.status(401).json({ error: 'Unauthorized' });
  return res.status(200).json({ success: true, accessToken });
}

export async function changePassword(req, res) {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
      return res.status(400).json({ error: 'Current and new password are required' });
    }
    if (newPassword.length < 8 || newPassword.length > 128) {
      return res.status(400).json({ error: 'New password must be between 8 and 128 characters' });
    }

    if (!authService.changePassword(req.user.username, currentPassword, newPassword, req.authTokenId)) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    logger.info(`Password changed for user: ${req.user.username}`);
    return res.status(200).json({ success: true });
  } catch (error) {
    logger.error(`Change password error: ${error.message}`);
    return res.status(500).json({ error: 'Unable to change password' });
  }
}

export async function logout(req, res) {
  try {
    authService.revokeToken(req.authTokenId);
    return res.status(200).json({ success: true });
  } catch (error) {
    logger.error(`Logout error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
}
