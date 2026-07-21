import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

interface Config {
  PORT: number;
  MONGO_URI: string;
  JWT_SECRET: string;
  NODE_ENV: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_BUCKET: string;
  STORAGE_USE_MOCK: boolean;
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
  SUPABASE_URL: process.env.SUPABASE_URL || '',
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  SUPABASE_BUCKET: process.env.SUPABASE_BUCKET || 'cloudvault-files',
  STORAGE_USE_MOCK: process.env.STORAGE_USE_MOCK === 'true',
};

// Fail fast in production if Supabase keys are missing
if (config.NODE_ENV === 'production') {
  if (!config.SUPABASE_URL) {
    console.error('[ERROR] Missing required environment variable in production: SUPABASE_URL');
    process.exit(1);
  }
  if (!config.SUPABASE_SERVICE_ROLE_KEY) {
    console.error(
      '[ERROR] Missing required environment variable in production: SUPABASE_SERVICE_ROLE_KEY',
    );
    process.exit(1);
  }
}
