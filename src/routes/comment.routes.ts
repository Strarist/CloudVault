import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { authenticateJWT } from '../middleware/auth';
import { requireWorkspaceRole } from '../middleware/rbac';
import { WorkspaceRole, ActivityAction, NotificationType } from '../models/types';
import { File } from '../models/file.model';
import { Comment } from '../models/comment.model';
import { User } from '../models/user.model';
import { Notification } from '../models/notification.model';
import { ActivityService } from '../services/activity.service';
import { asyncHandler } from '../utils/asyncHandler';

const router = Router();

// Apply authentication to all routes
router.use(asyncHandler(authenticateJWT));

/**
 * Extract mentions from comment text using regex
 * Matches @username patterns
 */
function extractMentions(content: string): string[] {
  const mentionRegex = /@(\w+)/g;
  const matches = content.match(mentionRegex);
  return matches ? matches.map((m) => m.substring(1)) : [];
}

/**
 * POST /workspaces/:workspaceId/files/:fileId/comments
 * Create a new comment on a file
 */
router.post(
  '/:workspaceId/files/:fileId/comments',
  asyncHandler(requireWorkspaceRole(WorkspaceRole.EDITOR)),
  asyncHandler(async (req: Request, res: Response) => {
    const { workspaceId, fileId } = req.params;
    const { content } = req.body;
    const userId = req.user?.id;

    // Validate input
    if (!content || typeof content !== 'string' || !content.trim()) {
      res.status(400).json({ error: 'Comment content is required and cannot be empty.' });
      return;
    }

    // Validate file exists and belongs to workspace
    const file = await File.findOne({
      _id: new mongoose.Types.ObjectId(fileId),
      workspaceId: new mongoose.Types.ObjectId(workspaceId),
      deletedAt: null,
    });

    if (!file) {
      res.status(404).json({ error: 'File not found.' });
      return;
    }

    // Extract mentions from content
    const mentionedUsernames = extractMentions(content);
    const mentionedUsers: mongoose.Types.ObjectId[] = [];

    // Resolve mentioned usernames to user IDs
    if (mentionedUsernames.length > 0) {
      const lowercasedUsernames = mentionedUsernames.map((u) => u.toLowerCase());
      const users = await User.find(
        { username: { $in: lowercasedUsernames } },
        { _id: 1, username: 1 },
      );
      mentionedUsers.push(...users.map((u) => u._id));
    }

    // Create comment
    const comment = await Comment.create({
      fileId: new mongoose.Types.ObjectId(fileId),
      workspaceId: new mongoose.Types.ObjectId(workspaceId),
      authorId: new mongoose.Types.ObjectId(userId),
      content: content.trim(),
      mentions: mentionedUsers,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Log activity: COMMENT_CREATED
    await ActivityService.createActivity(
      workspaceId,
      userId,
      ActivityAction.COMMENT_CREATED,
      {
        commentId: comment._id.toString(),
        fileId: fileId,
      },
      comment._id,
      'Comment',
    );

    // Generate MENTION notifications for each mentioned user
    for (const mentionedUserId of mentionedUsers) {
      // Only notify if mentioned user is different from the commenter
      if (!mentionedUserId.equals(new mongoose.Types.ObjectId(userId))) {
        await Notification.create({
          userId: mentionedUserId,
          type: NotificationType.MENTION,
          payload: {
            commentId: comment._id.toString(),
            fileId: fileId,
            workspaceId: workspaceId,
            actorId: userId,
          },
          isRead: false,
          createdAt: new Date(),
        });

        // Log activity: MENTION_CREATED
        await ActivityService.createActivity(
          workspaceId,
          userId,
          ActivityAction.MENTION_CREATED,
          {
            commentId: comment._id.toString(),
            mentionedUserId: mentionedUserId.toString(),
          },
          mentionedUserId,
          'User',
        );
      }
    }

    // Generate COMMENT notification for file owner if different from commenter
    if (file.createdBy && !file.createdBy.equals(new mongoose.Types.ObjectId(userId))) {
      await Notification.create({
        userId: file.createdBy,
        type: NotificationType.COMMENT,
        payload: {
          commentId: comment._id.toString(),
          fileId: fileId,
          workspaceId: workspaceId,
          actorId: userId,
        },
        isRead: false,
        createdAt: new Date(),
      });
    }

    // Populate author and mentions for response
    const populatedComment = await Comment.findById(comment._id)
      .populate('authorId', 'username email')
      .populate('mentions', 'username email');

    res.status(201).json(populatedComment);
  }),
);

/**
 * GET /workspaces/:workspaceId/files/:fileId/comments
 * List comments on a file with pagination
 * Query params: page=1, limit=20 (max 100)
 */
router.get(
  '/:workspaceId/files/:fileId/comments',
  asyncHandler(requireWorkspaceRole(WorkspaceRole.VIEWER)),
  asyncHandler(async (req: Request, res: Response) => {
    const { workspaceId, fileId } = req.params;
    const { page, limit } = req.query;

    // Parse and validate pagination params
    let pageNum = parseInt(page as string) || 1;
    let limitNum = parseInt(limit as string) || 20;

    if (pageNum < 1) pageNum = 1;
    if (limitNum < 1) limitNum = 20;
    if (limitNum > 100) limitNum = 100; // Max 100 per request

    // Validate file exists and belongs to workspace
    const file = await File.findOne({
      _id: new mongoose.Types.ObjectId(fileId),
      workspaceId: new mongoose.Types.ObjectId(workspaceId),
      deletedAt: null,
    });

    if (!file) {
      res.status(404).json({ error: 'File not found.' });
      return;
    }

    // Calculate skip amount
    const skip = (pageNum - 1) * limitNum;

    // Get total count for pagination info
    const totalCount = await Comment.countDocuments({
      fileId: new mongoose.Types.ObjectId(fileId),
      workspaceId: new mongoose.Types.ObjectId(workspaceId),
    });

    // Fetch comments, newest first
    const comments = await Comment.find({
      fileId: new mongoose.Types.ObjectId(fileId),
      workspaceId: new mongoose.Types.ObjectId(workspaceId),
    })
      .populate('authorId', 'username email avatar')
      .populate('mentions', 'username email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum);

    res.json({
      comments,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: totalCount,
        totalPages: Math.ceil(totalCount / limitNum),
      },
    });
  }),
);

/**
 * DELETE /workspaces/:workspaceId/files/:fileId/comments/:commentId
 * Delete a comment
 * Only comment author, workspace admin, or workspace owner can delete
 */
router.delete(
  '/:workspaceId/files/:fileId/comments/:commentId',
  asyncHandler(requireWorkspaceRole(WorkspaceRole.EDITOR)),
  asyncHandler(async (req: Request, res: Response) => {
    const { workspaceId, fileId, commentId } = req.params;
    const userId = req.user?.id;
    const userRole = req.membership?.role;

    // Validate file exists
    const file = await File.findOne({
      _id: new mongoose.Types.ObjectId(fileId),
      workspaceId: new mongoose.Types.ObjectId(workspaceId),
      deletedAt: null,
    });

    if (!file) {
      res.status(404).json({ error: 'File not found.' });
      return;
    }

    // Find comment
    const comment = await Comment.findOne({
      _id: new mongoose.Types.ObjectId(commentId),
      fileId: new mongoose.Types.ObjectId(fileId),
      workspaceId: new mongoose.Types.ObjectId(workspaceId),
    });

    if (!comment) {
      res.status(404).json({ error: 'Comment not found.' });
      return;
    }

    // Check authorization: author, admin, or owner
    const isAuthor = comment.authorId.equals(new mongoose.Types.ObjectId(userId));
    const isAdminOrOwner = userRole === WorkspaceRole.ADMIN || userRole === WorkspaceRole.OWNER;

    if (!isAuthor && !isAdminOrOwner) {
      res.status(403).json({ error: 'You do not have permission to delete this comment.' });
      return;
    }

    // Delete comment
    await Comment.deleteOne({ _id: new mongoose.Types.ObjectId(commentId) });

    // Log activity: COMMENT_DELETED
    await ActivityService.createActivity(
      workspaceId,
      userId,
      ActivityAction.COMMENT_DELETED,
      {
        commentId: commentId,
        fileId: fileId,
      },
      new mongoose.Types.ObjectId(commentId),
      'Comment',
    );

    res.json({ message: 'Comment deleted successfully.' });
  }),
);

export default router;
