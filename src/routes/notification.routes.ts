import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { authenticateJWT } from '../middleware/auth';
import { Notification } from '../models/notification.model';
import { User, IUser } from '../models/user.model';
import { asyncHandler } from '../utils/asyncHandler';

const router = Router();

// Apply authentication to all routes
router.use(asyncHandler(authenticateJWT));

/**
 * GET /notifications
 * List user's notifications with pagination
 * Query params: page=1, limit=20 (max 100)
 */
router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user?.id;
    const { page, limit } = req.query;

    // Parse and validate pagination params
    let pageNum = parseInt(page as string) || 1;
    let limitNum = parseInt(limit as string) || 20;

    if (pageNum < 1) pageNum = 1;
    if (limitNum < 1) limitNum = 20;
    if (limitNum > 100) limitNum = 100; // Max 100 per request

    // Calculate skip amount
    const skip = (pageNum - 1) * limitNum;

    // Get total count for pagination info
    const totalCount = await Notification.countDocuments({
      userId: new mongoose.Types.ObjectId(userId),
    });

    // Fetch notifications, newest first
    const notifications = await Notification.find({
      userId: new mongoose.Types.ObjectId(userId),
    })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum);

    // Find unique actorIds from payloads
    const actorIds = Array.from(
      new Set(
        notifications
          .map((n) => n.payload?.actorId)
          .filter(
            (id): id is string => typeof id === 'string' && mongoose.Types.ObjectId.isValid(id),
          ),
      ),
    );

    const actors = await User.find(
      { _id: { $in: actorIds.map((id) => new mongoose.Types.ObjectId(id)) } },
      { username: 1, name: 1, email: 1 },
    );
    const actorMap = new Map<string, IUser>(actors.map((u) => [u._id.toString(), u]));

    const populatedNotifications = notifications.map((n) => {
      const actorId = n.payload?.actorId;
      if (typeof actorId === 'string' && actorMap.has(actorId)) {
        const actor = actorMap.get(actorId);
        return {
          ...n.toObject(),
          payload: {
            ...n.payload,
            actorUsername: actor?.username,
            actorName: actor?.name,
          },
        };
      }
      return n.toObject();
    });

    // Get unread count
    const unreadCount = await Notification.countDocuments({
      userId: new mongoose.Types.ObjectId(userId),
      isRead: false,
    });

    res.json({
      notifications: populatedNotifications,
      unreadCount,
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
 * GET /notifications/unread-count
 * Get count of unread notifications
 */
router.get(
  '/unread-count',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user?.id;

    const unreadCount = await Notification.countDocuments({
      userId: new mongoose.Types.ObjectId(userId),
      isRead: false,
    });

    res.json({ unreadCount });
  }),
);

/**
 * PATCH /notifications/read-all
 * Mark all notifications as read
 */
router.patch(
  '/read-all',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user?.id;

    const result = await Notification.updateMany(
      {
        userId: new mongoose.Types.ObjectId(userId),
        isRead: false,
      },
      { isRead: true },
    );

    res.json({
      message: `${result.modifiedCount} notifications marked as read.`,
      modifiedCount: result.modifiedCount,
    });
  }),
);

/**
 * PATCH /notifications/:id/read
 * Mark a specific notification as read
 */
router.patch(
  '/:id/read',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user?.id;
    const { id } = req.params;

    // Find and update notification
    const notification = await Notification.findOneAndUpdate(
      {
        _id: new mongoose.Types.ObjectId(id),
        userId: new mongoose.Types.ObjectId(userId),
      },
      { isRead: true },
      { new: true },
    );

    if (!notification) {
      res.status(404).json({ error: 'Notification not found.' });
      return;
    }

    res.json(notification);
  }),
);

export default router;
