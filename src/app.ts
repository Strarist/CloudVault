import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import path from 'path';
import { Server } from 'http';

import { config } from './config';
import { connectToDB, closeDBConnection } from './config/db';
import { requestIdMiddleware } from './middleware/requestId';
import { loggerMiddleware, logger } from './middleware/logger';
import { errorHandler } from './middleware/errorHandler';

import healthRouter from './routes/health';
import indexRoutes from './routes/index.routes';
import authRoutes from './routes/auth.routes';

const app = express();

// Set up views
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

// Middlewares
app.use(requestIdMiddleware);
app.use(loggerMiddleware);

// Security & Utility
app.use(
  helmet({
    contentSecurityPolicy: false, // Turn off CSP for dev with CDN scripts in views
  }),
);
app.use(cors());
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static assets if any
app.use(express.static(path.join(__dirname, '../public')));

// Routes
app.use('/health', healthRouter);
app.use('/', indexRoutes);
app.use('/auth', authRoutes);

// Centralized error handler
app.use(errorHandler);

let server: Server;

async function startServer() {
  // 1. Connect to Database
  await connectToDB();

  // 2. Start Express Server
  server = app.listen(config.PORT, () => {
    logger.info(`Server is running in ${config.NODE_ENV} mode on port ${config.PORT}`);
  });
}

// Graceful Shutdown Logic
async function gracefulShutdown(signal: string) {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);

  if (server) {
    server.close(async () => {
      logger.info('Express server closed.');
      try {
        await closeDBConnection();
        logger.info('Graceful shutdown completed successfully. Exiting.');
        process.exit(0);
      } catch (err) {
        logger.error(err as Error, 'Error during DB connection closure during shutdown:');
        process.exit(1);
      }
    });
  } else {
    try {
      await closeDBConnection();
      process.exit(0);
    } catch (err) {
      logger.error(err as Error, 'Error during shutdown:');
      process.exit(1);
    }
  }

  // Set timeout of 10s to force shutdown if hanging
  setTimeout(() => {
    logger.warn('Forcing process shutdown after timeout.');
    process.exit(1);
  }, 10000);
}

// Register signals
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

startServer().catch((err) => {
  logger.error(err as Error, 'Unhandled error during startup:');
  process.exit(1);
});

export default app;
