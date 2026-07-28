import type { SecureStorage } from '@qmail/core';

/**
 * The browser's home for this device's encrypted keystore.
 *
 * IndexedDB rather than localStorage because it is not readable synchronously
 * from any script on the page and has no size ceiling worth worrying about. It
 * is not a secure enclave and does not need to be: what gets written here is
 * already encrypted under a key derived from the account password, and the
 * password is never stored anywhere.
 */
const DATABASE = 'qmail';
const STORE = 'keystore';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open local storage'));
  });
}

function transact<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDatabase().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = run(transaction.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('Local storage request failed'));
        transaction.oncomplete = () => db.close();
      }),
  );
}

export function createIndexedDbStorage(): SecureStorage {
  return {
    async get(key) {
      const value = await transact<unknown>('readonly', (store) => store.get(key));
      return typeof value === 'string' ? value : null;
    },
    async set(key, value) {
      await transact('readwrite', (store) => store.put(value, key));
    },
    async remove(key) {
      await transact('readwrite', (store) => store.delete(key));
    },
  };
}
