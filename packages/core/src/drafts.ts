/**
 * Drafts.
 *
 * Kept on the device and never sent anywhere. A draft is by definition
 * something the user has not decided to send, so uploading it — even encrypted —
 * would put text on a server that was never meant to leave the machine.
 *
 * They are stored through the same `SecureStorage` as the keystore, but unlike
 * the keystore they are not separately encrypted: they are plaintext the user is
 * still writing, sitting in app-private storage. Encrypting them would need the
 * account password held in memory for the whole session, which is a worse trade
 * than the one it would buy.
 */
import type { SecureStorage } from './storage.js';

export interface Draft {
  id: string;
  to: string;
  subject: string;
  body: string;
  /** Attachments are not kept in drafts; re-attach before sending. */
  updatedAt: string;
}

function draftsKey(address: string): string {
  return `qmail.drafts.${address.toLowerCase()}`;
}

async function readAll(storage: SecureStorage, address: string): Promise<Draft[]> {
  const raw = await storage.get(draftsKey(address));
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as Draft[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeAll(storage: SecureStorage, address: string, drafts: Draft[]): Promise<void> {
  await storage.set(draftsKey(address), JSON.stringify(drafts));
}

export async function listDrafts(storage: SecureStorage, address: string): Promise<Draft[]> {
  const drafts = await readAll(storage, address);
  return drafts.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

/** Create or update a draft. Returns the stored draft, with its id. */
export async function saveDraft(
  storage: SecureStorage,
  address: string,
  draft: Omit<Draft, 'updatedAt' | 'id'> & { id?: string },
): Promise<Draft> {
  const drafts = await readAll(storage, address);
  const id = draft.id ?? `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const saved: Draft = {
    id,
    to: draft.to,
    subject: draft.subject,
    body: draft.body,
    updatedAt: new Date().toISOString(),
  };

  const index = drafts.findIndex((existing) => existing.id === id);
  if (index >= 0) {
    drafts[index] = saved;
  } else {
    drafts.push(saved);
  }

  await writeAll(storage, address, drafts);
  return saved;
}

export async function deleteDraft(
  storage: SecureStorage,
  address: string,
  id: string,
): Promise<void> {
  const drafts = await readAll(storage, address);
  await writeAll(
    storage,
    address,
    drafts.filter((draft) => draft.id !== id),
  );
}

/** Remove every draft for an account, e.g. when its keys are forgotten. */
export async function clearDrafts(storage: SecureStorage, address: string): Promise<void> {
  await storage.remove(draftsKey(address));
}
