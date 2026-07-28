/**
 * The cross-platform parity check.
 *
 * The point of a shared crypto package is that a message sealed on one platform
 * opens on another. That only holds if every platform computes byte-identical
 * results, and the way that quietly stops being true — a differing base64
 * implementation, a JSON key-order difference in the signing input, a WASM
 * module that loaded a different build — produces no error at all. It produces a
 * message that simply will not open, months later, on a device nobody tested.
 *
 * So: a frozen set of inputs, replayed identically everywhere, reduced to one
 * digest over the actual computed outputs. Node, the browser and React Native
 * must all print the same digest. If they do not, the difference is real and
 * this says so before it reaches a user's mailbox.
 *
 * Only deterministic operations are digested. Key generation and encapsulation
 * are randomised by design, so they are exercised as a live round-trip whose
 * result is pass or fail rather than part of the digest.
 */
import { PARITY_VECTORS } from './parity-vectors.js';
import { aesEncrypt, deriveKeyEncryptionKey, sha256 } from './aes.js';
import { canonicalJson, fromBase64, toBase64, toHex, toUtf8 } from './bytes.js';
import { deriveKeyWithParams } from './kdf.js';
import { openKeystore, sealKeystore, splitIdentity } from './keystore.js';
import { generateIdentity, identityFingerprint } from './identity.js';
import { kemDecapsulate, verify } from './pqc.js';
import { openMessage, sealMessage } from './envelope.js';
import type { Argon2Params, EncryptedKeystore, Pbkdf2Params, SealedEnvelope } from './types.js';

export interface ParityCheck {
  name: string;
  passed: boolean;
  /** Present only on failure: what was expected versus what this platform produced. */
  detail?: string;
}

export interface ParityReport {
  /** Free-text label for where this ran, e.g. "node", "web", "mobile (android)". */
  platform: string;
  checks: ParityCheck[];
  passed: boolean;
  /**
   * SHA-256 over the canonical form of every deterministic output. Two platforms
   * agreeing here are running genuinely identical cryptography.
   */
  digest: string;
  /** Milliseconds the whole check took. Useful for spotting a pathological WASM path. */
  elapsedMs: number;
}

/** Typed view of the frozen fixture. */
const V = PARITY_VECTORS as unknown as {
  aes: { key: string; iv: string; aad: string; plaintext: string; expectedCiphertext: string };
  hkdf: { sharedSecret: string; info: string; expectedKey: string };
  argon2id: { password: string; salt: string; params: Argon2Params; expectedKey: string };
  pbkdf2: { password: string; salt: string; params: Pbkdf2Params; expectedKey: string };
  mlKem768: { secretKey: string; ciphertext: string; expectedSharedSecret: string };
  mlDsa65: { publicKey: string; message: string; signature: string };
  envelope: {
    sealed: SealedEnvelope;
    recipientKemSecretKey: string;
    senderSigPublicKey: string;
    expectedSubject: string;
    expectedBody: string;
    expectedAttachment: { filename: string; mimeType: string; data: string };
  };
  keystore: {
    sealed: EncryptedKeystore;
    password: string;
    expectedKemSecretKey: string;
    expectedSigSecretKey: string;
  };
};

/**
 * Run the parity check.
 *
 * Never throws: a platform where something is broken should still return a
 * report saying which check failed, because that report is the whole output.
 */
export async function runParityCheck(platform: string): Promise<ParityReport> {
  const started = Date.now();
  const checks: ParityCheck[] = [];
  /** Actual outputs, in a fixed order, digested at the end. */
  const outputs: Record<string, unknown> = {};

  async function check(name: string, run: () => Promise<{ actual: unknown; expected: unknown }>) {
    try {
      const { actual, expected } = await run();
      outputs[name] = actual;
      const passed = canonicalJson(actual) === canonicalJson(expected);
      checks.push(
        passed
          ? { name, passed: true }
          : {
              name,
              passed: false,
              detail: `expected ${canonicalJson(expected)}, got ${canonicalJson(actual)}`,
            },
      );
    } catch (error) {
      outputs[name] = `threw: ${(error as Error).message}`;
      checks.push({ name, passed: false, detail: `threw: ${(error as Error).message}` });
    }
  }

  // --- Encoding ------------------------------------------------------------
  await check('base64 round trip', async () => {
    const all = new Uint8Array(256).map((_, i) => i);
    return { actual: toBase64(all), expected: toBase64(fromBase64(toBase64(all))) };
  });

  await check('utf-8 beyond the BMP', async () => ({
    actual: toBase64(toUtf8('नमस्ते 🔐 Ω')),
    expected: '4KSo4KSu4KS44KWN4KSk4KWHIPCflJAgzqk=',
  }));

  await check('canonical json key ordering', async () => ({
    actual: canonicalJson({ to: 'b', from: 'a', v: 1 }),
    expected: '{"from":"a","to":"b","v":1}',
  }));

  // --- Symmetric primitives -------------------------------------------------
  await check('sha-256', async () => ({
    actual: toHex(await sha256(toUtf8('abc'))),
    expected: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  }));

  await check('aes-256-gcm', async () => ({
    actual: toBase64(
      await aesEncrypt(
        fromBase64(V.aes.key),
        fromBase64(V.aes.iv),
        fromBase64(V.aes.plaintext),
        fromBase64(V.aes.aad),
      ),
    ),
    expected: V.aes.expectedCiphertext,
  }));

  await check('hkdf-sha256', async () => ({
    actual: toBase64(await deriveKeyEncryptionKey(fromBase64(V.hkdf.sharedSecret), V.hkdf.info)),
    expected: V.hkdf.expectedKey,
  }));

  // --- Password key derivation ---------------------------------------------
  await check('argon2id', async () => ({
    actual: toBase64(
      await deriveKeyWithParams(
        V.argon2id.password,
        fromBase64(V.argon2id.salt),
        'argon2id',
        V.argon2id.params,
      ),
    ),
    expected: V.argon2id.expectedKey,
  }));

  await check('pbkdf2-sha512', async () => ({
    actual: toBase64(
      await deriveKeyWithParams(
        V.pbkdf2.password,
        fromBase64(V.pbkdf2.salt),
        'pbkdf2-sha512',
        V.pbkdf2.params,
      ),
    ),
    expected: V.pbkdf2.expectedKey,
  }));

  // --- Post-quantum, deterministic halves -----------------------------------
  await check('ml-kem-768 decapsulation', async () => ({
    actual: toBase64(
      await kemDecapsulate(fromBase64(V.mlKem768.ciphertext), fromBase64(V.mlKem768.secretKey)),
    ),
    expected: V.mlKem768.expectedSharedSecret,
  }));

  await check('ml-dsa-65 verification', async () => ({
    actual: await verify(
      fromBase64(V.mlDsa65.message),
      fromBase64(V.mlDsa65.signature),
      fromBase64(V.mlDsa65.publicKey),
    ),
    expected: true,
  }));

  await check('ml-dsa-65 rejects a tampered message', async () => {
    const tampered = fromBase64(V.mlDsa65.message);
    tampered[0] = (tampered[0] as number) ^ 0xff;
    return {
      actual: await verify(
        tampered,
        fromBase64(V.mlDsa65.signature),
        fromBase64(V.mlDsa65.publicKey),
      ),
      expected: false,
    };
  });

  // --- The whole pipeline ---------------------------------------------------
  await check('open a frozen envelope', async () => {
    const opened = await openMessage({
      envelope: V.envelope.sealed,
      kemSecretKey: fromBase64(V.envelope.recipientKemSecretKey),
      role: 'recipient',
      senderSigPublicKey: fromBase64(V.envelope.senderSigPublicKey),
    });
    return {
      actual: {
        subject: opened.content.subject,
        body: opened.content.body,
        verified: opened.verified,
        attachment: opened.content.attachment
          ? {
              filename: opened.content.attachment.filename,
              mimeType: opened.content.attachment.mimeType,
              data: toBase64(opened.content.attachment.data),
            }
          : null,
      },
      expected: {
        subject: V.envelope.expectedSubject,
        body: V.envelope.expectedBody,
        verified: true,
        attachment: V.envelope.expectedAttachment,
      },
    };
  });

  await check('open a frozen keystore', async () => {
    const secrets = await openKeystore(V.keystore.sealed, V.keystore.password);
    return {
      actual: {
        kem: toBase64(secrets.kemSecretKey),
        sig: toBase64(secrets.sigSecretKey),
      },
      expected: {
        kem: V.keystore.expectedKemSecretKey,
        sig: V.keystore.expectedSigSecretKey,
      },
    };
  });

  // --- Live round trip: randomised, so pass/fail only, not digested ---------
  const liveChecks: ParityCheck[] = [];
  try {
    const alice = await generateIdentity();
    const bob = await generateIdentity();

    const envelope = await sealMessage({
      content: { subject: 'live', body: 'generated on this device' },
      from: 'alice@qmail.com',
      to: 'bob@qmail.com',
      recipientKemPublicKey: bob.kem.publicKey,
      senderKemPublicKey: alice.kem.publicKey,
      senderSigSecretKey: alice.sig.secretKey,
    });

    const asRecipient = await openMessage({
      envelope,
      kemSecretKey: bob.kem.secretKey,
      role: 'recipient',
      senderSigPublicKey: alice.sig.publicKey,
    });
    liveChecks.push({
      name: 'live: keygen, seal and open as recipient',
      passed: asRecipient.content.body === 'generated on this device' && asRecipient.verified,
    });

    const asSender = await openMessage({
      envelope,
      kemSecretKey: alice.kem.secretKey,
      role: 'sender',
      senderSigPublicKey: alice.sig.publicKey,
    });
    liveChecks.push({
      name: 'live: sender can reopen their own copy',
      passed: asSender.content.body === 'generated on this device',
    });

    let foreignOpened = false;
    try {
      const mallory = await generateIdentity();
      await openMessage({ envelope, kemSecretKey: mallory.kem.secretKey, role: 'recipient' });
      foreignOpened = true;
    } catch {
      foreignOpened = false;
    }
    liveChecks.push({ name: 'live: a foreign key cannot open it', passed: !foreignOpened });

    const roundTripped = await openKeystore(
      await sealKeystore(splitIdentity(bob).secrets, 'live password'),
      'live password',
    );
    liveChecks.push({
      name: 'live: keystore seal and open',
      passed: toBase64(roundTripped.kemSecretKey) === toBase64(bob.kem.secretKey),
    });

    const printed = await identityFingerprint({
      kemPublicKey: alice.kem.publicKey,
      sigPublicKey: alice.sig.publicKey,
    });
    liveChecks.push({
      name: 'live: fingerprint formatting',
      passed: /^([0-9A-F]{4} ){15}[0-9A-F]{4}$/.test(printed),
    });
  } catch (error) {
    liveChecks.push({
      name: 'live round trip',
      passed: false,
      detail: `threw: ${(error as Error).message}`,
    });
  }

  const allChecks = [...checks, ...liveChecks];
  const digest = toHex(await sha256(toUtf8(canonicalJson(outputs))));

  return {
    platform,
    checks: allChecks,
    passed: allChecks.every((c) => c.passed),
    digest,
    elapsedMs: Date.now() - started,
  };
}
