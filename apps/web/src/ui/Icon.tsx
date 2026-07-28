import type { ReactElement } from 'react';

/**
 * The icon set.
 *
 * One family, drawn on the same 24-unit grid with the same 1.5 stroke and the
 * same round caps, so they read as siblings rather than as things collected
 * from different places. Deliberately small: lock, key, envelope, shield,
 * database, check, and the handful of controls the mailbox needs. If something
 * needs an icon that is not here, it gets drawn to match — it does not get an
 * emoji.
 */
export type IconName =
  | 'lock'
  | 'key'
  | 'envelope'
  | 'shield'
  | 'database'
  | 'check'
  | 'inbox'
  | 'send'
  | 'trash'
  | 'users'
  | 'search'
  | 'attachment'
  | 'compose'
  | 'settings'
  | 'signout'
  | 'back'
  | 'alert';

const PATHS: Record<IconName, ReactElement> = {
  lock: (
    <>
      <rect x="4" y="10.5" width="16" height="10" rx="2" />
      <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="12" r="3.5" />
      <path d="M11.5 12H21M18 12v3M15 12v2" />
    </>
  ),
  envelope: (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="2" />
      <path d="m3.5 7 8.5 6.5L20.5 7" />
    </>
  ),
  shield: <path d="M12 3l7.5 3v6c0 4.2-3 7.8-7.5 9-4.5-1.2-7.5-4.8-7.5-9V6z" />,
  database: (
    <>
      <ellipse cx="12" cy="6" rx="7.5" ry="3" />
      <path d="M4.5 6v12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6" />
      <path d="M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3" />
    </>
  ),
  check: <path d="m4.5 12.5 5 5 10-11" />,
  inbox: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <path d="M3 14h5l1.5 2.5h5L16 14h5" />
    </>
  ),
  send: <path d="M4 12 20.5 4.5 15 20l-3.5-6.5L4 12z" />,
  trash: (
    <>
      <path d="M4.5 6.5h15M9.5 6.5V4h5v2.5" />
      <path d="M6.5 6.5 7.5 20h9l1-13.5" />
      <path d="M10.5 10v6M13.5 10v6" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" />
      <path d="M16 5.2a3.5 3.5 0 0 1 0 5.6M17.5 14.4c2.4.7 4 2.7 4 5.6" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 5 5" />
    </>
  ),
  attachment: (
    <path d="M18 8.5 10.2 16.3a3 3 0 0 1-4.2-4.2l8-8a4.5 4.5 0 0 1 6.4 6.4l-8 8a6 6 0 0 1-8.5-8.5l7-7" />
  ),
  compose: (
    <>
      <path d="M4 20h16" />
      <path d="M15.5 4.5 19 8 9 18l-4.5 1L5.5 14.5z" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1M18.7 18.7l-2.1-2.1M7.4 7.4 5.3 5.3" />
    </>
  ),
  signout: (
    <>
      <path d="M9 4.5H5.5A1.5 1.5 0 0 0 4 6v12a1.5 1.5 0 0 0 1.5 1.5H9" />
      <path d="M15 8.5 19 12l-4 3.5M19 12H9" />
    </>
  ),
  back: <path d="M14.5 5.5 8 12l6.5 6.5" />,
  alert: (
    <>
      <path d="M12 3.5 21.5 20h-19z" />
      <path d="M12 9.5v4.5" />
      <circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none" />
    </>
  ),
};

export interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  /**
   * A label when the icon is the only thing conveying meaning. Left off when
   * adjacent text already says it, so screen readers do not hear it twice.
   */
  label?: string;
}

export function Icon({ name, size = 20, className, label }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
    >
      {PATHS[name]}
    </svg>
  );
}
