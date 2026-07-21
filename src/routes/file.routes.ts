import { Router, Request, Response } from 'express';
import multer from 'multer';
import { authenticateJWT } from '../middleware/auth';
import { requireWorkspaceRole } from '../middleware/rbac';
import { WorkspaceRole, FileStatus, AIStatus, ActivityAction } from '../models/types';
import { File } from '../models/file.model';
import { ActivityService } from '../services/activity.service';
import { FileVersion } from '../models/fileVersion.model';
import { Folder } from '../models/folder.model';
import { StorageService } from '../services/storage.service';
import { asyncHandler } from '../utils/asyncHandler';
import { AIJobService } from '../services/aiJob.service';
import { AIJob } from '../models/aiJob.model';
import { AIResult } from '../models/aiResult.model';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.use(asyncHandler(authenticateJWT));

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const ALLOWED_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/json',
  'application/zip',
  'application/x-zip-compressed',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
];

// Helper to format file size
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// 1. POST /:workspaceId/files/upload - Upload file or new version
router.post(
  '/:workspaceId/files/upload',
  asyncHandler(requireWorkspaceRole(WorkspaceRole.EDITOR)),
  upload.single('file'),
  asyncHandler(async (req: Request, res: Response) => {
    const { workspaceId } = req.params;
    const { folderId, fileId } = req.body;

    // A. Validate uploaded file
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded.' });
      return;
    }

    if (req.file.size === 0) {
      res.status(400).json({ error: 'File is empty.' });
      return;
    }

    if (req.file.size > MAX_FILE_SIZE) {
      res
        .status(400)
        .json({ error: `File size exceeds the 50MB limit (${formatBytes(req.file.size)}).` });
      return;
    }

    if (!ALLOWED_MIME_TYPES.includes(req.file.mimetype)) {
      res.status(400).json({
        error:
          'Invalid file type. Allowed types: PDF, Word, Excel, PPT, ZIP, TXT, CSV, JSON, PNG, JPEG, GIF, WEBP.',
      });
      return;
    }

    // B. Validate folder association if provided
    if (folderId) {
      const folder = await Folder.findById(folderId);
      if (!folder || folder.deletedAt) {
        res.status(404).json({ error: 'Folder not found.' });
        return;
      }
      if (folder.workspaceId.toString() !== workspaceId) {
        res.status(400).json({ error: 'Folder does not belong to this workspace.' });
        return;
      }
    }

    let fileDoc;
    let nextVersionNumber = 1;

    // C. Check if this is a new version or new file
    if (fileId) {
      // New Version flow
      fileDoc = await File.findOne({ _id: fileId, workspaceId, deletedAt: null });
      if (!fileDoc) {
        res.status(404).json({ error: 'File not found.' });
        return;
      }

      // Determine next version number
      const lastVersion = await FileVersion.findOne({ fileId }).sort({ versionNumber: -1 });
      nextVersionNumber = lastVersion ? lastVersion.versionNumber + 1 : 1;
    } else {
      // New File flow
      fileDoc = await File.create({
        name: req.file.originalname,
        workspaceId,
        folderId: folderId || null,
        createdBy: req.user!._id,
        status: FileStatus.PENDING_UPLOAD,
        aiStatus: AIStatus.NOT_STARTED,
        tags: [],
      });
    }

    const storageKey = `${workspaceId}/${fileDoc._id}/v${nextVersionNumber}/${req.file.originalname}`;

    // D. Perform Physical Upload to Supabase
    try {
      await StorageService.uploadFile(storageKey, req.file.buffer, req.file.mimetype);
    } catch (uploadError) {
      // If it is the first version, delete the newly created File doc to prevent cluttering
      if (nextVersionNumber === 1) {
        await File.deleteOne({ _id: fileDoc._id });
      } else {
        fileDoc.status = FileStatus.UPLOAD_FAILED;
        await fileDoc.save();
      }
      res
        .status(500)
        .json({ error: (uploadError as Error).message || 'Failed to upload physical file.' });
      return;
    }

    // E. Save Metadata to MongoDB with Rollback Safeguard
    try {
      // Test-specific hook to simulate DB write failure after successful Supabase upload
      if (req.headers['x-simulate-mongo-failure'] === 'true') {
        throw new Error('Simulated MongoDB metadata write failure.');
      }

      // Create physical version document
      const fileVersion = await FileVersion.create({
        fileId: fileDoc._id,
        versionNumber: nextVersionNumber,
        storageKey,
        mimeType: req.file.mimetype,
        fileSize: req.file.size,
        uploadedBy: req.user!._id,
      });

      // Update parent file document
      fileDoc.currentVersionId = fileVersion._id;
      fileDoc.status = FileStatus.ACTIVE;
      await fileDoc.save();

      await ActivityService.createActivity(
        workspaceId,
        req.user!._id,
        ActivityAction.FILE_UPLOADED,
        { fileId: fileDoc._id.toString(), fileName: fileDoc.name },
        fileDoc._id,
        'File',
      );

      // Return populated file details
      const responseData = await File.findById(fileDoc._id)
        .populate('currentVersionId')
        .populate('createdBy', 'name email');

      res.status(201).json(responseData);

      // Asynchronously trigger the AI job outside the upload transaction
      AIJobService.createJob(workspaceId, fileDoc._id, fileVersion._id).catch((err) => {
        // eslint-disable-next-line no-console
        console.error('Failed to schedule AI job:', err);
      });
    } catch {
      // ROLLBACK: Delete the physical file from Supabase since database write failed
      try {
        await StorageService.deleteFile(storageKey);
      } catch (cleanupError) {
        // eslint-disable-next-line no-console
        console.error(
          '[CRITICAL] Failed to cleanup orphaned file from Supabase storage:',
          cleanupError,
        );
      }

      // Clean up Mongo File doc if it was the first upload
      if (nextVersionNumber === 1) {
        await File.deleteOne({ _id: fileDoc._id });
      }

      res
        .status(500)
        .json({ error: 'Failed to save file metadata. Cloud upload was rolled back.' });
    }
  }),
);

// 2. GET /:workspaceId/files - List files in workspace (paginated)
router.get(
  '/:workspaceId/files',
  asyncHandler(requireWorkspaceRole(WorkspaceRole.VIEWER)),
  asyncHandler(async (req: Request, res: Response) => {
    const { workspaceId } = req.params;

    // Parse pagination query
    let page = parseInt(req.query.page as string, 10);
    let limit = parseInt(req.query.limit as string, 10);

    if (isNaN(page) || page <= 0) page = 1;
    if (isNaN(limit) || limit <= 0) limit = 50;
    if (limit > 100) limit = 100; // Cap limit at 100

    const query = {
      workspaceId,
      status: FileStatus.ACTIVE,
      deletedAt: null,
    };

    const [items, total] = await Promise.all([
      File.find(query)
        .populate('currentVersionId')
        .populate('createdBy', 'name email')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      File.countDocuments(query),
    ]);

    res.status(200).json({
      items,
      page,
      limit,
      total,
    });
  }),
);

// 3. GET /:workspaceId/files/:fileId/download - Generate short-lived signed download URL
router.get(
  '/:workspaceId/files/:fileId/download',
  asyncHandler(requireWorkspaceRole(WorkspaceRole.VIEWER)),
  asyncHandler(async (req: Request, res: Response) => {
    const { workspaceId, fileId } = req.params;

    // Verify file exists and belongs to this workspace
    const file = await File.findOne({ _id: fileId, workspaceId, deletedAt: null });
    if (!file) {
      res.status(404).json({ error: 'File not found.' });
      return;
    }

    if (file.status !== FileStatus.ACTIVE) {
      res.status(400).json({ error: 'File is not in active status.' });
      return;
    }

    // Get the current version or specific version
    const versionId = req.query.versionId as string;
    let fileVersion;

    if (versionId) {
      fileVersion = await FileVersion.findOne({ _id: versionId, fileId: file._id });
    } else {
      fileVersion = await FileVersion.findById(file.currentVersionId);
    }

    if (!fileVersion) {
      res.status(404).json({ error: 'File version not found.' });
      return;
    }

    try {
      if (StorageService.isMockMode()) {
        await ActivityService.createActivity(
          workspaceId,
          req.user!._id,
          ActivityAction.FILE_DOWNLOADED,
          { fileId: file._id.toString(), fileName: file.name },
          file._id,
          'File',
        );

        res.status(200).json({
          useApiStream: true,
          streamPath: `/workspaces/${workspaceId}/files/${fileId}/content`,
        });
        return;
      }

      const signedUrl = await StorageService.generateSignedUrl(fileVersion.storageKey, 60);

      await ActivityService.createActivity(
        workspaceId,
        req.user!._id,
        ActivityAction.FILE_DOWNLOADED,
        { fileId: file._id.toString(), fileName: file.name },
        file._id,
        'File',
      );

      res.status(200).json({ downloadUrl: signedUrl });
    } catch {
      res.status(500).json({ error: 'Failed to generate secure download URL.' });
    }
  }),
);

// 3b. GET /:workspaceId/files/:fileId/content - Stream file bytes (mock / local dev storage)
router.get(
  '/:workspaceId/files/:fileId/content',
  asyncHandler(requireWorkspaceRole(WorkspaceRole.VIEWER)),
  asyncHandler(async (req: Request, res: Response) => {
    const { workspaceId, fileId } = req.params;

    const file = await File.findOne({ _id: fileId, workspaceId, deletedAt: null });
    if (!file || file.status !== FileStatus.ACTIVE) {
      res.status(404).json({ error: 'File not found.' });
      return;
    }

    const fileVersion = await FileVersion.findById(file.currentVersionId);
    if (!fileVersion) {
      res.status(404).json({ error: 'File version not found.' });
      return;
    }

    try {
      const buffer = await StorageService.downloadFile(fileVersion.storageKey);
      res.setHeader('Content-Type', fileVersion.mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.name)}"`);
      res.send(buffer);
    } catch {
      res.status(500).json({ error: 'Failed to read file from storage.' });
    }
  }),
);

// 4. DELETE /:workspaceId/files/:fileId - Delete file and its physical versions
router.delete(
  '/:workspaceId/files/:fileId',
  asyncHandler(requireWorkspaceRole(WorkspaceRole.EDITOR)),
  asyncHandler(async (req: Request, res: Response) => {
    const { workspaceId, fileId } = req.params;

    const file = await File.findOne({ _id: fileId, workspaceId, deletedAt: null });
    if (!file) {
      res.status(404).json({ error: 'File not found.' });
      return;
    }

    // Mark file metadata as deleted
    file.status = FileStatus.DELETED;
    file.deletedAt = new Date();
    await file.save();

    try {
      await ActivityService.createActivity(
        workspaceId,
        req.user!._id,
        ActivityAction.FILE_DELETED,
        { fileId: file._id.toString(), fileName: file.name },
        file._id,
        'File',
      );
    } catch (activityError) {
      // eslint-disable-next-line no-console
      console.error(
        `[WARN] Failed to log FILE_DELETED activity for file ${file._id}:`,
        activityError,
      );
    }

    // Retrieve and delete all physical file versions from Supabase
    const versions = await FileVersion.find({ fileId: file._id });
    for (const version of versions) {
      try {
        await StorageService.deleteFile(version.storageKey);
        await version.deleteOne();
      } catch (deleteError) {
        // eslint-disable-next-line no-console
        console.error(
          `[WARN] Failed to delete file version ${version.versionNumber} for file ${file._id}:`,
          deleteError,
        );
      }
    }

    // AI-006: Clean up AI jobs and results on hard delete
    try {
      await AIJob.deleteMany({ fileId: file._id });
      await AIResult.deleteMany({ fileId: file._id });
    } catch (aiCleanupError) {
      // eslint-disable-next-line no-console
      console.error(
        `[WARN] Failed to delete AI jobs or results for file ${file._id}:`,
        aiCleanupError,
      );
    }

    res.status(200).json({ message: 'File and all physical versions deleted successfully.' });
  }),
);

// 5. PATCH /:workspaceId/files/:fileId - Switch active version / rollback
router.patch(
  '/:workspaceId/files/:fileId',
  asyncHandler(requireWorkspaceRole(WorkspaceRole.EDITOR)),
  asyncHandler(async (req: Request, res: Response) => {
    const { workspaceId, fileId } = req.params;
    const { currentVersionId } = req.body;

    if (!currentVersionId) {
      res.status(400).json({ error: 'currentVersionId is required.' });
      return;
    }

    const file = await File.findOne({ _id: fileId, workspaceId, deletedAt: null });
    if (!file) {
      res.status(404).json({ error: 'File not found.' });
      return;
    }

    // Verify version exists and belongs to this file
    const version = await FileVersion.findOne({ _id: currentVersionId, fileId: file._id });
    if (!version) {
      res.status(404).json({ error: 'FileVersion not found for this file.' });
      return;
    }

    // Retrieve cached AIResult for the target version
    const aiResult = await AIResult.findOne({ fileVersionId: currentVersionId });

    // Update File metadata using target version's state
    file.currentVersionId = version._id;
    file.aiStatus = version.aiStatus;
    file.summary = aiResult ? aiResult.summary : '';
    file.tags = aiResult ? aiResult.tags : [];
    await file.save();

    await ActivityService.createActivity(
      workspaceId,
      req.user!._id,
      ActivityAction.FILE_UPLOADED,
      { fileId: file._id.toString(), fileName: file.name, versionNumber: version.versionNumber },
      file._id,
      'File',
    );

    res.status(200).json({
      message: 'Active file version updated successfully.',
      file,
    });
  }),
);

export default router;
