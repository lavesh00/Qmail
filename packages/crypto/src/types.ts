/** Algorithm identifiers baked into every serialised structure. */
export const ALGORITHMS = {
  kem: 'ML-KEM-768',
  signature: 'ML-DSA-65',
  aead: 'AES-256-GCM',
} as const;

/** Byte lengths fixed by FIPS 203 and FIPS 204. Used to reject malformed input early. */
export const SIZES = {
  kemPublicKey: 1184,
  kemSecretKey: 2400,
  kemCiphertext: 1088,
  kemSharedSecret: 32,
  sigPublicKey: 1952,
  sigSecretKey: 4032,
  signature: 3309,
  aesKey: 32,
  aesIv: 12,
} as const;

/** An ML-KEM-768 keypair. */
export interface KemKeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

/** An ML-DSA-65 keypair. */
export interface SigKeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

/**
 * A Qmail identity: one KEM keypair for receiving mail, one signature keypair
 * for proving authorship. Both are generated on-device and the secret halves
 * never leave it.
 */
export interface Identity {
  kem: KemKeyPair;
  sig: SigKeyPair;
}

/** The half of an identity that is safe to publish to the server. */
export interface PublicIdentity {
  kemPublicKey: Uint8Array;
  sigPublicKey: Uint8Array;
}

/** The half of an identity that must stay on the device, encrypted at rest. */
export interface SecretIdentity {
  kemSecretKey: Uint8Array;
  sigSecretKey: Uint8Array;
}

/** Key-derivation functions this build knows how to use. */
export type KdfName = 'argon2id' | 'pbkdf2-sha512';

/**
 * A private-key bundle encrypted under a password-derived key. This is what
 * gets written to IndexedDB on web and SecureStore on mobile. Every field is
 * base64; the structure is self-describing so a future build can still read
 * blobs written by this one.
 */
export interface EncryptedKeystore {
  v: 1;
  kdf: KdfName;
  /** Argon2id parameters, or PBKDF2 iteration count, depending on `kdf`. */
  kdfParams: Argon2Params | Pbkdf2Params;
  /** Base64 salt fed to the KDF. */
  salt: string;
  /** Base64 AES-GCM nonce. */
  iv: string;
  /** Base64 AES-256-GCM ciphertext of the serialised secret keys. */
  ciphertext: string;
}

export interface Argon2Params {
  /** Iterations (time cost). */
  t: number;
  /** Memory cost in KiB. */
  m: number;
  /** Degree of parallelism. */
  p: number;
}

export interface Pbkdf2Params {
  iterations: number;
}

/**
 * One recipient's route into a message: the KEM ciphertext that lets them
 * recover the key-encryption key, plus the content key wrapped under it.
 *
 * A KEM cannot transport a chosen key directly — encapsulation produces a
 * random shared secret, not a slot to put a key in. So the content key is
 * generated independently and wrapped, which is the standard KEM-DEM
 * construction and the only way to give two parties (recipient and sender)
 * access to the same message body.
 */
export interface KeySlot {
  /** Base64 ML-KEM-768 ciphertext. */
  kemCiphertext: string;
  /** Base64 AES-GCM nonce used to wrap the content key. */
  wrapIv: string;
  /** Base64 AES-256-GCM ciphertext of the 32-byte content key. */
  wrappedKey: string;
}

/** Cleartext metadata that travels with a message and is bound into the AEAD. */
export interface EnvelopeHeader {
  v: 1;
  alg: typeof ALGORITHMS;
  /** Sender's Qmail address, e.g. `alice@qmail.com`. */
  from: string;
  /** Recipient's Qmail address. */
  to: string;
  /** ISO-8601 timestamp set by the sending client. */
  sentAt: string;
}

/**
 * A sealed message, exactly as it is stored in the `messages` table. The server
 * holds this and can read none of it.
 */
export interface SealedEnvelope {
  header: EnvelopeHeader;
  /** Base64 AES-GCM nonce for the body. */
  iv: string;
  /** Base64 AES-256-GCM ciphertext of the serialised message content. */
  body: string;
  /** Route for the recipient. */
  recipientSlot: KeySlot;
  /** Route for the sender, so their own Sent folder stays readable. */
  senderSlot: KeySlot;
  /** Base64 ML-DSA-65 signature over the canonical bytes of everything above. */
  signature: string;
}

/** An attachment, before encryption and after decryption. */
export interface Attachment {
  filename: string;
  mimeType: string;
  /** Raw bytes. Encrypted alongside the body under the same content key. */
  data: Uint8Array;
}

/** The plaintext a user actually composes. */
export interface MessageContent {
  subject: string;
  body: string;
  attachment?: Attachment;
}

/** Result of opening a sealed envelope. */
export interface OpenedMessage {
  content: MessageContent;
  header: EnvelopeHeader;
  /**
   * Whether the ML-DSA-65 signature verified against the sender's public key.
   * A false here means the message must be shown as unverified rather than
   * silently trusted.
   */
  verified: boolean;
}
