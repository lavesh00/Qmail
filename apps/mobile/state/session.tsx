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
 * Mirrors the web session model exactly, because the underlying facts are the
 * same on both platforms: a restored session and an unlocked mailbox are
 * separate things. The keys are encrypted under the account password and there
 * is nowhere safe to keep that password, so after a restart the app knows who
 * you are and still cannot read your mail until you say it again.
 */
export type SessionState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'locked'; address: string }
  | { status: 'ready'; account: Account };

interface SessionValue {
  state: SessionState;
  register: (handle: string, password: string) => Promise<{ address: string; fingerprint: string }>;
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

        if (await qmail.hasLocalKeys(account.address)) {
          setState({ status: 'locked', address: account.address });
        } else {
          // Signed in on a device that has never held this account's keys.
          // With no multi-device sync there is nothing to read here.
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
