import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from './index';

let supabase: SupabaseClient | null = null;

const supabaseConfigured =
  !config.STORAGE_USE_MOCK && config.SUPABASE_URL && config.SUPABASE_SERVICE_ROLE_KEY;

if (supabaseConfigured) {
  supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
    },
  });
} else if (config.STORAGE_USE_MOCK) {
  // eslint-disable-next-line no-console
  console.warn(
    '[WARN] STORAGE_USE_MOCK=true — using in-memory storage (local development only).',
  );
} else {
  // eslint-disable-next-line no-console
  console.warn(
    '[WARN] Supabase URL or Service Role Key is missing. Storage integration will fall back to a mock implementation.',
  );
}

export { supabase };
export default supabase;
