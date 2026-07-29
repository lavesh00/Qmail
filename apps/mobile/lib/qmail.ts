import AsyncStorage from '@react-native-async-storage/async-storage';
import { createQmailClient } from '@qmail/core';
import { createSecureStoreStorage } from './securestore-storage';
import { createWebViewEngine } from './webview-engine';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY. Copy .env.example to .env and fill it in.',
  );
}

/**
 * One client for the whole app, identical to the web one apart from the three
 * injected platform pieces: keys go to the keychain, the auth session goes to
 * AsyncStorage, and the cryptography runs in the WebView that `<CryptoHost />`
 * mounts, because Hermes cannot host it.
 */
export const qmail = createQmailClient({
  supabaseUrl,
  supabaseAnonKey,
  storage: createSecureStoreStorage(),
  engine: createWebViewEngine(),
  authStorage: AsyncStorage,
});
