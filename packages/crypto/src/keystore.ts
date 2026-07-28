/**
 * Private-key custody.
 *
 * Secret keys are encrypted under a key derived from the account password and
 * only ever written out in that form — to IndexedDB on web, SecureStore on
 * mobile. The server never receives this blob. Losing the password means losing
 * the mailbox, which is the intended property: there is no recovery path that
 * Qmail's operator could be compelled to use.
 */
import { aesDecrypt, aesEncrypt, generateIv } from './aes.js';
import { concatBytes, fromBase64, toBase64 } from './bytes.js';
import { deriveKeyFromPassword, deriveKeyWithParams, generateSalt } from './kdf.js';
import { SIZES, type EncryptedKeystore, type Identity, type SecretIdentity } from './types.js';

/**
 * Both secret keys are fixed-length under FIPS 203 and 204, so plain
 * concatenation is unambiguous and needs no framing.
 */
function serialiseSecrets(secrets: SecretIdentity): Uint8Array {
  if (secrets.kemSecretKey.length !== SIZES.kemSecretKey) {
    throw new Error('ML-KEM-768 secret key has the wrong length');
  }
  if (secrets.sigSecretKey.length !== SIZES.sigSecretKey) {
    throw new Error('ML-DSA-65 secret key has the wrong length');
  }
  return concatBytes(secrets.kemSecretKey, secrets.sigSecretKey);
}

function deserialiseSecrets(bytes: Uint8Array): SecretIdentity {
  const expected = SIZES.kemSecretKey + SIZES.sigSecretKey;
  if (bytes.length !== expected) {
    throw new Error(`Decrypted keystore is ${bytes.length} bytes, expected ${expected}`);
  }
  return {
    kemSecretKey: bytes.slice(0, SIZES.kemSecretKey),
    sigSecretKey: bytes.slice(SIZES.kemSecretKey),
  };
}

/** Encrypt an identity's secret keys under a password. */
export async function sealKeystore(
  secrets: SecretIdentity,
  password: string,
): Promise<EncryptedKeystore> {
  const salt = generateSalt();
  const { key, kdf, params } = await deriveKeyFromPassword(password, salt);
  const iv = generateIv();
  const ciphertext = await aesEncrypt(key, iv, serialiseSecrets(secrets));

  return {
    v: 1,
    kdf,
    kdfParams: params,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(ciphertext),
  };
}

/**
 * Decrypt a keystore.
 *
 * A wrong password and a corrupted blob both fail the GCM tag check, so both
 * surface here as the same error. That is deliberate — distinguishing them
 * would tell an attacker holding the file whether a guess was close.
 */
export async function openKeystore(
  keystore: EncryptedKeystore,
  password: string,
): Promise<SecretIdentity> {
  if (keystore.v !== 1) {
    throw new Error(`Unsupported keystore version: ${String(keystore.v)}`);
  }

  const salt = fromBase64(keystore.salt);
  const key = await deriveKeyWithParams(password, salt, keystore.kdf, keystore.kdfParams);

  let plaintext: Uint8Array;
  try {
    plaintext = await aesDecrypt(key, fromBase64(keystore.iv), fromBase64(keystore.ciphertext));
  } catch {
    throw new Error('Could not unlock keystore: wrong password, or the stored keys are corrupt.');
  }

  return deserialiseSecrets(plaintext);
}

/** Split a freshly generated identity into the halves that go to storage and to the server. */
export function splitIdentity(identity: Identity): {
  secrets: SecretIdentity;
  kemPublicKey: Uint8Array;
  sigPublicKey: Uint8Array;
} {
  return {
    secrets: {
      kemSecretKey: identity.kem.secretKey,
      sigSecretKey: identity.sig.secretKey,
    },
    kemPublicKey: identity.kem.publicKey,
    sigPublicKey: identity.sig.publicKey,
  };
}
