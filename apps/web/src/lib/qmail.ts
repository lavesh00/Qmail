import { createQmailClient } from '@qmail/core';
import { createIndexedDbStorage } from './indexeddb-storage';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy .env.example to .env.local and fill it in.',
  );
}

/**
 * One client for the whole app. It holds the decrypted keys in memory once
 * unlocked, so there must not be a second instance with a different idea of
 * whether this device is locked.
 */
export const qmail = createQmailClient({
  supabaseUrl,
  supabaseAnonKey,
  storage: createIndexedDbStorage(),
});
