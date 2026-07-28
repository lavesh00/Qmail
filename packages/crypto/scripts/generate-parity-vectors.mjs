/**
 * Generates the frozen vector set used by the cross-platform parity check.
 *
 * Run once, on any machine, and commit the result. Everything captured here is
 * deterministic on replay: decapsulating a fixed ciphertext under a fixed secret
 * key always yields the same shared secret, verifying a fixed signature always
 * yields the same answer, and opening a fixed envelope always yields the same
 * plaintext. Key generation and encapsulation are randomised and so are not
 * captured — those are exercised separately as a live round-trip.
 *
 *   node scripts/generate-parity-vectors.mjs
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  aesEncrypt,
  deriveKeyEncryptionKey,
  deriveKeyWithParams,
  generateIdentity,
  sealKeystore,
  sealMessage,
  sign,
  splitIdentity,
  toBase64,
  toUtf8,
  releasePqc,
} from '../dist/index.js';

const alice = await generateIdentity();
const bob = await generateIdentity();

// --- AES-256-GCM: GCM specification test case 16 -----------------------------
const aesKey = Buffer.from('feffe9928665731c6d6a8f9467308308feffe9928665731c6d6a8f9467308308', 'hex');
const aesIv = Buffer.from('cafebabefacedbaddecaf888', 'hex');
const aesAad = Buffer.from('feedfacedeadbeeffeedfacedeadbeefabaddad2', 'hex');
const aesPlaintext = Buffer.from(
  'd9313225f88406e5a55909c5aff5269a86a7a9531534f7da2e4c303d8a318a721c3c0c95956809532fcf0e2449a6b525b16aedf5aa0de657ba637b39',
  'hex',
);

// --- HKDF -------------------------------------------------------------------
const hkdfSecret = new Uint8Array(32).fill(0x0b);
const hkdfInfo = 'qmail/v1/content-key-wrap';

// --- Password KDFs ----------------------------------------------------------
const kdfPassword = 'qmail parity vector password';
const kdfSalt = new Uint8Array(16).map((_, i) => i);
const argon2Params = { t: 2, m: 19456, p: 1 };
const pbkdf2Params = { iterations: 210_000 };

// --- Signature --------------------------------------------------------------
const sigMessage = toUtf8('qmail cross-platform parity vector');
const signature = await sign(sigMessage, alice.sig.secretKey);

// --- Envelope ---------------------------------------------------------------
const content = {
  subject: 'Parity vector',
  body: 'If this opens identically on every platform, the shared module is genuinely shared. नमस्ते 🔐',
  attachment: {
    filename: 'sample.bin',
    mimeType: 'application/octet-stream',
    data: new Uint8Array(512).map((_, i) => (i * 17 + 3) % 256),
  },
};
const envelope = await sealMessage({
  content,
  from: 'alice@qmail.com',
  to: 'bob@qmail.com',
  recipientKemPublicKey: bob.kem.publicKey,
  senderKemPublicKey: alice.kem.publicKey,
  senderSigSecretKey: alice.sig.secretKey,
  sentAt: '2026-07-28T10:00:00.000Z',
});

// --- Keystore ---------------------------------------------------------------
const keystorePassword = 'parity keystore password';
const { secrets } = splitIdentity(bob);
const keystore = await sealKeystore(secrets, keystorePassword);

const vectors = {
  generatedAt: new Date().toISOString(),
  note: 'Frozen inputs for the cross-platform parity check. Regenerate only deliberately — changing these invalidates every recorded platform digest.',

  aes: {
    key: toBase64(aesKey),
    iv: toBase64(aesIv),
    aad: toBase64(aesAad),
    plaintext: toBase64(aesPlaintext),
    expectedCiphertext: toBase64(await aesEncrypt(aesKey, aesIv, aesPlaintext, aesAad)),
  },

  hkdf: {
    sharedSecret: toBase64(hkdfSecret),
    info: hkdfInfo,
    expectedKey: toBase64(await deriveKeyEncryptionKey(hkdfSecret, hkdfInfo)),
  },

  argon2id: {
    password: kdfPassword,
    salt: toBase64(kdfSalt),
    params: argon2Params,
    expectedKey: toBase64(await deriveKeyWithParams(kdfPassword, kdfSalt, 'argon2id', argon2Params)),
  },

  pbkdf2: {
    password: kdfPassword,
    salt: toBase64(kdfSalt),
    params: pbkdf2Params,
    expectedKey: toBase64(
      await deriveKeyWithParams(kdfPassword, kdfSalt, 'pbkdf2-sha512', pbkdf2Params),
    ),
  },

  mlKem768: {
    secretKey: toBase64(bob.kem.secretKey),
    ciphertext: envelope.recipientSlot.kemCiphertext,
    // Filled in below — it is whatever decapsulation actually produces, which is
    // deterministic given the pair above.
    expectedSharedSecret: null,
  },

  mlDsa65: {
    publicKey: toBase64(alice.sig.publicKey),
    message: toBase64(sigMessage),
    signature: toBase64(signature),
  },

  envelope: {
    sealed: envelope,
    recipientKemSecretKey: toBase64(bob.kem.secretKey),
    senderSigPublicKey: toBase64(alice.sig.publicKey),
    expectedSubject: content.subject,
    expectedBody: content.body,
    expectedAttachment: {
      filename: content.attachment.filename,
      mimeType: content.attachment.mimeType,
      data: toBase64(content.attachment.data),
    },
  },

  keystore: {
    sealed: keystore,
    password: keystorePassword,
    expectedKemSecretKey: toBase64(secrets.kemSecretKey),
    expectedSigSecretKey: toBase64(secrets.sigSecretKey),
  },
};

// Record the shared secret that this fixed (secret key, ciphertext) pair yields.
const { kemDecapsulate, fromBase64 } = await import('../dist/index.js');
vectors.mlKem768.expectedSharedSecret = toBase64(
  await kemDecapsulate(fromBase64(vectors.mlKem768.ciphertext), bob.kem.secretKey),
);

// Emitted as TypeScript rather than JSON on purpose. A `.json` import needs
// either an import attribute (which Metro's parser does not reliably accept) or
// a bundler-specific JSON loader; a plain module is understood identically by
// tsc, Vite, Metro and Node with no configuration at all.
const outPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'parity-vectors.ts');
const banner = `/**
 * Frozen inputs for the cross-platform parity check. Generated — do not edit.
 *
 *   node scripts/generate-parity-vectors.mjs
 *
 * Regenerating invalidates every previously recorded platform digest, so only
 * do it deliberately.
 */
export const PARITY_VECTORS = `;
writeFileSync(outPath, `${banner}${JSON.stringify(vectors, null, 2)} as const;\n`);
console.log(`Wrote ${outPath}`);

await releasePqc();
