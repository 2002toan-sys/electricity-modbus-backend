import { parseCookie, stringifySetCookie } from 'cookie';
import { z } from 'zod';
import logger from '../utils/logger.js';
import authService from '../services/authService.js';
import { refreshCookieConfig } from '../middleware/csrf.js';
import { logAuthAudit } from '../utils/authAudit.js';

const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

const loginSchema = z.object({
  username: z.string().trim().min(1).max(32),
  password: z.string().min(1).max(128)
});

function requestContext(req) {
  return {
    ip: req.ip,
    userAgent: req.get('user-agent') || null
  };
}

function getRefreshToken(req) {
  return parseCookie(req.headers.cookie || '')[refreshCookieConfig.name];
}

function setRefreshCookie(res, token) {
  res.append('Set-Cookie', stringifySetCookie({
    name: refreshCookieConfig.name,
    value: token,
    httpOnly: true,
    secure: refreshCookieConfig.secure,
    sameSite: refreshCookieConfig.sameSite,
    path: refreshCookieConfig.path,
    maxAge: REFRESH_TOKEN_TTL_SECONDS
  }));
}

function clearRefreshCookie(res) {
  res.append('Set-Cookie', stringifySetCookie({
    name: refreshCookieConfig.name,
    value: '',
    httpOnly: true,
    secure: refreshCookieConfig.secure,
    sameSite: refreshCookieConfig.sameSite,
    path: refreshCookieConfig.path,
    maxAge: 0
  }));
}

function respondWithSession(res, session, status = 200) {
  setRefreshCookie(res, session.refreshToken);
  return res.status(status).json({
    success: true,
    accessToken: session.accessToken,
    user: session.user
  });
}

export async function login(req, res) {
  const parsed = loginSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    const session = await authService.login(
      parsed.data.username,
      parsed.data.password,
      requestContext(req)
    );
    if (session.status !== 'ok') {
      logAuthAudit('auth.login.failed', { req, userId: session.userId });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    logAuthAudit('auth.login.succeeded', { req, userId: session.user.id });
    return respondWithSession(res, session);
  } catch (error) {
    logger.error(`Authentication failed from ${req.ip}: ${error.message}`);
    return res.status(500).json({ error: 'Unable to log in' });
  }
}

export async function refresh(req, res) {
  try {
    const session = authService.rotateRefreshToken(getRefreshToken(req), requestContext(req));
    if (session.status !== 'ok') {
      logAuthAudit(
        session.status === 'reuse' ? 'auth.refresh.reuse_detected' : 'auth.refresh.failed',
        { req, userId: session.userId }
      );
      clearRefreshCookie(res);
      return res.status(401).json({ error: 'Invalid refresh token' });
    }
    logAuthAudit('auth.refresh.succeeded', { req, userId: session.user.id });
    return respondWithSession(res, session);
  } catch (error) {
    logger.error(`Token refresh failed from ${req.ip}: ${error.message}`);
    return res.status(500).json({ error: 'Unable to refresh session' });
  }
}

export function verifyToken(req, res) {
  return res.status(200).json({ success: true, user: req.user });
}

export async function changePassword(req, res) {
  const passwordSchema = z.object({
    currentPassword: z.string().min(1).max(128),
    newPassword: z.string().min(8).max(128)
  });
  const parsed = passwordSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: 'Current and new password are required' });
  }

  try {
    const changed = await authService.changePassword(
      req.user.username,
      parsed.data.currentPassword,
      parsed.data.newPassword
    );
    if (!changed) return res.status(400).json({ error: 'Current password is incorrect' });
    logAuthAudit('auth.password.changed', { req, userId: req.user.id });
    clearRefreshCookie(res);
    return res.status(200).json({ success: true });
  } catch (error) {
    logger.error(`Password update failed for user ${req.user.id}: ${error.message}`);
    return res.status(500).json({ error: 'Unable to change password' });
  }
}

export function logout(req, res) {
  const userId = authService.logout(req.user?.id, req.authTokenId, getRefreshToken(req));
  logAuthAudit('auth.logout', { req, userId });
  clearRefreshCookie(res);
  return res.status(200).json({ success: true });
}

export function logoutAll(req, res) {
  authService.logoutAll(req.user.id);
  logAuthAudit('auth.logout_all', { req, userId: req.user.id });
  clearRefreshCookie(res);
  return res.status(200).json({ success: true });
}
