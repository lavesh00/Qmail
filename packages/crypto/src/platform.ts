/**
 * The one place this package touches host capabilities.
 *
 * Web and Node both expose a spec-compliant `globalThis.crypto` with
 * `getRandomValues` and `subtle`, so they need no setup. React Native does not
 * ship WebCrypto, so the mobile app installs a polyfill and calls
 * `setCryptoProvider` before any Qmail crypto runs. Keeping that seam explicit
 * means the algorithms themselves stay identical on every platform.
 */

export interface CryptoProvider {
  getRandomValues<T extends ArrayBufferView>(array: T): T;
  subtle: SubtleCrypto;
}

let override: CryptoProvider | null = null;

/**
 * Install a WebCrypto implementation. Call once, at app startup, before any
 * other function in this package.
 */
export function setCryptoProvider(provider: CryptoProvider): void {
  override = provider;
}

/** Resolve the active WebCrypto implementation. */
export function getCryptoProvider(): CryptoProvider {
  if (override) {
    return override;
  }
  const globalCrypto = (globalThis as { crypto?: CryptoProvider }).crypto;
  if (globalCrypto?.subtle && typeof globalCrypto.getRandomValues === 'function') {
    return globalCrypto;
  }
  throw new Error(
    'No WebCrypto implementation available. On React Native, call setCryptoProvider() with a polyfill during app startup.',
  );
}

/** Fill a new buffer of `length` bytes with cryptographically secure randomness. */
export function randomBytes(length: number): Uint8Array {
  return getCryptoProvider().getRandomValues(new Uint8Array(length));
}
