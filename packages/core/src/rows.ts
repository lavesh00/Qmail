/**
 * Translation between database rows and sealed envelopes.
 *
 * Kept in one place because the signature is computed over the envelope's
 * canonical form: if a row were reassembled even slightly differently on the
 * receiving side, verification would fail for reasons that look nothing like a
 * mapping bug.
 */
import { ALGORITHMS, type SealedEnvelope } from '@qmail/crypto';

/** A row of `public.messages`, as the client library returns it. */
export interface MessageRow {
  id: string;
  sender_id: string;
  recipient_id: string;
  sender_address: string;
  recipient_address: string;
  sent_at: string;
  iv: string;
  body: string;
  recipient_kem_ciphertext: string;
  recipient_wrap_iv: string;
  recipient_wrapped_key: string;
  sender_kem_ciphertext: string;
  sender_wrap_iv: string;
  sender_wrapped_key: string;
  signature: string;
  read: boolean;
  deleted_by_sender: boolean;
  deleted_by_recipient: boolean;
}

/** A row of `public.users`. */
export interface UserRow {
  id: string;
  address: string;
  kem_public_key: string;
  sig_public_key: string;
  created_at?: string;
}

/** A row of `public.contacts`. */
export interface ContactRow {
  id: string;
  owner_id: string;
  contact_id: string;
  address: string;
  kem_public_key: string;
  sig_public_key: string;
  first_seen_at: string;
  last_used_at: string;
}

/**
 * Rebuild the sealed envelope a row was written from.
 *
 * `sent_at` is normalised back to the exact ISO form the sender signed.
 * Postgres returns timestamps in its own rendering, and feeding that string
 * into the signature check unchanged would break verification on every message.
 */
export function rowToEnvelope(row: MessageRow): SealedEnvelope {
  return {
    header: {
      v: 1,
      alg: ALGORITHMS,
      from: row.sender_address,
      to: row.recipient_address,
      sentAt: new Date(row.sent_at).toISOString(),
    },
    iv: row.iv,
    body: row.body,
    recipientSlot: {
      kemCiphertext: row.recipient_kem_ciphertext,
      wrapIv: row.recipient_wrap_iv,
      wrappedKey: row.recipient_wrapped_key,
    },
    senderSlot: {
      kemCiphertext: row.sender_kem_ciphertext,
      wrapIv: row.sender_wrap_iv,
      wrappedKey: row.sender_wrapped_key,
    },
    signature: row.signature,
  };
}

/** Flatten a sealed envelope into the columns an insert expects. */
export function envelopeToInsert(
  envelope: SealedEnvelope,
  senderId: string,
  recipientId: string,
): Omit<MessageRow, 'id' | 'read' | 'deleted_by_sender' | 'deleted_by_recipient'> {
  return {
    sender_id: senderId,
    recipient_id: recipientId,
    sender_address: envelope.header.from,
    recipient_address: envelope.header.to,
    sent_at: envelope.header.sentAt,
    iv: envelope.iv,
    body: envelope.body,
    recipient_kem_ciphertext: envelope.recipientSlot.kemCiphertext,
    recipient_wrap_iv: envelope.recipientSlot.wrapIv,
    recipient_wrapped_key: envelope.recipientSlot.wrappedKey,
    sender_kem_ciphertext: envelope.senderSlot.kemCiphertext,
    sender_wrap_iv: envelope.senderSlot.wrapIv,
    sender_wrapped_key: envelope.senderSlot.wrappedKey,
    signature: envelope.signature,
  };
}
