import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { QmailError, type Account } from '@qmail/core';
import { qmail } from '../lib/qmail';

/**
 * There are three states here, not two, and the third is the interesting one.
 *
 * A signed-in session and an unlocked mailbox are separate facts. Supabase can
 * restore the session across a restart, but the private keys are encrypted
 * under the account password and there is nowhere safe to keep that password,
 * so they cannot come back on their own. After a restart the app knows who you
 * are and still cannot read a word of your mail until you say the password
 * again. That is the direct cost of the server being unable to recover a
 * mailbox, and it is the trade this whole design is making.
 */
export type SessionState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'locked'; address: string }
  | { status: 'ready'; account: Account };

interface SessionValue {
  state: SessionState;
  register: (handle: string, password: string) => Promise<{ address: string; fingerprint: string }>;
  /**
   * Enter the mailbox after registering. Separate from `register` so the
   * handover screen — the fingerprint, and the fact that a forgotten password
   * means a permanently unreadable mailbox — is actually read rather than
   * flashing past on the way to an inbox.
   */
  enterAfterRegistering: () => void;
  signIn: (address: string, password: string) => Promise<void>;
  unlock: (password: string) => Promise<void>;
  signOut: () => Promise<void>;
  lock: () => void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const account = await qmail.restoreSession();
        if (cancelled) return;

        if (!account) {
          setState({ status: 'signedOut' });
          return;
        }

        // The session came back. The keys did not — they need the password.
        if (await qmail.hasLocalKeys(account.address)) {
          setState({ status: 'locked', address: account.address });
        } else {
          // Signed in on a device that has never held this account's keys.
          // With no multi-device sync there is nothing to read here, so treat
          // it as signed out rather than as a mailbox that will not open.
          await qmail.logout();
          setState({ status: 'signedOut' });
        }
      } catch {
        if (!cancelled) setState({ status: 'signedOut' });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // The account is live and unlocked once this resolves; the session state is
  // deliberately left alone so the handover screen can hold the screen.
  const register = useCallback(
    async (handle: string, password: string) => qmail.register(handle, password),
    [],
  );

  const enterAfterRegistering = useCallback(() => {
    const account = qmail.currentAccount();
    if (account) {
      setState({ status: 'ready', account });
    }
  }, []);

  const signIn = useCallback(async (address: string, password: string) => {
    const account = await qmail.login(address, password);
    setState({ status: 'ready', account });
  }, []);

  const unlock = useCallback(async (password: string) => {
    await qmail.unlock(password);
    const account = qmail.currentAccount();
    if (!account) {
      throw new QmailError('Unlocked, but the account could not be identified.');
    }
    setState({ status: 'ready', account });
  }, []);

  const signOut = useCallback(async () => {
    await qmail.logout();
    setState({ status: 'signedOut' });
  }, []);

  const lock = useCallback(() => {
    const account = qmail.currentAccount();
    qmail.lock();
    setState(account ? { status: 'locked', address: account.address } : { status: 'signedOut' });
  }, []);

  const value = useMemo(
    () => ({ state, register, enterAfterRegistering, signIn, unlock, signOut, lock }),
    [state, register, enterAfterRegistering, signIn, unlock, signOut, lock],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) {
    throw new Error('useSession must be used inside a SessionProvider');
  }
  return value;
}
