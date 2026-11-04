import userService, { UserServiceError } from '../services/userService.js';
import logger from '../utils/logger.js';

const handleError = (res, error, action) => {
  if (error instanceof UserServiceError) {
    return res.status(error.status).json({ error: error.message });
  }
  if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
      error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
    return res.status(409).json({ error: 'Username already exists' });
  }
  logger.error(`${action}: ${error.message}`);
  return res.status(500).json({ error: `Unable to ${action}` });
};

export function getUsers(req, res) {
  try {
    return res.status(200).json(userService.listUsers());
  } catch (error) {
    return handleError(res, error, 'load users');
  }
}

export function createUser(req, res) {
  try {
    const body = req.body || {};
    const user = userService.createUser({
      username: body.username,
      role: body.role,
      fullName: body.full_name,
      password: body.password
    });
    return res.status(201).json(user);
  } catch (error) {
    return handleError(res, error, 'create user');
  }
}

export function updateUser(req, res) {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) {
    return res.status(400).json({ error: 'Invalid user ID' });
  }

  try {
    const user = userService.updateUserAsAdmin(id, req.body || {}, req.user.username);
    return res.status(200).json(user);
  } catch (error) {
    return handleError(res, error, 'update user');
  }
}

export function deleteUser(req, res) {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) {
    return res.status(400).json({ error: 'Invalid user ID' });
  }

  try {
    userService.deleteUserAsAdmin(id, req.user.username);
    return res.status(200).json({ success: true });
  } catch (error) {
    return handleError(res, error, 'delete user');
  }
}
