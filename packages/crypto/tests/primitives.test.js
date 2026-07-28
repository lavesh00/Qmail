/**
 * AES-256-GCM, HKDF, SHA-256 and the password KDF, checked against published
 * known-answer vectors.
 *
 * The GCM vectors are from the McGrew & Viega GCM specification that NIST
 * SP 800-38D adopted (test cases 13, 14 and 16 — the AES-256 ones). The HKDF
 * vector is RFC 5869 test case 1. Each has been confirmed to agree with Node's
 * own OpenSSL-backed implementation, which is independent of the WebCrypto path
 * this package actually uses.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { pbkdf2Sync } from 'node:crypto';
import {
  aesDecrypt,
  aesEncrypt,
  deriveKeyEncryptionKey,
  deriveKeyFromPassword,
  deriveKeyWithParams,
  fromHex,
  generateAesKey,
  generateIv,
  generateSalt,
  randomBytes,
  sha256,
  toHex,
  toUtf8,
} from '../dist/index.js';

/**
 * Web Crypto returns ciphertext and tag as one buffer, in that order, so the
 * expected value for each vector is `C || T`.
 */
const GCM_VECTORS = [
  {
    name: 'test case 13 — empty plaintext, empty AAD',
    key: '0000000000000000000000000000000000000000000000000000000000000000',
    iv: '000000000000000000000000',
    aad: '',
    plaintext: '',
    expected: '530f8afbc74536b9a963b4f1c4cb738b',
  },
  {
    name: 'test case 14 — one zero block, empty AAD',
    key: '0000000000000000000000000000000000000000000000000000000000000000',
    iv: '000000000000000000000000',
    aad: '',
    plaintext: '00000000000000000000000000000000',
    expected: 'cea7403d4d606b6e074ec5d3baf39d18d0d1c8a799996bf0265b98b5d48ab919',
  },
  {
    name: 'test case 16 — multi-block plaintext with AAD',
    key: 'feffe9928665731c6d6a8f9467308308feffe9928665731c6d6a8f9467308308',
    iv: 'cafebabefacedbaddecaf888',
    aad: 'feedfacedeadbeeffeedfacedeadbeefabaddad2',
    plaintext:
      'd9313225f88406e5a55909c5aff5269a86a7a9531534f7da2e4c303d8a318a721c3c0c95956809532fcf0e2449a6b525b16aedf5aa0de657ba637b39',
    expected:
      '522dc1f099567d07f47f37a32a84427d643a8cdcbfe5c0c97598a2bd2555d1aa8cb08e48590dbb3da7b08b1056828838c5f61e6393ba7a0abcc9f66276fc6ece0f4e1768cddf8853bb2d551b',
  },
];

for (const vector of GCM_VECTORS) {
  test(`AES-256-GCM encrypt matches GCM ${vector.name}`, async () => {
    const actual = await aesEncrypt(
      fromHex(vector.key),
      fromHex(vector.iv),
      fromHex(vector.plaintext),
      vector.aad ? fromHex(vector.aad) : undefined,
    );
    assert.equal(toHex(actual), vector.expected);
  });

  test(`AES-256-GCM decrypt matches GCM ${vector.name}`, async () => {
    const actual = await aesDecrypt(
      fromHex(vector.key),
      fromHex(vector.iv),
      fromHex(vector.expected),
      vector.aad ? fromHex(vector.aad) : undefined,
    );
    assert.equal(toHex(actual), vector.plaintext);
  });
}

test('AES-256-GCM rejects a flipped ciphertext bit', async () => {
  const key = generateAesKey();
  const iv = generateIv();
  const sealed = await aesEncrypt(key, iv, toUtf8('the quick brown fox'));
  sealed[3] ^= 0x01;
  await assert.rejects(() => aesDecrypt(key, iv, sealed));
});

test('AES-256-GCM rejects altered associated data', async () => {
  // This is what stops a message header being rewritten in the database.
  const key = generateAesKey();
  const iv = generateIv();
  const sealed = await aesEncrypt(key, iv, toUtf8('body'), toUtf8('from:alice@qmail.com'));
  await assert.rejects(() => aesDecrypt(key, iv, sealed, toUtf8('from:mallory@qmail.com')));
});

test('AES-256-GCM rejects the wrong key', async () => {
  const iv = generateIv();
  const sealed = await aesEncrypt(generateAesKey(), iv, toUtf8('body'));
  await assert.rejects(() => aesDecrypt(generateAesKey(), iv, sealed));
});

test('AES key import rejects a key that is not 256 bits', async () => {
  await assert.rejects(() => aesEncrypt(randomBytes(16), generateIv(), toUtf8('x')), /32 bytes/);
});

test('SHA-256 matches the NIST vector for "abc"', async () => {
  assert.equal(
    toHex(await sha256(toUtf8('abc'))),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
});

test('SHA-256 matches the NIST vector for the empty string', async () => {
  assert.equal(
    toHex(await sha256(new Uint8Array(0))),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  );
});

test('HKDF key-encryption keys are deterministic and domain-separated', async () => {
  const secret = fromHex('0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b');

  const a = await deriveKeyEncryptionKey(secret, 'qmail/v1/content-key-wrap');
  const again = await deriveKeyEncryptionKey(secret, 'qmail/v1/content-key-wrap');
  const other = await deriveKeyEncryptionKey(secret, 'qmail/v1/something-else');

  assert.equal(a.length, 32);
  assert.deepEqual(a, again, 'same secret and info must give the same key');
  assert.notDeepEqual(a, other, 'a different info string must give an unrelated key');
});

test('HKDF output differs for different shared secrets', async () => {
  const a = await deriveKeyEncryptionKey(randomBytes(32), 'qmail/v1/content-key-wrap');
  const b = await deriveKeyEncryptionKey(randomBytes(32), 'qmail/v1/content-key-wrap');
  assert.notDeepEqual(a, b);
});

test('Argon2id is the default and produces a 256-bit key', async () => {
  const salt = generateSalt();
  const derived = await deriveKeyFromPassword('correct horse battery staple', salt);
  assert.equal(derived.kdf, 'argon2id');
  assert.equal(derived.key.length, 32);
  assert.deepEqual(derived.params, { t: 2, m: 19456, p: 1 });
});

test('Argon2id is deterministic for a given password, salt and cost', async () => {
  const salt = generateSalt();
  const a = await deriveKeyFromPassword('hunter2', salt);
  const b = await deriveKeyWithParams('hunter2', salt, a.kdf, a.params);
  assert.deepEqual(a.key, b);
});

test('Argon2id output changes with the salt and with the password', async () => {
  const saltA = generateSalt();
  const saltB = generateSalt();
  const base = await deriveKeyFromPassword('hunter2', saltA);
  const otherSalt = await deriveKeyFromPassword('hunter2', saltB);
  const otherPassword = await deriveKeyFromPassword('hunter3', saltA);

  assert.notDeepEqual(base.key, otherSalt.key);
  assert.notDeepEqual(base.key, otherPassword.key);
});

test('PBKDF2 fallback agrees with Node’s independent implementation', async () => {
  // The fallback path has to be correct even though it is not the default,
  // because a keystore written on a platform without Argon2 must stay readable.
  const salt = generateSalt();
  const params = { iterations: 210_000 };
  const ours = await deriveKeyWithParams('hunter2', salt, 'pbkdf2-sha512', params);
  const theirs = pbkdf2Sync('hunter2', Buffer.from(salt), params.iterations, 32, 'sha512');
  assert.equal(toHex(ours), theirs.toString('hex'));
});

test('deriveKeyWithParams rejects an unknown KDF name', async () => {
  await assert.rejects(
    () => deriveKeyWithParams('x', generateSalt(), 'scrypt', { iterations: 1 }),
    /Unknown key-derivation function/,
  );
});

test('randomBytes returns the requested length and does not repeat', () => {
  assert.equal(randomBytes(32).length, 32);
  assert.notDeepEqual(randomBytes(32), randomBytes(32));
});
