/* eslint-disable @typescript-eslint/no-namespace */
import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

// Extend Express Request interface
declare global {
  namespace Express {
    interface Request {
      id: string;
    }
  }
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const reqId =
    (req.headers['x-request-id'] as string) ||
    `REQ-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
  req.id = reqId;
  res.setHeader('X-Request-Id', reqId);
  next();
}
