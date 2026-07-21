import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { authenticateJWT } from '../middleware/auth';
import { requireWorkspaceRole } from '../middleware/rbac';
import { WorkspaceRole } from '../models/types';
import { File } from '../models/file.model';
import { AIResult } from '../models/aiResult.model';
import { Workspace } from '../models/workspace.model';
import { asyncHandler } from '../utils/asyncHandler';

const router = Router();

// Apply JWT authentication
router.use(asyncHandler(authenticateJWT));

// GET /workspaces/:workspaceId/intelligence - Fetch workspace intelligence stats
router.get(
  '/:workspaceId/intelligence',
  asyncHandler(requireWorkspaceRole(WorkspaceRole.VIEWER)),
  asyncHandler(async (req: Request, res: Response) => {
    const { workspaceId } = req.params;
    const wsObjectId = new mongoose.Types.ObjectId(workspaceId);

    // 1. Fetch Workspace setting
    const workspace = await Workspace.findOne({ _id: wsObjectId, deletedAt: null });
    if (!workspace) {
      res.status(404).json({ error: 'Workspace not found.' });
      return;
    }

    // 2. Fetch all active files in the workspace
    const files = await File.find({
      workspaceId: wsObjectId,
      status: 'ACTIVE',
      deletedAt: null,
    }).populate('currentVersionId');

    const totalFiles = files.length;
    const processedFiles = files.filter((f) => f.aiStatus === 'READY').length;
    const coverage = totalFiles > 0 ? Math.round((processedFiles / totalFiles) * 100) : 0;

    // 3. Fetch corresponding AIResult documents for active versions
    const activeVersionIds = files
      .map((f) => f.currentVersionId?._id)
      .filter((id): id is mongoose.Types.ObjectId => !!id);

    const aiResults = await AIResult.find({
      fileVersionId: { $in: activeVersionIds },
    });

    const aiResultMap = new Map<string, (typeof aiResults)[0]>();
    for (const result of aiResults) {
      aiResultMap.set(result.fileVersionId.toString(), result);
    }

    // 4. Calculate top 5 tags by frequency
    const tagCounts: Record<string, number> = {};
    for (const file of files) {
      const fileTags = file.tags || [];
      const versionId = file.currentVersionId?._id?.toString();
      const aiResult = versionId ? aiResultMap.get(versionId) : null;
      const aiTags = aiResult?.tags || [];
      const combinedTags = Array.from(new Set([...fileTags, ...aiTags]));

      for (const tag of combinedTags) {
        if (!tag) continue;
        const normalized = tag.trim();
        if (!normalized) continue;
        tagCounts[normalized] = (tagCounts[normalized] || 0) + 1;
      }
    }

    const topTags = Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 5)
      .map(([tag]) => tag);

    // 5. Retrieve most recent 5 AI processed files
    const processedFilesList = files
      .filter((f) => f.aiStatus === 'READY')
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 5);

    const recentInsights = processedFilesList.map((file) => {
      const versionId = file.currentVersionId?._id?.toString();
      const aiResult = versionId ? aiResultMap.get(versionId) : null;
      return {
        fileId: file._id.toString(),
        name: file.name,
        summary: aiResult?.summary || '',
        tags: Array.from(new Set([...(file.tags || []), ...(aiResult?.tags || [])])),
        updatedAt: file.updatedAt,
      };
    });

    res.status(200).json({
      totalFiles,
      processedFiles,
      coverage,
      topTags,
      recentInsights,
      aiEnabled: workspace.aiEnabled,
      searchReady: processedFiles,
    });
  }),
);

export default router;
