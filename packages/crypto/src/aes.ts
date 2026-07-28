/**
 * AES-256-GCM and HKDF, both from the Web Crypto API.
 *
 * GCM is authenticated: a wrong key, a flipped ciphertext bit, or altered
 * associated data all surface as a thrown error on decrypt rather than as
 * plausible-looking garbage.
 */
import { SIZES } from './types.js';
import { getCryptoProvider, randomBytes } from './platform.js';

/** Generate a fresh random 256-bit content key. */
export function generateAesKey(): Uint8Array {
  return randomBytes(SIZES.aesKey);
}

/** Generate a fresh random 96-bit GCM nonce. Never reuse one with a given key. */
export function generateIv(): Uint8Array {
  return randomBytes(SIZES.aesIv);
}

async function importAesKey(raw: Uint8Array, usage: KeyUsage[]): Promise<CryptoKey> {
  if (raw.length !== SIZES.aesKey) {
    throw new Error(`AES key must be ${SIZES.aesKey} bytes, got ${raw.length}`);
  }
  return getCryptoProvider().subtle.importKey('raw', toArrayBuffer(raw), 'AES-GCM', false, usage);
}

/**
 * Copy into a standalone ArrayBuffer.
 *
 * A Uint8Array may be a view onto a larger buffer (WASM heap views routinely
 * are), and handing that whole buffer to WebCrypto would encrypt far more than
 * intended.
 */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer;
}

/**
 * Encrypt with AES-256-GCM.
 *
 * `additionalData` is authenticated but not encrypted: it cannot be altered
 * without decryption failing, which is how message headers get bound to their
 * bodies.
 */
export async function aesEncrypt(
  key: Uint8Array,
  iv: Uint8Array,
  plaintext: Uint8Array,
  additionalData?: Uint8Array,
): Promise<Uint8Array> {
  const cryptoKey = await importAesKey(key, ['encrypt']);
  const params: AesGcmParams = { name: 'AES-GCM', iv: toArrayBuffer(iv), tagLength: 128 };
  if (additionalData) {
    params.additionalData = toArrayBuffer(additionalData);
  }
  const result = await getCryptoProvider().subtle.encrypt(params, cryptoKey, toArrayBuffer(plaintext));
  return new Uint8Array(result);
}

/**
 * Decrypt with AES-256-GCM.
 *
 * Throws if the tag does not check out — wrong key, tampered ciphertext, or
 * altered associated data are indistinguishable here, and all three should stop
 * the caller cold.
 */
export async function aesDecrypt(
  key: Uint8Array,
  iv: Uint8Array,
  ciphertext: Uint8Array,
  additionalData?: Uint8Array,
): Promise<Uint8Array> {
  const cryptoKey = await importAesKey(key, ['decrypt']);
  const params: AesGcmParams = { name: 'AES-GCM', iv: toArrayBuffer(iv), tagLength: 128 };
  if (additionalData) {
    params.additionalData = toArrayBuffer(additionalData);
  }
  const result = await getCryptoProvider().subtle.decrypt(params, cryptoKey, toArrayBuffer(ciphertext));
  return new Uint8Array(result);
}

/**
 * Derive a key-encryption key from an ML-KEM shared secret via HKDF-SHA-256.
 *
 * The shared secret is not used as an AES key directly. HKDF gives domain
 * separation, so the same secret used for a different purpose would produce an
 * unrelated key, and it means the KEM's output distribution never has to be
 * assumed uniform by the cipher.
 */
export async function deriveKeyEncryptionKey(
  sharedSecret: Uint8Array,
  info: string,
): Promise<Uint8Array> {
  const provider = getCryptoProvider();
  const baseKey = await provider.subtle.importKey(
    'raw',
    toArrayBuffer(sharedSecret),
    'HKDF',
    false,
    ['deriveBits'],
  );
  const bits = await provider.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      // The shared secret is already uniform and single-use, so a salt adds
      // nothing here; `info` carries the domain separation instead.
      salt: new Uint8Array(0),
      info: new TextEncoder().encode(info),
    },
    baseKey,
    SIZES.aesKey * 8,
  );
  return new Uint8Array(bits);
}

/** SHA-256 digest. */
export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const digest = await getCryptoProvider().subtle.digest('SHA-256', toArrayBuffer(data));
  return new Uint8Array(digest);
}
