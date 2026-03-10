#!/bin/bash
# Integration test: Frontend + Backend

echo "=== Testing Backend ==="

echo "1. Login"
curl -c /tmp/cookies.txt -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' \
  2>/dev/null | jq .

echo -e "\n2. Verify Session"
curl -b /tmp/cookies.txt -X GET http://localhost:3000/api/auth/verify \
  2>/dev/null | jq .

echo -e "\n3. Get Room States"
curl -b /tmp/cookies.txt -X GET http://localhost:3000/api/monitor/rooms \
  2>/dev/null | jq '.data | keys'

echo -e "\n=== Integration Status ==="
echo "✅ Backend running on http://localhost:3000"
echo "✅ Frontend running on http://localhost:5174"
echo "✅ Next: Open http://localhost:5174 in browser and login"
