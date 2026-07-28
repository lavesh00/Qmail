import { useEffect, useState } from 'react';
import type { Account } from '@qmail/core';
import { qmail } from '../lib/qmail';
import { useSession } from '../state/session';
import { Icon } from '../ui/Icon';
import './mailbox.css';

/**
 * Phase 3 places a real, signed-in surface here so registration can be verified
 * end to end. The folders, compose and message reading arrive in Phase 4.
 */
export function Mailbox({ account }: { account: Account }) {
  const { signOut, lock } = useSession();
  const [fingerprint, setFingerprint] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    qmail
      .fingerprint()
      .then((value) => {
        if (!cancelled) setFingerprint(value);
      })
      .catch(() => {
        if (!cancelled) setFingerprint(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="shell">
      <header className="shell__bar">
        <div className="shell__brand">
          <Icon name="shield" size={20} />
          <span className="shell__wordmark">Qmail</span>
        </div>
        <div className="shell__actions">
          <span className="shell__address">{account.address}</span>
          <button type="button" className="iconbutton" onClick={lock} title="Lock this device">
            <Icon name="lock" size={18} label="Lock" />
          </button>
          <button type="button" className="iconbutton" onClick={() => void signOut()} title="Sign out">
            <Icon name="signout" size={18} label="Sign out" />
          </button>
        </div>
      </header>

      <main className="placeholder">
        <h1 className="placeholder__title">Signed in and unlocked</h1>
        <p className="placeholder__text">
          Your keys decrypted successfully on this device. Sending and receiving arrive next.
        </p>

        {fingerprint ? (
          <>
            <div className="placeholder__label">
              <Icon name="key" size={14} />
              Key fingerprint
            </div>
            <p className="placeholder__fingerprint">{fingerprint}</p>
          </>
        ) : null}
      </main>
    </div>
  );
}
