import { useState } from 'react';
import { SessionProvider, useSession } from './state/session';
import { Register } from './screens/auth/Register';
import { SignIn } from './screens/auth/SignIn';
import { Unlock } from './screens/auth/Unlock';
import { Mailbox } from './screens/Mailbox';
import ParityPanel from './dev/ParityPanel';

/**
 * Which surface is shown is decided by session state rather than by the URL:
 * signed out, signed in but locked, or ready. There is no URL that can put the
 * app in a state its keys do not support.
 */
function Routes() {
  const { state } = useSession();
  const [wantsRegister, setWantsRegister] = useState(false);

  // A diagnostics escape hatch. Not linked from anywhere in the product.
  if (window.location.hash === '#parity') {
    return <ParityPanel />;
  }

  if (state.status === 'loading') {
    return <div className="boot" />;
  }

  if (state.status === 'locked') {
    return <Unlock address={state.address} />;
  }

  if (state.status === 'ready') {
    return <Mailbox account={state.account} />;
  }

  return wantsRegister ? (
    <Register onSignIn={() => setWantsRegister(false)} />
  ) : (
    <SignIn onRegister={() => setWantsRegister(true)} />
  );
}

export default function App() {
  return (
    <SessionProvider>
      <Routes />
    </SessionProvider>
  );
}
