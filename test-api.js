#!/usr/bin/env node

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const API_KEY = process.env.API_KEY;
const ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:3001';

async function request(method, path, { body, token, apiKey } = {}) {
  const headers = {
    Origin: ORIGIN,
    'Content-Type': 'application/json'
  };
  if (method !== 'GET') headers['X-CSRF-Protection'] = '1';
  if (token) headers.Authorization = `Bearer ${token}`;
  if (apiKey) headers['X-API-Key'] = apiKey;

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${data.error || ''}`);
  return data;
}

async function main() {
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
    throw new Error('Set ADMIN_USERNAME and ADMIN_PASSWORD to the configured admin credentials.');
  }

  const login = await request('POST', '/api/auth/login', {
    body: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD }
  });
  const token = login.accessToken;
  if (!token) throw new Error('Login response did not contain an access token.');
  console.log(`Admin login successful: ${login.user.username}`);

  const currentUser = await request('GET', '/api/auth/me', { token });
  if (currentUser.user.role !== 'admin') throw new Error('Configured account is not an admin.');
  console.log('Authenticated user endpoint successful.');

  const rooms = await request('GET', '/api/monitor/rooms', { token });
  console.log(`Room status endpoint successful: ${Object.keys(rooms.data || {}).length} rooms.`);

  const plcStatus = await request('GET', '/api/monitor/plc-status', { token });
  console.log(`PLC status endpoint successful: ${(plcStatus.data || []).length} PLCs.`);

  const history = await request('GET', '/api/monitor/history?limit=10', { token });
  console.log(`History endpoint successful: ${(history.data || []).length} records returned.`);

  if (API_KEY) {
    await request('GET', '/api/monitor/rooms', { apiKey: API_KEY });
    console.log('Configured API key endpoint successful.');
  }
}

main().catch((error) => {
  console.error(`API checks failed: ${error.message}`);
  process.exitCode = 1;
});
