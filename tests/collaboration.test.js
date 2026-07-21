const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

const { User } = require('../dist/models/user.model.js');
const { Workspace } = require('../dist/models/workspace.model.js');
const { WorkspaceMember } = require('../dist/models/workspaceMember.model.js');
const { File } = require('../dist/models/file.model.js');
const { Comment } = require('../dist/models/comment.model.js');
const { Notification } = require('../dist/models/notification.model.js');
const { ActivityLog } = require('../dist/models/activityLog.model.js');
const { ActivityAction } = require('../dist/models/types.js');

const envPath = path.join(__dirname, '..', '.env');
const envText = fs.readFileSync(envPath, 'utf8').replace(/^(\s*[A-Z0-9_]+)\s+=/gm, '$1=');
const env = dotenv.parse(envText);

const PORT = 3017;
const API = `http://127.0.0.1:${PORT}`;
let serverProcess;

function makeSession() {
  return { cookie: '' };
}

async function request(session, pathname, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('Content-Type', 'application/json');
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

async function assertStatus(res, expectedStatus, message) {
  if (res.status !== expectedStatus) {
    const text = await res.text();
    assert.fail(`${message}: expected ${expectedStatus}, got ${res.status}. Response: ${text}`);
  }
}

async function waitForServer() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`${API}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Server not yet ready
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Server failed to start');
}

async function startServer() {
  const testEnv = {
    ...process.env,
    PORT: PORT.toString(),
    MONGO_URI: env.MONGO_URI || process.env.MONGO_URI,
    JWT_SECRET: env.JWT_SECRET || process.env.JWT_SECRET,
    NODE_ENV: 'test',
  };
  delete testEnv.SUPABASE_URL;
  delete testEnv.SUPABASE_SERVICE_ROLE_KEY;
  testEnv.SUPABASE_URL = '';
  testEnv.SUPABASE_SERVICE_ROLE_KEY = '';

  return new Promise((resolve, reject) => {
    serverProcess = spawn(process.execPath, ['dist/app.js'], {
      cwd: path.join(__dirname, '..'),
      stdio: 'ignore',
      env: testEnv,
    });

    serverProcess.on('error', reject);
    waitForServer().then(resolve).catch(reject);
  });
}

function stopServer() {
  return new Promise((resolve) => {
    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill('SIGTERM');
    }
    setTimeout(resolve, 500);
  });
}

// Main test suite
test('PHASE 7 – COLLABORATION LAYER – Comments, Mentions, Notifications', async (suite) => {
  let user1Session;
  let user2Session;
  let workspaceId;
  let fileId;

  suite.before(async () => {
    // Connect to MongoDB
    await mongoose.connect(env.MONGO_URI || env.MONGODB_URI || 'mongodb://127.0.0.1:27017/cloudvault', {
      serverSelectionTimeoutMS: 5000,
    });

    // Clear collections
    const collections = ['users', 'workspaces', 'workspacemembers', 'files', 'comments', 'notifications', 'activitylogs'];
    for (const coll of collections) {
      try {
        await mongoose.connection.collection(coll).deleteMany({});
      } catch {
        // Collection might not exist
      }
    }

    // Start server
    await startServer();

    // Create test users
    user1Session = makeSession();
    user2Session = makeSession();

    // Register user1
    let res = await request(user1Session, '/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email: 'user1@test.com',
        username: 'user1',
        password: 'TestPass123',
      }),
    });
    await assertStatus(res, 201, 'Failed to register user1');

    // Register user2
    res = await request(user2Session, '/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email: 'user2@test.com',
        username: 'user2',
        password: 'TestPass123',
      }),
    });
    await assertStatus(res, 201, 'Failed to register user2');

    // Login user1
    res = await request(user1Session, '/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        username: 'user1',
        password: 'TestPass123',
      }),
    });
    await assertStatus(res, 200, 'Failed to login user1');

    // Login user2
    res = await request(user2Session, '/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        username: 'user2',
        password: 'TestPass123',
      }),
    });
    await assertStatus(res, 200, 'Failed to login user2');

    // Get user1's workspace list to find workspace ID
    res = await request(user1Session, '/workspaces');
    assert.strictEqual(res.status, 200);
    const workspaces = await res.json();
    workspaceId = workspaces[0].workspaceId._id;

    // Upload a test file
    const formData = new FormData();
    formData.append('file', new Blob(['test content'], { type: 'text/plain' }), 'test.txt');

    res = await fetch(`${API}/workspaces/${workspaceId}/files/upload`, {
      method: 'POST',
      body: formData,
      headers: {
        'Cookie': user1Session.cookie,
      },
    });

    await assertStatus(res, 201, 'Failed to upload file');
    const file = await res.json();
    fileId = file._id;
  });

  suite.after(async () => {
    await stopServer();
    await mongoose.disconnect();
  });

  // =============================================================================
  // COMMENT TESTS
  // =============================================================================

  await suite.test('COMMENTS – Create comment on file', async () => {
    const res = await request(user1Session, `/workspaces/${workspaceId}/files/${fileId}/comments`, {
      method: 'POST',
      body: JSON.stringify({
        content: 'This is a test comment',
      }),
    });

    await assertStatus(res, 201, 'Failed to create comment');
    const comment = await res.json();
    assert(comment._id, 'Comment should have _id');
    assert.strictEqual(comment.content, 'This is a test comment');
  });

  await suite.test('COMMENTS – List comments with pagination', async () => {
    // List comments
    const res = await request(user1Session, `/workspaces/${workspaceId}/files/${fileId}/comments?page=1&limit=10`);

    await assertStatus(res, 200, 'Failed to list comments');
    const data = await res.json();
    assert(Array.isArray(data.comments), 'Should return comments array');
    assert(data.pagination, 'Should include pagination');
  });

  await suite.test('COMMENTS – Pagination limits max to 100 per request', async () => {
    const res = await request(user1Session, `/workspaces/${workspaceId}/files/${fileId}/comments?page=1&limit=200`);

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert(data.pagination.limit <= 100, 'Limit should be capped at 100');
  });

  await suite.test('COMMENTS – Newest comments first', async () => {
    // Create new comment
    let res = await request(user1Session, `/workspaces/${workspaceId}/files/${fileId}/comments`, {
      method: 'POST',
      body: JSON.stringify({
        content: 'Latest comment',
      }),
    });
    assert.strictEqual(res.status, 201);

    // List comments
    res = await request(user1Session, `/workspaces/${workspaceId}/files/${fileId}/comments?page=1&limit=10`);
    const data = await res.json();
    
    // First comment should be "Latest comment"
    assert(data.comments.length > 0, 'Should have comments');
    assert.strictEqual(data.comments[0].content, 'Latest comment', 'Newest comment should be first');
  });

  // =============================================================================
  // MENTION TESTS
  // =============================================================================

  await suite.test('MENTIONS – Extract @username mentions from comment', async () => {
    const res = await request(user1Session, `/workspaces/${workspaceId}/files/${fileId}/comments`, {
      method: 'POST',
      body: JSON.stringify({
        content: '@user2 please review this',
      }),
    });

    assert.strictEqual(res.status, 201);
    const comment = await res.json();
    assert(Array.isArray(comment.mentions), 'Should have mentions array');
  });

  await suite.test('MENTIONS – Handle unknown mention gracefully', async () => {
    const res = await request(user1Session, `/workspaces/${workspaceId}/files/${fileId}/comments`, {
      method: 'POST',
      body: JSON.stringify({
        content: '@unknownuser123 please check',
      }),
    });

    // Should still create comment even if user not found
    assert.strictEqual(res.status, 201, 'Should create comment even with unknown mention');
  });

  await suite.test('MENTIONS – Handle case-insensitive @username mentions', async () => {
    const res = await request(user1Session, `/workspaces/${workspaceId}/files/${fileId}/comments`, {
      method: 'POST',
      body: JSON.stringify({
        content: '@User2 please review this',
      }),
    });

    assert.strictEqual(res.status, 201);
    const comment = await res.json();
    assert(Array.isArray(comment.mentions) && comment.mentions.length > 0, 'Should resolve mention');
    assert.strictEqual(comment.mentions[0].username, 'user2');
  });

  // =============================================================================
  // NOTIFICATION TESTS
  // =============================================================================

  await suite.test('NOTIFICATIONS – Get unread count', async () => {
    const res = await request(user1Session, '/notifications/unread-count');

    await assertStatus(res, 200, 'Failed to get unread count');
    const data = await res.json();
    assert(typeof data.unreadCount === 'number', 'Should return unread count');
  });

  await suite.test('NOTIFICATIONS – List notifications with pagination', async () => {
    const res = await request(user1Session, '/notifications?page=1&limit=20');

    await assertStatus(res, 200, 'Failed to list notifications');
    const data = await res.json();
    assert(Array.isArray(data.notifications), 'Should return notifications array');
    assert(data.pagination, 'Should include pagination');
    assert(typeof data.unreadCount === 'number', 'Should include unread count');
  });

  await suite.test('NOTIFICATIONS – Pagination limited to 100 max', async () => {
    const res = await request(user1Session, '/notifications?page=1&limit=500');

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert(data.pagination.limit <= 100, 'Should cap limit at 100');
  });

  // =============================================================================
  // AUTHORIZATION & SECURITY TESTS
  // =============================================================================

  await suite.test('AUTHORIZATION – Only workspace members can comment', async () => {
    // Create new user not in workspace
    const newUserSession = makeSession();
    let res = await request(newUserSession, '/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email: 'user3@test.com',
        username: 'user3',
        password: 'TestPass123',
      }),
    });
    assert.strictEqual(res.status, 201);

    res = await request(newUserSession, '/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        username: 'user3',
        password: 'TestPass123',
      }),
    });
    assert.strictEqual(res.status, 200);

    // Try to comment
    res = await request(newUserSession, `/workspaces/${workspaceId}/files/${fileId}/comments`, {
      method: 'POST',
      body: JSON.stringify({
        content: 'Unauthorized comment',
      }),
    });

    assert.strictEqual(res.status, 403, 'Should deny comment from non-member');
  });

  // =============================================================================
  // ACTIVITY INTEGRATION TESTS
  // =============================================================================

  await suite.test('ACTIVITY – Comment creation logged', async () => {
    // Create comment
    let res = await request(user1Session, `/workspaces/${workspaceId}/files/${fileId}/comments`, {
      method: 'POST',
      body: JSON.stringify({
        content: 'Activity test comment',
      }),
    });
    assert.strictEqual(res.status, 201);

    // Check activity log
    res = await request(user1Session, `/workspaces/${workspaceId}/activity`);
    assert.strictEqual(res.status, 200);
    const activities = await res.json();
    
    const commentActivity = activities.items.find(
      (a) => a.action === ActivityAction.COMMENT_CREATED
    );
    assert(commentActivity, 'Should log COMMENT_CREATED activity');
  });
});
