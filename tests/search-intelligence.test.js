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
const { FileVersion } = require('../dist/models/fileVersion.model.js');
const { AIResult } = require('../dist/models/aiResult.model.js');

const envPath = path.join(__dirname, '..', '.env');
const envText = fs.readFileSync(envPath, 'utf8').replace(/^(\s*[A-Z0-9_]+)\s+=/gm, '$1=');
const env = dotenv.parse(envText);

const PORT = 3006;
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
  return new Promise((resolve, reject) => {
    serverProcess = spawn('npm', ['run', 'start'], {
      stdio: 'ignore',
      timeout: 10000,
      shell: true,
      env: { ...process.env, PORT: PORT.toString() }
    });

    setTimeout(() => {
      waitForServer().then(resolve).catch(reject);
    }, 1000);
  });
}

function stopServer() {
  return new Promise((resolve) => {
    if (serverProcess) {
      serverProcess.kill();
    }
    setTimeout(resolve, 500);
  });
}

test('PHASE 10 & 10.5 – KEYWORD SEARCH & WORKSPACE INTELLIGENCE', async (suite) => {
  let user1Session;
  let user2Session;
  let workspace1Id;
  let workspace2Id;

  suite.before(async () => {
    // Connect to MongoDB
    await mongoose.connect(env.MONGODB_URI || 'mongodb://0.0.0.0/cloudVault-drive', {
      serverSelectionTimeoutMS: 5000,
    });

    // Clear collections
    const collections = ['users', 'workspaces', 'workspacemembers', 'files', 'fileversions', 'airesults'];
    for (const coll of collections) {
      try {
        await mongoose.connection.collection(coll).deleteMany({});
      } catch {
        // Collection might not exist
      }
    }

    // Start server
    await startServer();

    // Create sessions
    user1Session = makeSession();
    user2Session = makeSession();

    // Register & Login User 1
    let res = await request(user1Session, '/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email: 'user11@test.com',
        username: 'user11',
        password: 'Password123',
      }),
    });
    await assertStatus(res, 201, 'Register user11');

    res = await request(user1Session, '/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        username: 'user11',
        password: 'Password123',
      }),
    });
    await assertStatus(res, 200, 'Login user11');

    // Register & Login User 2
    res = await request(user2Session, '/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email: 'user22@test.com',
        username: 'user22',
        password: 'Password123',
      }),
    });
    await assertStatus(res, 201, 'Register user22');

    res = await request(user2Session, '/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        username: 'user22',
        password: 'Password123',
      }),
    });
    await assertStatus(res, 200, 'Login user22');

    // Get Workspace IDs (automatically created for personal workspaces)
    res = await request(user1Session, '/workspaces');
    assert.strictEqual(res.status, 200);
    let workspaces = await res.json();
    workspace1Id = workspaces[0].workspaceId._id;

    res = await request(user2Session, '/workspaces');
    assert.strictEqual(res.status, 200);
    workspaces = await res.json();
    workspace2Id = workspaces[0].workspaceId._id;
  });

  suite.after(async () => {
    await stopServer();
    await mongoose.disconnect();
  });

  // =============================================================================
  // KEYWORD SEARCH TESTS
  // =============================================================================

  await suite.test('SEARCH – Param validation constraints', async () => {
    // 1. Query too short
    let res = await request(user1Session, `/workspaces/${workspace1Id}/search?q=a`);
    assert.strictEqual(res.status, 400, 'Should reject query shorter than 2 chars');

    // 2. Invalid limit
    res = await request(user1Session, `/workspaces/${workspace1Id}/search?q=test&limit=100`);
    assert.strictEqual(res.status, 400, 'Should reject limit > 50');

    // 3. Negative page
    res = await request(user1Session, `/workspaces/${workspace1Id}/search?q=test&page=0`);
    assert.strictEqual(res.status, 400, 'Should reject page < 1');
  });

  await suite.test('SEARCH – Workspace boundaries (RBAC)', async () => {
    // User 2 tries to search in User 1's workspace
    const res = await request(user2Session, `/workspaces/${workspace1Id}/search?q=test`);
    assert.strictEqual(res.status, 403, 'User 2 should not have access to User 1 workspace');
  });

  await suite.test('SEARCH – Scoring & sorting hierarchy', async () => {
    // We will inject files directly into DB to control matching, timestamps, and AI results.
    // File A: Matched on Filename only ("Finance Report 2026.pdf")
    // File B: Matched on Tag only ("Marketing Strategy", Tag: "finance")
    // File C: Matched on Summary only ("Annual targets", AI Summary: "finance review")
    // File D: Matched on both Filename and Tag ("Finance Q1", Tag: "finance")
    // File E: Deleted file (should be excluded)

    const u1 = await User.findOne({ username: 'user11' });
    
    // File A
    const fileA = await File.create({
      name: 'Finance Report 2026.pdf',
      workspaceId: new mongoose.Types.ObjectId(workspace1Id),
      createdBy: u1._id,
      status: 'ACTIVE',
      aiStatus: 'NOT_STARTED',
      tags: [],
    });
    const verA = await FileVersion.create({
      fileId: fileA._id,
      versionNumber: 1,
      storageKey: 'verA',
      mimeType: 'application/pdf',
      fileSize: 1000,
      uploadedBy: u1._id,
    });
    fileA.currentVersionId = verA._id;
    await fileA.save();

    // File B
    const fileB = await File.create({
      name: 'Marketing Strategy.docx',
      workspaceId: new mongoose.Types.ObjectId(workspace1Id),
      createdBy: u1._id,
      status: 'ACTIVE',
      aiStatus: 'NOT_STARTED',
      tags: ['finance'],
    });
    const verB = await FileVersion.create({
      fileId: fileB._id,
      versionNumber: 1,
      storageKey: 'verB',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      fileSize: 2000,
      uploadedBy: u1._id,
    });
    fileB.currentVersionId = verB._id;
    await fileB.save();

    // File C
    const fileC = await File.create({
      name: 'Annual targets.txt',
      workspaceId: new mongoose.Types.ObjectId(workspace1Id),
      createdBy: u1._id,
      status: 'ACTIVE',
      aiStatus: 'READY',
      tags: [],
    });
    const verC = await FileVersion.create({
      fileId: fileC._id,
      versionNumber: 1,
      storageKey: 'verC',
      mimeType: 'text/plain',
      fileSize: 500,
      uploadedBy: u1._id,
    });
    fileC.currentVersionId = verC._id;
    await fileC.save();
    await AIResult.create({
      workspaceId: new mongoose.Types.ObjectId(workspace1Id),
      fileId: fileC._id,
      fileVersionId: verC._id,
      summary: 'Detailed finance review for the year.',
      tags: [],
      embedding: [0.1, 0.2, 0.3],
      embeddingModel: 'text-embedding-ada-002',
      embeddingDimensions: 3,
      embeddingVersion: 1,
      modelProvider: 'openai',
      modelName: 'gpt-4',
      modelVersion: '1.0',
    });

    // File D
    const fileD = await File.create({
      name: 'Finance Q1.xlsx',
      workspaceId: new mongoose.Types.ObjectId(workspace1Id),
      createdBy: u1._id,
      status: 'ACTIVE',
      aiStatus: 'READY',
      tags: ['finance'],
    });
    const verD = await FileVersion.create({
      fileId: fileD._id,
      versionNumber: 1,
      storageKey: 'verD',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fileSize: 1500,
      uploadedBy: u1._id,
    });
    fileD.currentVersionId = verD._id;
    await fileD.save();

    await AIResult.create({
      workspaceId: new mongoose.Types.ObjectId(workspace1Id),
      fileId: fileD._id,
      fileVersionId: verD._id,
      summary: 'Q1 overview.',
      tags: ['finance'],
      embedding: [0.1, 0.2, 0.3],
      embeddingModel: 'text-embedding-ada-002',
      embeddingDimensions: 3,
      embeddingVersion: 1,
      modelProvider: 'openai',
      modelName: 'gpt-4',
      modelVersion: '1.0',
    });

    // File E (Deleted)
    const fileE = await File.create({
      name: 'Old Finance Data.xlsx',
      workspaceId: new mongoose.Types.ObjectId(workspace1Id),
      createdBy: u1._id,
      status: 'DELETED',
      aiStatus: 'NOT_STARTED',
      tags: [],
    });

    // Execute search for "finance"
    const res = await request(user1Session, `/workspaces/${workspace1Id}/search?q=finance`);
    await assertStatus(res, 200, 'Search request');
    const body = await res.json();

    assert.strictEqual(body.items.length, 4, 'Should return exactly 4 matches (File E is deleted)');
    
    // Ranks should be:
    // 1st: File D (Filename 100 + Tag 50 = 150 points)
    // 2nd: File A (Filename 100 points)
    // 3rd: File B (Tag 50 points)
    // 4th: File C (Summary 20 points)
    const item1 = body.items[0];
    const item2 = body.items[1];
    const item3 = body.items[2];
    const item4 = body.items[3];

    assert.strictEqual(item1.fileId, fileD._id.toString(), 'Top result must be File D (score 150)');
    assert.strictEqual(item1.score, 150);

    assert.strictEqual(item2.fileId, fileA._id.toString(), 'Second result must be File A (score 100)');
    assert.strictEqual(item2.score, 100);

    assert.strictEqual(item3.fileId, fileB._id.toString(), 'Third result must be File B (score 50)');
    assert.strictEqual(item3.score, 50);

    assert.strictEqual(item4.fileId, fileC._id.toString(), 'Fourth result must be File C (score 20)');
    assert.strictEqual(item4.score, 20);
  });

  // =============================================================================
  // WORKSPACE INTELLIGENCE TESTS
  // =============================================================================

  await suite.test('INTELLIGENCE – Workspace boundaries (RBAC)', async () => {
    const res = await request(user2Session, `/workspaces/${workspace1Id}/intelligence`);
    assert.strictEqual(res.status, 403, 'User 2 should not have access to User 1 intelligence');
  });

  await suite.test('INTELLIGENCE – Metrics calculation correctness', async () => {
    // Current files in DB for workspace 1 (from previous test):
    // Active: File A (aiStatus: NOT_STARTED), File B (aiStatus: NOT_STARTED), File C (aiStatus: READY), File D (aiStatus: READY) -> 4 active files
    // Deleted: File E -> Should be ignored.
    // Total Files: 4
    // Processed Files: 2 (File C & File D have aiStatus: READY)
    // Coverage: Math.round((2 / 4) * 100) = 50%
    // Tags list: File A (none), File B ("finance"), File C (none), File D ("finance") -> Tag frequency: "finance" (count 2)
    // Recent Insights: File C & File D (both are READY). Sorted by updatedAt.
    
    // Enable AI on workspace 1 first to check setting reflection
    await Workspace.updateOne({ _id: workspace1Id }, { aiEnabled: true });

    const res = await request(user1Session, `/workspaces/${workspace1Id}/intelligence`);
    await assertStatus(res, 200, 'Intelligence request');
    const body = await res.json();

    assert.strictEqual(body.totalFiles, 4, 'Total files count should be 4');
    assert.strictEqual(body.processedFiles, 2, 'Processed files count should be 2');
    assert.strictEqual(body.coverage, 50, 'Coverage should be 50%');
    assert.strictEqual(body.aiEnabled, true, 'aiEnabled should be true');
    assert.deepEqual(body.topTags, ['finance'], 'Top tags list should contain "finance"');
    
    assert.strictEqual(body.recentInsights.length, 2, 'Should have 2 recent insights');
    // The recent insights should contain names and summaries of READY files
    const insightNames = body.recentInsights.map((i) => i.name);
    assert.ok(insightNames.includes('Annual targets.txt'), 'Insights should include File C');
    assert.ok(insightNames.includes('Finance Q1.xlsx'), 'Insights should include File D');
  });
});
