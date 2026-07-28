/**
 * Where a device keeps its encrypted private keys.
 *
 * The blob written here is already encrypted under a key derived from the
 * account password, so this interface is not the thing protecting it — it just
 * has to persist across restarts and be scoped to the app. Web uses IndexedDB,
 * mobile uses Expo SecureStore; both satisfy the same three methods, which is
 * all the shared logic needs to know.
 */
export interface SecureStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/** Storage key for the encrypted keystore of a given address. */
export function keystoreKey(address: string): string {
  return `qmail.keystore.${address.toLowerCase()}`;
}

/** Storage key recording which address this device last signed in as. */
export const LAST_ADDRESS_KEY = 'qmail.last-address';

/**
 * An in-memory implementation, for tests and for a device that has explicitly
 * chosen not to persist keys. Nothing survives a restart.
 */
export function createMemoryStorage(): SecureStorage {
  const map = new Map<string, string>();
  return {
    async get(key) {
      return map.get(key) ?? null;
    },
    async set(key, value) {
      map.set(key, value);
    },
    async remove(key) {
      map.delete(key);
    },
  };
}
