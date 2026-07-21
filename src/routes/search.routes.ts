import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { authenticateJWT } from '../middleware/auth';
import { requireWorkspaceRole } from '../middleware/rbac';
import { WorkspaceRole } from '../models/types';
import { File } from '../models/file.model';
import { AIResult } from '../models/aiResult.model';
import { Workspace } from '../models/workspace.model';
import { searchEmbeddingService } from '../services/searchEmbedding.service';
import { asyncHandler } from '../utils/asyncHandler';

const router = Router();

// Apply JWT authentication
router.use(asyncHandler(authenticateJWT));

/**
 * Helper to calculate Cosine Similarity between two numeric vectors.
 */
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (!vecA || !vecB || vecA.length === 0 || vecA.length !== vecB.length) {
    return 0;
  }
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) {
    return 0;
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// GET /workspaces/:workspaceId/search - Multi-mode search across name, tags, and summary
router.get(
  '/:workspaceId/search',
  asyncHandler(requireWorkspaceRole(WorkspaceRole.VIEWER)),
  asyncHandler(async (req: Request, res: Response) => {
    const { workspaceId } = req.params;
    const { q, page = '1', limit = '20', mode = 'keyword' } = req.query;

    // 1. Validation Checks
    if (!q || typeof q !== 'string' || q.trim().length < 2) {
      res.status(400).json({ error: 'Query parameter q must be at least 2 characters long.' });
      return;
    }

    if (mode !== 'keyword' && mode !== 'semantic' && mode !== 'hybrid') {
      res.status(400).json({ error: 'Search mode must be one of: keyword, semantic, hybrid.' });
      return;
    }

    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);

    if (isNaN(pageNum) || pageNum < 1) {
      res.status(400).json({ error: 'Page parameter must be a positive integer.' });
      return;
    }

    if (isNaN(limitNum) || limitNum < 1 || limitNum > 50) {
      res.status(400).json({ error: 'Limit parameter must be an integer between 1 and 50.' });
      return;
    }

    const wsObjectId = new mongoose.Types.ObjectId(workspaceId);

    // Fetch workspace to verify existence & check if AI is enabled
    const workspace = await Workspace.findOne({ _id: wsObjectId, deletedAt: null });
    if (!workspace) {
      res.status(404).json({ error: 'Workspace not found.' });
      return;
    }

    // AI Disabled Workspace restrictions (Part G)
    if ((mode === 'semantic' || mode === 'hybrid') && !workspace.aiEnabled) {
      res.status(200).json({
        available: false,
        reason: 'AI search disabled for workspace',
      });
      return;
    }

    // 2. Fetch all active files in the workspace
    const files = await File.find({
      workspaceId: wsObjectId,
      status: 'ACTIVE',
      deletedAt: null,
    }).populate('currentVersionId');

    if (files.length === 0) {
      res.status(200).json({
        items: [],
        page: pageNum,
        limit: limitNum,
        total: 0,
      });
      return;
    }

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

    // 4. Score Calculation based on Mode
    const scoredResults: any[] = [];

    if (mode === 'keyword') {
      const queryLower = q.toLowerCase();
      for (const file of files) {
        let score = 0;
        let matchedOn: 'name' | 'tag' | 'summary' | null = null;

        // Match A: Filename Match (100 points)
        if (file.name.toLowerCase().includes(queryLower)) {
          score += 100;
          matchedOn = 'name';
        }

        const versionId = file.currentVersionId?._id?.toString();
        const aiResult = versionId ? aiResultMap.get(versionId) : null;

        // Match B: Tag Match (50 points)
        const fileTags = file.tags || [];
        const aiTags = aiResult?.tags || [];
        const allTags = Array.from(new Set([...fileTags, ...aiTags]));

        const tagMatches = allTags.some((tag) => tag.toLowerCase().includes(queryLower));
        if (tagMatches) {
          score += 50;
          if (!matchedOn) {
            matchedOn = 'tag';
          }
        }

        // Match C: Summary Match (20 points)
        if (aiResult?.summary && aiResult.summary.toLowerCase().includes(queryLower)) {
          score += 20;
          if (!matchedOn) {
            matchedOn = 'summary';
          }
        }

        // Exclude files with 0 matches
        if (score > 0) {
          scoredResults.push({
            fileId: file._id.toString(),
            name: file.name,
            mimeType: (file.currentVersionId as any)?.mimeType || 'application/octet-stream',
            aiStatus: file.aiStatus,
            summary: aiResult?.summary || '',
            tags: allTags,
            updatedAt: file.updatedAt,
            matchedOn,
            score,
          });
        }
      }
    } else if (mode === 'semantic') {
      // Generate query embedding
      const queryEmbedding = await searchEmbeddingService.generateQueryEmbedding(q);

      for (const file of files) {
        const versionId = file.currentVersionId?._id?.toString();
        const aiResult = versionId ? aiResultMap.get(versionId) : null;

        if (!aiResult || !aiResult.embedding || aiResult.embedding.length === 0) {
          continue;
        }

        const similarity = cosineSimilarity(queryEmbedding, aiResult.embedding);

        const fileTags = file.tags || [];
        const aiTags = aiResult.tags || [];
        const allTags = Array.from(new Set([...fileTags, ...aiTags]));

        if (similarity > 0) {
          scoredResults.push({
            fileId: file._id.toString(),
            name: file.name,
            mimeType: (file.currentVersionId as any)?.mimeType || 'application/octet-stream',
            aiStatus: file.aiStatus,
            summary: aiResult.summary || '',
            tags: allTags,
            updatedAt: file.updatedAt,
            matchedOn: 'semantic',
            score: similarity, // raw Cosine Similarity
          });
        }
      }
    } else if (mode === 'hybrid') {
      // Generate query embedding
      const queryEmbedding = await searchEmbeddingService.generateQueryEmbedding(q);
      const queryLower = q.toLowerCase();

      for (const file of files) {
        // A. Keyword scoring
        let keywordPoints = 0;
        let matchedOn: 'name' | 'tag' | 'summary' | 'semantic' | null = null;

        if (file.name.toLowerCase().includes(queryLower)) {
          keywordPoints += 100;
          matchedOn = 'name';
        }

        const versionId = file.currentVersionId?._id?.toString();
        const aiResult = versionId ? aiResultMap.get(versionId) : null;

        const fileTags = file.tags || [];
        const aiTags = aiResult?.tags || [];
        const allTags = Array.from(new Set([...fileTags, ...aiTags]));

        const tagMatches = allTags.some((tag) => tag.toLowerCase().includes(queryLower));
        if (tagMatches) {
          keywordPoints += 50;
          if (!matchedOn) matchedOn = 'tag';
        }

        if (aiResult?.summary && aiResult.summary.toLowerCase().includes(queryLower)) {
          keywordPoints += 20;
          if (!matchedOn) matchedOn = 'summary';
        }

        // B. Normalize keyword points to range [0, 1.7]
        const normalizedKeyword = keywordPoints / 100;

        // C. Semantic similarity scoring
        let similarity = 0;
        if (aiResult && aiResult.embedding && aiResult.embedding.length > 0) {
          similarity = cosineSimilarity(queryEmbedding, aiResult.embedding);
          if (!matchedOn && similarity > 0) {
            matchedOn = 'semantic';
          }
        }

        // D. Combined score (70% Semantic, 30% Keyword)
        const combinedScore = 0.7 * similarity + 0.3 * normalizedKeyword;

        // Only include if combined score is positive
        if (combinedScore > 0) {
          scoredResults.push({
            fileId: file._id.toString(),
            name: file.name,
            mimeType: (file.currentVersionId as any)?.mimeType || 'application/octet-stream',
            aiStatus: file.aiStatus,
            summary: aiResult?.summary || '',
            tags: allTags,
            updatedAt: file.updatedAt,
            matchedOn: matchedOn || 'semantic',
            score: combinedScore,
          });
        }
      }
    }

    // 5. Sort descending: Score first, then newest updatedAt
    scoredResults.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });

    // 6. Pagination
    const total = scoredResults.length;
    const startIndex = (pageNum - 1) * limitNum;
    const paginatedItems = scoredResults.slice(startIndex, startIndex + limitNum);

    res.status(200).json({
      items: paginatedItems,
      page: pageNum,
      limit: limitNum,
      total,
    });
  }),
);

export default router;
