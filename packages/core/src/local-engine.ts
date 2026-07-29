/**
 * The in-process crypto engine, for platforms whose JavaScript runtime can host
 * `@qmail/crypto` directly — browsers and Node.
 *
 * This is also the reference implementation: the WebView-hosted engine on mobile
 * runs this exact code, just on the far side of a message channel.
 */
import {
  fromBase64,
  generateIdentity,
  identityFingerprint,
  openKeystore,
  openMessage,
  runParityCheck,
  sealKeystore,
  sealMessage,
  splitIdentity,
  toBase64,
  verifyEnvelope,
  warmUp,
  type EncryptedKeystore,
  type MessageContent,
  type ParityReport,
  type SealedEnvelope,
  type SecretIdentity,
} from '@qmail/crypto';
import type {
  CryptoEngine,
  EngineOpenInput,
  EngineOpenOutput,
  EngineSealInput,
  PublicKeys,
} from './engine.js';

export function createLocalEngine(): CryptoEngine {
  /** Retained across calls, in memory only, cleared on lock. */
  let secrets: SecretIdentity | null = null;

  function requireSecrets(): SecretIdentity {
    if (!secrets) {
      throw new Error('The crypto engine is locked.');
    }
    return secrets;
  }

  return {
    async warmUp() {
      await warmUp();
    },

    async createIdentity(): Promise<PublicKeys> {
      const identity = await generateIdentity();
      const split = splitIdentity(identity);
      secrets = split.secrets;
      return {
        kemPublicKey: toBase64(split.kemPublicKey),
        sigPublicKey: toBase64(split.sigPublicKey),
      };
    },

    async exportKeystore(password: string): Promise<EncryptedKeystore> {
      return sealKeystore(requireSecrets(), password);
    },

    async importKeystore(keystore: EncryptedKeystore, password: string): Promise<void> {
      secrets = await openKeystore(keystore, password);
    },

    async lock() {
      secrets = null;
    },

    async isUnlocked() {
      return secrets !== null;
    },

    async fingerprint(keys: PublicKeys): Promise<string> {
      return identityFingerprint({
        kemPublicKey: fromBase64(keys.kemPublicKey),
        sigPublicKey: fromBase64(keys.sigPublicKey),
      });
    },

    async seal(input: EngineSealInput): Promise<SealedEnvelope> {
      const content: MessageContent = {
        subject: input.subject,
        body: input.body,
        ...(input.attachment
          ? {
              attachment: {
                filename: input.attachment.filename,
                mimeType: input.attachment.mimeType,
                data: fromBase64(input.attachment.data),
              },
            }
          : {}),
      };

      return sealMessage({
        content,
        from: input.from,
        to: input.to,
        recipientKemPublicKey: fromBase64(input.recipientKemPublicKey),
        senderKemPublicKey: fromBase64(input.senderKemPublicKey),
        senderSigSecretKey: requireSecrets().sigSecretKey,
        ...(input.sentAt ? { sentAt: input.sentAt } : {}),
      });
    },

    async open(input: EngineOpenInput): Promise<EngineOpenOutput> {
      const opened = await openMessage({
        envelope: input.envelope,
        kemSecretKey: requireSecrets().kemSecretKey,
        role: input.role,
        ...(input.senderSigPublicKey
          ? { senderSigPublicKey: fromBase64(input.senderSigPublicKey) }
          : {}),
      });

      return {
        subject: opened.content.subject,
        body: opened.content.body,
        ...(opened.content.attachment
          ? {
              attachment: {
                filename: opened.content.attachment.filename,
                mimeType: opened.content.attachment.mimeType,
                data: toBase64(opened.content.attachment.data),
              },
            }
          : {}),
        verified: opened.verified,
      };
    },

    async verifyEnvelope(envelope: SealedEnvelope, senderSigPublicKey: string): Promise<boolean> {
      return verifyEnvelope(envelope, fromBase64(senderSigPublicKey));
    },

    async parityCheck(platform: string): Promise<ParityReport> {
      return runParityCheck(platform);
    },
  };
}
