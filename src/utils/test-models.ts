/* eslint-disable no-console, @typescript-eslint/no-explicit-any */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { User } from '../models/user.model';
import { Workspace } from '../models/workspace.model';
import { WorkspaceMember } from '../models/workspaceMember.model';
import { Folder } from '../models/folder.model';
import { File } from '../models/file.model';
import { FileVersion } from '../models/fileVersion.model';
import { Comment } from '../models/comment.model';
import { Notification } from '../models/notification.model';
import { ActivityLog } from '../models/activityLog.model';
import {
  WorkspaceType,
  WorkspaceRole,
  FileStatus,
  AIStatus,
  NotificationType,
  ActivityAction,
} from '../models/types';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://0.0.0.0/cloudVault-drive';

async function runTests() {
  console.log('--- Database Layer Validation Script ---');
  console.log(`Connecting to MongoDB at: ${MONGO_URI}`);
  await mongoose.connect(MONGO_URI);
  console.log('Connected.');

  console.log('Ensuring all model indexes are built and cleaning old ones...');
  await (User as any).cleanIndexes();
  await User.ensureIndexes();
  await (WorkspaceMember as any).cleanIndexes();
  await WorkspaceMember.ensureIndexes();
  await (FileVersion as any).cleanIndexes();
  await FileVersion.ensureIndexes();
  console.log('Indexes built.');

  const cleanupIds: { [key: string]: mongoose.Types.ObjectId[] } = {
    users: [],
    workspaces: [],
    members: [],
    folders: [],
    files: [],
    versions: [],
    comments: [],
    notifications: [],
    logs: [],
  };

  try {
    // 1. Validate User Model
    console.log('Validating User model...');
    const testUser = await User.create({
      email: `test-${Date.now()}@cloudvault.com`,
      passwordHash: 'dummyhash123',
      name: 'Testy Tester',
      avatar: 'http://avatar.url/test.png',
    });
    cleanupIds.users.push(testUser._id as mongoose.Types.ObjectId);
    console.log('User created:', testUser.name);

    // 2. Validate Workspace Model
    console.log('Validating Workspace model...');
    const testWorkspace = await Workspace.create({
      name: 'Test Workspace',
      description: 'A sandbox workspace',
      ownerId: testUser._id,
      type: WorkspaceType.TEAM,
      aiEnabled: true,
    });
    cleanupIds.workspaces.push(testWorkspace._id as mongoose.Types.ObjectId);
    console.log('Workspace created:', testWorkspace.name);

    // 3. Validate WorkspaceMember Model
    console.log('Validating WorkspaceMember model...');
    const testMember = await WorkspaceMember.create({
      workspaceId: testWorkspace._id,
      userId: testUser._id,
      role: WorkspaceRole.OWNER,
    });
    cleanupIds.members.push(testMember._id as mongoose.Types.ObjectId);
    console.log('WorkspaceMember created with role:', testMember.role);

    // 4. Validate Folder Model
    console.log('Validating Folder model...');
    const testFolder = await Folder.create({
      name: 'Root folder',
      workspaceId: testWorkspace._id,
      createdBy: testUser._id,
    });
    cleanupIds.folders.push(testFolder._id as mongoose.Types.ObjectId);
    console.log('Folder created:', testFolder.name);

    // 5. Validate File Model
    console.log('Validating File model...');
    const testFile = await File.create({
      name: 'resume.pdf',
      workspaceId: testWorkspace._id,
      folderId: testFolder._id,
      createdBy: testUser._id,
      status: FileStatus.PENDING_UPLOAD,
      tags: ['career', 'pdf'],
      aiStatus: AIStatus.NOT_STARTED,
    });
    cleanupIds.files.push(testFile._id as mongoose.Types.ObjectId);
    console.log('File created:', testFile.name);

    // 6. Validate FileVersion Model
    console.log('Validating FileVersion model...');
    const testVersion = await FileVersion.create({
      fileId: testFile._id,
      versionNumber: 1,
      storageKey: 'supabase-bucket/resume-v1.pdf',
      mimeType: 'application/pdf',
      fileSize: 1024 * 50,
      uploadedBy: testUser._id,
    });
    cleanupIds.versions.push(testVersion._id as mongoose.Types.ObjectId);
    console.log('FileVersion created. Storage Key:', testVersion.storageKey);

    // Update File currentVersionId and status to ACTIVE
    testFile.currentVersionId = testVersion._id as mongoose.Types.ObjectId;
    testFile.status = FileStatus.ACTIVE;
    await testFile.save();
    console.log('File status updated to ACTIVE with version ID.');

    // 7. Validate Comment Model
    console.log('Validating Comment model...');
    const testComment = await Comment.create({
      fileId: testFile._id,
      workspaceId: testWorkspace._id,
      authorId: testUser._id,
      content: 'Please check the spelling in Section 2.',
      mentions: [testUser._id],
    });
    cleanupIds.comments.push(testComment._id as mongoose.Types.ObjectId);
    console.log('Comment created:', testComment.content);

    // 8. Validate Notification Model
    console.log('Validating Notification model...');
    const testNotification = await Notification.create({
      userId: testUser._id,
      type: NotificationType.COMMENT,
      payload: {
        commentId: testComment._id,
        fileId: testFile._id,
      },
      isRead: false,
    });
    cleanupIds.notifications.push(testNotification._id as mongoose.Types.ObjectId);
    console.log('Notification created of type:', testNotification.type);

    // 9. Validate ActivityLog Model
    console.log('Validating ActivityLog model...');
    const testLog = await ActivityLog.create({
      workspaceId: testWorkspace._id,
      actorId: testUser._id,
      action: ActivityAction.FILE_UPLOAD,
      targetId: testFile._id,
      targetType: 'File',
      metadata: {
        fileName: testFile.name,
        fileSize: testVersion.fileSize,
      },
    });
    cleanupIds.logs.push(testLog._id as mongoose.Types.ObjectId);
    console.log('ActivityLog created for action:', testLog.action);

    // 10. Check invalid validation error triggering
    console.log('Validating invalid enum triggers validation error...');
    try {
      await File.create({
        name: 'badfile.txt',
        workspaceId: testWorkspace._id,
        createdBy: testUser._id,
        status: 'INVALID_STATUS' as any,
      });
      throw new Error('Should have failed validation!');
    } catch (err: any) {
      if (err.message === 'Should have failed validation!') {
        throw err;
      }
      console.log('Enum check validation successfully caught invalid status:', err.message);
    }

    // 11. Test unique constraint on User email
    console.log('Testing User email uniqueness constraint...');
    try {
      await User.create({
        email: testUser.email,
        passwordHash: 'anotherhash',
        name: 'Another User',
      });
      throw new Error('Should have failed email uniqueness check!');
    } catch (err: any) {
      if (err.message === 'Should have failed email uniqueness check!') {
        throw err;
      }
      console.log('Email uniqueness validation successfully caught duplicate key:', err.message);
    }

    // 12. Test unique compound constraint on WorkspaceMember (workspaceId + userId)
    console.log('Testing WorkspaceMember uniqueness constraint...');
    try {
      await WorkspaceMember.create({
        workspaceId: testWorkspace._id,
        userId: testUser._id,
        role: WorkspaceRole.VIEWER,
      });
      throw new Error('Should have failed workspace member uniqueness check!');
    } catch (err: any) {
      if (err.message === 'Should have failed workspace member uniqueness check!') {
        throw err;
      }
      console.log(
        'WorkspaceMember uniqueness validation successfully caught duplicate key:',
        err.message,
      );
    }

    // 13. Test unique compound constraint on FileVersion (fileId + versionNumber)
    console.log('Testing FileVersion uniqueness constraint...');
    try {
      await FileVersion.create({
        fileId: testFile._id,
        versionNumber: 1,
        storageKey: 'another-key',
        mimeType: 'text/plain',
        fileSize: 100,
        uploadedBy: testUser._id,
      });
      throw new Error('Should have failed file version uniqueness check!');
    } catch (err: any) {
      if (err.message === 'Should have failed file version uniqueness check!') {
        throw err;
      }
      console.log(
        'FileVersion uniqueness validation successfully caught duplicate key:',
        err.message,
      );
    }

    console.log('\nAll model validations completed successfully.');
  } catch (error) {
    console.error('Validation error encountered:', error);
    process.exitCode = 1;
  } finally {
    console.log('\nCleaning up mock test documents...');
    await Comment.deleteMany({ _id: { $in: cleanupIds.comments } });
    await FileVersion.deleteMany({ _id: { $in: cleanupIds.versions } });
    await File.deleteMany({ _id: { $in: cleanupIds.files } });
    await Folder.deleteMany({ _id: { $in: cleanupIds.folders } });
    await WorkspaceMember.deleteMany({ _id: { $in: cleanupIds.members } });
    await Workspace.deleteMany({ _id: { $in: cleanupIds.workspaces } });
    await User.deleteMany({ _id: { $in: cleanupIds.users } });
    await Notification.deleteMany({ _id: { $in: cleanupIds.notifications } });
    await ActivityLog.deleteMany({ _id: { $in: cleanupIds.logs } });
    console.log('Cleanup complete.');

    await mongoose.disconnect();
    console.log('Database disconnected.');
  }
}

runTests();
