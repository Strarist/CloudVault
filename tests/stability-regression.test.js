const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

const { User } = require('../dist/models/user.model.js');
const { Workspace } = require('../dist/models/workspace.model.js');
const { WorkspaceMember } = require('../dist/models/workspaceMember.model.js');
const { File } = require('../dist/models/file.model.js');
const { FileVersion } = require('../dist/models/fileVersion.model.js');
const { ActivityLog } = require('../dist/models/activityLog.model.js');

const envPath = path.join(__dirname, '..', '.env');
const envText = fs.readFileSync(envPath, 'utf8').replace(/^(\s*[A-Z0-9_]+)\s+=/gm, '$1=');
const env = dotenv.parse(envText);

const PORT = 3002;
const API = `http://127.0.0.1:${PORT}`;
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

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

async function canReachSupabaseStorage() {
  try {
    const { error } = await supabase.storage.from(env.SUPABASE_BUCKET).list('', { limit: 1 });
    return !error || !/fetch failed/i.test(error.message);
  } catch (error) {
    return !(error instanceof Error) || !/fetch failed/i.test(error.message);
  }
}

before(async () => {
  await mongoose.connect(env.MONGO_URI);
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

test('logout clears the auth cookie on the backend route', async () => {
  const suffix = Date.now();
  const user = {
    email: `logout-${suffix}@cloudvault.com`,
    username: `logout${suffix}`,
    password: 'Password1',
  };
  const session = makeSession();
  const cleanupUserIds = [];
  const cleanupWorkspaceIds = [];

  try {
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

    response = await request(session, '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user.email, password: user.password }),
    });
    assert.equal(response.status, 200);
    assert.match(session.cookie, /^token=/);

    response = await request(session, '/auth/logout', { method: 'POST' });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('set-cookie') || '', /token=;/);
  } finally {
    await cleanupWorkspaceArtifacts(cleanupWorkspaceIds, cleanupUserIds);
  }
});

test('workspace invitation succeeds for a registered user and logs activity', async () => {
  const suffix = Date.now();
  const owner = {
    email: `owner-${suffix}@cloudvault.com`,
    username: `owner${suffix}`,
    password: 'Password1',
  };
  const member = {
    email: `member-${suffix}@cloudvault.com`,
    username: `member${suffix}`,
    password: 'Password1',
  };
  const ownerSession = makeSession();
  const memberSession = makeSession();
  const cleanupUserIds = [];
  const cleanupWorkspaceIds = [];

  try {
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

    response = await request(ownerSession, '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: owner.email, password: owner.password }),
    });
    assert.equal(response.status, 200);

    response = await request(ownerSession, '/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `Team ${suffix}`, description: 'invite-regression' }),
    });
    assert.equal(response.status, 201);
    const workspacePayload = await response.json();
    const workspaceId = workspacePayload.workspace._id;
    cleanupWorkspaceIds.push(new mongoose.Types.ObjectId(workspaceId));

    response = await request(ownerSession, `/workspaces/${workspaceId}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: member.email, role: 'VIEWER' }),
    });
    assert.equal(response.status, 201);
    const invitePayload = await response.json();
    assert.equal(invitePayload.userId.email, member.email);

    const membership = await WorkspaceMember.findOne({
      workspaceId,
      userId: memberUser._id,
    });
    assert.ok(membership);

    const activity = await ActivityLog.findOne({
      workspaceId,
      action: 'WORKSPACE_MEMBER_ADDED',
      'metadata.userId': memberUser._id.toString(),
    });
    assert.ok(activity);
  } finally {
    await cleanupWorkspaceArtifacts(cleanupWorkspaceIds, cleanupUserIds);
  }
});

test('file deletion removes Mongo metadata, file versions, activity entry, and Supabase object', async (t) => {
  if (!(await canReachSupabaseStorage())) {
    t.skip('Supabase storage is unreachable from the current sandbox.');
    return;
  }

  const suffix = Date.now();
  const owner = {
    email: `deleter-${suffix}@cloudvault.com`,
    username: `deleter${suffix}`,
    password: 'Password1',
  };
  const session = makeSession();
  const cleanupUserIds = [];
  const cleanupWorkspaceIds = [];

  try {
    let response = await request(session, '/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(owner),
    });
    assert.equal(response.status, 201);
    const createdUser = await response.json();
    cleanupUserIds.push(new mongoose.Types.ObjectId(createdUser._id));
    cleanupWorkspaceIds.push((await Workspace.findOne({ ownerId: createdUser._id }).select('_id'))._id);

    response = await request(session, '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: owner.email, password: owner.password }),
    });
    assert.equal(response.status, 200);

    response = await request(session, '/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `Delete ${suffix}`, description: 'delete-regression' }),
    });
    assert.equal(response.status, 201);
    const workspacePayload = await response.json();
    const workspaceId = workspacePayload.workspace._id;
    cleanupWorkspaceIds.push(new mongoose.Types.ObjectId(workspaceId));

    const form = new FormData();
    form.append('file', new Blob(['delete me'], { type: 'text/plain' }), 'delete-me.txt');
    response = await request(session, `/workspaces/${workspaceId}/files/upload`, {
      method: 'POST',
      body: form,
    });
    assert.equal(response.status, 201);
    const filePayload = await response.json();
    const fileId = filePayload._id;
    const storageKey = filePayload.currentVersionId.storageKey;

    response = await request(session, `/workspaces/${workspaceId}/files/${fileId}`, {
      method: 'DELETE',
    });
    assert.equal(response.status, 200);

    const deletedFile = await File.findById(fileId);
    assert.ok(deletedFile);
    assert.equal(deletedFile.status, 'DELETED');
    assert.ok(deletedFile.deletedAt);

    const versions = await FileVersion.find({ fileId });
    assert.equal(versions.length, 0);

    const activity = await ActivityLog.findOne({
      workspaceId,
      action: 'FILE_DELETED',
      'metadata.fileId': fileId,
    });
    assert.ok(activity);

    response = await request(session, `/workspaces/${workspaceId}/files`, { method: 'GET' });
    assert.equal(response.status, 200);
    const filesPayload = await response.json();
    assert.equal(filesPayload.total, 0);

    const { data, error } = await supabase.storage.from(env.SUPABASE_BUCKET).download(storageKey);
    assert.equal(data, null);
    assert.ok(error);
    assert.match(error.message, /Object not found/i);
  } finally {
    await cleanupWorkspaceArtifacts(cleanupWorkspaceIds, cleanupUserIds);
  }
});
