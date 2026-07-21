import { Router, Request, Response } from 'express';
import { authenticateJWT } from '../middleware/auth';
import { requireWorkspaceRole } from '../middleware/rbac';
import { WorkspaceRole, AIStatus } from '../models/types';
import { File } from '../models/file.model';
import { FileVersion } from '../models/fileVersion.model';
import { AIResult } from '../models/aiResult.model';
import { Workspace } from '../models/workspace.model';
import { AIJobService } from '../services/aiJob.service';
import { StorageService } from '../services/storage.service';
import { asyncHandler } from '../utils/asyncHandler';

const router = Router();

router.use(asyncHandler(authenticateJWT));

// 1. GET /:workspaceId/files/:fileId/ai - Get AI Result
router.get(
  '/:workspaceId/files/:fileId/ai',
  asyncHandler(requireWorkspaceRole(WorkspaceRole.VIEWER)),
  asyncHandler(async (req: Request, res: Response) => {
    const { workspaceId, fileId } = req.params;

    const file = await File.findOne({ _id: fileId, workspaceId, deletedAt: null });
    if (!file) {
      res.status(404).json({ error: 'File not found.' });
      return;
    }

    const version = await FileVersion.findById(file.currentVersionId);
    if (!version) {
      res.status(404).json({ error: 'Current version of the file not found.' });
      return;
    }

    const workspace = await Workspace.findOne({ _id: workspaceId, deletedAt: null });
    const aiEnabled = workspace ? workspace.aiEnabled : false;

    const aiResult = await AIResult.findOne({ fileVersionId: file.currentVersionId });

    res.status(200).json({
      aiEnabled,
      status: version.aiStatus || AIStatus.NOT_STARTED,
      summary: aiResult ? aiResult.summary : '',
      tags: aiResult ? aiResult.tags : [],
      modelName: aiResult ? aiResult.modelName : '',
      modelVersion: aiResult ? aiResult.modelVersion : '',
      generatedAt: aiResult ? aiResult.generatedAt : null,
    });
  }),
);

// 2. GET /:workspaceId/files/:fileId/text - Get Extracted Text
router.get(
  '/:workspaceId/files/:fileId/text',
  asyncHandler(requireWorkspaceRole(WorkspaceRole.VIEWER)),
  asyncHandler(async (req: Request, res: Response) => {
    const { workspaceId, fileId } = req.params;

    const file = await File.findOne({ _id: fileId, workspaceId, deletedAt: null });
    if (!file) {
      res.status(404).json({ error: 'File not found.' });
      return;
    }

    const aiResult = await AIResult.findOne({ fileVersionId: file.currentVersionId });
    if (!aiResult) {
      res.status(200).json({
        available: false,
        reason: 'AI processing not completed',
      });
      return;
    }

    if (aiResult.extractedTextCache) {
      const isTruncated = aiResult.extractedTextCache.includes('[TRUNCATED_RAW_TEXT_IN_SUPABASE]');
      res.status(200).json({
        available: true,
        content: aiResult.extractedTextCache,
        truncated: isTruncated,
      });
      return;
    }

    if (!aiResult.extractedTextStorageKey) {
      res.status(200).json({
        available: false,
        reason: 'AI processing not completed',
      });
      return;
    }

    try {
      const buffer = await StorageService.downloadFile(aiResult.extractedTextStorageKey);
      const content = buffer.toString('utf8');
      res.status(200).json({
        available: true,
        content,
        truncated: false,
      });
    } catch {
      res.status(500).json({ error: 'Failed to retrieve extracted text from storage.' });
    }
  }),
);

// 3. POST /:workspaceId/files/:fileId/reprocess - Reprocess file (High Priority AIJob)
router.post(
  '/:workspaceId/files/:fileId/reprocess',
  asyncHandler(requireWorkspaceRole(WorkspaceRole.EDITOR)),
  asyncHandler(async (req: Request, res: Response) => {
    const { workspaceId, fileId } = req.params;

    const file = await File.findOne({ _id: fileId, workspaceId, deletedAt: null });
    if (!file) {
      res.status(404).json({ error: 'File not found.' });
      return;
    }

    try {
      const job = await AIJobService.requestReprocess(
        workspaceId,
        fileId,
        file.currentVersionId!,
        req.user!._id,
      );
      res.status(200).json({
        message: 'Document successfully queued for reprocessing.',
        jobId: job._id.toString(),
        status: job.status,
        priority: job.priority,
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }),
);

export default router;
