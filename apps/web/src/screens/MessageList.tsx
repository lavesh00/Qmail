import type { Folder, MessageSummary } from '@qmail/core';
import { Icon } from '../ui/Icon';

const TITLES: Record<Folder, string> = {
  inbox: 'Inbox',
  sent: 'Sent',
  trash: 'Trash',
};

const EMPTY: Record<Folder, string> = {
  inbox: 'Nothing here yet. Messages sent to you will appear once they arrive.',
  sent: 'You have not sent anything yet.',
  trash: 'Nothing discarded.',
};

function formatWhen(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay
    ? date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function MessageList({
  folder,
  messages,
  total,
  query,
  onQueryChange,
  error,
  onOpen,
  onCompose,
  onRefresh,
}: {
  folder: Folder;
  messages: MessageSummary[] | null;
  total: number;
  query: string;
  onQueryChange: (value: string) => void;
  error: string | null;
  onOpen: (id: string) => void;
  onCompose: () => void;
  onRefresh: () => void;
}) {
  const searching = query.trim().length > 0;

  return (
    <>
      <header className="panel__head">
        <h1 className="panel__title">{TITLES[folder]}</h1>

        <label className="search">
          <Icon name="search" size={15} />
          <input
            className="search__input"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search this device"
            type="search"
          />
        </label>

        <button type="button" className="iconbutton" onClick={onRefresh} title="Refresh">
          <Icon name="inbox" size={18} label="Refresh" />
        </button>
      </header>

      {error ? (
        <div className="notice notice--panel">
          <Icon name="alert" size={16} className="notice__icon" />
          <span>{error}</span>
        </div>
      ) : null}

      {messages === null ? <p className="panel__muted">Decrypting your messages…</p> : null}

      {messages !== null && messages.length === 0 ? (
        <div className="empty">
          <p className="empty__text">
            {searching
              ? `Nothing here matches “${query}”. Search only covers messages this device has decrypted — the server holds ciphertext and cannot index it.`
              : EMPTY[folder]}
          </p>
          {folder === 'inbox' && !searching ? (
            <button type="button" className="button button--quiet empty__action" onClick={onCompose}>
              Write a message
            </button>
          ) : null}
        </div>
      ) : null}

      {messages !== null && messages.length > 0 ? (
        <>
          {searching ? (
            <p className="panel__muted panel__searchNote">
              {messages.length} of {total} on this device
            </p>
          ) : null}
          <ul className="list">
            {messages.map((message) => {
              // Trash holds both sides' discards, so the useful column is
              // whoever is at the other end — not the folder's usual one.
              const counterpart = message.role === 'sender' ? message.to : message.from;
              const unread = !message.read && message.role === 'recipient';
              return (
                <li key={message.id}>
                  <button
                    type="button"
                    className={unread ? 'row row--unread' : 'row'}
                    onClick={() => onOpen(message.id)}
                  >
                    <span className="row__who">{counterpart}</span>
                    <span className="row__subject">
                      {message.subject !== undefined ? (
                        message.subject || <span className="row__sealed">(no subject)</span>
                      ) : (
                        <span className="row__sealed">Could not decrypt</span>
                      )}
                    </span>
                    <span className="row__meta">
                      <VerifiedMark verified={message.verified} />
                      <span className="row__when">{formatWhen(message.sentAt)}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </>
  );
}

/**
 * The one status marker in the message list, and it maps to a real, checked
 * fact: whether the sender's ML-DSA signature over this stored row verifies.
 * Nothing else in the list gets a coloured indicator.
 */
export function VerifiedMark({ verified }: { verified: boolean | null }) {
  if (verified === null) {
    return (
      <span
        className="mark mark--unknown"
        title="The sender's key could not be resolved to check against"
      >
        unverified
      </span>
    );
  }
  return verified ? (
    <span className="mark mark--ok" title="Signature verified against the sender's published key">
      <Icon name="check" size={13} />
      verified
    </span>
  ) : (
    <span className="mark mark--bad" title="This message does not match the sender's signature">
      <Icon name="alert" size={13} />
      not verified
    </span>
  );
}
