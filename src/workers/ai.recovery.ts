import { AIJob } from '../models/aiJob.model';
import { File } from '../models/file.model';
import { FileVersion } from '../models/fileVersion.model';

export class AIRecoveryDaemon {
  /**
   * Scans for stalled PROCESSING jobs and resets them to PENDING.
   * Lock timeout is dynamically calculated as max(15 minutes, 3 * average processing duration).
   */
  static async runRecovery(defaultLockTimeoutMs: number = 15 * 60 * 1000): Promise<number> {
    let lockTimeoutMs = defaultLockTimeoutMs;

    try {
      // Aggregate completed jobs to calculate average processing duration (updatedAt - claimedAt)
      const stats = await AIJob.aggregate([
        {
          $match: {
            status: 'COMPLETED',
            claimedAt: { $exists: true },
          },
        },
        {
          $group: {
            _id: null,
            avgDuration: {
              $avg: { $subtract: ['$updatedAt', '$claimedAt'] },
            },
          },
        },
      ]);

      if (stats && stats.length > 0 && stats[0].avgDuration) {
        const dynamicTimeout = stats[0].avgDuration * 3;
        lockTimeoutMs = Math.max(defaultLockTimeoutMs, dynamicTimeout);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Failed to calculate dynamic average job duration:', err);
    }

    const expiredTime = new Date(Date.now() - lockTimeoutMs);

    // Find stalled jobs first to retrieve their file and version IDs
    const stalledJobs = await AIJob.find({
      status: 'PROCESSING',
      claimedAt: { $lt: expiredTime },
    });

    if (stalledJobs.length > 0) {
      const fileIds = stalledJobs.map((j) => j.fileId);
      const versionIds = stalledJobs.map((j) => j.fileVersionId);

      // Transition corresponding File & FileVersion statuses back to PENDING
      await File.updateMany({ _id: { $in: fileIds } }, { aiStatus: 'PENDING' });
      await FileVersion.updateMany({ _id: { $in: versionIds } }, { aiStatus: 'PENDING' });

      // Reset stalled processing jobs back to PENDING in AIJob collection
      await AIJob.updateMany(
        { _id: { $in: stalledJobs.map((j) => j._id) } },
        {
          $set: {
            status: 'PENDING',
          },
          $unset: {
            claimedAt: 1,
            workerId: 1,
          },
          $inc: {
            attemptCount: 1,
            priority: 1, // Lower priority on retry
          },
        },
      );

      // eslint-disable-next-line no-console
      console.log(
        `[AI Recovery] Reset ${stalledJobs.length} stalled processing jobs back to PENDING.`,
      );
    }

    return stalledJobs.length;
  }
}
