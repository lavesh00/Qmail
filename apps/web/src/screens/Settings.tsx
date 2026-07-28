import { useEffect, useState } from 'react';
import type { Account } from '@qmail/core';
import { ALGORITHMS } from '@qmail/crypto';
import { qmail } from '../lib/qmail';
import { Icon } from '../ui/Icon';

export function Settings({ account }: { account: Account }) {
  const [fingerprint, setFingerprint] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    qmail
      .fingerprint()
      .then((value) => !cancelled && setFingerprint(value))
      .catch(() => !cancelled && setFingerprint(null));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <header className="panel__head">
        <h1 className="panel__title">Settings</h1>
      </header>

      {/*
        A settings screen is a list of facts, not a grid of cards. Headings and
        spacing do the grouping; nothing here needs a box drawn around it.
      */}
      <div className="settings">
        <section className="settings__section">
          <h2 className="settings__heading">Account</h2>
          <dl className="settings__pairs">
            <dt>Address</dt>
            <dd className="settings__mono">{account.address}</dd>
          </dl>
        </section>

        <section className="settings__section">
          <h2 className="settings__heading">
            <Icon name="key" size={15} />
            Key fingerprint
          </h2>
          <p className="settings__fingerprint">{fingerprint ?? 'Loading…'}</p>
          <p className="settings__note">
            Read this aloud to someone over a channel Qmail does not control — a phone call, in
            person — and they can confirm that the keys they hold for you are yours, and not a
            substitute the server handed them.
          </p>
        </section>

        <section className="settings__section">
          <h2 className="settings__heading">
            <Icon name="shield" size={15} />
            Cryptography
          </h2>
          <dl className="settings__pairs">
            <dt>Key encapsulation</dt>
            <dd className="settings__mono">{ALGORITHMS.kem}</dd>
            <dt>Signatures</dt>
            <dd className="settings__mono">{ALGORITHMS.signature}</dd>
            <dt>Message content</dt>
            <dd className="settings__mono">{ALGORITHMS.aead}</dd>
          </dl>
          <p className="settings__note">
            Both post-quantum algorithms are NIST standards — FIPS 203 and FIPS 204. They are used on
            their own rather than paired with a classical algorithm, which is a deliberate choice for
            this version and a sensible thing to revisit later.
          </p>
        </section>

        <section className="settings__section">
          <h2 className="settings__heading">
            <Icon name="lock" size={15} />
            Key custody
          </h2>
          <p className="settings__note">
            Your private keys were generated on this device and are stored here, encrypted with your
            password. The server holds only their public halves, and no copy of the password. If you
            forget it or clear this browser's data, the mailbox cannot be opened again — not by you,
            and not by us.
          </p>
        </section>

        <section className="settings__section">
          <h2 className="settings__heading">
            <Icon name="database" size={15} />
            Search
          </h2>
          <p className="settings__note">
            Search covers messages already downloaded and decrypted on this device. The server holds
            ciphertext and cannot index it, which is the expected consequence of end-to-end
            encryption rather than a missing feature.
          </p>
        </section>
      </div>
    </>
  );
}
