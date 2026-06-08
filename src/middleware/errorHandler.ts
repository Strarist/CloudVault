import { Request, Response, NextFunction } from 'express';
import { logger } from './logger';

export interface AppError extends Error {
  status?: number;
}

export function errorHandler(
  err: AppError,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  const status = err.status || 500;
  const message = err.message || 'Internal Server Error';

  logger.error(
    {
      stack: err.stack,
      url: req.url,
      method: req.method,
    },
    `[${req.id}] Error: ${message}`,
  );

  res.status(status).json({
    error: message,
    requestId: req.id,
  });
}
