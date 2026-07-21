import { Router, Request, Response } from 'express';
import { authenticateJWT } from '../middleware/auth';
import { requireWorkspaceRole } from '../middleware/rbac';
import { WorkspaceRole } from '../models/types';
import { ActivityLog } from '../models/activityLog.model';
import { asyncHandler } from '../utils/asyncHandler';

const router = Router();

router.use(asyncHandler(authenticateJWT));

// GET /workspaces/:workspaceId/activity - Fetch workspace activity feed (paginated)
router.get(
  '/:workspaceId/activity',
  asyncHandler(requireWorkspaceRole(WorkspaceRole.VIEWER)),
  asyncHandler(async (req: Request, res: Response) => {
    const { workspaceId } = req.params;

    // Parse query parameters
    let page = parseInt(req.query.page as string, 10);
    let limit = parseInt(req.query.limit as string, 10);

    if (isNaN(page) || page <= 0) page = 1;
    if (isNaN(limit) || limit <= 0) limit = 50;
    if (limit > 100) limit = 100; // Cap limit at 100 max

    const query = { workspaceId };

    // Fetch paginated feed and total counts
    const [items, total] = await Promise.all([
      ActivityLog.find(query)
        .sort({ timestamp: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('actorId', 'name email'),
      ActivityLog.countDocuments(query),
    ]);

    res.status(200).json({
      items,
      page,
      limit,
      total,
    });
  }),
);

export default router;
