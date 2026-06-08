import mongoose from 'mongoose';
import { config } from './index';
import { logger } from '../middleware/logger';

export async function connectToDB(): Promise<void> {
  try {
    await mongoose.connect(config.MONGO_URI);
    logger.info('Successfully connected to MongoDB.');
  } catch (error) {
    logger.error(error as Error, 'Failed to connect to MongoDB:');
    process.exit(1);
  }
}

// Graceful connection closure helper
export async function closeDBConnection(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
    logger.info('MongoDB connection closed gracefully.');
  }
}
