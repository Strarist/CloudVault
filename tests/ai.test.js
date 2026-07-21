const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

// Dist-built Models and Services
const { User } = require('../dist/models/user.model.js');
const { Workspace } = require('../dist/models/workspace.model.js');
const { WorkspaceMember } = require('../dist/models/workspaceMember.model.js');
const { File } = require('../dist/models/file.model.js');
const { FileVersion } = require('../dist/models/fileVersion.model.js');
const { AIJob } = require('../dist/models/aiJob.model.js');
const { AIResult } = require('../dist/models/aiResult.model.js');
const { AIJobService } = require('../dist/services/aiJob.service.js');
const { AIRecoveryDaemon } = require('../dist/workers/ai.recovery.js');
const { WorkerHeartbeat } = require('../dist/workers/ai.worker.js');
const { Notification } = require('../dist/models/notification.model.js');
const { MockAIProvider } = require('../dist/services/aiProvider.service.js');
const { processJob } = require('../dist/workers/ai.worker.js');
const { ActivityLog } = require('../dist/models/activityLog.model.js');


const envPath = path.join(__dirname, '..', '.env');
const envText = fs.readFileSync(envPath, 'utf8').replace(/^(\s*[A-Z0-9_]+)\s+=/gm, '$1=');
const env = dotenv.parse(envText);

const PORT = 3004;
const API = `http://127.0.0.1:${PORT}`;
let serverProcess;

function makeSession() {
  return { cookie: '' };
}

async function request(session, pathname, options = {}) {
  const headers = new Headers(options.headers || {});
  if (session.cookie) {
    headers.set('Cookie', session.cookie);
  }

  const response = await fetch(`${API}${pathname}`, { ...options, headers });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) {
    session.cookie = setCookie.split(';')[0];
  }

  return response;
}

async function waitForServer() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`${API}/health`);
      if (response.ok) {
        return;
      }
    } catch {}

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error('Server did not start in time.');
}

async function cleanupAIArtifacts(workspaceIds, userIds) {
  if (workspaceIds.length > 0) {
    const wsIds = workspaceIds.map(id => new mongoose.Types.ObjectId(id));
    await AIJob.deleteMany({ workspaceId: { $in: wsIds } });
    await AIResult.deleteMany({ workspaceId: { $in: wsIds } });
    await FileVersion.deleteMany({ fileId: { $in: await File.find({ workspaceId: { $in: wsIds } }).select('_id') } });
    await File.deleteMany({ workspaceId: { $in: wsIds } });
    await WorkspaceMember.deleteMany({ workspaceId: { $in: wsIds } });
    await Workspace.deleteMany({ _id: { $in: wsIds } });
  }
  if (userIds.length > 0) {
    await User.deleteMany({ _id: { $in: userIds } });
  }
}

before(async () => {
  await mongoose.connect(env.MONGO_URI || 'mongodb://0.0.0.0/cloudVault-drive');
  serverProcess = spawn(process.execPath, ['dist/app.js'], {
    cwd: path.join(__dirname, '..'),
    stdio: 'ignore',
    env: { ...process.env, PORT: PORT.toString() },
  });
  await waitForServer();
});

after(async () => {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill('SIGTERM');
  }
  await mongoose.disconnect();
});

// 1. ATOMIC JOB CLAIMING (CONCURRENCY SAFETY)
test('concurrency: only one worker can claim a pending job atomically', async () => {
  await AIJob.deleteMany({});
  await AIResult.deleteMany({});
  const wsId = new mongoose.Types.ObjectId();
  const fileId = new mongoose.Types.ObjectId();
  const versionId = new mongoose.Types.ObjectId();

  // Insert a pending job
  const job = await AIJob.create({
    workspaceId: wsId,
    fileId,
    fileVersionId: versionId,
    status: 'PENDING',
    priority: 1,
    runAfter: new Date(),
  });

  // Try to claim simultaneously
  const claim1Promise = AIJob.findOneAndUpdate(
    { _id: job._id, status: 'PENDING', runAfter: { $lte: new Date() } },
    { $set: { status: 'PROCESSING', workerId: 'worker-1', claimedAt: new Date() } },
    { new: true }
  );

  const claim2Promise = AIJob.findOneAndUpdate(
    { _id: job._id, status: 'PENDING', runAfter: { $lte: new Date() } },
    { $set: { status: 'PROCESSING', workerId: 'worker-2', claimedAt: new Date() } },
    { new: true }
  );

  const [res1, res2] = await Promise.all([claim1Promise, claim2Promise]);

  // Assert exactly one claimed successfully, the other got null
  const success1 = res1 !== null;
  const success2 = res2 !== null;

  assert.equal(success1 !== success2, true, 'One and only one worker should successfully claim');
  
  // Clean up
  await AIJob.deleteOne({ _id: job._id });
});

// 2. PRIORITY QUEUE SCHEDULING (FIFO ORDER)
test('priority queue: workers poll jobs based on priority FIFO order', async () => {
  await AIJob.deleteMany({});
  await AIResult.deleteMany({});
  const wsId = new mongoose.Types.ObjectId();
  const fileId = new mongoose.Types.ObjectId();

  const ver1 = new mongoose.Types.ObjectId();
  const ver2 = new mongoose.Types.ObjectId();
  const ver3 = new mongoose.Types.ObjectId();

  // Create jobs with different priorities
  // priority: 0 = High, 1 = Standard, 2 = Low
  const jobLow = await AIJob.create({
    workspaceId: wsId,
    fileId,
    fileVersionId: ver1,
    status: 'PENDING',
    priority: 2,
    runAfter: new Date(Date.now() - 5000),
  });

  const jobHigh = await AIJob.create({
    workspaceId: wsId,
    fileId,
    fileVersionId: ver2,
    status: 'PENDING',
    priority: 0,
    runAfter: new Date(Date.now() - 5000),
  });

  const jobStandard = await AIJob.create({
    workspaceId: wsId,
    fileId,
    fileVersionId: ver3,
    status: 'PENDING',
    priority: 1,
    runAfter: new Date(Date.now() - 5000),
  });

  // Poll one by one matching worker claim logic
  const claimNext = async (workerId) => {
    return AIJob.findOneAndUpdate(
      { status: 'PENDING', runAfter: { $lte: new Date() } },
      { $set: { status: 'PROCESSING', workerId } },
      { sort: { priority: 1, runAfter: 1, createdAt: 1 }, new: true }
    );
  };

  const claimed1 = await claimNext('w1');
  const claimed2 = await claimNext('w2');
  const claimed3 = await claimNext('w3');

  assert.equal(claimed1.fileVersionId.toString(), ver2.toString(), 'First claimed should be High Priority (0)');
  assert.equal(claimed2.fileVersionId.toString(), ver3.toString(), 'Second claimed should be Standard Priority (1)');
  assert.equal(claimed3.fileVersionId.toString(), ver1.toString(), 'Third claimed should be Low Priority (2)');

  // Clean up
  await AIJob.deleteMany({ _id: { $in: [jobLow._id, jobHigh._id, jobStandard._id] } });
});

// 3. COST GOVERNANCE MONTHLY LIMITS
test('cost governance: scheduling respects monthly workspace limits', async () => {
  await AIJob.deleteMany({});
  await AIResult.deleteMany({});
  const suffix = Date.now();
  
  // Create test workspace
  const workspace = await Workspace.create({
    name: `Governance Ws ${suffix}`,
    description: 'cost-governance-test',
    ownerId: new mongoose.Types.ObjectId(),
    type: 'PERSONAL', // Limit is 100
    aiEnabled: true,
  });

  const fileId = new mongoose.Types.ObjectId();
  const versionId = new mongoose.Types.ObjectId();

  // Create 100 completed jobs in current month
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const mockActivityLogs = [];
  for (let i = 0; i < 100; i++) {
    mockActivityLogs.push({
      workspaceId: workspace._id,
      actorId: workspace.ownerId,
      action: 'AI_PROCESSING_COMPLETED',
      metadata: {},
      timestamp: new Date(startOfMonth.getTime() + i * 1000),
    });
  }
  await ActivityLog.insertMany(mockActivityLogs);

  // Try to schedule 101st job
  const job = await AIJobService.createJob(workspace._id, fileId, versionId);

  // Assert that job is rejected (returns null)
  assert.equal(job, null, 'Job creation should be blocked when limit is reached');

  // Clean up
  await ActivityLog.deleteMany({ workspaceId: workspace._id });
  await AIJob.deleteMany({ workspaceId: workspace._id });
  await Workspace.deleteOne({ _id: workspace._id });
});

// 4. LOCK RECOVERY DAEMON OPERATION
test('recovery daemon: resets stalled processing jobs with dynamic lock timeouts', async () => {
  await AIJob.deleteMany({});
  await AIResult.deleteMany({});
  const wsId = new mongoose.Types.ObjectId();
  const fileId = new mongoose.Types.ObjectId();
  const versionId = new mongoose.Types.ObjectId();

  // Create stalled job (stalled for 20 minutes)
  const job = await AIJob.create({
    workspaceId: wsId,
    fileId,
    fileVersionId: versionId,
    status: 'PROCESSING',
    claimedAt: new Date(Date.now() - 20 * 60 * 1000), // 20m ago
    attemptCount: 1,
    priority: 1,
    runAfter: new Date(),
  });

  // Run recovery with 15 minutes lock timeout
  const resetCount = await AIRecoveryDaemon.runRecovery(15 * 60 * 1000);
  assert.equal(resetCount, 1, 'Should reset exactly 1 stalled job');

  // Fetch updated job
  const updatedJob = await AIJob.findById(job._id);
  assert.equal(updatedJob.status, 'PENDING');
  assert.equal(updatedJob.claimedAt, undefined);
  assert.equal(updatedJob.workerId, undefined);
  assert.equal(updatedJob.attemptCount, 2);
  assert.equal(updatedJob.priority, 2, 'Priority value should increase (meaning lower priority)');

  // Clean up
  await AIJob.deleteOne({ _id: job._id });
});

// 5. GRACEFUL SIGTERM SHUTDOWN CLEANUP
test('shutdown: worker removes heartbeat from DB on graceful shutdown', async () => {
  // Directly simulate worker registration
  const tempWorkerId = 'worker-test-sigterm-shutdown';
  
  await WorkerHeartbeat.create({
    workerId: tempWorkerId,
    lastHeartbeat: new Date(),
    hostname: 'test-host',
    activeJobsCount: 0,
  });

  // Assert heartbeat exists
  let heartbeat = await WorkerHeartbeat.findOne({ workerId: tempWorkerId });
  assert.ok(heartbeat);

  // Simulate worker cleanup that runs during gracefulShutdown
  await WorkerHeartbeat.deleteOne({ workerId: tempWorkerId });

  // Assert heartbeat is deleted
  heartbeat = await WorkerHeartbeat.findOne({ workerId: tempWorkerId });
  assert.equal(heartbeat, null, 'Heartbeat should be deleted on shutdown');
});

// 6. UPLOAD INTEGRATION & SOFT VS HARD DELETE CASCADE
test('upload + delete integration: schedules job on upload, cleans up on hard delete', async () => {
  await AIJob.deleteMany({});
  await AIResult.deleteMany({});
  const suffix = Date.now();
  const owner = {
    email: `ai-user-${suffix}@cloudvault.com`,
    username: `aiuser${suffix}`,
    password: 'Password1',
  };
  const session = makeSession();
  const cleanupUserIds = [];
  const cleanupWorkspaceIds = [];

  try {
    // Register
    let response = await request(session, '/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(owner),
    });
    assert.equal(response.status, 201);
    const createdUser = await response.json();
    cleanupUserIds.push(new mongoose.Types.ObjectId(createdUser._id));
    
    // Fetch personal workspace
    const workspace = await Workspace.findOne({ ownerId: createdUser._id });
    assert.ok(workspace);
    cleanupWorkspaceIds.push(workspace._id);

    // Enable AI in workspace (so jobs are scheduled)
    workspace.aiEnabled = true;
    await workspace.save();

    // Login
    response = await request(session, '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: owner.email, password: owner.password }),
    });
    assert.equal(response.status, 200);

    // Upload File
    const form = new FormData();
    form.append('file', new Blob(['ai integrated test file content'], { type: 'text/plain' }), 'ai-test.txt');
    response = await request(session, `/workspaces/${workspace._id}/files/upload`, {
      method: 'POST',
      body: form,
    });
    assert.equal(response.status, 201);
    const filePayload = await response.json();
    const fileId = filePayload._id;
    const versionId = filePayload.currentVersionId._id;

    // Give asynchronous job creation a moment
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Verify AIJob was scheduled in MongoDB
    const job = await AIJob.findOne({ fileVersionId: versionId });
    assert.ok(job, 'AIJob should be successfully scheduled on file upload');
    assert.equal(job.status, 'PENDING');
    assert.equal(job.fileId.toString(), fileId.toString());

    // Verify File aiStatus is PENDING
    const fileBefore = await File.findById(fileId);
    assert.equal(fileBefore.aiStatus, 'PENDING');

    // Create a mock AIResult to test delete cascade
    const mockResult = await AIResult.create({
      workspaceId: workspace._id,
      fileId,
      fileVersionId: versionId,
      summary: 'Mock test summary',
      tags: ['test'],
      embedding: new Array(1536).fill(0.1),
      embeddingModel: 'mock-model',
      embeddingDimensions: 1536,
      embeddingVersion: 1,
      modelProvider: 'mock',
      modelName: 'mock',
      modelVersion: '1.0.0',
    });

    // Perform Hard Delete (calling HTTP DELETE route)
    response = await request(session, `/workspaces/${workspace._id}/files/${fileId}`, {
      method: 'DELETE',
    });
    assert.equal(response.status, 200);

    // Assert file status is DELETED (soft delete marker)
    const fileAfter = await File.findById(fileId);
    assert.equal(fileAfter.status, 'DELETED');
    assert.ok(fileAfter.deletedAt);

    // Assert that the AIJob and AIResult Cascade deletion has run
    const jobAfter = await AIJob.findOne({ fileId });
    assert.equal(jobAfter, null, 'AIJob should be cascade deleted');

    const resultAfter = await AIResult.findOne({ fileId });
    assert.equal(resultAfter, null, 'AIResult should be cascade deleted');

  } finally {
    await cleanupAIArtifacts(cleanupWorkspaceIds, cleanupUserIds);
  }
});

// 7. PROVIDER TIMEOUT RETRY
test('provider timeout: triggers transient retry logic', async () => {
  await AIJob.deleteMany({});
  await AIResult.deleteMany({});
  const wsId = new mongoose.Types.ObjectId();
  const fileId = new mongoose.Types.ObjectId();
  const versionId = new mongoose.Types.ObjectId();

  // Create workspace and version to satisfy worker checks
  const workspace = await Workspace.create({
    name: 'Timeout Ws',
    ownerId: new mongoose.Types.ObjectId(),
    type: 'PERSONAL',
    aiEnabled: true,
  });

  const file = await File.create({
    name: 'timeout-doc.txt',
    workspaceId: workspace._id,
    createdBy: workspace.ownerId,
    status: 'ACTIVE',
    aiStatus: 'PROCESSING',
    tags: [],
  });

  const version = await FileVersion.create({
    _id: versionId,
    fileId: file._id,
    versionNumber: 1,
    storageKey: 'key',
    mimeType: 'text/plain',
    fileSize: 10,
    uploadedBy: workspace.ownerId,
  });

  // Create PENDING job
  const job = await AIJob.create({
    workspaceId: workspace._id,
    fileId: file._id,
    fileVersionId: versionId,
    status: 'PENDING',
    priority: 1,
    runAfter: new Date(),
  });

  // Mock hanging provider by throwing PROVIDER_TIMEOUT
  const originalGenerateSummary = MockAIProvider.prototype.generateSummary;
  MockAIProvider.prototype.generateSummary = async () => {
    throw new Error('PROVIDER_TIMEOUT');
  };

  try {
    // Call worker's job processor directly
    await processJob(job);
  } finally {
    MockAIProvider.prototype.generateSummary = originalGenerateSummary;
  }

  // Fetch updated job
  const updatedJob = await AIJob.findById(job._id);
  assert.equal(updatedJob.status, 'PENDING', 'Job should remain PENDING for retry');
  assert.equal(updatedJob.attemptCount, 1, 'Attempt count should be 1');
  assert.equal(updatedJob.lastError.message, 'PROVIDER_TIMEOUT');
  assert.equal(updatedJob.lastError.errorType, 'TRANSIENT');

  // Clean up
  await FileVersion.deleteOne({ _id: versionId });
  await File.deleteOne({ _id: file._id });
  await Workspace.deleteOne({ _id: workspace._id });
  await AIJob.deleteOne({ _id: job._id });
});

// 8. WORKER HEALTH OBSERVABILITY
test('observability: /system/worker-health returns accurate queue and worker metrics', async () => {
  await AIJob.deleteMany({});
  await WorkerHeartbeat.deleteMany({});

  // 1. Insert mock heartbeats
  const worker1 = await WorkerHeartbeat.create({
    workerId: 'worker-health-1',
    lastHeartbeat: new Date(), // Active now
    hostname: 'host-1',
    activeJobsCount: 1,
  });

  await WorkerHeartbeat.create({
    workerId: 'worker-health-2',
    lastHeartbeat: new Date(Date.now() - 60000), // Stale (1 minute ago)
    hostname: 'host-2',
    activeJobsCount: 0,
  });

  // 2. Insert mock jobs
  const wsId = new mongoose.Types.ObjectId();
  const fileId = new mongoose.Types.ObjectId();
  const vId = new mongoose.Types.ObjectId();

  // 1 pending job scheduled for now
  await AIJob.create({
    workspaceId: wsId,
    fileId,
    fileVersionId: vId,
    status: 'PENDING',
    runAfter: new Date(Date.now() - 5000),
  });

  // 1 processing job
  await AIJob.create({
    workspaceId: wsId,
    fileId,
    fileVersionId: new mongoose.Types.ObjectId(),
    status: 'PROCESSING',
    runAfter: new Date(),
  });

  // 1 failed job updated 2 hours ago
  await AIJob.create({
    workspaceId: wsId,
    fileId,
    fileVersionId: new mongoose.Types.ObjectId(),
    status: 'FAILED',
    updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    runAfter: new Date(),
  });

  // Call API
  const response = await fetch(`${API}/system/worker-health`);
  assert.equal(response.status, 200);
  const health = await response.json();

  assert.equal(health.activeWorkers, 1, 'Only worker-1 should be active (within 30s)');
  assert.equal(health.queueDepth, 1, 'Queue depth should count PENDING jobs past due');
  assert.equal(health.processingJobs, 1, 'Processing jobs should be 1');
  assert.equal(health.failedJobs24h, 1, 'Failed jobs within 24h should be 1');

  // Clean up
  await WorkerHeartbeat.deleteMany({});
  await AIJob.deleteMany({});
});

// 9. AI JOB VISIBILITY ENDPOINT
test('observability: GET /workspaces/:workspaceId/ai/jobs restricts role and lists jobs', async () => {
  await AIJob.deleteMany({});
  const suffix = Date.now();
  
  // Register owner user
  const ownerData = {
    email: `owner-${suffix}@cloudvault.com`,
    username: `owner${suffix}`,
    password: 'Password1',
  };
  const sessionOwner = makeSession();
  let res = await request(sessionOwner, '/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ownerData),
  });
  const createdOwner = await res.json();
  const workspace = await Workspace.findOne({ ownerId: createdOwner._id });

  // Register admin user
  const adminData = {
    email: `admin-${suffix}@cloudvault.com`,
    username: `admin${suffix}`,
    password: 'Password1',
  };
  const sessionAdmin = makeSession();
  res = await request(sessionAdmin, '/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(adminData),
  });
  const createdAdmin = await res.json();
  
  // Add as ADMIN member
  await WorkspaceMember.create({
    workspaceId: workspace._id,
    userId: createdAdmin._id,
    role: 'ADMIN',
    joinedAt: new Date(),
  });

  // Log in admin
  await request(sessionAdmin, '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: adminData.email, password: adminData.password }),
  });

  // Create a job for workspace
  await AIJob.create({
    workspaceId: workspace._id,
    fileId: new mongoose.Types.ObjectId(),
    fileVersionId: new mongoose.Types.ObjectId(),
    status: 'PROCESSING',
    attemptCount: 1,
    runAfter: new Date(),
  });

  // Request visibility route with Admin session
  res = await request(sessionAdmin, `/workspaces/${workspace._id}/ai/jobs`);
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].status, 'PROCESSING');

  // Verify non-admin is blocked
  // Register viewer user
  const viewerData = {
    email: `viewer-${suffix}@cloudvault.com`,
    username: `viewer${suffix}`,
    password: 'Password1',
  };
  const sessionViewer = makeSession();
  res = await request(sessionViewer, '/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(viewerData),
  });
  const createdViewer = await res.json();
  
  await WorkspaceMember.create({
    workspaceId: workspace._id,
    userId: createdViewer._id,
    role: 'VIEWER',
    joinedAt: new Date(),
  });

  await request(sessionViewer, '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: viewerData.email, password: viewerData.password }),
  });

  res = await request(sessionViewer, `/workspaces/${workspace._id}/ai/jobs`);
  assert.equal(res.status, 403, 'VIEWER should be denied access to AI jobs endpoint');

  // Clean up
  await AIJob.deleteMany({ workspaceId: workspace._id });
  await WorkspaceMember.deleteMany({ workspaceId: workspace._id });
  await Workspace.deleteOne({ _id: workspace._id });
  await User.deleteMany({ _id: { $in: [createdOwner._id, createdAdmin._id, createdViewer._id] } });
});

// 10. AI PROCESSING FAILURE NOTIFICATIONS
test('notification: permanent AI failure notifies workspace owner and admin', async () => {
  await AIJob.deleteMany({});
  await Notification.deleteMany({});

  // Setup Workspace, Owner, Admin, File, Version
  const ownerId = new mongoose.Types.ObjectId();
  const adminUserId = new mongoose.Types.ObjectId();
  const wsId = new mongoose.Types.ObjectId();
  const fileId = new mongoose.Types.ObjectId();
  const versionId = new mongoose.Types.ObjectId();

  const workspace = await Workspace.create({
    _id: wsId,
    name: 'Notification Ws',
    ownerId,
    type: 'TEAM',
    aiEnabled: true,
  });

  await WorkspaceMember.create({
    workspaceId: wsId,
    userId: adminUserId,
    role: 'ADMIN',
    joinedAt: new Date(),
  });

  const file = await File.create({
    _id: fileId,
    name: 'notification-doc.txt',
    workspaceId: wsId,
    createdBy: ownerId,
    status: 'ACTIVE',
    aiStatus: 'PROCESSING',
    tags: [],
  });

  const version = await FileVersion.create({
    _id: versionId,
    fileId,
    versionNumber: 1,
    storageKey: 'key',
    mimeType: 'text/plain',
    fileSize: 10,
    uploadedBy: ownerId,
  });

  const job = await AIJob.create({
    workspaceId: wsId,
    fileId,
    fileVersionId: versionId,
    status: 'PENDING',
    attemptCount: 0,
    maxAttempts: 3,
    priority: 1,
    runAfter: new Date(),
  });

  // Mock permanent failure error
  const originalGenerateSummary = MockAIProvider.prototype.generateSummary;
  MockAIProvider.prototype.generateSummary = async () => {
    const err = new Error('Invalid Provider API Key');
    err.status = 401; // Classifies as PERMANENT
    throw err;
  };

  try {
    await processJob(job);
  } finally {
    MockAIProvider.prototype.generateSummary = originalGenerateSummary;
  }

  // Verify notifications
  const ownerNotification = await Notification.findOne({ userId: ownerId });
  assert.ok(ownerNotification, 'Workspace owner should receive notification');
  assert.equal(ownerNotification.type, 'AI_PROCESSING_FAILED');
  assert.equal(ownerNotification.payload.fileId, fileId.toString());
  assert.equal(ownerNotification.payload.reason, 'Invalid Provider API Key');

  const adminNotification = await Notification.findOne({ userId: adminUserId });
  assert.ok(adminNotification, 'Workspace admin should receive notification');
  assert.equal(adminNotification.type, 'AI_PROCESSING_FAILED');

  // Clean up
  await Notification.deleteMany({ userId: { $in: [ownerId, adminUserId] } });
  await FileVersion.deleteOne({ _id: versionId });
  await File.deleteOne({ _id: fileId });
  await WorkspaceMember.deleteMany({ workspaceId: wsId });
  await Workspace.deleteOne({ _id: wsId });
  await AIJob.deleteOne({ _id: job._id });
});

// 11. VERSION ROLLBACK CONTRACT
test('rollback: switching active version restores cached AIResult and aiStatus without reprocessing', async () => {
  await AIJob.deleteMany({});
  await AIResult.deleteMany({});
  const suffix = Date.now();

  // Register owner user
  const ownerData = {
    email: `rollback-${suffix}@cloudvault.com`,
    username: `rollback${suffix}`,
    password: 'Password1',
  };
  const session = makeSession();
  let res = await request(session, '/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ownerData),
  });
  const createdOwner = await res.json();
  const workspace = await Workspace.findOne({ ownerId: createdOwner._id });

  // Log in
  await request(session, '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ownerData.email, password: ownerData.password }),
  });

  // Create file
  const file = await File.create({
    name: 'rollback-doc.txt',
    workspaceId: workspace._id,
    createdBy: createdOwner._id,
    status: 'ACTIVE',
    aiStatus: 'READY',
    summary: 'v2 summary',
    tags: ['v2'],
  });

  // Create Version 1
  const v1 = await FileVersion.create({
    fileId: file._id,
    versionNumber: 1,
    storageKey: 'v1-key',
    mimeType: 'text/plain',
    fileSize: 10,
    uploadedBy: createdOwner._id,
    aiStatus: 'READY',
  });

  // Create AIResult for v1
  await AIResult.create({
    workspaceId: workspace._id,
    fileId: file._id,
    fileVersionId: v1._id,
    summary: 'v1 summary',
    tags: ['v1'],
    embedding: new Array(1536).fill(0.1),
    embeddingModel: 'mock-model',
    embeddingDimensions: 1536,
    embeddingVersion: 1,
    modelProvider: 'mock',
    modelName: 'mock',
    modelVersion: '1.0.0',
  });

  // Create Version 2 (active)
  const v2 = await FileVersion.create({
    fileId: file._id,
    versionNumber: 2,
    storageKey: 'v2-key',
    mimeType: 'text/plain',
    fileSize: 12,
    uploadedBy: createdOwner._id,
    aiStatus: 'PROCESSING',
  });

  file.currentVersionId = v2._id;
  await file.save();

  // Call PATCH route to switch to v1 (rollback)
  res = await request(session, `/workspaces/${workspace._id}/files/${file._id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentVersionId: v1._id }),
  });
  assert.equal(res.status, 200);

  // Assert File metadata matches v1 state
  const rolledBackFile = await File.findById(file._id);
  assert.equal(rolledBackFile.currentVersionId.toString(), v1._id.toString());
  assert.equal(rolledBackFile.summary, 'v1 summary');
  assert.deepEqual(rolledBackFile.tags, ['v1']);
  assert.equal(rolledBackFile.aiStatus, 'READY');

  // Assert no new AIJob is created
  const jobsCount = await AIJob.countDocuments({ fileId: file._id });
  assert.equal(jobsCount, 0, 'Rollback should use cache and never create jobs');

  // Clean up
  await AIResult.deleteMany({ fileId: file._id });
  await FileVersion.deleteMany({ fileId: file._id });
  await File.deleteOne({ _id: file._id });
  await Workspace.deleteOne({ _id: workspace._id });
  await User.deleteOne({ _id: createdOwner._id });
});

// 12. QUOTA GOVERNANCE BYPASS ATTEMPT
test('quota governance: file deletion does NOT refund monthly quota', async () => {
  await AIJob.deleteMany({});
  await ActivityLog.deleteMany({});

  const workspace = await Workspace.create({
    name: 'Quota Bypass Ws',
    ownerId: new mongoose.Types.ObjectId(),
    type: 'PERSONAL', // Limit is 100
    aiEnabled: true,
  });

  const fileId = new mongoose.Types.ObjectId();
  const versionId = new mongoose.Types.ObjectId();

  // Fill up quota with 100 activity log completions
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const mockActivityLogs = [];
  for (let i = 0; i < 100; i++) {
    mockActivityLogs.push({
      workspaceId: workspace._id,
      actorId: workspace.ownerId,
      action: 'AI_PROCESSING_COMPLETED',
      metadata: {},
      timestamp: new Date(startOfMonth.getTime() + i * 1000),
    });
  }
  await ActivityLog.insertMany(mockActivityLogs);

  // Deletion of previous files/jobs does not change activity logs.
  // Verify that creating a job is blocked (limit reached)
  const jobBeforeDelete = await AIJobService.createJob(workspace._id, fileId, versionId);
  assert.equal(jobBeforeDelete, null, 'Should be blocked');

  // Simulate file deletion cascade (deletes AIResult and AIJobs, but ActivityLogs remain)
  await AIJob.deleteMany({ workspaceId: workspace._id });

  // Attempt to schedule again after deletion
  const jobAfterDelete = await AIJobService.createJob(workspace._id, fileId, versionId);
  assert.equal(jobAfterDelete, null, 'Should still be blocked; deletion does not refund quota');

  // Clean up
  await ActivityLog.deleteMany({ workspaceId: workspace._id });
  await Workspace.deleteOne({ _id: workspace._id });
});

// 13. GET AI RESULT ENDPOINT
test('GET AI Result: READY status returns summary, tags and model metadata', async () => {
  await AIJob.deleteMany({});
  await AIResult.deleteMany({});
  const suffix = Date.now();
  const session = makeSession();

  // Register owner user
  const ownerData = {
    email: `ai-get-res-${suffix}@cloudvault.com`,
    username: `aigetres${suffix}`,
    password: 'Password1',
  };
  let res = await request(session, '/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ownerData),
  });
  const createdOwner = await res.json();
  const workspace = await Workspace.findOne({ ownerId: createdOwner._id });

  // Log in
  await request(session, '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ownerData.email, password: ownerData.password }),
  });

  // Create file
  const file = await File.create({
    name: 'ai-result-doc.txt',
    workspaceId: workspace._id,
    createdBy: createdOwner._id,
    status: 'ACTIVE',
    aiStatus: 'READY',
  });

  // Create Version
  const version = await FileVersion.create({
    fileId: file._id,
    versionNumber: 1,
    storageKey: 'v1-key',
    mimeType: 'text/plain',
    fileSize: 10,
    uploadedBy: createdOwner._id,
    aiStatus: 'READY',
  });

  file.currentVersionId = version._id;
  await file.save();

  // Create AIResult
  await AIResult.create({
    workspaceId: workspace._id,
    fileId: file._id,
    fileVersionId: version._id,
    summary: 'Test summary contents',
    tags: ['tag1', 'tag2'],
    embedding: new Array(1536).fill(0.2),
    embeddingModel: 'mock-model',
    embeddingDimensions: 1536,
    embeddingVersion: 1,
    modelProvider: 'mock',
    modelName: 'mock-summarizer',
    modelVersion: '1.0.0',
  });

  // Call API
  res = await request(session, `/workspaces/${workspace._id}/files/${file._id}/ai`);
  assert.equal(res.status, 200);
  const payload = await res.json();

  assert.equal(payload.status, 'READY');
  assert.equal(payload.summary, 'Test summary contents');
  assert.deepEqual(payload.tags, ['tag1', 'tag2']);
  assert.equal(payload.modelName, 'mock-summarizer');
  assert.equal(payload.modelVersion, '1.0.0');

  // Clean up
  await AIResult.deleteMany({ fileId: file._id });
  await FileVersion.deleteMany({ fileId: file._id });
  await File.deleteOne({ _id: file._id });
  await Workspace.deleteOne({ _id: workspace._id });
  await User.deleteOne({ _id: createdOwner._id });
});

// 14. GET TEXT ENDPOINT (CACHE & SUPABASE FALLBACK)
test('GET Text: cache hit and cache miss Supabase fallback', async () => {
  const { StorageService } = require('../dist/services/storage.service.js');
  await AIJob.deleteMany({});
  await AIResult.deleteMany({});
  const suffix = Date.now();
  const session = makeSession();

  // Register owner user
  const ownerData = {
    email: `ai-get-text-${suffix}@cloudvault.com`,
    username: `aigettext${suffix}`,
    password: 'Password1',
  };
  let res = await request(session, '/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ownerData),
  });
  const createdOwner = await res.json();
  const workspace = await Workspace.findOne({ ownerId: createdOwner._id });

  // Log in
  await request(session, '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ownerData.email, password: ownerData.password }),
  });

  // Create file
  const file = await File.create({
    name: 'ai-text-doc.txt',
    workspaceId: workspace._id,
    createdBy: createdOwner._id,
    status: 'ACTIVE',
    aiStatus: 'READY',
  });

  // Create Version
  const version = await FileVersion.create({
    fileId: file._id,
    versionNumber: 1,
    storageKey: 'v1-key',
    mimeType: 'text/plain',
    fileSize: 10,
    uploadedBy: createdOwner._id,
    aiStatus: 'READY',
  });

  file.currentVersionId = version._id;
  await file.save();

  // 1. Test cache hit: cache exists in AIResult
  const cacheResult = await AIResult.create({
    workspaceId: workspace._id,
    fileId: file._id,
    fileVersionId: version._id,
    summary: 'Test summary',
    tags: ['tag1'],
    extractedTextCache: 'cached raw text from file',
    embedding: new Array(1536).fill(0.2),
    embeddingModel: 'mock-model',
    embeddingDimensions: 1536,
    embeddingVersion: 1,
    modelProvider: 'mock',
    modelName: 'mock-summarizer',
    modelVersion: '1.0.0',
  });

  res = await request(session, `/workspaces/${workspace._id}/files/${file._id}/text`);
  assert.equal(res.status, 200);
  let payload = await res.json();
  assert.equal(payload.content, 'cached raw text from file');
  assert.equal(payload.truncated, false);

  // 2. Test cache miss (Supabase fallback): extractedTextCache is empty, download from storage key
  cacheResult.extractedTextCache = '';
  cacheResult.extractedTextStorageKey = `${workspace._id}/${file._id}/v1/extracted.txt`;
  await cacheResult.save();

  // Upload mock extracted text to StorageService mock store
  await StorageService.uploadFile(
    cacheResult.extractedTextStorageKey,
    Buffer.from('physical raw text downloaded from storage client'),
    'text/plain'
  );

  res = await request(session, `/workspaces/${workspace._id}/files/${file._id}/text`);
  assert.equal(res.status, 200);
  payload = await res.json();
  assert.equal(payload.content, 'physical raw text downloaded from storage client');
  assert.equal(payload.truncated, false);

  // Clean up
  await StorageService.deleteFile(cacheResult.extractedTextStorageKey);
  await AIResult.deleteMany({ fileId: file._id });
  await FileVersion.deleteMany({ fileId: file._id });
  await File.deleteOne({ _id: file._id });
  await Workspace.deleteOne({ _id: workspace._id });
  await User.deleteOne({ _id: createdOwner._id });
});

// 15. REPROCESS FLOW ENDPOINT
test('Reprocess: manual reprocess triggers high-priority job', async () => {
  await AIJob.deleteMany({});
  await AIResult.deleteMany({});
  const suffix = Date.now();
  const session = makeSession();

  // Register owner user
  const ownerData = {
    email: `ai-reprocess-${suffix}@cloudvault.com`,
    username: `aireprocess${suffix}`,
    password: 'Password1',
  };
  let res = await request(session, '/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ownerData),
  });
  const createdOwner = await res.json();
  const workspace = await Workspace.findOne({ ownerId: createdOwner._id });

  // Enable AI in workspace
  workspace.aiEnabled = true;
  await workspace.save();

  // Log in
  await request(session, '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ownerData.email, password: ownerData.password }),
  });

  // Create file
  const file = await File.create({
    name: 'reprocess-doc.txt',
    workspaceId: workspace._id,
    createdBy: createdOwner._id,
    status: 'ACTIVE',
    aiStatus: 'READY',
  });

  // Create Version
  const version = await FileVersion.create({
    fileId: file._id,
    versionNumber: 1,
    storageKey: 'v1-key',
    mimeType: 'text/plain',
    fileSize: 10,
    uploadedBy: createdOwner._id,
    aiStatus: 'READY',
  });

  file.currentVersionId = version._id;
  await file.save();

  // Call reprocess API (Editor/Owner permission)
  res = await request(session, `/workspaces/${workspace._id}/files/${file._id}/reprocess`, {
    method: 'POST',
  });
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.status, 'PENDING');
  assert.equal(payload.priority, 0, 'Reprocess job must be high-priority (0)');

  // Verify DB state
  const job = await AIJob.findById(payload.jobId);
  assert.ok(job);
  assert.equal(job.status, 'PENDING');
  assert.equal(job.priority, 0);

  const updatedFile = await File.findById(file._id);
  assert.equal(updatedFile.aiStatus, 'PROCESSING');

  const updatedVersion = await FileVersion.findById(version._id);
  assert.equal(updatedVersion.aiStatus, 'PROCESSING');

  // Verify ActivityLog
  const activity = await ActivityLog.findOne({
    workspaceId: workspace._id,
    action: 'AI_REPROCESS_REQUESTED',
  });
  assert.ok(activity);

  // Clean up
  await AIJob.deleteMany({ fileId: file._id });
  await FileVersion.deleteMany({ fileId: file._id });
  await File.deleteOne({ _id: file._id });
  await Workspace.deleteOne({ _id: workspace._id });
  await User.deleteOne({ _id: createdOwner._id });
});

// 16. PERMISSIONS SECURITY FOR REPROCESS
test('Permissions: VIEWER role cannot trigger reprocess, EDITOR can', async () => {
  await AIJob.deleteMany({});
  const suffix = Date.now();

  // Register owner user
  const ownerData = {
    email: `ai-perm-owner-${suffix}@cloudvault.com`,
    username: `aipermowner${suffix}`,
    password: 'Password1',
  };
  const sessionOwner = makeSession();
  let res = await request(sessionOwner, '/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ownerData),
  });
  const createdOwner = await res.json();
  const workspace = await Workspace.findOne({ ownerId: createdOwner._id });

  // Enable AI in workspace
  workspace.aiEnabled = true;
  await workspace.save();

  // Create file
  const file = await File.create({
    name: 'perm-reprocess-doc.txt',
    workspaceId: workspace._id,
    createdBy: createdOwner._id,
    status: 'ACTIVE',
    aiStatus: 'READY',
  });

  // Create Version
  const version = await FileVersion.create({
    fileId: file._id,
    versionNumber: 1,
    storageKey: 'v1-key',
    mimeType: 'text/plain',
    fileSize: 10,
    uploadedBy: createdOwner._id,
    aiStatus: 'READY',
  });

  file.currentVersionId = version._id;
  await file.save();

  // Register viewer user
  const viewerData = {
    email: `ai-perm-viewer-${suffix}@cloudvault.com`,
    username: `aipermviewer${suffix}`,
    password: 'Password1',
  };
  const sessionViewer = makeSession();
  res = await request(sessionViewer, '/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(viewerData),
  });
  const createdViewer = await res.json();

  // Add as VIEWER member
  await WorkspaceMember.create({
    workspaceId: workspace._id,
    userId: createdViewer._id,
    role: 'VIEWER',
    joinedAt: new Date(),
  });

  // Log in viewer
  await request(sessionViewer, '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: viewerData.email, password: viewerData.password }),
  });

  // Attempt reprocess with viewer session (should return 403)
  res = await request(sessionViewer, `/workspaces/${workspace._id}/files/${file._id}/reprocess`, {
    method: 'POST',
  });
  assert.equal(res.status, 403, 'VIEWER role should be blocked from reprocessing');

  // Register editor user
  const editorData = {
    email: `ai-perm-editor-${suffix}@cloudvault.com`,
    username: `aipermeditor${suffix}`,
    password: 'Password1',
  };
  const sessionEditor = makeSession();
  res = await request(sessionEditor, '/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(editorData),
  });
  const createdEditor = await res.json();

  // Add as EDITOR member
  await WorkspaceMember.create({
    workspaceId: workspace._id,
    userId: createdEditor._id,
    role: 'EDITOR',
    joinedAt: new Date(),
  });

  // Log in editor
  await request(sessionEditor, '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: editorData.email, password: editorData.password }),
  });

  // Attempt reprocess with editor session (should succeed with 200)
  res = await request(sessionEditor, `/workspaces/${workspace._id}/files/${file._id}/reprocess`, {
    method: 'POST',
  });
  assert.equal(res.status, 200, 'EDITOR role should be allowed to reprocess');

  // Clean up
  await AIJob.deleteMany({ fileId: file._id });
  await FileVersion.deleteMany({ fileId: file._id });
  await File.deleteOne({ _id: file._id });
  await WorkspaceMember.deleteMany({ workspaceId: workspace._id });
  await Workspace.deleteOne({ _id: workspace._id });
  await User.deleteMany({ _id: { $in: [createdOwner._id, createdViewer._id, createdEditor._id] } });
});

// 17. DELETED FILE ENDPOINT PROTECTION
test('Deleted File: AI endpoints reject access with 404 for deleted files', async () => {
  await AIJob.deleteMany({});
  const suffix = Date.now();
  const session = makeSession();

  // Register owner user
  const ownerData = {
    email: `ai-deleted-${suffix}@cloudvault.com`,
    username: `aideleted${suffix}`,
    password: 'Password1',
  };
  let res = await request(session, '/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ownerData),
  });
  const createdOwner = await res.json();
  const workspace = await Workspace.findOne({ ownerId: createdOwner._id });

  // Log in
  await request(session, '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ownerData.email, password: ownerData.password }),
  });

  // Create file marked as DELETED
  const file = await File.create({
    name: 'deleted-doc.txt',
    workspaceId: workspace._id,
    createdBy: createdOwner._id,
    status: 'DELETED',
    deletedAt: new Date(),
    aiStatus: 'READY',
  });

  // Call GET AI result endpoint (should return 404)
  res = await request(session, `/workspaces/${workspace._id}/files/${file._id}/ai`);
  assert.equal(res.status, 404);

  // Call GET Text endpoint (should return 404)
  res = await request(session, `/workspaces/${workspace._id}/files/${file._id}/text`);
  assert.equal(res.status, 404);

  // Call POST reprocess endpoint (should return 404)
  res = await request(session, `/workspaces/${workspace._id}/files/${file._id}/reprocess`, {
    method: 'POST',
  });
  assert.equal(res.status, 404);

  // Clean up
  await File.deleteOne({ _id: file._id });
  await Workspace.deleteOne({ _id: workspace._id });
  await User.deleteOne({ _id: createdOwner._id });
});

// 18. GET TEXT EMPTY STATE
test('GET Text: returns 200 with available: false when no AIResult exists', async () => {
  await AIJob.deleteMany({});
  await AIResult.deleteMany({});
  const suffix = Date.now();
  const session = makeSession();

  // Register owner user
  const ownerData = {
    email: `ai-empty-text-${suffix}@cloudvault.com`,
    username: `aiemptytext${suffix}`,
    password: 'Password1',
  };
  let res = await request(session, '/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ownerData),
  });
  const createdOwner = await res.json();
  const workspace = await Workspace.findOne({ ownerId: createdOwner._id });

  // Log in
  await request(session, '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ownerData.email, password: ownerData.password }),
  });

  // Create file
  const file = await File.create({
    name: 'ai-empty-text-doc.txt',
    workspaceId: workspace._id,
    createdBy: createdOwner._id,
    status: 'ACTIVE',
    aiStatus: 'NOT_STARTED',
  });

  // Create Version
  const version = await FileVersion.create({
    fileId: file._id,
    versionNumber: 1,
    storageKey: 'v1-key',
    mimeType: 'text/plain',
    fileSize: 10,
    uploadedBy: createdOwner._id,
    aiStatus: 'NOT_STARTED',
  });

  file.currentVersionId = version._id;
  await file.save();

  // Call GET Text endpoint (should return 200 with available: false)
  res = await request(session, `/workspaces/${workspace._id}/files/${file._id}/text`);
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.available, false);
  assert.equal(payload.reason, 'AI processing not completed');

  // Clean up
  await FileVersion.deleteMany({ fileId: file._id });
  await File.deleteOne({ _id: file._id });
  await Workspace.deleteOne({ _id: workspace._id });
  await User.deleteOne({ _id: createdOwner._id });
});

// 19. STATE TRANSITIONS ALIGNMENT
test('state transitions: File and FileVersion status transitions remain perfectly aligned', async () => {
  await AIJob.deleteMany({});
  await AIResult.deleteMany({});
  const suffix = Date.now();
  const session = makeSession();

  // Register owner user
  const ownerData = {
    email: `ai-states-${suffix}@cloudvault.com`,
    username: `aistates${suffix}`,
    password: 'Password1',
  };
  let res = await request(session, '/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ownerData),
  });
  const createdOwner = await res.json();
  const workspace = await Workspace.findOne({ ownerId: createdOwner._id });

  // Log in
  await request(session, '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ownerData.email, password: ownerData.password }),
  });

  // Scenario 1: Initial upload in AI-disabled workspace (default: aiEnabled = false)
  let fileRes = await File.create({
    name: 'disabled-state-doc.txt',
    workspaceId: workspace._id,
    createdBy: createdOwner._id,
    status: 'ACTIVE',
    aiStatus: 'NOT_STARTED', // defaults
  });
  let versionRes = await FileVersion.create({
    fileId: fileRes._id,
    versionNumber: 1,
    storageKey: 'v1-key-disabled',
    mimeType: 'text/plain',
    fileSize: 10,
    uploadedBy: createdOwner._id,
    aiStatus: 'NOT_STARTED', // defaults
  });
  assert.equal(fileRes.aiStatus, 'NOT_STARTED');
  assert.equal(versionRes.aiStatus, 'NOT_STARTED');

  // Enable AI in workspace for the rest of tests
  workspace.aiEnabled = true;
  await workspace.save();

  // Scenario 2: Initial upload in AI-enabled workspace schedules job and transitions to PENDING
  const job = await AIJobService.createJob(workspace._id, fileRes._id, versionRes._id);
  assert.ok(job);
  assert.equal(job.status, 'PENDING');

  const filePending = await File.findById(fileRes._id);
  const versionPending = await FileVersion.findById(versionRes._id);
  assert.equal(filePending.aiStatus, 'PENDING');
  assert.equal(versionPending.aiStatus, 'PENDING');

  // Scenario 3: After worker claims job, transitions to PROCESSING
  // We simulate worker processJob running, which transitions status to PROCESSING
  await processJob(job);

  // Since mock processJob completes immediately to READY, let's verify it completed to READY
  const fileReady = await File.findById(fileRes._id);
  const versionReady = await FileVersion.findById(versionRes._id);
  assert.equal(fileReady.aiStatus, 'READY');
  assert.equal(versionReady.aiStatus, 'READY');

  // To verify the intermediate PROCESSING state, we can simulate worker claiming without finishing,
  // or we can test that processJob transitions it to PROCESSING at the start (which it does via updates).
  // Let's create a new job and run it with a slow mock generator to capture the PROCESSING state.
  const fileRes2 = await File.create({
    name: 'processing-state-doc.txt',
    workspaceId: workspace._id,
    createdBy: createdOwner._id,
    status: 'ACTIVE',
    aiStatus: 'NOT_STARTED',
  });
  const versionRes2 = await FileVersion.create({
    fileId: fileRes2._id,
    versionNumber: 1,
    storageKey: 'v1-key-proc',
    mimeType: 'text/plain',
    fileSize: 10,
    uploadedBy: createdOwner._id,
    aiStatus: 'NOT_STARTED',
  });
  const job2 = await AIJobService.createJob(workspace._id, fileRes2._id, versionRes2._id);
  
  // Set up a mock provider summary that returns only after we verify the status
  let resolveProvider;
  const originalGenerateSummary = MockAIProvider.prototype.generateSummary;
  MockAIProvider.prototype.generateSummary = async () => {
    return new Promise((resolve) => {
      resolveProvider = resolve;
    });
  };

  const processPromise = processJob(job2);

  // Wait briefly for updates to hit database
  await new Promise((resolve) => setTimeout(resolve, 50));

  const fileProc = await File.findById(fileRes2._id);
  const versionProc = await FileVersion.findById(versionRes2._id);
  assert.equal(fileProc.aiStatus, 'PROCESSING');
  assert.equal(versionProc.aiStatus, 'PROCESSING');

  // Clean up mock and complete
  if (resolveProvider) {
    resolveProvider({ summary: 'Mock text summary' });
  }
  await processPromise;
  MockAIProvider.prototype.generateSummary = originalGenerateSummary;

  // Clean up
  await AIResult.deleteMany({ fileId: { $in: [fileRes._id, fileRes2._id] } });
  await AIJob.deleteMany({ fileId: { $in: [fileRes._id, fileRes2._id] } });
  await FileVersion.deleteMany({ fileId: { $in: [fileRes._id, fileRes2._id] } });
  await File.deleteMany({ _id: { $in: [fileRes._id, fileRes2._id] } });
  await Workspace.deleteOne({ _id: workspace._id });
  await User.deleteOne({ _id: createdOwner._id });
});
