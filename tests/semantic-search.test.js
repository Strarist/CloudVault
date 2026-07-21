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

async function clearDatabase() {
  const collections = ['files', 'fileversions', 'airesults'];
  for (const coll of collections) {
    try {
      await mongoose.connection.collection(coll).deleteMany({});
    } catch {}
  }
}

test('PHASE 11 – SEMANTIC & HYBRID SEARCH INTEGRATION', async (suite) => {
  let user1Session;
  let user2Session;
  let workspace1Id;
  let workspace2Id;
  let u1;
  let u2;

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

    // Get User Mongoose objects
    u1 = await User.findOne({ username: 'user11' });
    u2 = await User.findOne({ username: 'user22' });

    // Get Workspace IDs
    res = await request(user1Session, '/workspaces');
    assert.strictEqual(res.status, 200);
    let workspaces = await res.json();
    workspace1Id = workspaces[0].workspaceId._id;

    res = await request(user2Session, '/workspaces');
    assert.strictEqual(res.status, 200);
    workspaces = await res.json();
    workspace2Id = workspaces[0].workspaceId._id;

    // Enable AI on Workspace 1
    await Workspace.updateOne({ _id: workspace1Id }, { aiEnabled: true });
  });

  suite.after(async () => {
    await stopServer();
    await mongoose.disconnect();
  });

  // =============================================================================
  // KEYWORD SEARCH PARAM VALIDATION
  // =============================================================================

  await suite.test('SEARCH – Mode parameter validation', async () => {
    const res = await request(user1Session, `/workspaces/${workspace1Id}/search?q=test&mode=invalid`);
    assert.strictEqual(res.status, 400, 'Should reject invalid search mode');
  });

  // =============================================================================
  // SEMANTIC & HYBRID SEARCH TESTS
  // =============================================================================

  await suite.test('SEMANTIC – Concept matching and ranking order', async () => {
    await clearDatabase();

    // File A: Perfect match for 'audit info' (similarity = 1.0)
    const fileA = await File.create({
      name: 'Internal Audit.pdf',
      workspaceId: new mongoose.Types.ObjectId(workspace1Id),
      createdBy: u1._id,
      status: 'ACTIVE',
      aiStatus: 'READY',
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

    const embeddingA = new Array(1536).fill(0);
    embeddingA[0] = 1.0;
    embeddingA[1] = 1.0;

    await AIResult.create({
      workspaceId: new mongoose.Types.ObjectId(workspace1Id),
      fileId: fileA._id,
      fileVersionId: verA._id,
      summary: 'Company internal audits log.',
      tags: [],
      embedding: embeddingA, // matches 'audit info'
      embeddingModel: 'mock-text-embedding-3-small',
      embeddingDimensions: 1536,
      embeddingVersion: 1,
      modelProvider: 'openai',
      modelName: 'gpt-4',
      modelVersion: '1.0',
    });

    // File B: Partial match for 'audit info' (similarity = 0.707)
    const fileB = await File.create({
      name: 'Tax Files.xlsx',
      workspaceId: new mongoose.Types.ObjectId(workspace1Id),
      createdBy: u1._id,
      status: 'ACTIVE',
      aiStatus: 'READY',
      tags: [],
    });
    const verB = await FileVersion.create({
      fileId: fileB._id,
      versionNumber: 1,
      storageKey: 'verB',
      mimeType: 'application/vnd.ms-excel',
      fileSize: 2000,
      uploadedBy: u1._id,
    });
    fileB.currentVersionId = verB._id;
    await fileB.save();

    const embeddingB = new Array(1536).fill(0);
    embeddingB[0] = 1.0;

    await AIResult.create({
      workspaceId: new mongoose.Types.ObjectId(workspace1Id),
      fileId: fileB._id,
      fileVersionId: verB._id,
      summary: 'Fiscal tax reporting information.',
      tags: [],
      embedding: embeddingB, // partial match
      embeddingModel: 'mock-text-embedding-3-small',
      embeddingDimensions: 1536,
      embeddingVersion: 1,
      modelProvider: 'openai',
      modelName: 'gpt-4',
      modelVersion: '1.0',
    });

    // Execute semantic search
    const res = await request(user1Session, `/workspaces/${workspace1Id}/search?q=audit%20info&mode=semantic`);
    await assertStatus(res, 200, 'Semantic Search request');
    const body = await res.json();

    assert.strictEqual(body.items.length, 2, 'Should return exactly 2 matches');
    assert.strictEqual(body.items[0].fileId, fileA._id.toString(), 'Top semantic result should be Internal Audit (exact match)');
    assert.strictEqual(body.items[1].fileId, fileB._id.toString(), 'Second semantic result should be Tax Files');
    
    // Similarity score assertions
    assert.ok(body.items[0].score > 0.99, 'Similarity should be ~1.0');
    assert.ok(body.items[1].score > 0.70 && body.items[1].score < 0.71, 'Similarity should be ~0.707');
  });

  await suite.test('HYBRID – Score combination and ranking verification', async () => {
    await clearDatabase();

    // Hybrid Mode computes: Final Score = 0.7 * Semantic + 0.3 * (Keyword / 100)
    // File X: perfect keyword match (filename contains "audit" -> 100 pts) but 0 semantic similarity (0.0)
    // Score X = 0.7 * 0 + 0.3 * 1.0 = 0.30
    // File Y: zero keyword match (filename: "Workspace Target Document") but high semantic similarity (1.0)
    // Score Y = 0.7 * 1.0 + 0.3 * 0 = 0.70
    // File Y should rank ABOVE File X because of its semantic similarity weight!

    // File X
    const fileX = await File.create({
      name: 'Audit Reports Folder.docx',
      workspaceId: new mongoose.Types.ObjectId(workspace1Id),
      createdBy: u1._id,
      status: 'ACTIVE',
      aiStatus: 'READY',
      tags: [],
    });
    const verX = await FileVersion.create({
      fileId: fileX._id,
      versionNumber: 1,
      storageKey: 'verX',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      fileSize: 1000,
      uploadedBy: u1._id,
    });
    fileX.currentVersionId = verX._id;
    await fileX.save();

    const embeddingX = new Array(1536).fill(0);
    embeddingX[3] = 1.0; // Orthogonal to 'audit' query embedding

    await AIResult.create({
      workspaceId: new mongoose.Types.ObjectId(workspace1Id),
      fileId: fileX._id,
      fileVersionId: verX._id,
      summary: 'Report of company status.',
      tags: [],
      embedding: embeddingX,
      embeddingModel: 'mock-text-embedding-3-small',
      embeddingDimensions: 1536,
      embeddingVersion: 1,
      modelProvider: 'openai',
      modelName: 'gpt-4',
      modelVersion: '1.0',
    });

    // File Y
    const fileY = await File.create({
      name: 'Workspace Target Document.docx',
      workspaceId: new mongoose.Types.ObjectId(workspace1Id),
      createdBy: u1._id,
      status: 'ACTIVE',
      aiStatus: 'READY',
      tags: [],
    });
    const verY = await FileVersion.create({
      fileId: fileY._id,
      versionNumber: 1,
      storageKey: 'verY',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      fileSize: 1000,
      uploadedBy: u1._id,
    });
    fileY.currentVersionId = verY._id;
    await fileY.save();

    const embeddingY = new Array(1536).fill(0);
    embeddingY[0] = 1.0;
    embeddingY[1] = 1.0;

    await AIResult.create({
      workspaceId: new mongoose.Types.ObjectId(workspace1Id),
      fileId: fileY._id,
      fileVersionId: verY._id,
      summary: 'Workspace targeting.',
      tags: [],
      embedding: embeddingY, // exact match similarity (1.0)
      embeddingModel: 'mock-text-embedding-3-small',
      embeddingDimensions: 1536,
      embeddingVersion: 1,
      modelProvider: 'openai',
      modelName: 'gpt-4',
      modelVersion: '1.0',
    });

    // Execute hybrid search for "audit"
    const res = await request(user1Session, `/workspaces/${workspace1Id}/search?q=audit&mode=hybrid`);
    await assertStatus(res, 200, 'Hybrid Search request');
    const body = await res.json();

    assert.strictEqual(body.items[0].fileId, fileY._id.toString(), 'Top result should be File Y in Hybrid Mode (score 0.70)');
    assert.strictEqual(body.items[1].fileId, fileX._id.toString(), 'Second result should be File X in Hybrid Mode (score 0.30)');
  });

  await suite.test('WORKSPACE ISOLATION – Rejects cross-workspace queries', async () => {
    const res = await request(user2Session, `/workspaces/${workspace1Id}/search?q=audit&mode=semantic`);
    assert.strictEqual(res.status, 403, 'Should reject access with 403 Forbidden');
  });

  await suite.test('AI DISABLED – Rejects semantic requests with status 200 & available: false', async () => {
    // Disable AI on Workspace 1
    await Workspace.updateOne({ _id: workspace1Id }, { aiEnabled: false });

    const res = await request(user1Session, `/workspaces/${workspace1Id}/search?q=audit&mode=semantic`);
    await assertStatus(res, 200, 'Request should return 200 OK');
    const body = await res.json();

    assert.strictEqual(body.available, false, 'available should be false');
    assert.strictEqual(body.reason, 'AI search disabled for workspace');

    // Re-enable AI
    await Workspace.updateOne({ _id: workspace1Id }, { aiEnabled: true });
  });

  await suite.test('ROLLBACK – Uses active version embedding immediately', async () => {
    await clearDatabase();

    // File R:
    // v1 - has embeddingA (exact match for "concept a")
    // v2 - has embeddingB (exact match for "concept b")

    // Create File R
    const fileR = await File.create({
      name: 'Dynamic File.docx',
      workspaceId: new mongoose.Types.ObjectId(workspace1Id),
      createdBy: u1._id,
      status: 'ACTIVE',
      aiStatus: 'READY',
      tags: [],
    });

    // Create v1
    const ver1 = await FileVersion.create({
      fileId: fileR._id,
      versionNumber: 1,
      storageKey: 'ver1',
      mimeType: 'text/plain',
      fileSize: 100,
      uploadedBy: u1._id,
    });

    const embeddingR1 = new Array(1536).fill(0);
    embeddingR1[0] = 1.0;

    await AIResult.create({
      workspaceId: new mongoose.Types.ObjectId(workspace1Id),
      fileId: fileR._id,
      fileVersionId: ver1._id,
      summary: 'Version 1 summary.',
      tags: [],
      embedding: embeddingR1, // matches 'concept a'
      embeddingModel: 'mock-text-embedding-3-small',
      embeddingDimensions: 1536,
      embeddingVersion: 1,
      modelProvider: 'openai',
      modelName: 'gpt-4',
      modelVersion: '1.0',
    });

    // Create v2
    const ver2 = await FileVersion.create({
      fileId: fileR._id,
      versionNumber: 2,
      storageKey: 'ver2',
      mimeType: 'text/plain',
      fileSize: 200,
      uploadedBy: u1._id,
    });

    const embeddingR2 = new Array(1536).fill(0);
    embeddingR2[1] = 1.0;

    await AIResult.create({
      workspaceId: new mongoose.Types.ObjectId(workspace1Id),
      fileId: fileR._id,
      fileVersionId: ver2._id,
      summary: 'Version 2 summary.',
      tags: [],
      embedding: embeddingR2, // matches 'concept b'
      embeddingModel: 'mock-text-embedding-3-small',
      embeddingDimensions: 1536,
      embeddingVersion: 1,
      modelProvider: 'openai',
      modelName: 'gpt-4',
      modelVersion: '1.0',
    });

    // Point currentVersionId to ver2 (active version = v2)
    fileR.currentVersionId = ver2._id;
    await fileR.save();

    // Search for "concept b" - should find File R (score 1.0)
    let res = await request(user1Session, `/workspaces/${workspace1Id}/search?q=concept%20b&mode=semantic`);
    await assertStatus(res, 200, 'Search concept B');
    let body = await res.json();
    let itemIds = body.items.map((i) => i.fileId);
    assert.ok(itemIds.includes(fileR._id.toString()), 'Should find File R under active version v2');

    // Rollback to v1 (set currentVersionId = ver1)
    fileR.currentVersionId = ver1._id;
    await fileR.save();

    // Search for "concept b" - should NOT find File R anymore (since v1's embedding is orthogonal, similarity = 0.0)
    res = await request(user1Session, `/workspaces/${workspace1Id}/search?q=concept%20b&mode=semantic`);
    await assertStatus(res, 200, 'Search concept B after rollback');
    body = await res.json();
    let itemIdsPost = body.items.map((i) => i.fileId);
    assert.strictEqual(itemIdsPost.includes(fileR._id.toString()), false, 'Should NOT find File R under active version v1 for concept B');

    // Search for "concept a" - should find File R now (similarity = 1.0)
    res = await request(user1Session, `/workspaces/${workspace1Id}/search?q=concept%20a&mode=semantic`);
    await assertStatus(res, 200, 'Search concept A after rollback');
    body = await res.json();
    let itemIdsPostA = body.items.map((i) => i.fileId);
    assert.ok(itemIdsPostA.includes(fileR._id.toString()), 'Should find File R under active version v1 for concept A');
  });

  await suite.test('DELETED FILES – Excluded from semantic and hybrid searches', async () => {
    await clearDatabase();

    const fileToDel = await File.create({
      name: 'Delete Me.docx',
      workspaceId: new mongoose.Types.ObjectId(workspace1Id),
      createdBy: u1._id,
      status: 'DELETED', // Soft deleted
      aiStatus: 'READY',
      tags: [],
    });

    const verDel = await FileVersion.create({
      fileId: fileToDel._id,
      versionNumber: 1,
      storageKey: 'verDel',
      mimeType: 'text/plain',
      fileSize: 100,
      uploadedBy: u1._id,
    });
    fileToDel.currentVersionId = verDel._id;
    await fileToDel.save();

    const embeddingDel = new Array(1536).fill(0);
    embeddingDel[2] = 1.0;

    await AIResult.create({
      workspaceId: new mongoose.Types.ObjectId(workspace1Id),
      fileId: fileToDel._id,
      fileVersionId: verDel._id,
      summary: 'Deleted document summary.',
      tags: [],
      embedding: embeddingDel, // matches 'deleted'
      embeddingModel: 'mock-text-embedding-3-small',
      embeddingDimensions: 1536,
      embeddingVersion: 1,
      modelProvider: 'openai',
      modelName: 'gpt-4',
      modelVersion: '1.0',
    });

    // Execute semantic search
    const res = await request(user1Session, `/workspaces/${workspace1Id}/search?q=deleted&mode=semantic`);
    await assertStatus(res, 200, 'Search');
    const body = await res.json();

    const ids = body.items.map((i) => i.fileId);
    assert.strictEqual(ids.includes(fileToDel._id.toString()), false, 'Soft-deleted file should be excluded from semantic search');
  });
});
