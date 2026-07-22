import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  const dbUp = mongoose.connection.readyState === 1;
  const payload = {
    status: dbUp ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    services: {
      database: dbUp ? 'up' : 'down',
    },
  };

  // Render health checks treat non-2xx as unhealthy
  res.status(dbUp ? 200 : 503).json(payload);
});

export default router;
