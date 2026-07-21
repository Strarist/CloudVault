/* eslint-disable no-console, no-inner-declarations, @typescript-eslint/no-explicit-any */
import http from 'http';
import mongoose from 'mongoose';
import app from '../app';
import { User } from '../models/user.model';
import { Workspace } from '../models/workspace.model';
import { WorkspaceMember } from '../models/workspaceMember.model';
import { File } from '../models/file.model';
import { FileVersion } from '../models/fileVersion.model';
import { ActivityLog } from '../models/activityLog.model';
import { ActivityAction } from '../models/types';
import { StorageService } from '../services/storage.service';

const TEST_PORT = 3004;
const BASE_URL = `http://localhost:${TEST_PORT}`;

// Helper to construct a multi-part form boundary body manually in Node
function createMultipartBody(
  filename: string,
  mimeType: string,
  content: string,
  boundary: string,
) {
  let body = '';
  body += `--${boundary}\r\n`;
  body += `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n`;
  body += `Content-Type: ${mimeType}\r\n\r\n`;
  body += `${content}\r\n`;
  body += `--${boundary}--`;
  return body;
}

async function runActivityTests() {
  console.log('--- Phase 6.5 Activity System Validation ---');

  // Start server locally for tests
  const server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(TEST_PORT, () => {
      console.log(`Test server running on port ${TEST_PORT}`);
      resolve();
    });
  });

  const cleanupUserIds: mongoose.Types.ObjectId[] = [];
  const cleanupWorkspaceIds: mongoose.Types.ObjectId[] = [];

  try {
    const uniqueSuffix = Date.now();
    const emailA = `user-activity-a-${uniqueSuffix}@cloudvault.com`;
    const emailB = `user-activity-b-${uniqueSuffix}@cloudvault.com`;
    const emailC = `user-activity-c-${uniqueSuffix}@cloudvault.com`;
    const password = 'securePassword123';

    // Helper for register
    async function registerUser(email: string, username: string) {
      const res = await fetch(`${BASE_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, username, password }),
      });
      if (res.status !== 201) {
        throw new Error(`Register failed: ${await res.text()}`);
      }
      const data = (await res.json()) as any;
      cleanupUserIds.push(new mongoose.Types.ObjectId(data._id));
      return data;
    }

    // Helper for login
    async function loginUser(username: string) {
      const res = await fetch(`${BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (res.status !== 200) {
        throw new Error(`Login failed: ${await res.text()}`);
      }
      const cookies = res.headers.get('set-cookie') || '';
      const tokenCookie = cookies.split(';')[0];
      const data = (await res.json()) as any;
      return { user: data.user, cookie: tokenCookie };
    }

    // 1. Setup Users
    console.log('Registering test users A, B, and C...');
    const userA = await registerUser(emailA, `usera_act_${uniqueSuffix}`);
    const userB = await registerUser(emailB, `userb_act_${uniqueSuffix}`);
    const userC = await registerUser(emailC, `userc_act_${uniqueSuffix}`);

    const sessionA = await loginUser(userA.email);
    await loginUser(userB.email);
    const sessionC = await loginUser(userC.email);

    // 2. Test 1: Workspace Created -> Activity Created
    console.log('Testing: Workspace Created -> Activity Logged...');
    const createWSRes = await fetch(`${BASE_URL}/workspaces`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionA.cookie,
      },
      body: JSON.stringify({
        name: `Workspace Act ${uniqueSuffix}`,
        description: 'Test workspace for activity tracking',
      }),
    });
    if (createWSRes.status !== 201) {
      throw new Error(`Workspace creation failed: ${await createWSRes.text()}`);
    }
    const { workspace } = (await createWSRes.json()) as any;
    const workspaceId = workspace._id;
    cleanupWorkspaceIds.push(new mongoose.Types.ObjectId(workspaceId));

    // Verify activity record exists
    const createActivity = await ActivityLog.findOne({
      workspaceId,
      action: ActivityAction.WORKSPACE_CREATED,
    });
    if (!createActivity || createActivity.metadata.workspaceName !== workspace.name) {
      throw new Error('WORKSPACE_CREATED activity record missing or invalid!');
    }
    console.log('✅ Workspace Created Log Verified.');

    // 3. Test 2: Member Added -> Activity Created
    console.log('Testing: Member Added -> Activity Logged...');
    const inviteRes = await fetch(`${BASE_URL}/workspaces/${workspaceId}/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionA.cookie,
      },
      body: JSON.stringify({
        email: emailB,
        role: 'EDITOR',
      }),
    });
    if (inviteRes.status !== 201) {
      throw new Error(`Member invitation failed: ${await inviteRes.text()}`);
    }

    const memberActivity = await ActivityLog.findOne({
      workspaceId,
      action: ActivityAction.WORKSPACE_MEMBER_ADDED,
    });
    if (
      !memberActivity ||
      memberActivity.metadata.userId !== userB._id ||
      memberActivity.metadata.role !== 'EDITOR'
    ) {
      throw new Error('WORKSPACE_MEMBER_ADDED activity record missing or invalid!');
    }
    console.log('✅ Member Added Log Verified.');

    // 4. Test 3: Role Changed -> Activity Created
    console.log('Testing: Role Changed -> Activity Logged...');
    const updateRoleRes = await fetch(
      `${BASE_URL}/workspaces/${workspaceId}/members/${userB._id}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: sessionA.cookie,
        },
        body: JSON.stringify({ role: 'ADMIN' }),
      },
    );
    if (updateRoleRes.status !== 200) {
      throw new Error(`Member role update failed: ${await updateRoleRes.text()}`);
    }

    const roleActivity = await ActivityLog.findOne({
      workspaceId,
      action: ActivityAction.WORKSPACE_ROLE_CHANGED,
    });
    if (
      !roleActivity ||
      roleActivity.metadata.userId !== userB._id ||
      roleActivity.metadata.oldRole !== 'EDITOR' ||
      roleActivity.metadata.newRole !== 'ADMIN'
    ) {
      throw new Error('WORKSPACE_ROLE_CHANGED activity record missing or invalid!');
    }
    console.log('✅ Role Changed Log Verified.');

    // 5. Test 4: File Uploaded -> Activity Created
    console.log('Testing: File Uploaded -> Activity Logged...');
    StorageService.clearMockStorage();
    const boundary = '----WebKitFormBoundaryE19z2V345B67a';
    const uploadRes = await fetch(`${BASE_URL}/workspaces/${workspaceId}/files/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        Cookie: sessionA.cookie,
      },
      body: createMultipartBody('document.pdf', 'application/pdf', 'dummy-pdf-content', boundary),
    });
    if (uploadRes.status !== 201) {
      throw new Error(`File upload failed: ${await uploadRes.text()}`);
    }
    const uploadedFile = (await uploadRes.json()) as any;

    const fileActivity = await ActivityLog.findOne({
      workspaceId,
      action: ActivityAction.FILE_UPLOADED,
    });
    if (
      !fileActivity ||
      fileActivity.metadata.fileId !== uploadedFile._id ||
      fileActivity.metadata.fileName !== 'document.pdf'
    ) {
      throw new Error('FILE_UPLOADED activity record missing or invalid!');
    }
    console.log('✅ File Uploaded Log Verified.');

    // 6. Test 5: Unauthorized User -> Activity Feed Access -> Rejected
    console.log('Testing: Unauthorized Feed Access (Non-member User C)...');
    const unauthorizedFeedRes = await fetch(`${BASE_URL}/workspaces/${workspaceId}/activity`, {
      headers: { Cookie: sessionC.cookie },
    });
    if (unauthorizedFeedRes.status !== 403) {
      throw new Error(
        `Expected 403 for non-member feed access, got: ${unauthorizedFeedRes.status}`,
      );
    }
    console.log('✅ Unauthorized Feed Access Blocked Verified.');

    // 7. Test 6: Activity Pagination (100 Records)
    console.log('Testing: Activity Feed Pagination (Seeding 100 records)...');
    // Seed 100 historical logs
    const seedDocs = [];
    for (let i = 1; i <= 100; i++) {
      seedDocs.push({
        workspaceId: new mongoose.Types.ObjectId(workspaceId),
        actorId: new mongoose.Types.ObjectId(userA._id),
        action: ActivityAction.FILE_DOWNLOADED,
        metadata: {
          fileId: uploadedFile._id,
          fileName: `seeded-file-${i}.txt`,
        },
        timestamp: new Date(Date.now() - i * 1000), // Ensures order
      });
    }
    await ActivityLog.insertMany(seedDocs);

    // Fetch Page 1 (Limit 50)
    console.log('Fetching Page 1 (Limit 50)...');
    const page1Res = await fetch(`${BASE_URL}/workspaces/${workspaceId}/activity?page=1&limit=50`, {
      headers: { Cookie: sessionA.cookie },
    });
    if (page1Res.status !== 200) {
      throw new Error(`Failed to fetch page 1: ${await page1Res.text()}`);
    }
    const page1Data = (await page1Res.json()) as any;
    if (page1Data.items.length !== 50) {
      throw new Error(`Expected 50 items on Page 1, got: ${page1Data.items.length}`);
    }
    if (page1Data.page !== 1 || page1Data.limit !== 50 || page1Data.total < 104) {
      throw new Error(`Invalid pagination metadata on Page 1: ${JSON.stringify(page1Data)}`);
    }

    // Verify sort order: newest first (newest timestamp in items[0])
    const t0 = new Date(page1Data.items[0].timestamp).getTime();
    const t1 = new Date(page1Data.items[1].timestamp).getTime();
    if (t0 < t1) {
      throw new Error(`Activity feed sort order is not newest first!`);
    }

    // Fetch Page 2 (Limit 50)
    console.log('Fetching Page 2 (Limit 50)...');
    const page2Res = await fetch(`${BASE_URL}/workspaces/${workspaceId}/activity?page=2&limit=50`, {
      headers: { Cookie: sessionA.cookie },
    });
    if (page2Res.status !== 200) {
      throw new Error(`Failed to fetch page 2: ${await page2Res.text()}`);
    }
    const page2Data = (await page2Res.json()) as any;
    if (page2Data.items.length !== 50) {
      throw new Error(`Expected 50 items on Page 2, got: ${page2Data.items.length}`);
    }
    if (page2Data.page !== 2 || page2Data.limit !== 50) {
      throw new Error(`Invalid pagination metadata on Page 2: ${JSON.stringify(page2Data)}`);
    }
    console.log('✅ Activity Feed Pagination Verified.');

    console.log('\n=======================================');
    console.log('🎉 ALL ACTIVITY SYSTEM TESTS PASSED 🎉');
    console.log('=======================================');
  } catch (error) {
    console.error('❌ Test execution failed:', error);
    process.exit(1);
  } finally {
    // Cleanup Database records
    console.log('Cleaning up test data from DB...');
    await User.deleteMany({ _id: { $in: cleanupUserIds } });
    await Workspace.deleteMany({ _id: { $in: cleanupWorkspaceIds } });
    await WorkspaceMember.deleteMany({ workspaceId: { $in: cleanupWorkspaceIds } });
    await File.deleteMany({ workspaceId: { $in: cleanupWorkspaceIds } });
    await FileVersion.deleteMany({});
    await ActivityLog.deleteMany({ workspaceId: { $in: cleanupWorkspaceIds } });
    StorageService.clearMockStorage();

    // Stop server
    server.close(() => {
      console.log('Test server shut down.');
      process.exit(0);
    });
  }
}

// Run the script directly
runActivityTests().catch(console.error);
