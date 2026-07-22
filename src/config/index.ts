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
  AI_PROVIDER: string;
  OPENROUTER_API_KEY: string;
  OPENROUTER_BASE_URL: string;
  OPENROUTER_MODEL: string;
  OPENROUTER_EMBEDDING_MODEL: string;
  /** Comma-separated allowed frontend origins for CORS (credentials). */
  CORS_ORIGINS: string[];
  /** When true, auth cookie uses SameSite=None; Secure (cross-site Vercel↔Render). */
  COOKIE_CROSS_SITE: boolean;
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

const defaultCorsOrigins =
  process.env.NODE_ENV === 'production'
    ? []
    : ['http://localhost:3001', 'http://127.0.0.1:3001'];

const corsOrigins = (process.env.CORS_ORIGINS || defaultCorsOrigins.join(','))
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const isProduction = (process.env.NODE_ENV || 'development') === 'production';

export const config: Config = {
  PORT: parseInt(process.env.PORT || '3000', 10),
  MONGO_URI: getEnvOrThrow('MONGO_URI'),
  JWT_SECRET: getEnvOrThrow('JWT_SECRET'),
  NODE_ENV: process.env.NODE_ENV || 'development',
  SUPABASE_URL: process.env.SUPABASE_URL || '',
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  SUPABASE_BUCKET: process.env.SUPABASE_BUCKET || 'cloudvault-files',
  STORAGE_USE_MOCK: process.env.STORAGE_USE_MOCK === 'true',
  AI_PROVIDER: (process.env.AI_PROVIDER || 'mock').toLowerCase(),
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || '',
  OPENROUTER_BASE_URL: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
  OPENROUTER_MODEL: process.env.OPENROUTER_MODEL || 'openrouter/free',
  OPENROUTER_EMBEDDING_MODEL: process.env.OPENROUTER_EMBEDDING_MODEL || 'local',
  CORS_ORIGINS: corsOrigins,
  // Cross-site cookies required when frontend (Vercel) and API (Render) are different sites.
  // Override with COOKIE_CROSS_SITE=true|false if needed.
  COOKIE_CROSS_SITE:
    process.env.COOKIE_CROSS_SITE === 'true' ||
    (process.env.COOKIE_CROSS_SITE !== 'false' && isProduction && corsOrigins.length > 0),
};

export type AuthCookieOptions = {
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax' | 'none';
  path: '/';
  maxAge?: number;
};

/** Shared auth cookie flags for login + logout clearCookie. */
export function getAuthCookieOptions(maxAgeMs?: number): AuthCookieOptions {
  const crossSite = config.COOKIE_CROSS_SITE;
  const options: AuthCookieOptions = {
    httpOnly: true,
    secure: crossSite || config.NODE_ENV === 'production',
    sameSite: crossSite ? 'none' : 'lax',
    path: '/',
  };
  if (typeof maxAgeMs === 'number') {
    options.maxAge = maxAgeMs;
  }
  return options;
}

// Fail fast in production if Supabase keys / weak JWT secret / missing CORS
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
  if (config.CORS_ORIGINS.length === 0) {
    console.error(
      '[ERROR] CORS_ORIGINS must be set in production (comma-separated frontend URLs, e.g. https://app.vercel.app).',
    );
    process.exit(1);
  }
  const weakSecrets = new Set([
    'change-me-to-a-long-random-string',
    'secret',
    'jwt_secret',
    'password',
    'changeme',
  ]);
  if (config.JWT_SECRET.length < 32 || weakSecrets.has(config.JWT_SECRET.toLowerCase())) {
    console.error(
      '[ERROR] JWT_SECRET in production must be a strong random value (at least 32 characters).',
    );
    process.exit(1);
  }
}
