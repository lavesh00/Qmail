export {
  QmailClient,
  QmailError,
  createQmailClient,
  MAX_ATTACHMENT_BYTES,
  QMAIL_DOMAIN,
  type Account,
  type Contact,
  type Folder,
  type MessageSummary,
  type OpenedMail,
  type QmailClientOptions,
} from './client.js';

export {
  createMemoryStorage,
  keystoreKey,
  LAST_ADDRESS_KEY,
  type SecureStorage,
} from './storage.js';

export {
  envelopeToInsert,
  rowToEnvelope,
  type ContactRow,
  type MessageRow,
  type UserRow,
} from './rows.js';
