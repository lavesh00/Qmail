/**
 * ML-KEM-768 and ML-DSA-65.
 *
 * NIST's published known-answer vectors cannot be run directly through this
 * package: liboqs-js exposes no way to inject the deterministic seed those
 * vectors depend on, so keypairs and encapsulations here are always randomised.
 *
 * What is checked instead is stronger than a round-trip against ourselves —
 * every operation is cross-validated against @noble/post-quantum, a separate
 * pure-JavaScript implementation of FIPS 203 and FIPS 204 that shares no code
 * with the liboqs WASM build. Keys, ciphertexts and signatures produced by one
 * are consumed by the other in both directions. Two independent implementations
 * agreeing byte-for-byte is the property that a known-answer test is trying to
 * establish in the first place.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import {
  SIZES,
  generateKemKeyPair,
  generateSigKeyPair,
  kemDecapsulate,
  kemEncapsulate,
  releasePqc,
  sign,
  toUtf8,
  verify,
} from '../dist/index.js';

test.after(async () => {
  await releasePqc();
});

test('ML-KEM-768 key sizes match FIPS 203', async () => {
  const { publicKey, secretKey } = await generateKemKeyPair();
  assert.equal(publicKey.length, SIZES.kemPublicKey, 'encapsulation key is 1184 bytes');
  assert.equal(secretKey.length, SIZES.kemSecretKey, 'decapsulation key is 2400 bytes');
});

test('ML-KEM-768 ciphertext and shared secret sizes match FIPS 203', async () => {
  const { publicKey } = await generateKemKeyPair();
  const { ciphertext, sharedSecret } = await kemEncapsulate(publicKey);
  assert.equal(ciphertext.length, SIZES.kemCiphertext, 'ciphertext is 1088 bytes');
  assert.equal(sharedSecret.length, SIZES.kemSharedSecret, 'shared secret is 32 bytes');
});

test('ML-KEM-768 encapsulation and decapsulation agree', async () => {
  const { publicKey, secretKey } = await generateKemKeyPair();
  const { ciphertext, sharedSecret } = await kemEncapsulate(publicKey);
  assert.deepEqual(await kemDecapsulate(ciphertext, secretKey), sharedSecret);
});

test('ML-KEM-768 encapsulation is randomised', async () => {
  // Two encapsulations to the same key must not produce the same ciphertext,
  // or every message to a given recipient would share a content key.
  const { publicKey } = await generateKemKeyPair();
  const a = await kemEncapsulate(publicKey);
  const b = await kemEncapsulate(publicKey);
  assert.notDeepEqual(a.ciphertext, b.ciphertext);
  assert.notDeepEqual(a.sharedSecret, b.sharedSecret);
});

test('ML-KEM-768 gives the wrong key holder a different shared secret', async () => {
  // ML-KEM uses implicit rejection: decapsulating with the wrong key yields a
  // plausible-looking but unrelated secret rather than an error. The AEAD tag
  // is what turns that into a visible failure, which the envelope tests cover.
  const alice = await generateKemKeyPair();
  const mallory = await generateKemKeyPair();
  const { ciphertext, sharedSecret } = await kemEncapsulate(alice.publicKey);
  assert.notDeepEqual(await kemDecapsulate(ciphertext, mallory.secretKey), sharedSecret);
});

test('ML-KEM-768 rejects inputs of the wrong length', async () => {
  await assert.rejects(() => kemEncapsulate(new Uint8Array(100)), /1184 bytes/);
  await assert.rejects(
    () => kemDecapsulate(new Uint8Array(10), new Uint8Array(SIZES.kemSecretKey)),
    /1088 bytes/,
  );
});

test('ML-KEM-768 interoperates with an independent implementation, both directions', async () => {
  // liboqs generates, noble encapsulates, liboqs recovers.
  const ours = await generateKemKeyPair();
  const theirEncap = ml_kem768.encapsulate(ours.publicKey);
  assert.deepEqual(
    await kemDecapsulate(theirEncap.cipherText, ours.secretKey),
    theirEncap.sharedSecret,
    'noble encapsulation must decapsulate under liboqs',
  );

  // noble generates, liboqs encapsulates, noble recovers.
  const theirs = ml_kem768.keygen();
  const ourEncap = await kemEncapsulate(theirs.publicKey);
  assert.deepEqual(
    ml_kem768.decapsulate(ourEncap.ciphertext, theirs.secretKey),
    ourEncap.sharedSecret,
    'liboqs encapsulation must decapsulate under noble',
  );
});

test('ML-DSA-65 key and signature sizes match FIPS 204', async () => {
  const { publicKey, secretKey } = await generateSigKeyPair();
  assert.equal(publicKey.length, SIZES.sigPublicKey, 'verification key is 1952 bytes');
  assert.equal(secretKey.length, SIZES.sigSecretKey, 'signing key is 4032 bytes');

  const signature = await sign(toUtf8('qmail'), secretKey);
  assert.equal(signature.length, SIZES.signature, 'signature is 3309 bytes');
});

test('ML-DSA-65 verifies its own signature', async () => {
  const { publicKey, secretKey } = await generateSigKeyPair();
  const message = toUtf8('the archive is sealed');
  assert.equal(await verify(message, await sign(message, secretKey), publicKey), true);
});

test('ML-DSA-65 rejects a tampered message', async () => {
  const { publicKey, secretKey } = await generateSigKeyPair();
  const message = toUtf8('transfer 100 to alice');
  const signature = await sign(message, secretKey);

  const tampered = new Uint8Array(message);
  tampered[9] ^= 0x01;
  assert.equal(await verify(tampered, signature, publicKey), false);
});

test('ML-DSA-65 rejects a tampered signature', async () => {
  const { publicKey, secretKey } = await generateSigKeyPair();
  const message = toUtf8('the archive is sealed');
  const signature = await sign(message, secretKey);
  signature[0] ^= 0x01;
  assert.equal(await verify(message, signature, publicKey), false);
});

test('ML-DSA-65 rejects a signature made by a different key', async () => {
  const alice = await generateSigKeyPair();
  const mallory = await generateSigKeyPair();
  const message = toUtf8('from alice, honestly');
  const forged = await sign(message, mallory.secretKey);
  assert.equal(await verify(message, forged, alice.publicKey), false);
});

test('ML-DSA-65 verification returns false rather than throwing on malformed input', async () => {
  // A corrupt database row must render as unverified, not crash the inbox.
  const { publicKey } = await generateSigKeyPair();
  assert.equal(await verify(toUtf8('x'), new Uint8Array(3), publicKey), false);
  assert.equal(await verify(toUtf8('x'), new Uint8Array(SIZES.signature), new Uint8Array(5)), false);
});

test('ML-DSA-65 rejects a signing key of the wrong length', async () => {
  await assert.rejects(() => sign(toUtf8('x'), new Uint8Array(64)), /4032 bytes/);
});

test('ML-DSA-65 interoperates with an independent implementation, both directions', async () => {
  const message = toUtf8('cross-implementation check');

  // liboqs signs, noble verifies.
  const ours = await generateSigKeyPair();
  const ourSignature = await sign(message, ours.secretKey);
  assert.equal(
    ml_dsa65.verify(ourSignature, message, ours.publicKey),
    true,
    'noble must accept a liboqs signature',
  );

  // noble signs, liboqs verifies.
  const theirs = ml_dsa65.keygen(new Uint8Array(32).fill(7));
  const theirSignature = ml_dsa65.sign(message, theirs.secretKey);
  assert.equal(
    await verify(message, theirSignature, theirs.publicKey),
    true,
    'liboqs must accept a noble signature',
  );
});
