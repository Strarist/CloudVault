import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { Workspace } from '../models/workspace.model';
import { WorkspaceMember } from '../models/workspaceMember.model';
import { User } from '../models/user.model';
import { AIJob } from '../models/aiJob.model';
import mongoose from 'mongoose';
import { WorkspaceType, WorkspaceRole, ActivityAction } from '../models/types';
import { authenticateJWT } from '../middleware/auth';
import { requireWorkspaceRole } from '../middleware/rbac';
import { asyncHandler } from '../utils/asyncHandler';
import { ActivityService } from '../services/activity.service';
import { AIJobService } from '../services/aiJob.service';

const router = Router();

// Apply JWT authentication to all workspace routes
router.use(asyncHandler(authenticateJWT));

const roleWeights: Record<WorkspaceRole, number> = {
  [WorkspaceRole.OWNER]: 4,
  [WorkspaceRole.ADMIN]: 3,
  [WorkspaceRole.EDITOR]: 2,
  [WorkspaceRole.VIEWER]: 1,
};

// GET /workspaces - List all workspaces user belongs to
router.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const memberships = await WorkspaceMember.find({ userId: req.user!._id }).populate({
      path: 'workspaceId',
      match: { deletedAt: null },
    });

    // Filter out memberships where workspace is deleted or does not exist
    const activeMemberships = memberships.filter((m) => m.workspaceId !== null);

    res.status(200).json(activeMemberships);
  }),
);

// POST /workspaces - Create a team workspace
router.post(
  '/',
  body('name')
    .trim()
    .isLength({ min: 3 })
    .withMessage('Workspace name must be at least 3 characters long'),
  asyncHandler(async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array(), message: 'Invalid inputs.' });
      return;
    }

    const { name, description } = req.body;

    const workspace = await Workspace.create({
      name,
      description: description || '',
      ownerId: req.user!._id,
      type: WorkspaceType.TEAM,
      aiEnabled: false,
    });

    const member = await WorkspaceMember.create({
      workspaceId: workspace._id,
      userId: req.user!._id,
      role: WorkspaceRole.OWNER,
      joinedAt: new Date(),
    });

    await ActivityService.createActivity(
      workspace._id,
      req.user!._id,
      ActivityAction.WORKSPACE_CREATED,
      { workspaceName: workspace.name },
      workspace._id,
      'Workspace',
    );

    res.status(201).json({ workspace, member });
  }),
);

// GET /workspaces/:workspaceId - Get workspace details and list of members
router.get(
  '/:workspaceId',
  asyncHandler(requireWorkspaceRole(WorkspaceRole.VIEWER)),
  asyncHandler(async (req: Request, res: Response) => {
    const workspace = await Workspace.findById(req.params.workspaceId);
    if (!workspace || workspace.deletedAt) {
      res.status(404).json({ error: 'Workspace not found.' });
      return;
    }

    const members = await WorkspaceMember.find({ workspaceId: workspace._id }).populate(
      'userId',
      'name email username avatar',
    );

    res.status(200).json({
      workspace,
      role: req.membership!.role,
      members,
    });
  }),
);

// POST /workspaces/:workspaceId/members - Add/Invite member by email
router.post(
  '/:workspaceId/members',
  asyncHandler(requireWorkspaceRole(WorkspaceRole.ADMIN)),
  body('email').trim().isEmail().withMessage('A valid email address is required'),
  body('role').optional().isIn(Object.values(WorkspaceRole)).withMessage('Invalid workspace role'),
  asyncHandler(async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array(), message: 'Invalid inputs.' });
      return;
    }

    const workspace = await Workspace.findById(req.params.workspaceId);
    if (!workspace || workspace.deletedAt) {
      res.status(404).json({ error: 'Workspace not found.' });
      return;
    }

    if (workspace.type === WorkspaceType.PERSONAL) {
      res.status(400).json({ error: 'Cannot add members to a Personal Workspace.' });
      return;
    }

    const targetEmail = req.body.email.toLowerCase();
    const targetUser = await User.findOne({ email: targetEmail });
    if (!targetUser) {
      res.status(404).json({ error: 'User with this email not found.' });
      return;
    }

    const existingMember = await WorkspaceMember.findOne({
      workspaceId: workspace._id,
      userId: targetUser._id,
    });
    if (existingMember) {
      res.status(400).json({ error: 'User is already a member of this workspace.' });
      return;
    }

    const targetRole = req.body.role || WorkspaceRole.VIEWER;
    if (targetRole === WorkspaceRole.OWNER) {
      res.status(400).json({ error: 'Cannot invite a member as OWNER.' });
      return;
    }

    // Role hierarchy weights check: ADMIN cannot invite other ADMINs or OWNERs
    const currentUserRole = req.membership!.role;
    if (currentUserRole === WorkspaceRole.ADMIN && targetRole === WorkspaceRole.ADMIN) {
      res.status(403).json({ error: 'Access denied. ADMINs cannot invite other ADMINs.' });
      return;
    }

    const newMember = await WorkspaceMember.create({
      workspaceId: workspace._id,
      userId: targetUser._id,
      role: targetRole,
      joinedAt: new Date(),
    });

    await ActivityService.createActivity(
      workspace._id,
      req.user!._id,
      ActivityAction.WORKSPACE_MEMBER_ADDED,
      { userId: targetUser._id.toString(), role: targetRole },
      targetUser._id,
      'User',
    );

    const populatedMember = await WorkspaceMember.findById(newMember._id).populate(
      'userId',
      'name email username avatar',
    );

    res.status(201).json(populatedMember);
  }),
);

// PATCH /workspaces/:workspaceId/members/:userId - Update member role
router.patch(
  '/:workspaceId/members/:userId',
  asyncHandler(requireWorkspaceRole(WorkspaceRole.ADMIN)),
  body('role').isIn(Object.values(WorkspaceRole)).withMessage('Valid workspace role is required'),
  asyncHandler(async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array(), message: 'Invalid inputs.' });
      return;
    }

    const targetRole = req.body.role;
    if (targetRole === WorkspaceRole.OWNER) {
      res.status(400).json({ error: 'Cannot demote or assign OWNER role via membership edits.' });
      return;
    }

    const targetMember = await WorkspaceMember.findOne({
      workspaceId: req.params.workspaceId,
      userId: req.params.userId,
    });

    if (!targetMember) {
      res.status(404).json({ error: 'Member not found in this workspace.' });
      return;
    }

    if (targetMember.role === WorkspaceRole.OWNER) {
      res.status(400).json({ error: 'Cannot modify the role of the workspace OWNER.' });
      return;
    }

    const currentUserRole = req.membership!.role;

    // Role hierarchy check
    if (currentUserRole === WorkspaceRole.ADMIN) {
      // ADMIN cannot demote/modify other ADMINs
      if (targetMember.role === WorkspaceRole.ADMIN) {
        res.status(403).json({ error: 'Access denied. ADMINs cannot modify other ADMINs.' });
        return;
      }
      // ADMIN cannot promote to ADMIN
      if (targetRole === WorkspaceRole.ADMIN) {
        res.status(403).json({ error: 'Access denied. ADMINs cannot promote members to ADMIN.' });
        return;
      }
    }

    const oldRole = targetMember.role;
    targetMember.role = targetRole;
    await targetMember.save();

    await ActivityService.createActivity(
      req.params.workspaceId,
      req.user!._id,
      ActivityAction.WORKSPACE_ROLE_CHANGED,
      { userId: targetMember.userId.toString(), oldRole, newRole: targetRole },
      targetMember.userId,
      'User',
    );

    const populatedMember = await WorkspaceMember.findById(targetMember._id).populate(
      'userId',
      'name email username avatar',
    );

    res.status(200).json(populatedMember);
  }),
);

// DELETE /workspaces/:workspaceId/members/:userId - Remove member or self-leave
router.delete(
  '/:workspaceId/members/:userId',
  asyncHandler(async (req: Request, res: Response) => {
    const { workspaceId, userId } = req.params;

    const currentUserMember = await WorkspaceMember.findOne({
      workspaceId,
      userId: req.user!._id,
    });
    if (!currentUserMember) {
      res.status(403).json({ error: 'Access denied. You are not a member of this workspace.' });
      return;
    }

    const targetMember = await WorkspaceMember.findOne({
      workspaceId,
      userId,
    });
    if (!targetMember) {
      res.status(404).json({ error: 'Member not found in this workspace.' });
      return;
    }

    const isSelfLeave = req.user!._id.toString() === targetMember.userId.toString();

    if (isSelfLeave) {
      if (currentUserMember.role === WorkspaceRole.OWNER) {
        res.status(400).json({
          error:
            'OWNER cannot leave the workspace. You must delete the workspace or transfer ownership first.',
        });
        return;
      }
      await targetMember.deleteOne();
      await ActivityService.createActivity(
        workspaceId,
        req.user!._id,
        ActivityAction.WORKSPACE_MEMBER_REMOVED,
        { userId: userId },
        new mongoose.Types.ObjectId(userId),
        'User',
      );
      res.status(200).json({ message: 'Successfully left the workspace.' });
      return;
    }

    // It is a kick. Verify that current user has authority (OWNER or ADMIN)
    const currentUserRoleWeight = roleWeights[currentUserMember.role] || 0;
    const adminRoleWeight = roleWeights[WorkspaceRole.ADMIN];

    if (currentUserRoleWeight < adminRoleWeight) {
      res.status(403).json({ error: 'Access denied. Insufficient permissions to remove members.' });
      return;
    }

    // Role hierarchy weights check
    if (currentUserMember.role === WorkspaceRole.ADMIN) {
      // ADMIN cannot kick OWNER or other ADMINs
      if (targetMember.role === WorkspaceRole.OWNER || targetMember.role === WorkspaceRole.ADMIN) {
        res
          .status(403)
          .json({ error: 'Access denied. ADMINs cannot remove OWNERs or other ADMINs.' });
        return;
      }
    }

    await targetMember.deleteOne();
    await ActivityService.createActivity(
      workspaceId,
      req.user!._id,
      ActivityAction.WORKSPACE_MEMBER_REMOVED,
      { userId: userId },
      new mongoose.Types.ObjectId(userId),
      'User',
    );
    res.status(200).json({ message: 'Member successfully removed from workspace.' });
  }),
);

// GET /workspaces/:workspaceId/ai/jobs - Get AI jobs for workspace (admin only, paginated)
router.get(
  '/:workspaceId/ai/jobs',
  asyncHandler(requireWorkspaceRole(WorkspaceRole.ADMIN)),
  asyncHandler(async (req: Request, res: Response) => {
    const { workspaceId } = req.params;
    let page = parseInt(req.query.page as string, 10);
    let limit = parseInt(req.query.limit as string, 10);

    if (isNaN(page) || page <= 0) page = 1;
    if (isNaN(limit) || limit <= 0) limit = 50;
    if (limit > 100) limit = 100; // Cap limit at 100

    const query = { workspaceId: new mongoose.Types.ObjectId(workspaceId) };

    const [items, total] = await Promise.all([
      AIJob.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      AIJob.countDocuments(query),
    ]);

    const formattedItems = items.map((job) => ({
      id: job._id.toString(),
      fileVersionId: job.fileVersionId.toString(),
      status: job.status,
      attemptCount: job.attemptCount,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      lastError: job.lastError || null,
    }));

    res.status(200).json({
      items: formattedItems,
      page,
      limit,
      total,
    });
  }),
);

// POST /workspaces/:workspaceId/ai/toggle - Toggle Workspace AI status (admin only)
router.post(
  '/:workspaceId/ai/toggle',
  asyncHandler(requireWorkspaceRole(WorkspaceRole.ADMIN)),
  asyncHandler(async (req: Request, res: Response) => {
    const { workspaceId } = req.params;
    const { aiEnabled } = req.body;

    if (typeof aiEnabled !== 'boolean') {
      res.status(400).json({ error: 'aiEnabled is required and must be a boolean' });
      return;
    }

    try {
      await AIJobService.toggleWorkspaceAI(workspaceId, aiEnabled);
      res.status(200).json({ message: 'AI settings updated successfully.', aiEnabled });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to update AI settings.' });
    }
  }),
);

export default router;
