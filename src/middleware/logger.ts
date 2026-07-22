import { Request, Response, NextFunction } from 'express';
import pino from 'pino';

const isProduction = process.env.NODE_ENV === 'production';

const logger = pino(
  isProduction
    ? {
        level: process.env.LOG_LEVEL || 'info',
      }
    : {
        level: process.env.LOG_LEVEL || 'info',
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        },
      },
);

export function loggerMiddleware(req: Request, res: Response, next: NextFunction): void {
  const startTime = Date.now();
  // Avoid logging raw query strings that may contain tokens
  const safeUrl = (req.originalUrl || req.url || '').split('?')[0];

  // Log request start
  logger.info(`[${req.id}] ${req.method} ${safeUrl} - Started`);

  // Log request end
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const statusCode = res.statusCode;

    if (statusCode >= 500) {
      logger.error(`[${req.id}] ${req.method} ${safeUrl} - ${statusCode} - ${duration}ms`);
    } else if (statusCode >= 400) {
      logger.warn(`[${req.id}] ${req.method} ${safeUrl} - ${statusCode} - ${duration}ms`);
    } else {
      logger.info(`[${req.id}] ${req.method} ${safeUrl} - ${statusCode} - ${duration}ms`);
    }
  });

  next();
}

export { logger };
export default logger;
