/* eslint-disable no-console, no-inner-declarations, @typescript-eslint/no-explicit-any */
import http from 'http';
import mongoose from 'mongoose';
import app from '../app';
import { User } from '../models/user.model';
import { Workspace } from '../models/workspace.model';
import { WorkspaceMember } from '../models/workspaceMember.model';
import { File } from '../models/file.model';
import { FileVersion } from '../models/fileVersion.model';
import { StorageService } from '../services/storage.service';

const TEST_PORT = 3003;
const BASE_URL = `http://localhost:${TEST_PORT}`;

// Helper to construct a multi-part form boundary body manually in Node
function createMultipartBody(
  filename: string,
  mimeType: string,
  content: string,
  boundary: string,
  additionalFields: Record<string, string> = {},
) {
  let body = '';
  for (const [key, val] of Object.entries(additionalFields)) {
    body += `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="${key}"\r\n\r\n`;
    body += `${val}\r\n`;
  }
  body += `--${boundary}\r\n`;
  body += `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n`;
  body += `Content-Type: ${mimeType}\r\n\r\n`;
  body += `${content}\r\n`;
  body += `--${boundary}--`;
  return body;
}

async function getFileContentFromStorage(storageKey: string): Promise<string> {
  const { supabase } = await import('../config/supabase');
  const { config } = await import('../config');
  if (supabase) {
    const { data, error } = await supabase.storage
      .from(config.SUPABASE_BUCKET)
      .download(storageKey);
    if (error || !data) {
      throw new Error(`Failed to download from Supabase: ${error?.message}`);
    }
    return Buffer.from(await data.arrayBuffer()).toString();
  } else {
    const file = StorageService.getMockFile(storageKey);
    if (!file) throw new Error('File not found in mock storage');
    return file.buffer.toString();
  }
}

async function listAllFiles(path: string): Promise<string[]> {
  const { supabase } = await import('../config/supabase');
  const { config } = await import('../config');
  if (!supabase) {
    return Array.from((StorageService as any).mockStorage.keys());
  }

  const allFiles: string[] = [];

  async function recurse(currentPath: string) {
    const { data, error } = await supabase!.storage.from(config.SUPABASE_BUCKET).list(currentPath);

    if (error) {
      console.error(`Error listing folder ${currentPath}:`, error);
      return;
    }

    if (!data) return;

    for (const item of data) {
      const itemPath = currentPath ? `${currentPath}/${item.name}` : item.name;
      if (!item.id) {
        await recurse(itemPath);
      } else {
        allFiles.push(itemPath);
      }
    }
  }

  await recurse(path);
  return allFiles;
}

async function runStorageTests() {
  console.log('--- Phase 6 Storage Integration Validation ---');

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
    const emailA = `user-storage-a-${uniqueSuffix}@cloudvault.com`;
    const emailB = `user-storage-b-${uniqueSuffix}@cloudvault.com`;
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
    console.log('Registering test users A and B...');
    const userA = await registerUser(emailA, `usera_store_${uniqueSuffix}`);
    const userB = await registerUser(emailB, `userb_store_${uniqueSuffix}`);

    const sessionA = await loginUser(userA.email);
    const sessionB = await loginUser(userB.email);

    // 2. Create Team Workspace for User A
    console.log('Creating Team Workspace for User A...');
    const createWSRes = await fetch(`${BASE_URL}/workspaces`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionA.cookie,
      },
      body: JSON.stringify({
        name: `Workspace Team ${uniqueSuffix}`,
        description: 'Test workspace for storage integration',
      }),
    });
    if (createWSRes.status !== 201) {
      throw new Error(`Workspace creation failed: ${await createWSRes.text()}`);
    }
    const { workspace } = (await createWSRes.json()) as any;
    const workspaceId = workspace._id;
    cleanupWorkspaceIds.push(new mongoose.Types.ObjectId(workspaceId));

    const { supabase } = await import('../config/supabase');
    const isRealStorage = !!supabase;
    console.log(`Running in ${isRealStorage ? 'REAL Supabase' : 'MOCK'} storage mode.`);

    if (isRealStorage) {
      const { config } = await import('../config');
      const { data: buckets, error: listError } = await supabase.storage.listBuckets();
      if (listError) {
        console.error('Failed to list buckets:', listError.message);
      } else {
        const bucketName = config.SUPABASE_BUCKET;
        const exists = buckets.some((b) => b.name === bucketName);
        if (!exists) {
          console.log(`Bucket ${bucketName} not found. Creating it...`);
          const { error: createError } = await supabase.storage.createBucket(bucketName, {
            public: false,
          });
          if (createError) {
            console.error(`Failed to create bucket ${bucketName}:`, createError.message);
          } else {
            console.log(`Successfully created bucket ${bucketName}.`);
          }
        }
      }
    }

    // Clear any previous mock storage
    StorageService.clearMockStorage();

    // 3. Test: Upload Success
    console.log('Testing: Upload Success (Valid File)...');
    const boundary = '----WebKitFormBoundaryE19z2V345B67a';
    const textFileContent = 'Hello CloudVault Storage Integration Phase 6!';
    const bodyContent = createMultipartBody('notes.txt', 'text/plain', textFileContent, boundary);

    const uploadRes = await fetch(`${BASE_URL}/workspaces/${workspaceId}/files/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        Cookie: sessionA.cookie,
      },
      body: bodyContent,
    });

    if (uploadRes.status !== 201) {
      throw new Error(`Upload failed: ${await uploadRes.text()}`);
    }

    const uploadedFile = (await uploadRes.json()) as any;
    console.log('File uploaded successfully! ID:', uploadedFile._id);

    // Verify database entries
    const fileDoc = await File.findById(uploadedFile._id);
    if (!fileDoc || fileDoc.status !== 'ACTIVE') {
      throw new Error(`File document missing or not ACTIVE in Mongo! Status: ${fileDoc?.status}`);
    }

    const versionDoc = await FileVersion.findById(fileDoc.currentVersionId);
    if (!versionDoc) {
      throw new Error('FileVersion document missing in Mongo!');
    }

    // Verify storage contains physical file
    const storedContent = await getFileContentFromStorage(versionDoc.storageKey);
    if (storedContent !== textFileContent) {
      throw new Error(
        `Physical file content missing or mismatched in storage! Got: ${storedContent}`,
      );
    }
    console.log('✅ Upload Success Verified.');

    // 4. Test: Authorization Failure (Non-member upload)
    console.log('Testing: Authorization Failure (Non-member upload attempt)...');
    const uploadUnauthorizedRes = await fetch(
      `${BASE_URL}/workspaces/${workspaceId}/files/upload`,
      {
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          Cookie: sessionB.cookie,
        },
        body: bodyContent,
      },
    );
    if (uploadUnauthorizedRes.status !== 403) {
      throw new Error(`Expected 403 for unauthorized upload, got: ${uploadUnauthorizedRes.status}`);
    }
    console.log('✅ Authorization Failure Verified.');

    // 5. Test: Download Authorization (Member vs Non-member)
    console.log('Testing: Download Authorization (Member download success)...');
    const downloadRes = await fetch(
      `${BASE_URL}/workspaces/${workspaceId}/files/${uploadedFile._id}/download`,
      {
        headers: { Cookie: sessionA.cookie },
      },
    );
    if (downloadRes.status !== 200) {
      throw new Error(`Download request failed for member: ${await downloadRes.text()}`);
    }
    const { downloadUrl } = (await downloadRes.json()) as any;
    if (isRealStorage) {
      const { config } = await import('../config');
      if (!downloadUrl.includes(config.SUPABASE_URL)) {
        throw new Error(`Invalid download signed URL structure: ${downloadUrl}`);
      }
    } else {
      if (!downloadUrl.startsWith('https://mock-supabase.storage/signed/')) {
        throw new Error(`Invalid download signed URL structure: ${downloadUrl}`);
      }
    }

    console.log('Testing: Download Authorization (Non-member download rejected)...');
    const downloadUnauthorizedRes = await fetch(
      `${BASE_URL}/workspaces/${workspaceId}/files/${uploadedFile._id}/download`,
      {
        headers: { Cookie: sessionB.cookie },
      },
    );
    if (downloadUnauthorizedRes.status !== 403) {
      throw new Error(
        `Expected 403 for unauthorized download, got: ${downloadUnauthorizedRes.status}`,
      );
    }
    console.log('✅ Download Authorization Verified.');

    // 6. Test: Invalid File Validation
    console.log('Testing: Invalid File Validation (Invalid MIME)...');
    const invalidMimeBody = createMultipartBody(
      'run.sh',
      'application/x-sh',
      'echo "hello"',
      boundary,
    );
    const mimeRes = await fetch(`${BASE_URL}/workspaces/${workspaceId}/files/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        Cookie: sessionA.cookie,
      },
      body: invalidMimeBody,
    });
    if (mimeRes.status !== 400) {
      throw new Error(`Expected 400 for invalid MIME type, got: ${mimeRes.status}`);
    }

    console.log('Testing: Invalid File Validation (Oversized File)...');
    // Generate simulated oversized content (> 50MB)
    const giantContent = 'A'.repeat(50 * 1024 * 1024 + 100);
    const oversizedBody = createMultipartBody('huge.txt', 'text/plain', giantContent, boundary);
    const sizeRes = await fetch(`${BASE_URL}/workspaces/${workspaceId}/files/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        Cookie: sessionA.cookie,
      },
      body: oversizedBody,
    });
    if (sizeRes.status !== 400) {
      throw new Error(`Expected 400 for oversized file upload, got: ${sizeRes.status}`);
    }
    console.log('✅ File Validation Checks Verified.');

    // 7. Test: Storage Failure Recovery (Supabase Upload Fails)
    console.log('Testing: Storage Failure Recovery (Supabase upload throws)...');
    StorageService.setMockFailure(true); // Tell mock to throw on next upload

    const uploadFailBody = createMultipartBody(
      'broken.txt',
      'text/plain',
      'Supabase failure test',
      boundary,
    );
    const uploadFailRes = await fetch(`${BASE_URL}/workspaces/${workspaceId}/files/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        Cookie: sessionA.cookie,
      },
      body: uploadFailBody,
    });
    if (uploadFailRes.status !== 500) {
      throw new Error(`Expected 500 on storage upload failure, got: ${uploadFailRes.status}`);
    }

    // Verify no orphaned File or FileVersion records are ACTIVE
    const failedFile = await File.findOne({ name: 'broken.txt' });
    if (failedFile && failedFile.status !== 'UPLOAD_FAILED') {
      throw new Error(
        `Expected File record to not exist or be status UPLOAD_FAILED, got: ${failedFile?.status}`,
      );
    }
    const failedVersion = await FileVersion.findOne({ storageKey: { $regex: /broken\.txt$/ } });
    if (failedVersion) {
      throw new Error('FileVersion was incorrectly written to Mongo during storage failure!');
    }
    console.log('✅ Physical Storage Failure Rollback Verified.');

    // 8. Test: Storage Failure Recovery (MongoDB Write Fails after successful Supabase upload)
    console.log(
      'Testing: Storage Failure Recovery (MongoDB metadata write throws after successful upload)...',
    );
    const mongoFailRes = await fetch(`${BASE_URL}/workspaces/${workspaceId}/files/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        Cookie: sessionA.cookie,
        'x-simulate-mongo-failure': 'true',
      },
      body: createMultipartBody('mongofail.txt', 'text/plain', 'Mongo failure test', boundary),
    });

    if (mongoFailRes.status !== 500) {
      throw new Error(
        `Expected 500 on MongoDB metadata write failure, got: ${mongoFailRes.status}`,
      );
    }

    // Verify metadata does not exist in Mongo
    const orphanedFile = await File.findOne({ name: 'mongofail.txt' });
    if (orphanedFile) {
      throw new Error(
        'File document was incorrectly saved or not cleaned up during Mongo write failure.',
      );
    }
    const orphanedVersion = await FileVersion.findOne({
      storageKey: { $regex: /mongofail\.txt$/ },
    });
    if (orphanedVersion) {
      throw new Error('FileVersion was incorrectly saved during Mongo write failure.');
    }

    // Verify physical file was rolled back (deleted) from storage
    const allFiles = await listAllFiles(workspaceId);
    let rolledBackFileFound = false;
    for (const key of allFiles) {
      if (key.endsWith('mongofail.txt')) {
        rolledBackFileFound = true;
      }
    }
    if (rolledBackFileFound) {
      throw new Error(
        'Physical file was not deleted from Supabase storage during Mongo write failure rollback!',
      );
    }
    console.log('✅ Database Write Failure Rollback Verified.');

    console.log('\n=======================================');
    console.log('🎉 ALL INTEGRATION TESTS PASSED 🎉');
    console.log('=======================================');
  } catch (error) {
    console.error('❌ Test execution failed:', error);
    process.exit(1);
  } finally {
    // Cleanup Database records and physical files
    console.log('Cleaning up test data...');
    const { supabase } = await import('../config/supabase');
    const isRealStorage = !!supabase;
    if (isRealStorage) {
      console.log('Cleaning up physical files from real Supabase storage...');
      for (const wsId of cleanupWorkspaceIds) {
        try {
          const filesToDelete = await listAllFiles(wsId.toString());
          for (const fileKey of filesToDelete) {
            console.log(`Deleting file from Supabase storage: ${fileKey}`);
            await StorageService.deleteFile(fileKey);
          }
        } catch (cleanupErr) {
          console.error(`Failed to clean up files for workspace ${wsId}:`, cleanupErr);
        }
      }
    }

    console.log('Cleaning up DB records...');
    await User.deleteMany({ _id: { $in: cleanupUserIds } });
    await Workspace.deleteMany({ _id: { $in: cleanupWorkspaceIds } });
    await WorkspaceMember.deleteMany({ workspaceId: { $in: cleanupWorkspaceIds } });
    await File.deleteMany({ workspaceId: { $in: cleanupWorkspaceIds } });
    await FileVersion.deleteMany({});
    StorageService.clearMockStorage();

    // Stop server
    server.close(() => {
      console.log('Test server shut down.');
      process.exit(0);
    });
  }
}

// Run the script directly
runStorageTests().catch(console.error);
