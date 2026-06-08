import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

interface Config {
  PORT: number;
  MONGO_URI: string;
  JWT_SECRET: string;
  NODE_ENV: string;
}

const getEnvOrThrow = (key: string): string => {
  const value = process.env[key];
  if (!value) {
    // eslint-disable-next-line no-console
    console.error(`[ERROR] Missing required environment variable: ${key}`);
    process.exit(1);
  }
  return value;
};

export const config: Config = {
  PORT: parseInt(process.env.PORT || '3000', 10),
  MONGO_URI: getEnvOrThrow('MONGO_URI'),
  JWT_SECRET: getEnvOrThrow('JWT_SECRET'),
  NODE_ENV: process.env.NODE_ENV || 'development',
};
