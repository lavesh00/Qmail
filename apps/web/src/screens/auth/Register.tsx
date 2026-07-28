import { useState, type FormEvent } from 'react';
import { QmailClient, QmailError } from '@qmail/core';
import { useSession } from '../../state/session';
import { Icon } from '../../ui/Icon';
import { AuthShell } from './AuthShell';

const MIN_PASSWORD = 10;

type Stage =
  | { name: 'form' }
  | { name: 'working'; step: string }
  | { name: 'done'; address: string; fingerprint: string };

export function Register({ onSignIn }: { onSignIn: () => void }) {
  const { register, enterAfterRegistering } = useSession();
  const [handle, setHandle] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>({ name: 'form' });

  const handleProblem = handle.length > 0 ? QmailClient.validateHandle(handle) : null;
  const passwordShort = password.length > 0 && password.length < MIN_PASSWORD;
  const mismatch = confirm.length > 0 && confirm !== password;

  const canSubmit =
    handle.length > 0 &&
    !handleProblem &&
    password.length >= MIN_PASSWORD &&
    confirm === password &&
    stage.name === 'form';

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;

    setError(null);
    setStage({ name: 'working', step: 'Generating your keys on this device…' });

    try {
      const result = await register(handle, password);
      setStage({ name: 'done', address: result.address, fingerprint: result.fingerprint });
    } catch (cause) {
      setError(cause instanceof QmailError ? cause.message : 'Registration failed. Try again.');
      setStage({ name: 'form' });
    }
  }

  if (stage.name === 'done') {
    return (
      <AuthShell
        title="Your mailbox is ready"
        lede="These keys were generated here and never left this device. The server holds only their public halves."
      >
        <p className="handover__address">{stage.address}</p>

        <div className="handover__label">
          <Icon name="key" size={14} />
          Key fingerprint
        </div>
        <p className="handover__fingerprint">{stage.fingerprint}</p>

        <p className="handover__warning">
          Read this to someone over a channel Qmail does not control, and they can confirm they are
          writing to you and not to a key the server substituted.
        </p>
        <p className="handover__warning">
          Your private keys are encrypted with your password and stored on this device only. There is
          no copy on the server and no recovery: if you forget the password, or clear this browser's
          data, the mailbox cannot be opened again by anyone, including us.
        </p>

        <button type="button" className="button" onClick={enterAfterRegistering}>
          I have noted this down — go to my inbox
        </button>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Claim an address"
      lede="Qmail is a closed platform. Your address works with other Qmail accounts, not with Gmail or Outlook."
      footer={
        <>
          Already have an address?{' '}
          <button type="button" className="link" onClick={onSignIn}>
            Sign in
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

      {stage.name === 'working' ? (
        <div className="progress">
          <Icon name="key" size={16} />
          <span>{stage.step}</span>
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
              onChange={(event) => setHandle(event.target.value.toLowerCase())}
              placeholder="you"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              disabled={stage.name === 'working'}
            />
            <span className="field__domain">@qmail.com</span>
          </div>
          {handleProblem ? <p className="field__error">{handleProblem}</p> : null}
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
            autoComplete="new-password"
            disabled={stage.name === 'working'}
          />
          {passwordShort ? (
            <p className="field__error">Use at least {MIN_PASSWORD} characters.</p>
          ) : (
            <p className="field__hint">
              This password encrypts your private keys on this device. It is never sent to the
              server, and it cannot be reset.
            </p>
          )}
        </div>

        <div className="field">
          <label className="field__label" htmlFor="confirm">
            Confirm password
          </label>
          <input
            id="confirm"
            className="field__input"
            type="password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            autoComplete="new-password"
            disabled={stage.name === 'working'}
          />
          {mismatch ? <p className="field__error">These do not match.</p> : null}
        </div>

        <button type="submit" className="button" disabled={!canSubmit}>
          {stage.name === 'working' ? 'Creating your mailbox…' : 'Create mailbox'}
        </button>
      </form>
    </AuthShell>
  );
}
