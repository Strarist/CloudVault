# Delete Flow Root Cause Analysis (RCA)

A stability regression test was failing with `ECONNRESET` on file deletion. Below is the detailed investigation and root cause analysis.

---

## 1. Investigation & Evidence

### Test Execution Observations
* **Individual execution**: Running `node --test tests/stability-regression.test.js` succeeds 100% of the time.
* **Concurrent execution**: Running `npm run test:stability` (which executes multiple test files in parallel) consistently causes a failure during the file deletion test case.

### Server Spawn Diagnostics
During concurrent execution, the child process logs revealed the following crash on startup for the second test file's spawned server:

```text
node:events:486
      throw er; // Unhandled 'error' event
      ^

Error: listen EADDRINUSE: address already in use :::3000
    at Server.setupListenHandle [as _listen2] (node:net:1948:16)
    at listenInCluster (node:net:2005:12)
    at Server.listen (node:net:2110:7)
    at app.listen (D:\CloudVault\node_modules\express\lib\application.js:635:24)
    at startServer (D:\CloudVault\dist\app.js:65:18)
    at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
Emitted 'error' event on Server instance at:
    at emitErrorNT (node:net:1984:8)
    at process.processTicksAndRejections (node:internal/process/task_queues:90:21) {
  code: 'EADDRINUSE',
  errno: -4091,
  syscall: 'listen',
  address: '::',
  port: 3000
}
```

### Exact Failing Statement in Test Suite
The failure in the test suite manifests during the HTTP request exchange:
```javascript
// File: tests/stability-regression.test.js (Line 282)
response = await request(session, `/workspaces/${workspaceId}/files/${fileId}`, {
  method: 'DELETE',
});
```

### Stack Trace
```text
✖ file deletion removes Mongo metadata, file versions, activity entry, and Supabase object (1716.0786ms)
  [TypeError: fetch failed] {
    [cause]: Error: read ECONNRESET
        at TCP.onStreamRead (node:internal/stream_base_commons:216:20) {
      errno: -4077,
      code: 'ECONNRESET',
      syscall: 'read'
    }
  }
```

---

## 2. Root Cause Identification

1. **Port Collision**: Both `tests/stability-regression.test.js` and `tests/edge-case-regression.test.js` spawn the Express server on the hardcoded port `3000`.
2. **Parallel Execution**: Node's test runner runs these test files in parallel. 
3. **Leaked/Dangling Connection**: The first test suite starts its server on port `3000` successfully. The second test suite fails to start its server because port `3000` is already in use (`EADDRINUSE`).
4. **Transient Success**: Because the first server is active on port `3000`, the first few requests from the second test suite are received and handled by the *first* server (since they share the same database state).
5. **SIGTERM during Execution**: When the first test suite completes, its `after` hook kills its spawned server process (`serverProcess.kill('SIGTERM')`).
6. **Connection Reset**: When the second test suite attempts its subsequent `/DELETE` file request, the target port `3000` is no longer active, resulting in a sudden `ECONNRESET` (connection reset) fetch failure.

---

## 3. Minimal Fix Plan

To isolate the test files and allow safe parallel execution, we will configure each test suite to spawn its Express backend on a unique port by passing the `PORT` environment variable.

### Unique Port Assignment
* `tests/stability-regression.test.js`: Port `3002`
* `tests/edge-case-regression.test.js`: Port `3003`
* `tests/ai.test.js`: Port `3004`
* `tests/collaboration.test.js`: Port `3005`

---

## 4. Regression Risk

* **Risk Level**: **None**.
* **Impact**: Changing test ports isolated per suite does not affect the production config. The production server continues to default to port `3000` or the runtime `PORT` environment variable.
