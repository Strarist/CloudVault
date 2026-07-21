const { test, before, after } = require('node:test');
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
const { FileVersion } = require('../dist/models/fileVersion.model.js');
const { ActivityLog } = require('../dist/models/activityLog.model.js');

const envPath = path.join(__dirname, '..', '.env');
const envText = fs.readFileSync(envPath, 'utf8').replace(/^(\s*[A-Z0-9_]+)\s+=/gm, '$1=');
const env = dotenv.parse(envText);

const PORT = 3003;
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

async function cleanupWorkspaceArtifacts(workspaceIds, userIds) {
  if (workspaceIds.length > 0) {
    await ActivityLog.deleteMany({ workspaceId: { $in: workspaceIds } });
    const fileDocs = await File.find({ workspaceId: { $in: workspaceIds } }).select('_id');
    const fileIds = fileDocs.map((fileDoc) => fileDoc._id);
    if (fileIds.length > 0) {
      await FileVersion.deleteMany({ fileId: { $in: fileIds } });
    }
    await File.deleteMany({ workspaceId: { $in: workspaceIds } });
    await WorkspaceMember.deleteMany({ workspaceId: { $in: workspaceIds } });
    await Workspace.deleteMany({ _id: { $in: workspaceIds } });
  }

  if (userIds.length > 0) {
    await User.deleteMany({ _id: { $in: userIds } });
  }
}

before(async () => {
  await mongoose.connect(env.MONGO_URI);
  // Use mock storage when Supabase is unreachable so file upload/delete tests stay deterministic
  serverProcess = spawn(process.execPath, ['dist/app.js'], {
    cwd: path.join(__dirname, '..'),
    stdio: 'ignore',
    env: {
      ...process.env,
      PORT: PORT.toString(),
      SUPABASE_URL: '',
      SUPABASE_SERVICE_ROLE_KEY: '',
    },
  });
  await waitForServer();
});

after(async () => {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill('SIGTERM');
  }
  await mongoose.disconnect();
});

test('BUG-001 – logout correctly clears auth state and cookie', async () => {
  const suffix = Date.now();
  const user = {
    email: `logout-edge-${suffix}@cloudvault.com`,
    username: `logouedge${suffix}`,
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
      body: JSON.stringify(user),
    });
    assert.equal(response.status, 201);
    const createdUser = await response.json();
    cleanupUserIds.push(new mongoose.Types.ObjectId(createdUser._id));

    const personalWorkspace = await Workspace.findOne({ ownerId: createdUser._id }).select('_id');
    assert.ok(personalWorkspace);
    cleanupWorkspaceIds.push(personalWorkspace._id);

    // Login
    response = await request(session, '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user.email, password: user.password }),
    });
    assert.equal(response.status, 200);
    assert.match(session.cookie, /^token=/);

    // Logout
    response = await request(session, '/auth/logout', { method: 'POST' });
    assert.equal(response.status, 200);
    
    // Verify cookie is cleared
    const setCookie = response.headers.get('set-cookie') || '';
    assert.match(setCookie, /token=;/);

    // Verify /auth/me now returns 401 (and does not hang or loop)
    response = await request(session, '/auth/me', { method: 'GET' });
    assert.equal(response.status, 401, 'After logout, /auth/me should return 401, not retry indefinitely');
  } finally {
    await cleanupWorkspaceArtifacts(cleanupWorkspaceIds, cleanupUserIds);
  }
});

test('BUG-002 – file delete removes metadata, versions, activity, and clears UI state', async () => {
  const suffix = Date.now();
  const owner = {
    email: `deleter2-${suffix}@cloudvault.com`,
    username: `deleter2${suffix}`,
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
    cleanupWorkspaceIds.push((await Workspace.findOne({ ownerId: createdUser._id }).select('_id'))._id);

    // Login
    response = await request(session, '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: owner.email, password: owner.password }),
    });
    assert.equal(response.status, 200);

    // Create workspace
    response = await request(session, '/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `Delete ${suffix}`, description: 'delete-edge-test' }),
    });
    assert.equal(response.status, 201);
    const workspacePayload = await response.json();
    const workspaceId = workspacePayload.workspace._id;
    cleanupWorkspaceIds.push(new mongoose.Types.ObjectId(workspaceId));

    // Upload file
    const form = new FormData();
    form.append('file', new Blob(['delete-edge-test-content'], { type: 'text/plain' }), 'delete-edge.txt');
    response = await request(session, `/workspaces/${workspaceId}/files/upload`, {
      method: 'POST',
      body: form,
    });
    assert.equal(response.status, 201);
    const filePayload = await response.json();
    const fileId = filePayload._id;

    // Verify file exists
    let fileDoc = await File.findById(fileId);
    assert.ok(fileDoc);
    assert.equal(fileDoc.status, 'ACTIVE');

    // Delete file
    response = await request(session, `/workspaces/${workspaceId}/files/${fileId}`, {
      method: 'DELETE',
    });
    assert.equal(response.status, 200, 'File delete should succeed');

    // Verify file is marked deleted
    fileDoc = await File.findById(fileId);
    assert.ok(fileDoc);
    assert.equal(fileDoc.status, 'DELETED');
    assert.ok(fileDoc.deletedAt, 'File should have deletedAt timestamp');

    // Verify file versions are cleaned up
    const versions = await FileVersion.find({ fileId });
    assert.equal(versions.length, 0, 'All file versions should be deleted after file deletion');

    // Verify activity is logged
    const activity = await ActivityLog.findOne({
      workspaceId,
      action: 'FILE_DELETED',
      'metadata.fileId': fileId,
    });
    assert.ok(activity, 'File deletion should be logged in activity');

    // Verify list endpoint no longer shows deleted file
    response = await request(session, `/workspaces/${workspaceId}/files`, { method: 'GET' });
    assert.equal(response.status, 200);
    const filesPayload = await response.json();
    assert.equal(filesPayload.total, 0, 'Deleted files should not appear in file list');
  } finally {
    await cleanupWorkspaceArtifacts(cleanupWorkspaceIds, cleanupUserIds);
  }
});

test('BUG-003 – workspace invitation creates membership, logs activity, and allows immediate role changes', async () => {
  const suffix = Date.now();
  const owner = {
    email: `owner3-${suffix}@cloudvault.com`,
    username: `owner3${suffix}`,
    password: 'Password1',
  };
  const member = {
    email: `member3-${suffix}@cloudvault.com`,
    username: `member3${suffix}`,
    password: 'Password1',
  };
  const ownerSession = makeSession();
  const memberSession = makeSession();
  const cleanupUserIds = [];
  const cleanupWorkspaceIds = [];

  try {
    // Register both users
    let response = await request(ownerSession, '/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(owner),
    });
    assert.equal(response.status, 201);
    const ownerUser = await response.json();
    cleanupUserIds.push(new mongoose.Types.ObjectId(ownerUser._id));
    cleanupWorkspaceIds.push((await Workspace.findOne({ ownerId: ownerUser._id }).select('_id'))._id);

    response = await request(memberSession, '/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(member),
    });
    assert.equal(response.status, 201);
    const memberUser = await response.json();
    cleanupUserIds.push(new mongoose.Types.ObjectId(memberUser._id));
    cleanupWorkspaceIds.push((await Workspace.findOne({ ownerId: memberUser._id }).select('_id'))._id);

    // Owner logs in
    response = await request(ownerSession, '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: owner.email, password: owner.password }),
    });
    assert.equal(response.status, 200);

    // Create team workspace
    response = await request(ownerSession, '/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `Team ${suffix}`, description: 'invite-edge-test' }),
    });
    assert.equal(response.status, 201);
    const workspacePayload = await response.json();
    const workspaceId = workspacePayload.workspace._id;
    cleanupWorkspaceIds.push(new mongoose.Types.ObjectId(workspaceId));

    // Invite member
    response = await request(ownerSession, `/workspaces/${workspaceId}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: member.email, role: 'VIEWER' }),
    });
    assert.equal(response.status, 201, 'Invite should succeed');
    const invitePayload = await response.json();
    assert.equal(invitePayload.userId.email, member.email);

    // Verify membership was created
    const membership = await WorkspaceMember.findOne({
      workspaceId,
      userId: memberUser._id,
    });
    assert.ok(membership, 'Membership should be created');
    assert.equal(membership.role, 'VIEWER');

    // Verify activity was logged
    const activity = await ActivityLog.findOne({
      workspaceId,
      action: 'WORKSPACE_MEMBER_ADDED',
      'metadata.userId': memberUser._id.toString(),
    });
    assert.ok(activity, 'Invite should be logged in activity');

    // Test role change after invite
    response = await request(ownerSession, `/workspaces/${workspaceId}/members/${memberUser._id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'EDITOR' }),
    });
    assert.equal(response.status, 200, 'Role change should succeed after invite');
    const updatedMembership = await response.json();
    assert.equal(updatedMembership.role, 'EDITOR');

    // Verify role change in DB
    const updatedMem = await WorkspaceMember.findOne({
      workspaceId,
      userId: memberUser._id,
    });
    assert.equal(updatedMem.role, 'EDITOR');

    // Verify role change activity logged
    const roleChangeActivity = await ActivityLog.findOne({
      workspaceId,
      action: 'WORKSPACE_ROLE_CHANGED',
      'metadata.userId': memberUser._id.toString(),
    });
    assert.ok(roleChangeActivity, 'Role change should be logged');

    // Members payload must include username for @-mention autocomplete
    response = await request(ownerSession, `/workspaces/${workspaceId}`, { method: 'GET' });
    assert.equal(response.status, 200);
    const detailPayload = await response.json();
    const memberRow = detailPayload.members.find(
      (m) => m.userId._id === memberUser._id || m.userId._id?.toString?.() === memberUser._id.toString(),
    );
    assert.ok(memberRow, 'Invited member should appear in members list');
    assert.ok(memberRow.userId.username, 'Member userId.username required for mention suggestions');
    assert.equal(memberRow.userId.username, member.username.toLowerCase());
  } finally {
    await cleanupWorkspaceArtifacts(cleanupWorkspaceIds, cleanupUserIds);
  }
});

test('auth session switch: login A then logout then login B yields B on /auth/me', async () => {
  const suffix = Date.now();
  const userA = {
    email: `owner-switch-${suffix}@cloudvault.com`,
    username: `ownerswitch${suffix}`,
    password: 'Password1',
  };
  const userB = {
    email: `invitee-switch-${suffix}@cloudvault.com`,
    username: `inviteesw${suffix}`,
    password: 'Password1',
  };
  const session = makeSession();
  const cleanupUserIds = [];
  const cleanupWorkspaceIds = [];

  try {
    let response = await request(session, '/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(userA),
    });
    assert.equal(response.status, 201);
    const createdA = await response.json();
    cleanupUserIds.push(new mongoose.Types.ObjectId(createdA._id));
    cleanupWorkspaceIds.push((await Workspace.findOne({ ownerId: createdA._id }).select('_id'))._id);

    response = await request(session, '/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(userB),
    });
    assert.equal(response.status, 201);
    const createdB = await response.json();
    cleanupUserIds.push(new mongoose.Types.ObjectId(createdB._id));
    cleanupWorkspaceIds.push((await Workspace.findOne({ ownerId: createdB._id }).select('_id'))._id);

    response = await request(session, '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: userA.email, password: userA.password }),
    });
    assert.equal(response.status, 200);

    response = await request(session, '/auth/me', { method: 'GET' });
    assert.equal(response.status, 200);
    let me = await response.json();
    assert.equal(me.email, userA.email.toLowerCase());
    assert.equal(me.username, userA.username.toLowerCase());

    response = await request(session, '/auth/logout', { method: 'POST' });
    assert.equal(response.status, 200);

    // Login B by canonical username (not email)
    response = await request(session, '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: userB.username, password: userB.password }),
    });
    assert.equal(response.status, 200);
    const loginB = await response.json();
    assert.equal(loginB.user.email, userB.email.toLowerCase());
    assert.equal(loginB.user.username, userB.username.toLowerCase());

    response = await request(session, '/auth/me', { method: 'GET' });
    assert.equal(response.status, 200);
    me = await response.json();
    assert.equal(me.email, userB.email.toLowerCase(), 'After switch, /auth/me must be user B');
    assert.notEqual(me.email, userA.email.toLowerCase());
  } finally {
    await cleanupWorkspaceArtifacts(cleanupWorkspaceIds, cleanupUserIds);
  }
});
