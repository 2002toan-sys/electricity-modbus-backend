const ROLE_PERMISSIONS = Object.freeze({
  admin: new Set([
    'monitor:read',
    'relay:read',
    'relay:main:control',
    'relay:sub:control',
    'room:state:update',
    'notifications:read',
    'notifications:mark',
    'notifications:write',
    'notifications:clear'
  ]),
  user: new Set([
    'monitor:read',
    'relay:read',
    'relay:sub:control',
    'notifications:read',
    'notifications:mark'
  ])
});

export function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user || !['jwt', 'api-key'].includes(req.authType)) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!ROLE_PERMISSIONS[req.user.role]?.has(permission)) {
      return res.status(403).json({ error: 'Insufficient permission' });
    }

    return next();
  };
}

export function requireAdmin(req, res, next) {
  if (!req.user || !['jwt', 'api-key'].includes(req.authType)) {
    return res.status(401).json({ error: 'JWT authentication required' });
  }
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin role required' });
  }
  if (req.authType !== 'jwt') {
    return res.status(403).json({ error: 'JWT admin authentication required' });
  }
  return next();
}
