/**
 * Password-based key derivation, for the key that encrypts private keys at rest.
 *
 * Argon2id is the primary: it is memory-hard, so an attacker who steals the
 * encrypted keystore cannot cheaply parallelise guessing on a GPU. If the
 * Argon2 WASM module cannot be loaded on a given platform, PBKDF2-HMAC-SHA-512
 * at a high iteration count is used instead — it is weaker against custom
 * hardware but is available through the same WebCrypto seam everything else
 * here already relies on.
 *
 * Which one was used is recorded in the keystore, so a blob written on one
 * platform always stays readable on another.
 */
import { getCryptoProvider, randomBytes } from './platform.js';
import type { Argon2Params, KdfName, Pbkdf2Params } from './types.js';
import { SIZES } from './types.js';

/**
 * Argon2id cost parameters, at the minimum OWASP recommends for this variant
 * (19 MiB of memory, two passes). Chosen to stay comfortable on a mid-range
 * phone — memory cost is what an attacker pays for, and what a cheap device
 * cannot afford.
 */
export const DEFAULT_ARGON2_PARAMS: Argon2Params = {
  t: 2,
  m: 19456,
  p: 1,
};

/** PBKDF2 fallback cost, at the OWASP figure for HMAC-SHA-512. */
export const DEFAULT_PBKDF2_PARAMS: Pbkdf2Params = {
  iterations: 210_000,
};

/** Length of the KDF salt. Fresh per keystore, stored alongside it in the clear. */
export const SALT_BYTES = 16;

export interface DerivedKey {
  key: Uint8Array;
  kdf: KdfName;
  params: Argon2Params | Pbkdf2Params;
}

/** Generate a fresh random KDF salt. */
export function generateSalt(): Uint8Array {
  return randomBytes(SALT_BYTES);
}

let argon2Available: boolean | null = null;

async function deriveArgon2id(
  password: string,
  salt: Uint8Array,
  params: Argon2Params,
): Promise<Uint8Array> {
  const { argon2id } = await import('hash-wasm');
  const result = await argon2id({
    password,
    salt,
    parallelism: params.p,
    iterations: params.t,
    memorySize: params.m,
    hashLength: SIZES.aesKey,
    outputType: 'binary',
  });
  return new Uint8Array(result);
}

async function derivePbkdf2(
  password: string,
  salt: Uint8Array,
  params: Pbkdf2Params,
): Promise<Uint8Array> {
  const provider = getCryptoProvider();
  const passwordBytes = new TextEncoder().encode(password);
  const baseKey = await provider.subtle.importKey('raw', passwordBytes, 'PBKDF2', false, [
    'deriveBits',
  ]);
  const saltCopy = new Uint8Array(salt);
  const bits = await provider.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-512', salt: saltCopy, iterations: params.iterations },
    baseKey,
    SIZES.aesKey * 8,
  );
  return new Uint8Array(bits);
}

/**
 * Derive a 256-bit key from a password, preferring Argon2id.
 *
 * The first failure to load Argon2 is remembered, so a platform without it does
 * not pay the failed-import cost on every unlock.
 */
export async function deriveKeyFromPassword(
  password: string,
  salt: Uint8Array,
): Promise<DerivedKey> {
  if (argon2Available !== false) {
    try {
      const key = await deriveArgon2id(password, salt, DEFAULT_ARGON2_PARAMS);
      argon2Available = true;
      return { key, kdf: 'argon2id', params: DEFAULT_ARGON2_PARAMS };
    } catch (error) {
      argon2Available = false;
      // eslint-disable-next-line no-console
      console.warn('Argon2id unavailable, falling back to PBKDF2-SHA-512:', error);
    }
  }

  const key = await derivePbkdf2(password, salt, DEFAULT_PBKDF2_PARAMS);
  return { key, kdf: 'pbkdf2-sha512', params: DEFAULT_PBKDF2_PARAMS };
}

/**
 * Re-derive a key using exactly the algorithm and parameters recorded in a
 * stored keystore, rather than the current defaults. Without this, raising the
 * cost parameters in a later release would lock every existing user out.
 */
export async function deriveKeyWithParams(
  password: string,
  salt: Uint8Array,
  kdf: KdfName,
  params: Argon2Params | Pbkdf2Params,
): Promise<Uint8Array> {
  if (kdf === 'argon2id') {
    return deriveArgon2id(password, salt, params as Argon2Params);
  }
  if (kdf === 'pbkdf2-sha512') {
    return derivePbkdf2(password, salt, params as Pbkdf2Params);
  }
  throw new Error(`Unknown key-derivation function: ${String(kdf)}`);
}
