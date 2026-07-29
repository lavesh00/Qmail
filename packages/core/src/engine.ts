/**
 * The seam between the mailbox logic and the cryptography.
 *
 * On web and in Node, `@qmail/crypto` is imported directly and this is a thin
 * pass-through. On React Native it cannot be: Hermes provides neither
 * WebAssembly nor WebCrypto, so the module physically cannot run in that engine.
 * There, the identical module runs inside a WebView — whose Chromium engine has
 * both — and this interface is implemented over an async channel to it.
 *
 * Two properties make that substitution safe rather than a quiet downgrade:
 *
 *   - Everything crossing this boundary is base64 or plain JSON, so a remote
 *     implementation is a marshalling exercise and not a reimplementation. The
 *     algorithms are the same compiled liboqs either way.
 *   - Secret keys never cross it at all. The engine retains them after unlock
 *     and is asked to perform operations, rather than handing them out. On
 *     mobile that means the decrypted private keys stay inside the WebView and
 *     are never marshalled into the React Native heap.
 *
 * `runParityCheck` is exposed through the same channel precisely so a bridged
 * engine can be made to prove it produces byte-identical results.
 */
import type { EncryptedKeystore, ParityReport, SealedEnvelope } from '@qmail/crypto';

/** Base64 public keys — the half of an identity that is safe to publish. */
export interface PublicKeys {
  kemPublicKey: string;
  sigPublicKey: string;
}

/** An attachment in transit across the engine boundary; `data` is base64. */
export interface EngineAttachment {
  filename: string;
  mimeType: string;
  data: string;
}

export interface EngineSealInput {
  subject: string;
  body: string;
  attachment?: EngineAttachment;
  from: string;
  to: string;
  /** Base64 ML-KEM-768 public key of the recipient. */
  recipientKemPublicKey: string;
  /** Base64 ML-KEM-768 public key of the sender, for their own Sent copy. */
  senderKemPublicKey: string;
  sentAt?: string;
}

export interface EngineOpenInput {
  envelope: SealedEnvelope;
  role: 'recipient' | 'sender';
  /** Base64 ML-DSA-65 public key of the sender. Omitted means "cannot verify". */
  senderSigPublicKey?: string;
}

export interface EngineOpenOutput {
  subject: string;
  body: string;
  attachment?: EngineAttachment;
  verified: boolean;
}

export interface CryptoEngine {
  /** Instantiate the underlying modules ahead of first use. */
  warmUp(): Promise<void>;

  /**
   * Generate a fresh identity. The secret halves are retained by the engine and
   * deliberately not returned; only the public keys come back.
   */
  createIdentity(): Promise<PublicKeys>;

  /** Seal the retained secret keys under a password, for storage. */
  exportKeystore(password: string): Promise<EncryptedKeystore>;

  /** Decrypt a keystore and retain its secrets. Throws on a wrong password. */
  importKeystore(keystore: EncryptedKeystore, password: string): Promise<void>;

  /** Discard the retained secrets. */
  lock(): Promise<void>;

  isUnlocked(): Promise<boolean>;

  /** Fingerprint a published identity, for out-of-band verification. */
  fingerprint(keys: PublicKeys): Promise<string>;

  /** Seal a message, signing with the retained signing key. */
  seal(input: EngineSealInput): Promise<SealedEnvelope>;

  /** Open a message, decapsulating with the retained KEM key. */
  open(input: EngineOpenInput): Promise<EngineOpenOutput>;

  /** Check a stored row's signature without decrypting it. */
  verifyEnvelope(envelope: SealedEnvelope, senderSigPublicKey: string): Promise<boolean>;

  /** Run the cross-platform parity check inside whatever engine this is. */
  parityCheck(platform: string): Promise<ParityReport>;
}
