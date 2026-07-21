import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { AIJob } from '../models/aiJob.model';
import { AIResult } from '../models/aiResult.model';
import { File } from '../models/file.model';
import { FileVersion } from '../models/fileVersion.model';
import { Workspace } from '../models/workspace.model';
import { AIStatus, ActivityAction, WorkspaceRole, NotificationType } from '../models/types';
import { createAIProvider, isMockAIProvider } from '../services/aiProvider.service';
import { ActivityService } from '../services/activity.service';
import { withTimeout } from '../services/aiTimeout.service';
import {
  buildMockExtractedText,
  extractTextFromFileVersion,
  TextExtractError,
} from '../services/textExtract.service';
import { WorkspaceMember } from '../models/workspaceMember.model';
import { Notification } from '../models/notification.model';

// Load environment variables
const envPath = path.join(__dirname, '..', '..', '.env');
if (fs.existsSync(envPath)) {
  const envText = fs.readFileSync(envPath, 'utf8').replace(/^(\s*[A-Z0-9_]+)\s+=/gm, '$1=');
  const env = dotenv.parse(envText);
  for (const k in env) {
    process.env[k] = env[k];
  }
}

const workerId = `worker-${os.hostname()}-${process.pid}-${Math.random().toString(36).substring(2, 7)}`;
let pollingEnabled = true;
let activeJobPromise: Promise<void> | null = null;
const aiProvider = createAIProvider();
const SYSTEM_ACTOR_ID = new mongoose.Types.ObjectId('000000000000000000000000');

// Inline heartbeat schema
const workerHeartbeatSchema = new mongoose.Schema(
  {
    workerId: { type: String, required: true, unique: true },
    lastHeartbeat: { type: Date, required: true, default: Date.now },
    hostname: { type: String, required: true },
    activeJobsCount: { type: Number, required: true, default: 0 },
  },
  { collection: 'worker_heartbeats' },
);
const WorkerHeartbeat = mongoose.model('WorkerHeartbeat', workerHeartbeatSchema);

/**
 * Classify error as TRANSIENT or PERMANENT
 */
function classifyError(err: any): 'TRANSIENT' | 'PERMANENT' {
  const msg = (err.message || '').toLowerCase();
  const status = err.status || err.response?.status;

  if (
    status === 429 ||
    status === 503 ||
    status === 504 ||
    msg.includes('timeout') ||
    msg.includes('network') ||
    msg.includes('econnrefused')
  ) {
    return 'TRANSIENT';
  }

  if (
    status === 400 ||
    status === 401 ||
    status === 403 ||
    msg.includes('auth') ||
    msg.includes('key') ||
    msg.includes('unauthorized') ||
    msg.includes('not found') ||
    msg.includes('unsupported mime') ||
    msg.includes('no extractable text') ||
    msg.includes('text extraction failed') ||
    msg.includes('empty')
  ) {
    return 'PERMANENT';
  }

  return 'TRANSIENT'; // Default
}

/**
 * Perform byte-safe UTF-8 cache truncation (max 50KB)
 */
function truncateTextCache(text: string, maxBytes: number = 50 * 1024): string {
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= maxBytes) {
    return text;
  }
  // Safe slice without splitting multi-byte characters
  let sliced = buf.subarray(0, maxBytes).toString('utf8');
  if (sliced.length > 0 && text.substring(0, sliced.length) !== sliced) {
    sliced = sliced.substring(0, sliced.length - 1);
  }
  return sliced + '\n\n[TRUNCATED_RAW_TEXT_IN_SUPABASE]';
}

/**
 * Helper to dispatch AI_PROCESSING_FAILED notification to workspace owners and admins.
 */
async function notifyFailure(
  workspaceId: mongoose.Types.ObjectId,
  fileId: mongoose.Types.ObjectId,
  fileVersionId: mongoose.Types.ObjectId,
  reason: string,
): Promise<void> {
  try {
    const workspace = await Workspace.findById(workspaceId);
    if (!workspace) return;

    const recipients = new Set<string>();
    recipients.add(workspace.ownerId.toString());

    // Query admins
    const admins = await WorkspaceMember.find({
      workspaceId: workspace._id,
      role: WorkspaceRole.ADMIN,
    });
    for (const admin of admins) {
      recipients.add(admin.userId.toString());
    }

    const notifications = Array.from(recipients).map((userId) => ({
      userId: new mongoose.Types.ObjectId(userId),
      type: NotificationType.AI_PROCESSING_FAILED,
      payload: {
        fileId: fileId.toString(),
        fileVersionId: fileVersionId.toString(),
        reason,
      },
    }));

    if (notifications.length > 0) {
      await Notification.insertMany(notifications);
    }
  } catch (err) {
    console.error('Failed to create AI failure notifications:', err);
  }
}

/**
 * Main Job Execution Thread
 */
async function processJob(job: any): Promise<void> {
  const fileVersionId = job.fileVersionId;
  const fileId = job.fileId;
  const workspaceId = job.workspaceId;
  let version: any = null;

  console.log(`[${workerId}] Starting Job ${job._id} for file version ${fileVersionId}`);

  try {
    await File.updateOne({ _id: fileId }, { aiStatus: AIStatus.PROCESSING });
    await FileVersion.updateOne({ _id: fileVersionId }, { aiStatus: AIStatus.PROCESSING });

    // 1. Validate workspace still has AI enabled
    const workspace = await Workspace.findOne({ _id: workspaceId, deletedAt: null });
    if (!workspace || !workspace.aiEnabled) {
      console.log(
        `[${workerId}] Workspace ${workspaceId} has AI disabled. Cancelling job ${job._id}.`,
      );
      job.status = 'CANCELLED';
      await job.save();
      await File.updateOne({ _id: fileId }, { aiStatus: AIStatus.FAILED });
      await FileVersion.updateOne({ _id: fileVersionId }, { aiStatus: AIStatus.FAILED });
      return;
    }

    // 2. Validate version still exists
    version = await FileVersion.findById(fileVersionId);
    if (!version) {
      throw new Error('Target FileVersion was deleted before processing could begin.');
    }

    // 3. Extract text (real download when live provider; mock text when mock provider)
    let extractedText: string;
    if (isMockAIProvider(aiProvider)) {
      extractedText = buildMockExtractedText(String(fileVersionId));
    } else {
      try {
        extractedText = await extractTextFromFileVersion(version);
      } catch (extractErr: unknown) {
        const message =
          extractErr instanceof TextExtractError
            ? extractErr.message
            : extractErr instanceof Error
              ? extractErr.message
              : 'Text extraction failed';
        const permanent = new Error(message) as Error & { status?: number };
        permanent.status = 400;
        throw permanent;
      }
    }

    // 4. Generate AI summaries, tags, embeddings from provider (IAIProvider) with timeout protection
    const summaryRes = await withTimeout(aiProvider.generateSummary(extractedText), 60000);
    const tagsRes = await withTimeout(aiProvider.generateTags(extractedText), 30000);
    const embeddingRes = await withTimeout(aiProvider.generateEmbedding(extractedText), 60000);

    // 5. Build inline cache with UTF-8 byte-safety
    const truncatedCache = truncateTextCache(extractedText);

    // 6. Write AIResult and File/Version statuses in a single atomic database operation block
    let transactionSuccessful = false;
    try {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          // Create AIResult
          await AIResult.findOneAndUpdate(
            { fileVersionId },
            {
              $set: {
                workspaceId,
                fileId,
                fileVersionId,
                schemaVersion: 1,
                summary: summaryRes.summary,
                tags: tagsRes.tags,
                extractedTextCache: truncatedCache,
                extractedTextStorageKey: `${workspaceId}/${fileId}/v${version.versionNumber}/extracted.txt`,
                embedding: embeddingRes.embedding,
                embeddingModel: embeddingRes.model,
                embeddingDimensions: embeddingRes.dimensions,
                embeddingVersion: 1,
                modelProvider: aiProvider.providerName,
                modelName: aiProvider.summarizerModelName,
                modelVersion: aiProvider.summarizerModelVersion,
              },
            },
            { upsert: true, session },
          );

          // Update Job Status
          job.status = 'COMPLETED';
          await job.save({ session });

          // Update File & FileVersion AI Status to READY
          await File.updateOne({ _id: fileId }, { aiStatus: AIStatus.READY }).session(session);
          await FileVersion.updateOne({ _id: fileVersionId }, { aiStatus: AIStatus.READY }).session(
            session,
          );
        });
        transactionSuccessful = true;
      } finally {
        await session.endSession();
      }
    } catch (txError: any) {
      const msg = (txError.message || '').toLowerCase();
      if (
        msg.includes('transaction numbers are only allowed on a replica set member') ||
        msg.includes('replica set')
      ) {
        console.log(
          `[${workerId}] Standalone MongoDB detected (no replica set). Falling back to non-transactional updates.`,
        );
      } else {
        throw txError;
      }
    }

    // Fallback if transaction was not supported/successful
    if (!transactionSuccessful) {
      await AIResult.findOneAndUpdate(
        { fileVersionId },
        {
          $set: {
            workspaceId,
            fileId,
            fileVersionId,
            schemaVersion: 1,
            summary: summaryRes.summary,
            tags: tagsRes.tags,
            extractedTextCache: truncatedCache,
            extractedTextStorageKey: `${workspaceId}/${fileId}/v${version.versionNumber}/extracted.txt`,
            embedding: embeddingRes.embedding,
            embeddingModel: embeddingRes.model,
            embeddingDimensions: embeddingRes.dimensions,
            embeddingVersion: 1,
            modelProvider: aiProvider.providerName,
            modelName: aiProvider.summarizerModelName,
            modelVersion: aiProvider.summarizerModelVersion,
          },
        },
        { upsert: true },
      );

      // Update Job Status
      job.status = 'COMPLETED';
      await job.save();

      // Update File & FileVersion AI Status to READY
      await File.updateOne({ _id: fileId }, { aiStatus: AIStatus.READY });
      await FileVersion.updateOne({ _id: fileVersionId }, { aiStatus: AIStatus.READY });
    }

    // 7. Log Activity: AI_PROCESSING_COMPLETED
    await ActivityService.createActivity(
      workspaceId.toString(),
      version?.uploadedBy || SYSTEM_ACTOR_ID, // Use uploader or system actor
      ActivityAction.AI_PROCESSING_COMPLETED,
      {
        fileId: fileId.toString(),
        fileVersionId: fileVersionId.toString(),
        jobId: job._id.toString(),
      },
    );

    console.log(`[${workerId}] Successfully completed Job ${job._id}`);
  } catch (err: any) {
    const errorType = classifyError(err);
    console.error(`[${workerId}] Job ${job._id} failed: ${err.message}. Type: ${errorType}`);

    job.lastError = {
      message: err.message,
      stack: err.stack,
      timestamp: new Date(),
      errorType,
    };

    if (errorType === 'PERMANENT') {
      job.status = 'FAILED';
      await job.save();
      await File.updateOne({ _id: fileId }, { aiStatus: AIStatus.FAILED });
      await FileVersion.updateOne({ _id: fileVersionId }, { aiStatus: AIStatus.FAILED });
      await notifyFailure(workspaceId, fileId, fileVersionId, err.message);

      // Log failure activity
      await ActivityService.createActivity(
        workspaceId.toString(),
        version?.uploadedBy || SYSTEM_ACTOR_ID,
        ActivityAction.AI_PROCESSING_FAILED,
        {
          fileId: fileId.toString(),
          fileVersionId: fileVersionId.toString(),
          jobId: job._id.toString(),
          error: err.message,
        },
      );
    } else {
      // Transient error: retry up to maxAttempts
      job.attemptCount += 1;
      if (job.attemptCount >= job.maxAttempts) {
        job.status = 'FAILED';
        await job.save();
        await File.updateOne({ _id: fileId }, { aiStatus: AIStatus.FAILED });
        await FileVersion.updateOne({ _id: fileVersionId }, { aiStatus: AIStatus.FAILED });
        await notifyFailure(
          workspaceId,
          fileId,
          fileVersionId,
          `Max attempts reached. Last error: ${err.message}`,
        );

        // Log failure activity
        await ActivityService.createActivity(
          workspaceId.toString(),
          version?.uploadedBy || SYSTEM_ACTOR_ID,
          ActivityAction.AI_PROCESSING_FAILED,
          {
            fileId: fileId.toString(),
            fileVersionId: fileVersionId.toString(),
            jobId: job._id.toString(),
            error: `Max attempts reached. Last error: ${err.message}`,
          },
        );
      } else {
        job.status = 'PENDING';
        job.priority += 1; // Lower priority on retry
        // Backoff: attempt * 5 seconds for testing/quick feedback, normally minutes
        const backoffMs = job.attemptCount * 5000;
        job.runAfter = new Date(Date.now() + backoffMs);
        await job.save();
      }
    }
  }
}

/**
 * Heartbeat scheduler
 */
async function emitHeartbeat(activeJobsCount: number): Promise<void> {
  try {
    await WorkerHeartbeat.findOneAndUpdate(
      { workerId },
      {
        $set: {
          lastHeartbeat: new Date(),
          hostname: os.hostname(),
          activeJobsCount,
        },
      },
      { upsert: true },
    );
  } catch (err) {
    console.error('Failed to emit heartbeat:', err);
  }
}

/**
 * Worker polling loop
 */
async function startWorker(): Promise<void> {
  const mongoUri = process.env.MONGO_URI || 'mongodb://0.0.0.0/cloudVault-drive';
  await mongoose.connect(mongoUri);
  console.log(`[${workerId}] AI Worker connected to MongoDB`);

  // Start heartbeat interval
  const heartbeatInterval = setInterval(() => emitHeartbeat(activeJobPromise ? 1 : 0), 10000);
  await emitHeartbeat(0);

  while (pollingEnabled) {
    try {
      // Atomic claim using findOneAndUpdate
      const job = await AIJob.findOneAndUpdate(
        {
          status: 'PENDING',
          runAfter: { $lte: new Date() },
        },
        {
          $set: {
            status: 'PROCESSING',
            claimedAt: new Date(),
            workerId: workerId,
          },
        },
        {
          sort: { priority: 1, runAfter: 1, createdAt: 1 }, // Priority FIFO
          new: true,
        },
      );

      if (job) {
        activeJobPromise = processJob(job);
        await activeJobPromise;
        activeJobPromise = null;
      } else {
        // Idle sleep
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } catch (err: any) {
      console.error('Error in worker claim loop:', err.message);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }

  clearInterval(heartbeatInterval);
}

/**
 * Graceful Shutdown handlers
 */
async function gracefulShutdown(signal: string) {
  console.log(`[${workerId}] Received ${signal}. Stopping new job claims...`);
  pollingEnabled = false;

  if (activeJobPromise) {
    console.log(`[${workerId}] Awaiting active job completion...`);
    await activeJobPromise;
  }

  try {
    // Remove heartbeat record
    await WorkerHeartbeat.deleteOne({ workerId });
    await mongoose.disconnect();
    console.log(`[${workerId}] Successfully disconnected and cleaned up heartbeats.`);
  } catch (err) {
    console.error('Error during shutdown cleanup:', err);
  }

  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Start the loop if run as a script directly
if (require.main === module) {
  startWorker().catch((err) => {
    console.error('Worker boot crash:', err);
    process.exit(1);
  });
}

export { startWorker, processJob, classifyError, truncateTextCache, WorkerHeartbeat };
