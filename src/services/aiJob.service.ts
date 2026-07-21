import mongoose from 'mongoose';
import { Workspace } from '../models/workspace.model';
import { File } from '../models/file.model';
import { FileVersion } from '../models/fileVersion.model';
import { AIJob, IAIJob } from '../models/aiJob.model';
import { WorkspaceType, AIStatus, ActivityAction } from '../models/types';
import { ActivityService } from './activity.service';
import { ActivityLog } from '../models/activityLog.model';

export class AIJobService {
  /**
   * Schedules a new AI job for a file version
   * Enforces Workspace AI enabled status and monthly cost governance limits
   */
  static async createJob(
    workspaceId: string | mongoose.Types.ObjectId,
    fileId: string | mongoose.Types.ObjectId,
    fileVersionId: string | mongoose.Types.ObjectId,
    priority: number = 1,
  ): Promise<IAIJob | null> {
    const wsId = new mongoose.Types.ObjectId(workspaceId);
    const fId = new mongoose.Types.ObjectId(fileId);
    const fvId = new mongoose.Types.ObjectId(fileVersionId);

    // 1. Fetch parent Workspace and check AI toggle status
    const workspace = await Workspace.findOne({ _id: wsId, deletedAt: null });
    if (!workspace || !workspace.aiEnabled) {
      return null;
    }

    // 2. Enforce monthly cost governance limits
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const processedCount = await ActivityLog.countDocuments({
      workspaceId: wsId,
      action: ActivityAction.AI_PROCESSING_COMPLETED,
      timestamp: { $gte: startOfMonth },
    });

    const limit = workspace.type === WorkspaceType.TEAM ? 1000 : 100;
    if (processedCount >= limit) {
      // Mark File AI status directly to FAILED with monthly limit notification
      await File.updateOne({ _id: fId }, { aiStatus: AIStatus.FAILED });
      await FileVersion.updateOne({ _id: fvId }, { aiStatus: AIStatus.FAILED });
      return null;
    }

    // 3. Prevent duplicate active jobs (idempotency)
    const existingJob = await AIJob.findOne({
      fileVersionId: fvId,
      jobType: 'SUMMARIZE_AND_EMBED',
    });
    if (existingJob) {
      if (existingJob.status === 'CANCELLED' || existingJob.status === 'FAILED') {
        // Reset cancelled or failed jobs for scheduling
        existingJob.status = 'PENDING';
        existingJob.attemptCount = 0;
        existingJob.priority = priority;
        existingJob.runAfter = new Date();
        await existingJob.save();

        await File.updateOne({ _id: fId }, { aiStatus: AIStatus.PENDING });
        await FileVersion.updateOne({ _id: fvId }, { aiStatus: AIStatus.PENDING });
        return existingJob;
      }
      return existingJob;
    }

    // 4. Create new job entry
    try {
      const job = await AIJob.create({
        workspaceId: wsId,
        fileId: fId,
        fileVersionId: fvId,
        jobType: 'SUMMARIZE_AND_EMBED',
        status: 'PENDING',
        priority,
        runAfter: new Date(),
      });

      // Update File and FileVersion AIStatus to PENDING
      await File.updateOne({ _id: fId }, { aiStatus: AIStatus.PENDING });
      await FileVersion.updateOne({ _id: fvId }, { aiStatus: AIStatus.PENDING });

      return job;
    } catch (err: any) {
      if (err.code === 11000) {
        // Handle race conditions where another call inserted first
        const job = await AIJob.findOne({ fileVersionId: fvId, jobType: 'SUMMARIZE_AND_EMBED' });
        return job;
      }
      throw err;
    }
  }

  /**
   * Toggles Workspace AI status and cancels pending/processing jobs if disabled
   */
  static async toggleWorkspaceAI(
    workspaceId: string | mongoose.Types.ObjectId,
    aiEnabled: boolean,
  ): Promise<void> {
    const wsId = new mongoose.Types.ObjectId(workspaceId);

    // Update workspace configuration
    await Workspace.updateOne({ _id: wsId }, { aiEnabled });

    if (!aiEnabled) {
      // Cancel all pending or processing jobs for the workspace
      const toCancel = await AIJob.find({
        workspaceId: wsId,
        status: { $in: ['PENDING', 'PROCESSING'] },
      }).select('fileId fileVersionId');

      await AIJob.updateMany(
        { workspaceId: wsId, status: { $in: ['PENDING', 'PROCESSING'] } },
        { $set: { status: 'CANCELLED' } },
      );

      const fileIds = Array.from(new Set(toCancel.map((j) => j.fileId.toString())));
      const versionIds = Array.from(
        new Set(toCancel.map((j) => j.fileVersionId.toString()).filter(Boolean)),
      );

      if (fileIds.length > 0) {
        await File.updateMany(
          { _id: { $in: fileIds.map((id) => new mongoose.Types.ObjectId(id)) } },
          { aiStatus: AIStatus.FAILED },
        );
      }
      if (versionIds.length > 0) {
        await FileVersion.updateMany(
          { _id: { $in: versionIds.map((id) => new mongoose.Types.ObjectId(id)) } },
          { aiStatus: AIStatus.FAILED },
        );
      }
    }
  }

  /**
   * User-initiated manual retry for failed AI jobs
   */
  static async requestReprocess(
    workspaceId: string | mongoose.Types.ObjectId,
    fileId: string | mongoose.Types.ObjectId,
    fileVersionId: string | mongoose.Types.ObjectId,
    userId: string | mongoose.Types.ObjectId,
  ): Promise<IAIJob> {
    const wsId = new mongoose.Types.ObjectId(workspaceId);
    const fId = new mongoose.Types.ObjectId(fileId);
    const fvId = new mongoose.Types.ObjectId(fileVersionId);

    // Verify workspace has AI enabled
    const workspace = await Workspace.findOne({ _id: wsId, deletedAt: null });
    if (!workspace || !workspace.aiEnabled) {
      throw new Error('AI processing is disabled for this workspace.');
    }

    // Verify version exists
    const version = await FileVersion.findOne({ _id: fvId, fileId: fId });
    if (!version) {
      throw new Error('Target file version not found.');
    }

    // Verify duplicate job isn't already active
    const activeJob = await AIJob.findOne({
      fileVersionId: fvId,
      status: { $in: ['PENDING', 'PROCESSING'] },
    });
    if (activeJob) {
      throw new Error('Job is already active or queued for this version.');
    }

    // Log Activity: AI_REPROCESS_REQUESTED
    await ActivityService.createActivity(
      workspaceId.toString(),
      userId.toString(),
      ActivityAction.AI_REPROCESS_REQUESTED,
      {
        fileId: fId.toString(),
        fileVersionId: fvId.toString(),
      },
    );

    // Create or reset Job as Priority 0 (High Priority)
    const job = await AIJob.findOneAndUpdate(
      { fileVersionId: fvId, jobType: 'SUMMARIZE_AND_EMBED' },
      {
        $set: {
          status: 'PENDING',
          attemptCount: 0,
          priority: 0, // High Priority
          runAfter: new Date(),
          workspaceId: wsId,
          fileId: fId,
        },
      },
      { upsert: true, new: true },
    );

    // Update File and FileVersion status to PROCESSING
    await File.updateOne({ _id: fId }, { aiStatus: AIStatus.PROCESSING });
    await FileVersion.updateOne({ _id: fvId }, { aiStatus: AIStatus.PROCESSING });

    return job;
  }
}
