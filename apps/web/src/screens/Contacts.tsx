import { useEffect, useState } from 'react';
import type { Contact } from '@qmail/core';
import { identityFingerprint } from '@qmail/crypto';
import { qmail } from '../lib/qmail';
import { Icon } from '../ui/Icon';

interface Row {
  contact: Contact;
  fingerprint: string;
}

export function Contacts({ onWrite }: { onWrite: (address: string) => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const contacts = await qmail.loadContacts();
        const withPrints = await Promise.all(
          contacts.map(async (contact) => ({
            contact,
            fingerprint: await identityFingerprint({
              kemPublicKey: contact.kemPublicKey,
              sigPublicKey: contact.sigPublicKey,
            }),
          })),
        );
        if (!cancelled) setRows(withPrints);
      } catch (cause) {
        if (!cancelled) {
          setRows([]);
          setError(cause instanceof Error ? cause.message : 'Could not load your contacts.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <header className="panel__head">
        <h1 className="panel__title">Contacts</h1>
      </header>

      <p className="panel__muted panel__searchNote">
        Built automatically from people you have exchanged mail with. Their public keys are cached
        here so a repeat send does not have to fetch them again.
      </p>

      {error ? (
        <div className="notice notice--panel">
          <Icon name="alert" size={16} className="notice__icon" />
          <span>{error}</span>
        </div>
      ) : null}

      {rows === null ? <p className="panel__muted">Loading…</p> : null}

      {rows !== null && rows.length === 0 && !error ? (
        <div className="empty">
          <p className="empty__text">
            No contacts yet. Anyone you write to, or hear from, will be added here.
          </p>
        </div>
      ) : null}

      {rows !== null && rows.length > 0 ? (
        <ul className="contacts">
          {rows.map(({ contact, fingerprint }) => (
            <li key={contact.address} className="contact">
              <div className="contact__head">
                <span className="contact__address">{contact.address}</span>
                <button
                  type="button"
                  className="link contact__write"
                  onClick={() => onWrite(contact.address)}
                >
                  Write
                </button>
              </div>
              <p className="contact__fingerprint">{fingerprint}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
