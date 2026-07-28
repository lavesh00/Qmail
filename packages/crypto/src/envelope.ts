/**
 * The message pipeline: sealing a composed message into something the server
 * can store but not read, and opening it again on a device that holds the right
 * secret key.
 *
 * Shape of a sealed message:
 *
 *   1. A random 256-bit content key encrypts the subject, body and attachment
 *      with AES-256-GCM. The header travels in the clear but is fed in as
 *      associated data, so `from`, `to` and `sentAt` cannot be edited without
 *      decryption failing.
 *   2. That content key is wrapped twice — once for the recipient, once for the
 *      sender — each time under a key-encryption key derived from a fresh
 *      ML-KEM-768 encapsulation to that party's public key. The second wrap is
 *      what makes a working Sent folder possible without the server holding
 *      anything extra.
 *   3. The whole assembled structure is signed with ML-DSA-65, so tampering
 *      anywhere in the stored row is detectable before a single byte is
 *      decrypted.
 *
 * A KEM cannot transport a chosen key directly: encapsulation yields a random
 * shared secret rather than a slot to place a key into. Generating the content
 * key separately and wrapping it is the standard KEM-DEM construction, and it is
 * the only way two different parties can end up able to read one ciphertext.
 */
import { aesDecrypt, aesEncrypt, deriveKeyEncryptionKey, generateAesKey, generateIv } from './aes.js';
import { canonicalBytes, fromBase64, fromUtf8, toBase64, toUtf8, wipe } from './bytes.js';
import { kemDecapsulate, kemEncapsulate, sign, verify } from './pqc.js';
import {
  ALGORITHMS,
  type Attachment,
  type EnvelopeHeader,
  type KeySlot,
  type MessageContent,
  type OpenedMessage,
  type SealedEnvelope,
} from './types.js';

/**
 * Domain separator for the HKDF step. Distinguishes a key-encryption key from
 * any other use of the same shared secret.
 */
const KEK_INFO = 'qmail/v1/content-key-wrap';

/** Everything the signature commits to. Kept in one place so seal and open cannot drift. */
function signingInput(envelope: Omit<SealedEnvelope, 'signature'>): Uint8Array {
  return canonicalBytes({
    header: envelope.header,
    iv: envelope.iv,
    body: envelope.body,
    recipientSlot: envelope.recipientSlot,
    senderSlot: envelope.senderSlot,
  });
}

interface SerialisedContent {
  subject: string;
  body: string;
  attachment?: {
    filename: string;
    mimeType: string;
    data: string;
  };
}

function serialiseContent(content: MessageContent): Uint8Array {
  const payload: SerialisedContent = {
    subject: content.subject,
    body: content.body,
  };
  if (content.attachment) {
    payload.attachment = {
      filename: content.attachment.filename,
      mimeType: content.attachment.mimeType,
      data: toBase64(content.attachment.data),
    };
  }
  return toUtf8(JSON.stringify(payload));
}

function deserialiseContent(bytes: Uint8Array): MessageContent {
  const payload = JSON.parse(fromUtf8(bytes)) as SerialisedContent;
  const content: MessageContent = {
    subject: payload.subject,
    body: payload.body,
  };
  if (payload.attachment) {
    const attachment: Attachment = {
      filename: payload.attachment.filename,
      mimeType: payload.attachment.mimeType,
      data: fromBase64(payload.attachment.data),
    };
    content.attachment = attachment;
  }
  return content;
}

/** Encapsulate to one party and wrap the content key for them. */
async function buildKeySlot(recipientKemPublicKey: Uint8Array, contentKey: Uint8Array): Promise<KeySlot> {
  const { ciphertext, sharedSecret } = await kemEncapsulate(recipientKemPublicKey);
  const kek = await deriveKeyEncryptionKey(sharedSecret, KEK_INFO);
  const wrapIv = generateIv();
  const wrappedKey = await aesEncrypt(kek, wrapIv, contentKey);

  wipe(sharedSecret);
  wipe(kek);

  return {
    kemCiphertext: toBase64(ciphertext),
    wrapIv: toBase64(wrapIv),
    wrappedKey: toBase64(wrappedKey),
  };
}

/** Recover the content key from a slot, using our own ML-KEM secret key. */
async function openKeySlot(slot: KeySlot, kemSecretKey: Uint8Array): Promise<Uint8Array> {
  const sharedSecret = await kemDecapsulate(fromBase64(slot.kemCiphertext), kemSecretKey);
  const kek = await deriveKeyEncryptionKey(sharedSecret, KEK_INFO);
  const contentKey = await aesDecrypt(kek, fromBase64(slot.wrapIv), fromBase64(slot.wrappedKey));

  wipe(sharedSecret);
  wipe(kek);

  return contentKey;
}

export interface SealOptions {
  content: MessageContent;
  /** Sender's Qmail address. */
  from: string;
  /** Recipient's Qmail address. */
  to: string;
  /** Recipient's published ML-KEM-768 public key. */
  recipientKemPublicKey: Uint8Array;
  /** Sender's own ML-KEM-768 public key, so the Sent copy stays readable. */
  senderKemPublicKey: Uint8Array;
  /** Sender's ML-DSA-65 secret key. */
  senderSigSecretKey: Uint8Array;
  /** Defaults to now. Overridable so tests can pin it. */
  sentAt?: string;
}

/** Seal a composed message. The result is exactly what gets written to `messages`. */
export async function sealMessage(options: SealOptions): Promise<SealedEnvelope> {
  const header: EnvelopeHeader = {
    v: 1,
    alg: ALGORITHMS,
    from: options.from,
    to: options.to,
    sentAt: options.sentAt ?? new Date().toISOString(),
  };

  const contentKey = generateAesKey();
  const iv = generateIv();

  try {
    const body = await aesEncrypt(
      contentKey,
      iv,
      serialiseContent(options.content),
      canonicalBytes(header),
    );

    const [recipientSlot, senderSlot] = await Promise.all([
      buildKeySlot(options.recipientKemPublicKey, contentKey),
      buildKeySlot(options.senderKemPublicKey, contentKey),
    ]);

    const unsigned = {
      header,
      iv: toBase64(iv),
      body: toBase64(body),
      recipientSlot,
      senderSlot,
    };

    const signature = await sign(signingInput(unsigned), options.senderSigSecretKey);

    return { ...unsigned, signature: toBase64(signature) };
  } finally {
    wipe(contentKey);
  }
}

/** Which of the two key slots this device should try. */
export type EnvelopeRole = 'recipient' | 'sender';

export interface OpenOptions {
  envelope: SealedEnvelope;
  /** Our ML-KEM-768 secret key. */
  kemSecretKey: Uint8Array;
  /** Whether we are reading this as its recipient or from our own Sent folder. */
  role: EnvelopeRole;
  /**
   * The sender's published ML-DSA-65 public key. Omit only if it genuinely
   * cannot be resolved — the message is then reported as unverified.
   */
  senderSigPublicKey?: Uint8Array;
}

/**
 * Open a sealed message.
 *
 * The signature is checked first, and its result is reported rather than
 * enforced: a message that fails verification still decrypts, but comes back
 * with `verified: false` so the interface can flag it visibly instead of
 * silently presenting it as authentic. Decryption failure, by contrast, throws —
 * there is nothing to show.
 */
export async function openMessage(options: OpenOptions): Promise<OpenedMessage> {
  const { envelope } = options;

  if (envelope.header.v !== 1) {
    throw new Error(`Unsupported envelope version: ${String(envelope.header.v)}`);
  }

  const verified = options.senderSigPublicKey
    ? await verify(
        signingInput(envelope),
        fromBase64(envelope.signature),
        options.senderSigPublicKey,
      )
    : false;

  const slot = options.role === 'recipient' ? envelope.recipientSlot : envelope.senderSlot;
  const contentKey = await openKeySlot(slot, options.kemSecretKey);

  try {
    const plaintext = await aesDecrypt(
      contentKey,
      fromBase64(envelope.iv),
      fromBase64(envelope.body),
      canonicalBytes(envelope.header),
    );
    return {
      content: deserialiseContent(plaintext),
      header: envelope.header,
      verified,
    };
  } finally {
    wipe(contentKey);
  }
}

/**
 * Check a sealed message's signature without decrypting it.
 *
 * Useful for flagging a tampered row in a message list, where the body is not
 * being rendered yet.
 */
export async function verifyEnvelope(
  envelope: SealedEnvelope,
  senderSigPublicKey: Uint8Array,
): Promise<boolean> {
  return verify(signingInput(envelope), fromBase64(envelope.signature), senderSigPublicKey);
}
