/**
 * @qmail/crypto — the single cryptographic implementation shared by the web and
 * mobile clients.
 *
 * Nothing in here talks to a network or to storage. It takes bytes and returns
 * bytes, which is what lets the identical package be imported by a browser, a
 * React Native runtime, and a plain Node test script and be expected to produce
 * identical results.
 */

export {
  ALGORITHMS,
  SIZES,
  type Argon2Params,
  type Attachment,
  type EncryptedKeystore,
  type EnvelopeHeader,
  type Identity,
  type KdfName,
  type KemKeyPair,
  type KeySlot,
  type MessageContent,
  type OpenedMessage,
  type Pbkdf2Params,
  type PublicIdentity,
  type SealedEnvelope,
  type SecretIdentity,
  type SigKeyPair,
} from './types.js';

export {
  canonicalBytes,
  canonicalJson,
  concatBytes,
  constantTimeEqual,
  fromBase64,
  fromHex,
  fromUtf8,
  toBase64,
  toHex,
  toUtf8,
  wipe,
} from './bytes.js';

export {
  getCryptoProvider,
  randomBytes,
  setCryptoProvider,
  type CryptoProvider,
} from './platform.js';

export {
  generateKemKeyPair,
  generateSigKeyPair,
  kemDecapsulate,
  kemEncapsulate,
  releasePqc,
  sign,
  verify,
  warmUp,
} from './pqc.js';

export {
  aesDecrypt,
  aesEncrypt,
  deriveKeyEncryptionKey,
  generateAesKey,
  generateIv,
  sha256,
} from './aes.js';

export {
  DEFAULT_ARGON2_PARAMS,
  DEFAULT_PBKDF2_PARAMS,
  deriveKeyFromPassword,
  deriveKeyWithParams,
  generateSalt,
  type DerivedKey,
} from './kdf.js';

export { openKeystore, sealKeystore, splitIdentity } from './keystore.js';

export {
  fingerprint,
  formatFingerprint,
  generateIdentity,
  identityFingerprint,
} from './identity.js';

export {
  openMessage,
  sealMessage,
  verifyEnvelope,
  type EnvelopeRole,
  type OpenOptions,
  type SealOptions,
} from './envelope.js';

export { runParityCheck, type ParityCheck, type ParityReport } from './parity.js';
