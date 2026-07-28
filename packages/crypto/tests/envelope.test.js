/**
 * The message pipeline.
 *
 * These are the tests that establish the architecture actually holds: that a
 * recipient can read a message, that the sender can still read their own copy,
 * that nobody else can read either, and that altering a stored row is caught
 * rather than silently rendered.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fromBase64,
  generateIdentity,
  identityFingerprint,
  openMessage,
  releasePqc,
  sealMessage,
  toBase64,
  toUtf8,
  verifyEnvelope,
} from '../dist/index.js';

test.after(async () => {
  await releasePqc();
});

/** Three identities, generated once — keygen is the slow part of these tests. */
const alice = await generateIdentity();
const bob = await generateIdentity();
const mallory = await generateIdentity();

const CONTENT = {
  subject: 'Review 2 slides',
  body: 'Draft attached. The KEM section still needs a diagram.',
};

async function seal(overrides = {}) {
  return sealMessage({
    content: CONTENT,
    from: 'alice@qmail.com',
    to: 'bob@qmail.com',
    recipientKemPublicKey: bob.kem.publicKey,
    senderKemPublicKey: alice.kem.publicKey,
    senderSigSecretKey: alice.sig.secretKey,
    sentAt: '2026-07-28T10:00:00.000Z',
    ...overrides,
  });
}

test('a sealed envelope exposes no plaintext', async () => {
  const envelope = await seal();
  const serialised = JSON.stringify(envelope);
  assert.equal(serialised.includes('Review 2 slides'), false, 'subject must not appear');
  assert.equal(serialised.includes('needs a diagram'), false, 'body must not appear');
  // Addresses and timestamp are deliberately in the clear: the server routes on
  // them. They are bound into the AEAD so they cannot be edited undetected.
  assert.equal(envelope.header.from, 'alice@qmail.com');
  assert.equal(envelope.header.to, 'bob@qmail.com');
});

test('the recipient can open the message and the signature verifies', async () => {
  const envelope = await seal();
  const opened = await openMessage({
    envelope,
    kemSecretKey: bob.kem.secretKey,
    role: 'recipient',
    senderSigPublicKey: alice.sig.publicKey,
  });

  assert.deepEqual(opened.content, CONTENT);
  assert.equal(opened.verified, true);
  assert.equal(opened.header.from, 'alice@qmail.com');
});

test('the sender can open their own copy — this is what makes a Sent folder work', async () => {
  const envelope = await seal();
  const opened = await openMessage({
    envelope,
    kemSecretKey: alice.kem.secretKey,
    role: 'sender',
    senderSigPublicKey: alice.sig.publicKey,
  });

  assert.deepEqual(opened.content, CONTENT);
  assert.equal(opened.verified, true);
});

test('a third party cannot open the message with either slot', async () => {
  const envelope = await seal();

  await assert.rejects(
    () =>
      openMessage({
        envelope,
        kemSecretKey: mallory.kem.secretKey,
        role: 'recipient',
        senderSigPublicKey: alice.sig.publicKey,
      }),
    'the recipient slot must not open under a foreign key',
  );

  await assert.rejects(
    () =>
      openMessage({
        envelope,
        kemSecretKey: mallory.kem.secretKey,
        role: 'sender',
        senderSigPublicKey: alice.sig.publicKey,
      }),
    'the sender slot must not open under a foreign key',
  );
});

test('the recipient cannot open the sender’s slot, and vice versa', async () => {
  const envelope = await seal();

  await assert.rejects(() =>
    openMessage({ envelope, kemSecretKey: bob.kem.secretKey, role: 'sender' }),
  );
  await assert.rejects(() =>
    openMessage({ envelope, kemSecretKey: alice.kem.secretKey, role: 'recipient' }),
  );
});

test('the two key slots are independent ciphertexts of the same content key', async () => {
  const envelope = await seal();
  assert.notEqual(envelope.recipientSlot.kemCiphertext, envelope.senderSlot.kemCiphertext);
  assert.notEqual(envelope.recipientSlot.wrappedKey, envelope.senderSlot.wrappedKey);

  const asRecipient = await openMessage({
    envelope,
    kemSecretKey: bob.kem.secretKey,
    role: 'recipient',
  });
  const asSender = await openMessage({
    envelope,
    kemSecretKey: alice.kem.secretKey,
    role: 'sender',
  });
  assert.deepEqual(asRecipient.content, asSender.content, 'both slots reach the same plaintext');
});

test('two sealings of identical content produce different ciphertext', async () => {
  const a = await seal();
  const b = await seal();
  assert.notEqual(a.body, b.body, 'a fresh content key and nonce every time');
  assert.notEqual(a.iv, b.iv);
});

test('an attachment survives the round trip byte for byte', async () => {
  const data = new Uint8Array(4096).map((_, i) => (i * 31 + 7) % 256);
  const envelope = await seal({
    content: {
      ...CONTENT,
      attachment: { filename: 'kem-diagram.png', mimeType: 'image/png', data },
    },
  });

  const opened = await openMessage({
    envelope,
    kemSecretKey: bob.kem.secretKey,
    role: 'recipient',
    senderSigPublicKey: alice.sig.publicKey,
  });

  assert.equal(opened.content.attachment.filename, 'kem-diagram.png');
  assert.equal(opened.content.attachment.mimeType, 'image/png');
  assert.deepEqual(opened.content.attachment.data, data);
});

test('unicode subjects and bodies survive the round trip', async () => {
  const content = { subject: 'नमस्ते 🔐', body: 'Ω≈ç√ — em dash, “smart quotes”' };
  const envelope = await seal({ content });
  const opened = await openMessage({
    envelope,
    kemSecretKey: bob.kem.secretKey,
    role: 'recipient',
  });
  assert.deepEqual(opened.content, content);
});

test('a tampered body is caught by the signature before it is decrypted', async () => {
  const envelope = await seal();

  // Simulate someone editing the stored row directly in the database.
  const body = fromBase64(envelope.body);
  body[5] ^= 0x01;
  const tampered = { ...envelope, body: toBase64(body) };

  assert.equal(await verifyEnvelope(tampered, alice.sig.publicKey), false);

  const opened = await openMessage({
    envelope: tampered,
    kemSecretKey: bob.kem.secretKey,
    role: 'recipient',
    senderSigPublicKey: alice.sig.publicKey,
  }).catch((error) => error);

  // Either outcome is acceptable and both are safe: the AEAD tag rejects it, or
  // it is reported unverified. What must not happen is verified: true.
  if (!(opened instanceof Error)) {
    assert.equal(opened.verified, false);
  }
});

test('a rewritten sender address is caught', async () => {
  const envelope = await seal();
  const tampered = {
    ...envelope,
    header: { ...envelope.header, from: 'mallory@qmail.com' },
  };

  assert.equal(
    await verifyEnvelope(tampered, alice.sig.publicKey),
    false,
    'the signature covers the header',
  );

  // Even ignoring the signature, the header is the AEAD's associated data, so
  // decryption itself fails. Two independent defences, deliberately.
  await assert.rejects(() =>
    openMessage({ envelope: tampered, kemSecretKey: bob.kem.secretKey, role: 'recipient' }),
  );
});

test('a rewritten timestamp is caught', async () => {
  const envelope = await seal();
  const tampered = {
    ...envelope,
    header: { ...envelope.header, sentAt: '2020-01-01T00:00:00.000Z' },
  };
  assert.equal(await verifyEnvelope(tampered, alice.sig.publicKey), false);
});

test('a swapped key slot is caught by the signature', async () => {
  const first = await seal();
  const second = await seal();
  const spliced = { ...first, recipientSlot: second.recipientSlot };
  assert.equal(await verifyEnvelope(spliced, alice.sig.publicKey), false);
});

test('a message signed by the wrong sender opens but reports unverified', async () => {
  // Mallory writes a row claiming to be from Alice. Bob can decrypt it, because
  // it was genuinely encapsulated to him — but nothing vouches for the author,
  // and that has to be visible rather than assumed.
  const envelope = await sealMessage({
    content: CONTENT,
    from: 'alice@qmail.com',
    to: 'bob@qmail.com',
    recipientKemPublicKey: bob.kem.publicKey,
    senderKemPublicKey: mallory.kem.publicKey,
    senderSigSecretKey: mallory.sig.secretKey,
  });

  const opened = await openMessage({
    envelope,
    kemSecretKey: bob.kem.secretKey,
    role: 'recipient',
    senderSigPublicKey: alice.sig.publicKey,
  });

  assert.equal(opened.verified, false, 'must not be presented as authentically from Alice');
});

test('a message opened without the sender’s public key reports unverified', async () => {
  const envelope = await seal();
  const opened = await openMessage({
    envelope,
    kemSecretKey: bob.kem.secretKey,
    role: 'recipient',
  });
  assert.equal(opened.verified, false);
});

test('an unknown envelope version is refused rather than guessed at', async () => {
  const envelope = await seal();
  const future = { ...envelope, header: { ...envelope.header, v: 2 } };
  await assert.rejects(
    () => openMessage({ envelope: future, kemSecretKey: bob.kem.secretKey, role: 'recipient' }),
    /Unsupported envelope version/,
  );
});

test('fingerprints identify a key and are stable', async () => {
  const alicePublic = {
    kemPublicKey: alice.kem.publicKey,
    sigPublicKey: alice.sig.publicKey,
  };
  const first = await identityFingerprint(alicePublic);
  const again = await identityFingerprint(alicePublic);
  const bobs = await identityFingerprint({
    kemPublicKey: bob.kem.publicKey,
    sigPublicKey: bob.sig.publicKey,
  });

  assert.equal(first, again, 'the same identity must always give the same fingerprint');
  assert.notEqual(first, bobs);
  assert.match(first, /^([0-9A-F]{4} ){15}[0-9A-F]{4}$/, '16 groups of 4 hex characters');
});

test('a fingerprint covers the signing key as well as the encryption key', async () => {
  // Swapping only the signing key must change the fingerprint, otherwise an
  // out-of-band check would not detect a substituted signing identity.
  const real = await identityFingerprint({
    kemPublicKey: alice.kem.publicKey,
    sigPublicKey: alice.sig.publicKey,
  });
  const swapped = await identityFingerprint({
    kemPublicKey: alice.kem.publicKey,
    sigPublicKey: mallory.sig.publicKey,
  });
  assert.notEqual(real, swapped);
});

test('the envelope survives a JSON round trip, as it must to sit in a database', async () => {
  const envelope = await seal();
  const revived = JSON.parse(JSON.stringify(envelope));
  const opened = await openMessage({
    envelope: revived,
    kemSecretKey: bob.kem.secretKey,
    role: 'recipient',
    senderSigPublicKey: alice.sig.publicKey,
  });
  assert.deepEqual(opened.content, CONTENT);
  assert.equal(opened.verified, true);
});

test('canonical signing input does not depend on JSON key order', async () => {
  // A row read back from Postgres may present its JSON keys in any order. If the
  // signature depended on that order, verification would pass on the sending
  // device and fail on the receiving one — exactly the kind of silent
  // cross-platform bug this whole layer exists to prevent.
  const envelope = await seal();
  const reordered = {
    signature: envelope.signature,
    senderSlot: {
      wrappedKey: envelope.senderSlot.wrappedKey,
      kemCiphertext: envelope.senderSlot.kemCiphertext,
      wrapIv: envelope.senderSlot.wrapIv,
    },
    recipientSlot: envelope.recipientSlot,
    body: envelope.body,
    iv: envelope.iv,
    header: {
      sentAt: envelope.header.sentAt,
      to: envelope.header.to,
      from: envelope.header.from,
      alg: envelope.header.alg,
      v: envelope.header.v,
    },
  };
  assert.equal(await verifyEnvelope(reordered, alice.sig.publicKey), true);
});
