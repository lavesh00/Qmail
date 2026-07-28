/**
 * ML-KEM-768 (FIPS 203) and ML-DSA-65 (FIPS 204), via the Open Quantum Safe
 * liboqs WASM build.
 *
 * The WASM modules are expensive to instantiate and cheap to reuse, so each one
 * is created once and shared. Every function here is async only because that
 * first instantiation is; after it, the operations are synchronous WASM calls.
 */
import { loadKem, loadSig, type KemBackend, type SigBackend } from './liboqs.js';
import { SIZES, type KemKeyPair, type SigKeyPair } from './types.js';

let kemPromise: Promise<KemBackend> | null = null;
let sigPromise: Promise<SigBackend> | null = null;

function kem(): Promise<KemBackend> {
  kemPromise ??= loadKem();
  return kemPromise;
}

function sig(): Promise<SigBackend> {
  sigPromise ??= loadSig();
  return sigPromise;
}

/**
 * Instantiate both WASM modules ahead of time.
 *
 * Worth calling during app startup: it moves roughly 40 ms of one-off work off
 * the first send, where the user is waiting on it.
 */
export async function warmUp(): Promise<void> {
  await Promise.all([kem(), sig()]);
}

/**
 * Release both WASM modules. Only useful in tests and short-lived scripts —
 * an app should keep them for its lifetime.
 */
export async function releasePqc(): Promise<void> {
  if (kemPromise) {
    (await kemPromise).destroy();
    kemPromise = null;
  }
  if (sigPromise) {
    (await sigPromise).destroy();
    sigPromise = null;
  }
}

function expectSize(name: string, value: Uint8Array, expected: number): void {
  if (value.length !== expected) {
    throw new Error(`${name} must be ${expected} bytes, got ${value.length}`);
  }
}

/** Generate an ML-KEM-768 keypair. */
export async function generateKemKeyPair(): Promise<KemKeyPair> {
  const instance = await kem();
  const { publicKey, secretKey } = instance.generateKeyPair();
  return { publicKey, secretKey };
}

/**
 * Encapsulate to a public key, producing a ciphertext for the holder of the
 * matching secret key and the 32-byte shared secret both sides will derive.
 */
export async function kemEncapsulate(
  publicKey: Uint8Array,
): Promise<{ ciphertext: Uint8Array; sharedSecret: Uint8Array }> {
  expectSize('ML-KEM-768 public key', publicKey, SIZES.kemPublicKey);
  const instance = await kem();
  const { ciphertext, sharedSecret } = instance.encapsulate(publicKey);
  return { ciphertext, sharedSecret };
}

/** Recover the shared secret from a ciphertext using the matching secret key. */
export async function kemDecapsulate(
  ciphertext: Uint8Array,
  secretKey: Uint8Array,
): Promise<Uint8Array> {
  expectSize('ML-KEM-768 ciphertext', ciphertext, SIZES.kemCiphertext);
  expectSize('ML-KEM-768 secret key', secretKey, SIZES.kemSecretKey);
  const instance = await kem();
  return instance.decapsulate(ciphertext, secretKey);
}

/** Generate an ML-DSA-65 keypair. */
export async function generateSigKeyPair(): Promise<SigKeyPair> {
  const instance = await sig();
  const { publicKey, secretKey } = instance.generateKeyPair();
  return { publicKey, secretKey };
}

/** Sign a message with an ML-DSA-65 secret key. */
export async function sign(message: Uint8Array, secretKey: Uint8Array): Promise<Uint8Array> {
  expectSize('ML-DSA-65 secret key', secretKey, SIZES.sigSecretKey);
  const instance = await sig();
  return instance.sign(message, secretKey);
}

/**
 * Verify an ML-DSA-65 signature.
 *
 * Returns false rather than throwing for any malformed input, so that a corrupt
 * row read from the database is reported as "not verified" instead of crashing
 * the inbox that is rendering it.
 */
export async function verify(
  message: Uint8Array,
  signature: Uint8Array,
  publicKey: Uint8Array,
): Promise<boolean> {
  if (publicKey.length !== SIZES.sigPublicKey) {
    return false;
  }
  try {
    const instance = await sig();
    return instance.verify(message, signature, publicKey);
  } catch {
    return false;
  }
}
