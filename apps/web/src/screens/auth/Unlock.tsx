import { useState, type FormEvent } from 'react';
import { QmailError } from '@qmail/core';
import { useSession } from '../../state/session';
import { Icon } from '../../ui/Icon';
import { AuthShell } from './AuthShell';

/**
 * Shown after a restart, when the session came back but the keys did not.
 *
 * Not a second sign-in — the account is already signed in. This is the password
 * doing its other job: deriving the key that decrypts the private keys sitting
 * encrypted on this device.
 */
export function Unlock({ address }: { address: string }) {
  const { unlock, signOut } = useSession();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!password || busy) return;

    setError(null);
    setBusy(true);
    try {
      await unlock(password);
    } catch (cause) {
      setError(cause instanceof QmailError ? cause.message : 'That password did not unlock your keys.');
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="Unlock your mailbox"
      lede={`Signed in as ${address}. Your private keys are encrypted on this device and need your password to open.`}
      footer={
        <button type="button" className="link" onClick={() => void signOut()}>
          Sign out instead
        </button>
      }
    >
      {error ? (
        <div className="notice">
          <Icon name="alert" size={16} className="notice__icon" />
          <span>{error}</span>
        </div>
      ) : null}

      <form onSubmit={onSubmit} noValidate>
        <div className="field">
          <label className="field__label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            className="field__input"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            autoFocus
            disabled={busy}
          />
        </div>

        <button type="submit" className="button" disabled={!password || busy}>
          {busy ? 'Unlocking…' : 'Unlock'}
        </button>
      </form>
    </AuthShell>
  );
}
