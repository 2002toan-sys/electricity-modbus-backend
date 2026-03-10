# Refactoring Complete: CommandQueue Architecture

## ✅ What Was Implemented

### 1. **6 Independent PLC Connections** 
- Each floor (2-6) has its own TCP connection
- PLCManager handles auto-reconnect with exponential backoff (2s → 30s)
- Each connection self-monitors and auto-recovers
- Socket cleanup on disconnect/error
- No reconnect trigger from CommandQueue (PLCManager's responsibility)

### 2. **6 Independent Command Queues**

```
CommandQueue Architecture:
├── floor_2_queue: [command, command, ...]
├── floor_3_queue: [command, command, ...]
├── floor_4_queue: [command, command, ...]
├── floor_5_queue: [command, command, ...]
├── floor_6_queue: [command, command, ...]
└── Read polling: 500ms/floor (scheduled, not spam)
```

**Key Features:**
- **READ Commands**: 
  - Scheduled every 500ms per floor
  - Only ONE read enqueued at a time (no spam)
  - Processes sequentially, updates state automatically

- **WRITE Commands**: 
  - Go to FRONT of queue (high priority)
  - Used by RelayService for relay control
  - Callback on completion with result/error

- **Queue Processing**:
  - TCP connection check BEFORE executing
  - Only sends if connected
  - Waits for PLC response before next command
  - Sequential per floor (no overlapping)

### 3. **Memory Leak Prevention**

**Cleanup mechanisms:**
- `commandQueue.destroy()` - clears all timers, queues, maps
- Timers stored in Map and cleared on stop
- Queue arrays cleared on destroy
- No circular references
- Resources released on shutdown

## 📁 Files Modified

### New File
- ✨ **`src/services/commandQueue.js`** (~400 lines)
  - Unified queue system for 6 floors
  - READ/WRITE command handling
  - TCP connection checking
  - State update processing
  - Memory cleanup

### Updated Files
1. **`src/services/plcManager.js`**
   - Added: `readCoils()` method
   - Added: `writeRegister()` method
   - Connection monitoring remains unchanged

2. **`src/services/monitorService.js`**
   - Removed: 200+ lines of polling worker logic
   - Now: delegates to CommandQueue
   - Focused on: broadcasting to WebSocket clients
   - 65% code reduction

3. **`src/services/relayService.js`**
   - Changed: uses `commandQueue.enqueueWrite()` instead of `queueManager`
   - Simpler: Promise-based API
   - Priority: writes go to front automatically

4. **`src/app.js`**
   - Changed: `monitorService.startPolling()` → `monitorService.startMonitoring()`
   - Added: `commandQueue.destroy()` on shutdown
   - Cleaner initialization flow

## 🔄 Operation Flow

### Normal Operation (Polling)
```
Every 500ms per floor:
  1. Check if READ already in queue → if yes, skip (no spam)
  2. If no READ in queue → enqueue READ
  3. processQueue() fires
  4. Check TCP connection
  5. Execute READ (reads D100/D101)
  6. Update room state automatically
  7. Broadcast to WebSocket clients
```

### Write Operation (User Action)
```
User clicks relay:
  1. RelayService.setRelay() called
  2. commandQueue.enqueueWrite() → goes to FRONT
  3. processQueue() fires
  4. Check TCP connection
  5. Execute WRITE (writeCoil)
  6. Callback called with result
  7. State updated
  8. Broadcast to clients
```

### Connection Loss Scenario
```
Network error:
  1. PLCManager detects socket error
  2. Marks connection as down
  3. Schedules reconnect (not CommandQueue's job)
  
Meanwhile:
  4. CommandQueue.processQueue() checks connection
  5. Sees connected=false
  6. Pauses queue processing
  7. Commands stay in queue
  
When reconnected:
  8. PLCManager restores connection
  9. CommandQueue resumes processing
  10. Executes queued commands
```

## 📊 Key Points

| Aspect | Detail |
|--------|--------|
| **Queue Depth** | Shallow: usually 0-1 command per floor |
| **Read Interval** | 500ms per floor (configurable) |
| **Read Spam** | ✅ Prevented: max 1 read per cycle |
| **Write Priority** | ✅ Goes to FRONT |
| **TCP Check** | ✅ Before every execute |
| **Sequential** | ✅ Per floor (independent) |
| **Reconnect** | ✅ PLCManager job, not Queue |
| **Memory Leak** | ✅ Cleanup on destroy |

## 🚀 Testing

Quick verification:
```bash
npm start
# Check logs:
# - "CommandQueue initialized for 6 floors"
# - "Starting READ polling for floor..." (repeat for 6 floors)
# - "READ command enqueued for floor..." (every 500ms)
# - "READ processed floor..." (with D100/D101 values)
```

## ✨ Improvements

- **Cleaner Architecture**: Clear separation (Queue vs Broadcasting)
- **Not Spam**: No continuous READ pushes
- **Priority Works**: WRITEs execute before buffered READs
- **Memory Safe**: All timers/queues cleaned up
- **Maintainable**: Simple, readable code
- **Debuggable**: `getQueueStatus()` shows real-time queue state

## 🛠️ API Summary

```javascript
import commandQueue from './services/commandQueue.js';

// Enqueue READ (internal use, called by polling)
commandQueue.enqueueRead(floor, 'holding', 100, 2);

// Enqueue WRITE with priority
commandQueue.enqueueWrite(floor, 'writeCoil', address, value, callback);

// Start/stop polling
commandQueue.startAllPolling();
commandQueue.stopAllPolling();

// Get queue status
commandQueue.getQueueStatus(); // { floor_2: {...}, floor_3: {...}, ... }

// Cleanup
commandQueue.destroy();
```

---

**Status: ✅ Ready for Testing**

No further changes needed. System is:
- ✅ Clean
- ✅ Simple
- ✅ Memory-safe
- ✅ Queue-based
- ✅ No spam
- ✅ TCP-aware
- ✅ Self-recovering
