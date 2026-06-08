/* eslint-disable @typescript-eslint/no-namespace */
import { Request, Response, NextFunction, RequestHandler } from 'express';
import { WorkspaceMember, IWorkspaceMember } from '../models/workspaceMember.model';
import { WorkspaceRole } from '../models/types';

declare global {
  namespace Express {
    interface Request {
      membership?: IWorkspaceMember;
    }
  }
}

const roleWeights: Record<WorkspaceRole, number> = {
  [WorkspaceRole.OWNER]: 4,
  [WorkspaceRole.ADMIN]: 3,
  [WorkspaceRole.EDITOR]: 2,
  [WorkspaceRole.VIEWER]: 1,
};

export function requireWorkspaceRole(requiredRole: WorkspaceRole): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user;
      if (!user) {
        res.status(401).json({ error: 'Authentication required.' });
        return;
      }

      // Try finding workspaceId in params (workspaceId or id), body, or query
      const workspaceId =
        req.params.workspaceId ||
        req.params.id ||
        req.body.workspaceId ||
        (req.query.workspaceId as string);

      if (!workspaceId) {
        res.status(400).json({ error: 'Workspace ID is missing from the request.' });
        return;
      }

      const member = await WorkspaceMember.findOne({
        workspaceId,
        userId: user._id,
      });

      if (!member) {
        res.status(403).json({ error: 'Access denied. You are not a member of this workspace.' });
        return;
      }

      const userRoleWeight = roleWeights[member.role] || 0;
      const requiredRoleWeight = roleWeights[requiredRole] || 0;

      if (userRoleWeight < requiredRoleWeight) {
        res.status(403).json({
          error: `Access denied. Insufficient permissions. Required role: ${requiredRole}`,
        });
        return;
      }

      req.membership = member;
      next();
    } catch (error) {
      next(error);
    }
  };
}
