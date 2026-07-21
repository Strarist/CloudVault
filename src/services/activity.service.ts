import mongoose from 'mongoose';
import { ActivityLog, IActivityLog } from '../models/activityLog.model';
import { ActivityAction } from '../models/types';

export class ActivityService {
  /**
   * Helper to validate metadata schema for each action type to prevent drift
   */
  private static validateMetadata(action: ActivityAction, metadata: Record<string, unknown>): void {
    if (!metadata) {
      throw new Error('Metadata is required for logging activities.');
    }

    switch (action) {
      case ActivityAction.WORKSPACE_CREATED:
        if (typeof metadata.workspaceName !== 'string' || !metadata.workspaceName.trim()) {
          throw new Error(
            'WORKSPACE_CREATED metadata must contain a valid "workspaceName" string.',
          );
        }
        break;

      case ActivityAction.WORKSPACE_MEMBER_ADDED:
        if (!metadata.userId || typeof metadata.role !== 'string') {
          throw new Error('WORKSPACE_MEMBER_ADDED metadata must contain "userId" and "role".');
        }
        break;

      case ActivityAction.WORKSPACE_MEMBER_REMOVED:
        if (!metadata.userId) {
          throw new Error('WORKSPACE_MEMBER_REMOVED metadata must contain "userId".');
        }
        break;

      case ActivityAction.WORKSPACE_ROLE_CHANGED:
        if (
          !metadata.userId ||
          typeof metadata.oldRole !== 'string' ||
          typeof metadata.newRole !== 'string'
        ) {
          throw new Error(
            'WORKSPACE_ROLE_CHANGED metadata must contain "userId", "oldRole", and "newRole".',
          );
        }
        break;

      case ActivityAction.FILE_UPLOADED:
      case ActivityAction.FILE_DELETED:
      case ActivityAction.FILE_DOWNLOADED:
        if (
          !metadata.fileId ||
          typeof metadata.fileName !== 'string' ||
          !metadata.fileName.trim()
        ) {
          throw new Error(`${action} metadata must contain "fileId" and "fileName".`);
        }
        break;

      case ActivityAction.COMMENT_CREATED:
      case ActivityAction.COMMENT_DELETED:
        if (!metadata.commentId || !metadata.fileId) {
          throw new Error(`${action} metadata must contain "commentId" and "fileId".`);
        }
        break;

      case ActivityAction.MENTION_CREATED:
        if (!metadata.commentId || !metadata.mentionedUserId) {
          throw new Error(`${action} metadata must contain "commentId" and "mentionedUserId".`);
        }
        break;

      default:
        // Accept other actions without validation for extensibility
        break;
    }
  }

  /**
   * Logs a new historical activity to MongoDB
   */
  public static async createActivity(
    workspaceId: string | mongoose.Types.ObjectId,
    actorId: string | mongoose.Types.ObjectId,
    action: ActivityAction,
    metadata: Record<string, unknown>,
    targetId?: string | mongoose.Types.ObjectId,
    targetType?: string,
  ): Promise<IActivityLog> {
    // 1. Enforce metadata consistency
    this.validateMetadata(action, metadata);

    // 2. Create the document
    const log = await ActivityLog.create({
      workspaceId: new mongoose.Types.ObjectId(workspaceId.toString()),
      actorId: new mongoose.Types.ObjectId(actorId.toString()),
      action,
      targetId: targetId ? new mongoose.Types.ObjectId(targetId.toString()) : null,
      targetType: targetType || '',
      metadata,
      timestamp: new Date(),
    });

    return log;
  }
}
