/**
 * The Qmail client: everything the apps do that is not drawing pixels.
 *
 * Both the web and mobile clients drive this same object, so registration,
 * sending, receiving and trash behave identically on each and only have to be
 * reasoned about once. The two things that genuinely differ per platform —
 * where the encrypted keystore is written, and which WebCrypto implementation
 * is in use — are injected rather than branched on.
 */
import {
  fromBase64,
  generateIdentity,
  identityFingerprint,
  openKeystore,
  openMessage,
  sealKeystore,
  sealMessage,
  splitIdentity,
  toBase64,
  verifyEnvelope,
  warmUp,
  type Attachment,
  type EncryptedKeystore,
  type MessageContent,
  type SecretIdentity,
} from '@qmail/crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  envelopeToInsert,
  rowToEnvelope,
  type ContactRow,
  type MessageRow,
  type UserRow,
} from './rows.js';
import { LAST_ADDRESS_KEY, keystoreKey, type SecureStorage } from './storage.js';

export const QMAIL_DOMAIN = 'qmail.com';

/**
 * Mirrors the CHECK constraint on `users.address`. Validated here as well so a
 * bad handle is rejected before an auth account is created for it — otherwise a
 * failed insert would leave an orphaned login behind.
 */
const HANDLE_PATTERN = /^[a-z0-9]([a-z0-9._-]{1,28}[a-z0-9])?$/;

/**
 * Attachments ride inside the encrypted body rather than in object storage, so
 * they land in a Postgres row. Base64 inflates them by a third; this ceiling
 * keeps a message comfortably inside what the free tier will accept, and gives
 * the user a clear refusal instead of a failed insert.
 */
export const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;

/**
 * An error worth showing a user. The message is written to be read by one, and
 * the underlying failure is kept for logs rather than surfaced.
 */
export class QmailError extends Error {
  override readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'QmailError';
    this.cause = cause;
  }
}

/** Which mailbox a message is being listed for. */
export type Folder = 'inbox' | 'sent' | 'trash';

/** A message as it appears in a list, before its body is decrypted. */
export interface MessageSummary {
  id: string;
  from: string;
  to: string;
  sentAt: string;
  read: boolean;
  /** Whether this device is the recipient or the sender of the message. */
  role: 'recipient' | 'sender';
  /**
   * Result of checking the sender's signature over the stored row. False means
   * the message must be shown as unverified rather than silently trusted.
   * Null means the sender's public key could not be resolved to check against.
   */
  verified: boolean | null;
  /** Decrypted subject. Present once the message has been opened. */
  subject?: string;
}

/** A fully decrypted message. */
export interface OpenedMail {
  id: string;
  from: string;
  to: string;
  sentAt: string;
  subject: string;
  body: string;
  attachment?: Attachment;
  verified: boolean;
  role: 'recipient' | 'sender';
  read: boolean;
}

export interface Contact {
  address: string;
  kemPublicKey: Uint8Array;
  sigPublicKey: Uint8Array;
  lastUsedAt: string;
}

export interface Account {
  id: string;
  address: string;
}

export interface QmailClientOptions {
  supabaseUrl: string;
  supabaseAnonKey: string;
  storage: SecureStorage;
  /** Passed through to supabase-js; mobile supplies an async storage adapter. */
  authStorage?: {
    getItem(key: string): Promise<string | null> | string | null;
    setItem(key: string, value: string): Promise<void> | void;
    removeItem(key: string): Promise<void> | void;
  };
}

export function createQmailClient(options: QmailClientOptions): QmailClient {
  return new QmailClient(options);
}

export class QmailClient {
  readonly supabase: SupabaseClient;
  private readonly storage: SecureStorage;

  /** Decrypted secret keys. In memory only, cleared on lock or logout. */
  private secrets: SecretIdentity | null = null;
  private account: Account | null = null;

  /** Public keys of correspondents, so a repeat send skips the lookup. */
  private readonly contactCache = new Map<string, Contact>();

  constructor(options: QmailClientOptions) {
    this.storage = options.storage;
    this.supabase = createClient(options.supabaseUrl, options.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        ...(options.authStorage ? { storage: options.authStorage } : {}),
      },
    });
  }

  // -------------------------------------------------------------------------
  // Accounts
  // -------------------------------------------------------------------------

  /** Full address for a handle, e.g. `alice` becomes `alice@qmail.com`. */
  static addressFor(handle: string): string {
    return `${handle.trim().toLowerCase()}@${QMAIL_DOMAIN}`;
  }

  /** Why a handle is unacceptable, or null if it is fine. */
  static validateHandle(handle: string): string | null {
    const normalised = handle.trim().toLowerCase();
    if (normalised.length === 0) {
      return 'Choose a handle.';
    }
    if (normalised.length < 3) {
      return 'Handles are at least 3 characters.';
    }
    if (normalised.length > 30) {
      return 'Handles are at most 30 characters.';
    }
    if (!HANDLE_PATTERN.test(normalised)) {
      return 'Use letters, digits, dots, dashes and underscores, starting and ending with a letter or digit.';
    }
    return null;
  }

  /** Whether a handle is still free. */
  async isHandleAvailable(handle: string): Promise<boolean> {
    const address = QmailClient.addressFor(handle);
    const { data, error } = await this.supabase
      .from('users')
      .select('id')
      .ilike('address', address)
      .maybeSingle();
    if (error) {
      throw new QmailError('Could not check whether that address is taken.', error);
    }
    return data === null;
  }

  /**
   * Create an account.
   *
   * Keys are generated on this device before anything is sent anywhere, and
   * only the public halves ever leave it. The secret halves are encrypted under
   * the password and written to local storage; the server sees neither them nor
   * the password.
   */
  async register(handle: string, password: string): Promise<{ address: string; fingerprint: string }> {
    const problem = QmailClient.validateHandle(handle);
    if (problem) {
      throw new QmailError(problem);
    }

    const address = QmailClient.addressFor(handle);

    // Generating the identity first means a slow keygen cannot leave a
    // half-registered account behind if the user closes the tab.
    await warmUp();
    const identity = await generateIdentity();
    const { secrets, kemPublicKey, sigPublicKey } = splitIdentity(identity);

    const { data, error } = await this.supabase.auth.signUp({ email: address, password });
    if (error) {
      throw new QmailError(this.describeSignUpError(error.message), error);
    }
    if (!data.user || !data.session) {
      throw new QmailError('The account was created but no session was returned. Try signing in.');
    }

    const { error: profileError } = await this.supabase.from('users').insert({
      id: data.user.id,
      address,
      kem_public_key: toBase64(kemPublicKey),
      sig_public_key: toBase64(sigPublicKey),
    });
    if (profileError) {
      throw new QmailError(
        profileError.message.includes('users_address_key')
          ? `${address} is already taken.`
          : 'Your account was created but its public keys could not be published.',
        profileError,
      );
    }

    const keystore = await sealKeystore(secrets, password);
    await this.storage.set(keystoreKey(address), JSON.stringify(keystore));
    await this.storage.set(LAST_ADDRESS_KEY, address);

    this.secrets = secrets;
    this.account = { id: data.user.id, address };

    return {
      address,
      fingerprint: await identityFingerprint({ kemPublicKey, sigPublicKey }),
    };
  }

  private describeSignUpError(message: string): string {
    if (/already registered/i.test(message)) {
      return 'That address is already registered.';
    }
    if (/password/i.test(message)) {
      return 'That password is too short. Use at least 10 characters.';
    }
    return message;
  }

  /**
   * Sign in and unlock this device's keys.
   *
   * Both steps need the password, for different reasons: the server checks it
   * to issue a session, and it derives the key that decrypts the local
   * keystore. The server never learns the derived key.
   */
  async login(address: string, password: string): Promise<Account> {
    const normalised = address.trim().toLowerCase();

    const { data, error } = await this.supabase.auth.signInWithPassword({
      email: normalised,
      password,
    });
    if (error) {
      throw new QmailError('That address and password do not match an account.', error);
    }

    this.account = { id: data.user.id, address: normalised };
    await this.storage.set(LAST_ADDRESS_KEY, normalised);
    await this.unlock(password);
    return this.account;
  }

  /**
   * Decrypt this device's keystore into memory.
   *
   * Called on sign-in, and again after a restart: the session survives, but the
   * secret keys are encrypted at rest and there is nowhere safe to keep the
   * password, so they cannot come back without it. That is the direct cost of
   * the server being unable to recover a mailbox, and it is the intended trade.
   */
  async unlock(password: string): Promise<void> {
    const address = this.account?.address ?? (await this.storage.get(LAST_ADDRESS_KEY));
    if (!address) {
      throw new QmailError('No account on this device to unlock.');
    }

    const raw = await this.storage.get(keystoreKey(address));
    if (!raw) {
      throw new QmailError(
        `This device holds no keys for ${address}. Keys live only on the device that registered them, so this account cannot be opened here.`,
      );
    }

    const keystore = JSON.parse(raw) as EncryptedKeystore;
    this.secrets = await openKeystore(keystore, password);

    if (!this.account) {
      const { data } = await this.supabase.auth.getUser();
      if (data.user) {
        this.account = { id: data.user.id, address };
      }
    }
  }

  /** Whether this device holds an encrypted keystore for an account. */
  async hasLocalKeys(address?: string): Promise<boolean> {
    const target = address ?? (await this.storage.get(LAST_ADDRESS_KEY));
    if (!target) {
      return false;
    }
    return (await this.storage.get(keystoreKey(target))) !== null;
  }

  /** The address this device last signed in as, if any. */
  async lastAddress(): Promise<string | null> {
    return this.storage.get(LAST_ADDRESS_KEY);
  }

  /** Restore the Supabase session after a restart. Does not unlock the keys. */
  async restoreSession(): Promise<Account | null> {
    const { data } = await this.supabase.auth.getSession();
    if (!data.session) {
      return null;
    }
    const address = data.session.user.email;
    if (!address) {
      return null;
    }
    this.account = { id: data.session.user.id, address };
    return this.account;
  }

  isUnlocked(): boolean {
    return this.secrets !== null;
  }

  currentAccount(): Account | null {
    return this.account;
  }

  /** Drop the decrypted keys but keep the session. */
  lock(): void {
    this.secrets = null;
  }

  /** Sign out. The encrypted keystore stays, so this device can sign in again. */
  async logout(): Promise<void> {
    this.secrets = null;
    this.account = null;
    this.contactCache.clear();
    await this.supabase.auth.signOut();
  }

  /**
   * Remove this account's keys from the device.
   *
   * Irreversible: with no multi-device sync and no server-side copy, every
   * message ever sent to this account becomes permanently unreadable.
   */
  async forgetKeys(address: string): Promise<void> {
    await this.storage.remove(keystoreKey(address));
    await this.storage.remove(LAST_ADDRESS_KEY);
    this.secrets = null;
  }

  /** This account's key fingerprint, for verifying out of band. */
  async fingerprint(): Promise<string> {
    const me = await this.requireProfile();
    return identityFingerprint({
      kemPublicKey: fromBase64(me.kem_public_key),
      sigPublicKey: fromBase64(me.sig_public_key),
    });
  }

  // -------------------------------------------------------------------------
  // Directory
  // -------------------------------------------------------------------------

  private requireAccount(): Account {
    if (!this.account) {
      throw new QmailError('Not signed in.');
    }
    return this.account;
  }

  private requireSecrets(): SecretIdentity {
    if (!this.secrets) {
      throw new QmailError('This device is locked. Enter your password to unlock your mailbox.');
    }
    return this.secrets;
  }

  private async requireProfile(): Promise<UserRow> {
    const account = this.requireAccount();
    const { data, error } = await this.supabase
      .from('users')
      .select('*')
      .eq('id', account.id)
      .single<UserRow>();
    if (error || !data) {
      throw new QmailError('Could not load your account.', error);
    }
    return data;
  }

  /** Look up an address's public keys, preferring the local contact cache. */
  async lookup(address: string): Promise<Contact> {
    const normalised = address.trim().toLowerCase();
    const cached = this.contactCache.get(normalised);
    if (cached) {
      return cached;
    }

    const { data, error } = await this.supabase
      .from('users')
      .select('*')
      .ilike('address', normalised)
      .maybeSingle<UserRow>();
    if (error) {
      throw new QmailError('Could not look up that address.', error);
    }
    if (!data) {
      throw new QmailError(`No Qmail account exists at ${normalised}.`);
    }

    const contact: Contact = {
      address: data.address,
      kemPublicKey: fromBase64(data.kem_public_key),
      sigPublicKey: fromBase64(data.sig_public_key),
      lastUsedAt: new Date().toISOString(),
    };
    this.contactCache.set(normalised, contact);
    return contact;
  }

  /** Load the persisted contact cache into memory. */
  async loadContacts(): Promise<Contact[]> {
    const account = this.requireAccount();
    const { data, error } = await this.supabase
      .from('contacts')
      .select('*')
      .eq('owner_id', account.id)
      .order('last_used_at', { ascending: false })
      .returns<ContactRow[]>();
    if (error) {
      throw new QmailError('Could not load your contacts.', error);
    }

    const contacts = (data ?? []).map((row) => ({
      address: row.address,
      kemPublicKey: fromBase64(row.kem_public_key),
      sigPublicKey: fromBase64(row.sig_public_key),
      lastUsedAt: row.last_used_at,
    }));
    for (const contact of contacts) {
      this.contactCache.set(contact.address.toLowerCase(), contact);
    }
    return contacts;
  }

  /**
   * Record someone as a contact after corresponding with them.
   *
   * Best-effort: failing to cache a contact must not fail a send that has
   * already been delivered.
   */
  private async rememberContact(contactId: string, contact: Contact): Promise<void> {
    const account = this.requireAccount();
    if (contactId === account.id) {
      return;
    }
    try {
      await this.supabase.from('contacts').upsert(
        {
          owner_id: account.id,
          contact_id: contactId,
          address: contact.address,
          kem_public_key: toBase64(contact.kemPublicKey),
          sig_public_key: toBase64(contact.sigPublicKey),
          last_used_at: new Date().toISOString(),
        },
        { onConflict: 'owner_id,contact_id' },
      );
    } catch {
      // Deliberately swallowed; see above.
    }
  }

  // -------------------------------------------------------------------------
  // Sending
  // -------------------------------------------------------------------------

  async send(input: {
    to: string;
    subject: string;
    body: string;
    attachment?: Attachment;
  }): Promise<{ id: string }> {
    const account = this.requireAccount();
    const secrets = this.requireSecrets();

    if (input.attachment && input.attachment.data.length > MAX_ATTACHMENT_BYTES) {
      throw new QmailError(
        `Attachments are limited to ${Math.floor(MAX_ATTACHMENT_BYTES / 1024 / 1024)} MB.`,
      );
    }

    const recipientAddress = input.to.trim().toLowerCase();
    if (recipientAddress === account.address) {
      // Sending to yourself would encapsulate to the same key twice, which is
      // harmless but produces a message that appears in both folders. Allowed,
      // but worth being deliberate about rather than accidental.
    }

    const [recipientRow, me] = await Promise.all([
      this.supabase
        .from('users')
        .select('*')
        .ilike('address', recipientAddress)
        .maybeSingle<UserRow>(),
      this.requireProfile(),
    ]);

    if (recipientRow.error) {
      throw new QmailError('Could not look up the recipient.', recipientRow.error);
    }
    if (!recipientRow.data) {
      throw new QmailError(
        `No Qmail account exists at ${recipientAddress}. Qmail is a closed platform — mail can only be sent to other @${QMAIL_DOMAIN} addresses.`,
      );
    }

    const content: MessageContent = {
      subject: input.subject,
      body: input.body,
      ...(input.attachment ? { attachment: input.attachment } : {}),
    };

    const envelope = await sealMessage({
      content,
      from: me.address,
      to: recipientRow.data.address,
      recipientKemPublicKey: fromBase64(recipientRow.data.kem_public_key),
      senderKemPublicKey: fromBase64(me.kem_public_key),
      senderSigSecretKey: secrets.sigSecretKey,
    });

    const { data, error } = await this.supabase
      .from('messages')
      .insert(envelopeToInsert(envelope, account.id, recipientRow.data.id))
      .select('id')
      .single<{ id: string }>();

    if (error || !data) {
      throw new QmailError(this.describeSendError(error), error);
    }

    await this.rememberContact(recipientRow.data.id, {
      address: recipientRow.data.address,
      kemPublicKey: fromBase64(recipientRow.data.kem_public_key),
      sigPublicKey: fromBase64(recipientRow.data.sig_public_key),
      lastUsedAt: new Date().toISOString(),
    });

    return { id: data.id };
  }

  private describeSendError(error: { message?: string } | null): string {
    const message = error?.message ?? '';
    if (/fetch|network|Failed to fetch/i.test(message)) {
      return 'Could not reach the server. Your message was not sent — nothing was lost, try again when you are back online.';
    }
    return 'Your message could not be sent.';
  }

  // -------------------------------------------------------------------------
  // Receiving
  // -------------------------------------------------------------------------

  /**
   * List a folder.
   *
   * Signatures are checked here, against the sender's published key, so a
   * tampered row is flagged in the list rather than only on open.
   */
  async list(folder: Folder): Promise<MessageSummary[]> {
    const account = this.requireAccount();

    let query = this.supabase.from('messages').select('*').order('sent_at', { ascending: false });

    if (folder === 'inbox') {
      query = query.eq('recipient_id', account.id).eq('deleted_by_recipient', false);
    } else if (folder === 'sent') {
      query = query.eq('sender_id', account.id).eq('deleted_by_sender', false);
    } else {
      query = query.or(
        `and(recipient_id.eq.${account.id},deleted_by_recipient.eq.true),and(sender_id.eq.${account.id},deleted_by_sender.eq.true)`,
      );
    }

    const { data, error } = await query.returns<MessageRow[]>();
    if (error) {
      throw new QmailError('Could not load your messages.', error);
    }

    const rows = data ?? [];
    const addresses = new Set(rows.map((row) => row.sender_address.toLowerCase()));
    await this.prefetchSenders(addresses);

    return Promise.all(
      rows.map(async (row) => {
        const role: 'recipient' | 'sender' = row.recipient_id === account.id ? 'recipient' : 'sender';
        const sender = this.contactCache.get(row.sender_address.toLowerCase());
        const verified = sender
          ? await verifyEnvelope(rowToEnvelope(row), sender.sigPublicKey)
          : null;
        return {
          id: row.id,
          from: row.sender_address,
          to: row.recipient_address,
          sentAt: new Date(row.sent_at).toISOString(),
          read: row.read,
          role,
          verified,
        };
      }),
    );
  }

  /** Warm the contact cache for a batch of addresses in one query. */
  private async prefetchSenders(addresses: Set<string>): Promise<void> {
    const missing = [...addresses].filter((address) => !this.contactCache.has(address));
    if (missing.length === 0) {
      return;
    }
    const { data } = await this.supabase
      .from('users')
      .select('*')
      .in('address', missing)
      .returns<UserRow[]>();
    for (const row of data ?? []) {
      this.contactCache.set(row.address.toLowerCase(), {
        address: row.address,
        kemPublicKey: fromBase64(row.kem_public_key),
        sigPublicKey: fromBase64(row.sig_public_key),
        lastUsedAt: new Date().toISOString(),
      });
    }
  }

  /** Fetch and decrypt one message. */
  async open(id: string): Promise<OpenedMail> {
    const account = this.requireAccount();
    const secrets = this.requireSecrets();

    const { data, error } = await this.supabase
      .from('messages')
      .select('*')
      .eq('id', id)
      .single<MessageRow>();
    if (error || !data) {
      throw new QmailError('That message could not be loaded.', error);
    }

    const role: 'recipient' | 'sender' = data.recipient_id === account.id ? 'recipient' : 'sender';
    const sender = await this.lookup(data.sender_address).catch(() => null);

    const opened = await openMessage({
      envelope: rowToEnvelope(data),
      kemSecretKey: secrets.kemSecretKey,
      role,
      ...(sender ? { senderSigPublicKey: sender.sigPublicKey } : {}),
    });

    return {
      id: data.id,
      from: data.sender_address,
      to: data.recipient_address,
      sentAt: new Date(data.sent_at).toISOString(),
      subject: opened.content.subject,
      body: opened.content.body,
      ...(opened.content.attachment ? { attachment: opened.content.attachment } : {}),
      verified: opened.verified,
      role,
      read: data.read,
    };
  }

  /** Mark a received message as read. Only the recipient may do this. */
  async markRead(id: string, read = true): Promise<void> {
    const { error } = await this.supabase.from('messages').update({ read }).eq('id', id);
    if (error) {
      throw new QmailError('Could not update the message.', error);
    }
  }

  /**
   * Move this side's copy to trash.
   *
   * Soft, and per side: the other party's copy is untouched. Once both sides
   * have discarded it the row is removed entirely, by a trigger in the database.
   */
  async moveToTrash(id: string, role: 'recipient' | 'sender'): Promise<void> {
    const column = role === 'recipient' ? 'deleted_by_recipient' : 'deleted_by_sender';
    const { error } = await this.supabase
      .from('messages')
      .update({ [column]: true })
      .eq('id', id);
    if (error) {
      throw new QmailError('Could not move the message to trash.', error);
    }
  }

  /** Take this side's copy back out of the trash. */
  async restoreFromTrash(id: string, role: 'recipient' | 'sender'): Promise<void> {
    const column = role === 'recipient' ? 'deleted_by_recipient' : 'deleted_by_sender';
    const { error } = await this.supabase
      .from('messages')
      .update({ [column]: false })
      .eq('id', id);
    if (error) {
      throw new QmailError('Could not restore the message.', error);
    }
  }
}
