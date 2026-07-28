/**
 * Private-key custody at rest.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SIZES,
  fromBase64,
  generateIdentity,
  openKeystore,
  releasePqc,
  sealKeystore,
  splitIdentity,
  toBase64,
} from '../dist/index.js';

test.after(async () => {
  await releasePqc();
});

const identity = await generateIdentity();
const { secrets } = splitIdentity(identity);
const PASSWORD = 'a reasonably long passphrase';

test('a keystore round-trips under the right password', async () => {
  const keystore = await sealKeystore(secrets, PASSWORD);
  const recovered = await openKeystore(keystore, PASSWORD);
  assert.deepEqual(recovered.kemSecretKey, secrets.kemSecretKey);
  assert.deepEqual(recovered.sigSecretKey, secrets.sigSecretKey);
});

test('a keystore exposes no key material', async () => {
  const keystore = await sealKeystore(secrets, PASSWORD);
  const serialised = JSON.stringify(keystore);
  assert.equal(serialised.includes(toBase64(secrets.kemSecretKey)), false);
  assert.equal(serialised.includes(toBase64(secrets.sigSecretKey)), false);
  assert.equal(serialised.includes(PASSWORD), false);
});

test('a keystore records how it was derived, so a later build can still read it', async () => {
  const keystore = await sealKeystore(secrets, PASSWORD);
  assert.equal(keystore.v, 1);
  assert.equal(keystore.kdf, 'argon2id');
  assert.deepEqual(keystore.kdfParams, { t: 2, m: 19456, p: 1 });
  assert.equal(fromBase64(keystore.salt).length, 16);
  assert.equal(fromBase64(keystore.iv).length, SIZES.aesIv);
});

test('the wrong password is refused', async () => {
  const keystore = await sealKeystore(secrets, PASSWORD);
  await assert.rejects(
    () => openKeystore(keystore, 'not the password'),
    /wrong password, or the stored keys are corrupt/,
  );
});

test('a password differing by one character is refused', async () => {
  const keystore = await sealKeystore(secrets, PASSWORD);
  await assert.rejects(() => openKeystore(keystore, `${PASSWORD} `));
});

test('a corrupted keystore is refused rather than yielding garbage keys', async () => {
  const keystore = await sealKeystore(secrets, PASSWORD);
  const bytes = fromBase64(keystore.ciphertext);
  bytes[20] ^= 0x01;
  await assert.rejects(() => openKeystore({ ...keystore, ciphertext: toBase64(bytes) }));
});

test('two keystores for the same identity differ, because the salt is fresh', async () => {
  const a = await sealKeystore(secrets, PASSWORD);
  const b = await sealKeystore(secrets, PASSWORD);
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.ciphertext, b.ciphertext);
});

test('an unknown keystore version is refused', async () => {
  const keystore = await sealKeystore(secrets, PASSWORD);
  await assert.rejects(
    () => openKeystore({ ...keystore, v: 99 }, PASSWORD),
    /Unsupported keystore version/,
  );
});

test('a keystore written with PBKDF2 stays readable', async () => {
  // Simulates a blob written on a platform where Argon2 could not load. The
  // recorded parameters, not the current defaults, decide how to re-derive.
  const { deriveKeyWithParams } = await import('../dist/index.js');
  const { aesEncrypt, generateIv, generateSalt } = await import('../dist/index.js');

  const salt = generateSalt();
  const params = { iterations: 210_000 };
  const key = await deriveKeyWithParams(PASSWORD, salt, 'pbkdf2-sha512', params);
  const iv = generateIv();
  const plaintext = new Uint8Array(SIZES.kemSecretKey + SIZES.sigSecretKey);
  plaintext.set(secrets.kemSecretKey, 0);
  plaintext.set(secrets.sigSecretKey, SIZES.kemSecretKey);

  const keystore = {
    v: 1,
    kdf: 'pbkdf2-sha512',
    kdfParams: params,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(await aesEncrypt(key, iv, plaintext)),
  };

  const recovered = await openKeystore(keystore, PASSWORD);
  assert.deepEqual(recovered.kemSecretKey, secrets.kemSecretKey);
  assert.deepEqual(recovered.sigSecretKey, secrets.sigSecretKey);
});

test('splitIdentity separates what is published from what stays on the device', () => {
  const split = splitIdentity(identity);
  assert.deepEqual(split.kemPublicKey, identity.kem.publicKey);
  assert.deepEqual(split.sigPublicKey, identity.sig.publicKey);
  assert.deepEqual(split.secrets.kemSecretKey, identity.kem.secretKey);
  assert.deepEqual(split.secrets.sigSecretKey, identity.sig.secretKey);
});

test('a keystore refuses secret keys of the wrong length', async () => {
  await assert.rejects(
    () => sealKeystore({ kemSecretKey: new Uint8Array(10), sigSecretKey: secrets.sigSecretKey }, PASSWORD),
    /ML-KEM-768 secret key has the wrong length/,
  );
  await assert.rejects(
    () => sealKeystore({ kemSecretKey: secrets.kemSecretKey, sigSecretKey: new Uint8Array(10) }, PASSWORD),
    /ML-DSA-65 secret key has the wrong length/,
  );
});
