import { useEffect, useState } from 'react';
import { deleteDraft, listDrafts, type Draft } from '@qmail/core';
import { createIndexedDbStorage } from '../lib/indexeddb-storage';
import { Icon } from '../ui/Icon';

const storage = createIndexedDbStorage();

export function Drafts({
  address,
  onOpen,
  onCompose,
}: {
  address: string;
  onOpen: (draft: Draft) => void;
  onCompose: () => void;
}) {
  const [drafts, setDrafts] = useState<Draft[] | null>(null);

  async function load() {
    setDrafts(await listDrafts(storage, address));
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  async function discard(id: string) {
    await deleteDraft(storage, address, id);
    await load();
  }

  return (
    <>
      <header className="panel__head">
        <h1 className="panel__title">Drafts</h1>
      </header>

      <p className="panel__muted panel__searchNote">
        Drafts stay on this device and are never uploaded. Something you have not decided to send
        should not be sitting on a server.
      </p>

      {drafts === null ? <p className="panel__muted">Loading…</p> : null}

      {drafts !== null && drafts.length === 0 ? (
        <div className="empty">
          <p className="empty__text">No drafts saved.</p>
          <button type="button" className="button button--quiet empty__action" onClick={onCompose}>
            Write a message
          </button>
        </div>
      ) : null}

      {drafts !== null && drafts.length > 0 ? (
        <ul className="list">
          {drafts.map((draft) => (
            <li key={draft.id} className="draft">
              <button type="button" className="row draft__open" onClick={() => onOpen(draft)}>
                <span className="row__who">{draft.to ? `${draft.to}@qmail.com` : 'No recipient'}</span>
                <span className="row__subject">
                  {draft.subject || <span className="row__sealed">(no subject)</span>}
                </span>
                <span className="row__meta">
                  <span className="row__when">
                    {new Date(draft.updatedAt).toLocaleDateString(undefined, {
                      day: 'numeric',
                      month: 'short',
                    })}
                  </span>
                </span>
              </button>
              <button
                type="button"
                className="iconbutton draft__discard"
                onClick={() => void discard(draft.id)}
                title="Discard draft"
              >
                <Icon name="trash" size={16} label="Discard draft" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
