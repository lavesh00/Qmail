import { useState, type FormEvent } from 'react';
import { QmailClient, QmailError } from '@qmail/core';
import { useSession } from '../../state/session';
import { Icon } from '../../ui/Icon';
import { AuthShell } from './AuthShell';

export function SignIn({ onRegister }: { onRegister: () => void }) {
  const { signIn } = useSession();
  const [handle, setHandle] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!handle || !password || busy) return;

    setError(null);
    setBusy(true);
    try {
      await signIn(QmailClient.addressFor(handle), password);
    } catch (cause) {
      setError(cause instanceof QmailError ? cause.message : 'Could not sign in.');
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="Sign in"
      lede="Your keys live on the device that registered them, so sign in from that device."
      footer={
        <>
          No address yet?{' '}
          <button type="button" className="link" onClick={onRegister}>
            Claim one
          </button>
        </>
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
          <label className="field__label" htmlFor="handle">
            Address
          </label>
          <div className="field__address">
            <input
              id="handle"
              className="field__input"
              value={handle}
              onChange={(event) => setHandle(event.target.value.toLowerCase().replace(/@.*$/, ''))}
              placeholder="you"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              disabled={busy}
            />
            <span className="field__domain">@qmail.com</span>
          </div>
        </div>

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
            disabled={busy}
          />
        </div>

        <button type="submit" className="button" disabled={!handle || !password || busy}>
          {busy ? 'Unlocking your mailbox…' : 'Sign in'}
        </button>
      </form>
    </AuthShell>
  );
}
