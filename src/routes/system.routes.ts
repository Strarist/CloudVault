import { Router, Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { AIJob } from '../models/aiJob.model';
import { WorkerHeartbeat } from '../workers/ai.worker';

const router = Router();

router.get(
  '/worker-health',
  asyncHandler(async (_req: Request, res: Response) => {
    const activeThreshold = new Date(Date.now() - 30 * 1000);
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [activeWorkers, queueDepth, failedJobs24h, processingJobs] = await Promise.all([
      WorkerHeartbeat.countDocuments({ lastHeartbeat: { $gte: activeThreshold } }),
      AIJob.countDocuments({ status: 'PENDING', runAfter: { $lte: new Date() } }),
      AIJob.countDocuments({ status: 'FAILED', updatedAt: { $gte: oneDayAgo } }),
      AIJob.countDocuments({ status: 'PROCESSING' }),
    ]);

    res.status(200).json({
      activeWorkers,
      queueDepth,
      failedJobs24h,
      processingJobs,
    });
  }),
);

export default router;
