import * as SecureStore from 'expo-secure-store';
import type { SecureStorage } from '@qmail/core';

/**
 * The device's home for the encrypted keystore, backed by the platform keychain
 * — Keychain Services on iOS, EncryptedSharedPreferences on Android.
 *
 * SecureStore caps a single value at around 2 KB, and a Qmail keystore is about
 * 8.5 KB: an ML-KEM decapsulation key and an ML-DSA signing key are 6,432 bytes
 * before base64. So values are split across numbered entries and rejoined on
 * read. The blob is already encrypted under the account password before it gets
 * here; the keychain is the second lock, not the only one.
 */

/** Comfortably under the platform limit, with room for the key name itself. */
const CHUNK = 1600;

function chunkKey(key: string, index: number): string {
  return `${key}__${index}`;
}

function countKey(key: string): string {
  return `${key}__n`;
}

/**
 * SecureStore rejects keys containing anything but alphanumerics, `.`, `-` and
 * `_`. Qmail's keys are derived from email addresses, so `@` has to go.
 */
function safeKey(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]/g, '_');
}

export function createSecureStoreStorage(): SecureStorage {
  return {
    async get(rawKey) {
      const key = safeKey(rawKey);
      const countRaw = await SecureStore.getItemAsync(countKey(key));
      if (countRaw === null) {
        return null;
      }
      const count = Number.parseInt(countRaw, 10);
      if (!Number.isFinite(count) || count < 0) {
        return null;
      }

      const parts: string[] = [];
      for (let i = 0; i < count; i += 1) {
        const part = await SecureStore.getItemAsync(chunkKey(key, i));
        if (part === null) {
          // A partial write, or storage cleared mid-way. Treat it as absent
          // rather than returning a truncated keystore that will fail to
          // decrypt with a confusing error.
          return null;
        }
        parts.push(part);
      }
      return parts.join('');
    },

    async set(rawKey, value) {
      const key = safeKey(rawKey);

      // Clear any longer previous value first, so stale trailing chunks cannot
      // be rejoined onto a shorter new one.
      await this.remove(rawKey);

      const chunks: string[] = [];
      for (let i = 0; i < value.length; i += CHUNK) {
        chunks.push(value.slice(i, i + CHUNK));
      }

      for (let i = 0; i < chunks.length; i += 1) {
        await SecureStore.setItemAsync(chunkKey(key, i), chunks[i] as string);
      }
      await SecureStore.setItemAsync(countKey(key), String(chunks.length));
    },

    async remove(rawKey) {
      const key = safeKey(rawKey);
      const countRaw = await SecureStore.getItemAsync(countKey(key));
      if (countRaw !== null) {
        const count = Number.parseInt(countRaw, 10);
        for (let i = 0; i < count; i += 1) {
          await SecureStore.deleteItemAsync(chunkKey(key, i));
        }
      }
      await SecureStore.deleteItemAsync(countKey(key));
    },
  };
}
