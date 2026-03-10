#!/usr/bin/env node

/**
 * Test client for Hotel Modbus System
 * Tests all authentication methods and APIs
 */

const BASE_URL = 'http://localhost:3000';
const API_KEY = 'your-secret-api-key-here';

async function test(name, fn) {
  try {
    console.log(`\n📝 Testing: ${name}`);
    await fn();
    console.log(`✅ PASSED: ${name}`);
  } catch (error) {
    console.error(`❌ FAILED: ${name}`);
    console.error(error.message);
  }
}

async function request(method, path, body = null, headers = {}) {
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    }
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`${BASE_URL}${path}`, options);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(`${response.status}: ${data.error}`);
  }

  return data;
}

async function runTests() {
  console.log('🚀 Hotel Modbus System - API Test Suite\n');

  // Test 1: Login as Admin
  let adminToken = null;
  await test('Login as admin', async () => {
    const response = await request('POST', '/api/auth/login', {
      username: 'admin',
      password: 'admin123'
    });
    adminToken = response.token;
    if (!response.token) throw new Error('No token returned');
    console.log(`   Token: ${response.token.substring(0, 20)}...`);
  });

  // Test 2: Login as User
  let userToken = null;
  await test('Login as user', async () => {
    const response = await request('POST', '/api/auth/login', {
      username: 'user',
      password: 'user123'
    });
    userToken = response.token;
    if (!response.token) throw new Error('No token returned');
    console.log(`   Token: ${response.token.substring(0, 20)}...`);
  });

  // Test 3: Verify Admin Token
  await test('Verify admin token', async () => {
    const response = await request('GET', '/api/auth/verify', null, {
      'Authorization': `Bearer ${adminToken}`
    });
    if (response.user.role !== 'admin') throw new Error('Wrong role');
    console.log(`   User: ${response.user.username} (${response.user.role})`);
  });

  // Test 4: Get Room States with Admin Token
  await test('Get room states (JWT)', async () => {
    const response = await request('GET', '/api/monitor/rooms', null, {
      'Authorization': `Bearer ${adminToken}`
    });
    const rooms = Object.keys(response.data);
    console.log(`   Found ${rooms.length} rooms: ${rooms.join(', ')}`);
  });

  // Test 5: Get Room States with API Key
  await test('Get room states (API Key)', async () => {
    const response = await request('GET', '/api/monitor/rooms', null, {
      'X-API-Key': API_KEY
    });
    const rooms = Object.keys(response.data);
    console.log(`   Found ${rooms.length} rooms`);
  });

  // Test 6: Get PLC Status
  await test('Get PLC status', async () => {
    const response = await request('GET', '/api/monitor/plc-status', null, {
      'Authorization': `Bearer ${adminToken}`
    });
    console.log(`   PLCs: ${response.data.map(p => `Floor ${p.floor} (${p.status})`).join(', ')}`);
  });

  // Test 7: Set Main Relay with API Key
  await test('Set main relay (API Key)', async () => {
    const response = await request('POST', '/api/relay/main/set',
      [{ room: '201', set: 'on' }],
      { 'X-API-Key': API_KEY }
    );
    console.log(`   Room 201: ${response[0].status}`);
  });

  // Test 8: Set Main Relay with Admin JWT
  await test('Set main relay (Admin JWT)', async () => {
    const response = await request('POST', '/api/relay/main/set/jwt',
      [{ room: '202', set: 'on' }],
      { 'Authorization': `Bearer ${adminToken}` }
    );
    console.log(`   Room 202: ${response[0].status}`);
  });

  // Test 9: User tries to control main relay (should fail)
  await test('User cannot control main relay (should fail)', async () => {
    try {
      await request('POST', '/api/relay/main/set/jwt',
        [{ room: '201', set: 'on' }],
        { 'Authorization': `Bearer ${userToken}` }
      );
      throw new Error('Should have been denied');
    } catch (error) {
      if (error.message.includes('403')) {
        console.log(`   ✓ Correctly denied with 403`);
      } else {
        throw error;
      }
    }
  });

  // Test 10: Get State History
  await test('Get state history', async () => {
    const response = await request('GET', '/api/monitor/history?limit=10', null, {
      'Authorization': `Bearer ${adminToken}`
    });
    console.log(`   Found ${response.data.length} history records`);
    if (response.data.length > 0) {
      console.log(`   Latest: ${response.data[0].room} ${response.data[0].previous_state} → ${response.data[0].new_state}`);
    }
  });

  // Test 11: Get History for Specific Room
  await test('Get history for room 201', async () => {
    const response = await request('GET', '/api/monitor/history?room=201&limit=5', null, {
      'Authorization': `Bearer ${adminToken}`
    });
    console.log(`   Found ${response.data.length} records for room 201`);
  });

  console.log('\n✨ All tests completed!\n');
}

// Run tests
runTests().catch(error => {
  console.error('Test suite failed:', error);
  process.exit(1);
});
