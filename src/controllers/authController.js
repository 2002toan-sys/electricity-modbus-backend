import config from '../utils/configLoader.js';
import logger from '../utils/logger.js';

/**
 * Login handler: authenticate user and return JWT token
 */
export async function login(req, res) {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    // Find user in config
    const user = config.auth?.users?.find(
      u => u.username === username && u.password === password
    );

    if (!user) {
      logger.warn(`Login failed for user: ${username}`);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Create server-side session (simpler: username/password -> session)
    if (!req.session) {
      logger.error('Session middleware not initialized');
      return res.status(500).json({ error: 'Session not available' });
    }

    req.session.user = { username: user.username, role: user.role };
    logger.info(`User logged in and session created: ${username} (role: ${user.role})`);

    res.status(200).json({
      success: true,
      user: {
        username: user.username,
        role: user.role
      }
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
    // Verify session
    const user = req.session?.user;
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    res.status(200).json({ success: true, user });
  } catch (error) {
    logger.error(`Session verify error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
}

export async function logout(req, res) {
  try {
    if (req.session) {
      req.session.destroy(err => {
        if (err) return res.status(500).json({ error: 'Logout failed' });
        res.status(200).json({ success: true });
      });
    } else {
      res.status(200).json({ success: true });
    }
  } catch (error) {
    logger.error(`Logout error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
}
