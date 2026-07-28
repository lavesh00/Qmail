import type { ReactNode } from 'react';
import { Icon } from '../../ui/Icon';
import './auth.css';

/**
 * The frame around registration, sign-in and unlock.
 *
 * The lattice behind it is the one decorative element in the app, and it earns
 * its place by being the thing the cryptography is actually named after —
 * ML-KEM's security rests on hard problems in lattices. It appears here and
 * nowhere near a message, where it would only compete with content.
 */
export function AuthShell({
  title,
  lede,
  children,
  footer,
}: {
  title: string;
  lede?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="auth">
      <div className="auth__lattice" aria-hidden="true" />
      <main className="auth__panel">
        <div className="auth__brand">
          <Icon name="shield" size={22} />
          <span className="auth__wordmark">Qmail</span>
        </div>

        <h1 className="auth__title">{title}</h1>
        {lede ? <p className="auth__lede">{lede}</p> : null}

        {children}

        {footer ? <div className="auth__footer">{footer}</div> : null}
      </main>
    </div>
  );
}
