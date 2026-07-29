import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { QmailClient, QmailError } from '@qmail/core';
import { useSession } from '../state/session';
import { Icon } from '../ui/Icon';
import { colors, radius, space } from '../theme/colors';

const MIN_PASSWORD = 10;

/** The lattice, drawn as a grid of thin rules rather than a glow. */
function Lattice() {
  const cells = [];
  for (let i = 1; i < 8; i += 1) {
    cells.push(<View key={`v${i}`} style={[styles.latticeLine, { left: i * 56 }]} />);
  }
  for (let i = 1; i < 16; i += 1) {
    cells.push(<View key={`h${i}`} style={[styles.latticeRow, { top: i * 56 }]} />);
  }
  return (
    <View style={styles.lattice} pointerEvents="none">
      {cells}
    </View>
  );
}

function Shell({
  title,
  lede,
  children,
}: {
  title: string;
  lede?: string;
  children: React.ReactNode;
}) {
  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Lattice />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.brand}>
          {/* Neutral: the accent belongs to the primary action, not the mark. */}
        <Icon name="shield" size={22} color={colors.paperDim} />
          <Text style={styles.wordmark}>Qmail</Text>
        </View>
        <Text style={styles.title}>{title}</Text>
        {lede ? <Text style={styles.lede}>{lede}</Text> : null}
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Notice({ text }: { text: string }) {
  return (
    <View style={styles.notice}>
      <Icon name="alert" size={16} color={colors.stateFailed} />
      <Text style={styles.noticeText}>{text}</Text>
    </View>
  );
}

function Field({
  label,
  value,
  onChange,
  secure,
  hint,
  error,
  domain,
  autoFocus,
  editable = true,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  secure?: boolean;
  hint?: string;
  error?: string | null;
  domain?: boolean;
  autoFocus?: boolean;
  editable?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.fieldBox}>
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={onChange}
          secureTextEntry={secure}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus={autoFocus}
          editable={editable}
          placeholderTextColor={colors.paperFaint}
          placeholder={domain ? 'you' : undefined}
        />
        {domain ? <Text style={styles.domain}>@qmail.com</Text> : null}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!error && hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

function Button({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      style={[styles.button, disabled && styles.buttonDisabled]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text style={styles.buttonLabel}>{label}</Text>
    </Pressable>
  );
}

export function Auth({ initialMode = 'signIn' }: { initialMode?: 'signIn' | 'register' }) {
  const [mode, setMode] = useState<'signIn' | 'register'>(initialMode);
  return mode === 'register' ? (
    <Register onSignIn={() => setMode('signIn')} />
  ) : (
    <SignIn onRegister={() => setMode('register')} />
  );
}

function SignIn({ onRegister }: { onRegister: () => void }) {
  const { signIn } = useSession();
  const [handle, setHandle] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
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
    <Shell
      title="Sign in"
      lede="Your keys live on the device that registered them, so sign in from that device."
    >
      {error ? <Notice text={error} /> : null}
      <Field
        label="Address"
        value={handle}
        onChange={(v) => setHandle(v.toLowerCase().replace(/@.*$/, ''))}
        domain
        editable={!busy}
      />
      <Field label="Password" value={password} onChange={setPassword} secure editable={!busy} />
      <Button
        label={busy ? 'Unlocking your mailbox…' : 'Sign in'}
        onPress={submit}
        disabled={!handle || !password || busy}
      />
      <View style={styles.footer}>
        <Text style={styles.footerText}>No address yet? </Text>
        <Pressable onPress={onRegister}>
          <Text style={styles.link}>Claim one</Text>
        </Pressable>
      </View>
    </Shell>
  );
}

function Register({ onSignIn }: { onSignIn: () => void }) {
  const { register, enterAfterRegistering } = useSession();
  const [handle, setHandle] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ address: string; fingerprint: string } | null>(null);

  const handleProblem = handle.length > 0 ? QmailClient.validateHandle(handle) : null;
  const canSubmit =
    handle.length > 0 &&
    !handleProblem &&
    password.length >= MIN_PASSWORD &&
    confirm === password &&
    !busy;

  async function submit() {
    if (!canSubmit) return;
    setError(null);
    setBusy(true);
    try {
      setDone(await register(handle, password));
    } catch (cause) {
      setError(cause instanceof QmailError ? cause.message : 'Registration failed.');
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Shell
        title="Your mailbox is ready"
        lede="These keys were generated here and never left this device. The server holds only their public halves."
      >
        <Text style={styles.address}>{done.address}</Text>
        <View style={styles.printLabel}>
          <Icon name="key" size={14} color={colors.paperFaint} />
          <Text style={styles.printLabelText}>KEY FINGERPRINT</Text>
        </View>
        <Text style={styles.fingerprint}>{done.fingerprint}</Text>
        <Text style={styles.warning}>
          Read this to someone over a channel Qmail does not control, and they can confirm they are
          writing to you and not to a key the server substituted.
        </Text>
        <Text style={styles.warning}>
          Your private keys are encrypted with your password and stored on this device only. There
          is no copy on the server and no recovery: if you forget the password, or uninstall the
          app, the mailbox cannot be opened again by anyone, including us.
        </Text>
        <Button label="I have noted this down — go to my inbox" onPress={enterAfterRegistering} />
      </Shell>
    );
  }

  return (
    <Shell
      title="Claim an address"
      lede="Qmail is a closed platform. Your address works with other Qmail accounts, not with Gmail or Outlook."
    >
      {error ? <Notice text={error} /> : null}
      <Field
        label="Address"
        value={handle}
        onChange={(v) => setHandle(v.toLowerCase())}
        domain
        error={handleProblem}
        editable={!busy}
      />
      <Field
        label="Password"
        value={password}
        onChange={setPassword}
        secure
        editable={!busy}
        error={
          password.length > 0 && password.length < MIN_PASSWORD
            ? `Use at least ${MIN_PASSWORD} characters.`
            : null
        }
        hint="This password encrypts your private keys on this device. It is never sent to the server, and it cannot be reset."
      />
      <Field
        label="Confirm password"
        value={confirm}
        onChange={setConfirm}
        secure
        editable={!busy}
        error={confirm.length > 0 && confirm !== password ? 'These do not match.' : null}
      />
      <Button
        label={busy ? 'Generating your keys…' : 'Create mailbox'}
        onPress={submit}
        disabled={!canSubmit}
      />
      <View style={styles.footer}>
        <Text style={styles.footerText}>Already have an address? </Text>
        <Pressable onPress={onSignIn}>
          <Text style={styles.link}>Sign in</Text>
        </Pressable>
      </View>
    </Shell>
  );
}

export function Unlock({ address }: { address: string }) {
  const { unlock, signOut } = useSession();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!password || busy) return;
    setError(null);
    setBusy(true);
    try {
      await unlock(password);
    } catch (cause) {
      setError(
        cause instanceof QmailError ? cause.message : 'That password did not unlock your keys.',
      );
      setBusy(false);
    }
  }

  return (
    <Shell
      title="Unlock your mailbox"
      lede={`Signed in as ${address}. Your private keys are encrypted on this device and need your password to open.`}
    >
      {error ? <Notice text={error} /> : null}
      <Field
        label="Password"
        value={password}
        onChange={setPassword}
        secure
        autoFocus
        editable={!busy}
      />
      <Button label={busy ? 'Unlocking…' : 'Unlock'} onPress={submit} disabled={!password || busy} />
      <View style={styles.footer}>
        <Pressable onPress={() => void signOut()}>
          <Text style={styles.link}>Sign out instead</Text>
        </Pressable>
      </View>
    </Shell>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink },
  scroll: { padding: space.s5, paddingTop: space.s8, paddingBottom: space.s8 },

  lattice: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0.5 },
  latticeLine: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: colors.inkLine },
  latticeRow: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: colors.inkLine },

  brand: { flexDirection: 'row', alignItems: 'center', gap: space.s2, marginBottom: space.s7 },
  wordmark: { color: colors.paper, fontSize: 17, fontWeight: '600' },

  title: { color: colors.paper, fontSize: 26, fontWeight: '600', marginBottom: space.s2 },
  lede: { color: colors.paperFaint, fontSize: 14, lineHeight: 21, marginBottom: space.s6 },

  field: { marginBottom: space.s4 },
  fieldLabel: { color: colors.paperDim, fontSize: 13, marginBottom: space.s2 },
  fieldBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.inkLine,
    borderRadius: radius.base,
    paddingHorizontal: space.s3,
  },
  input: { flex: 1, color: colors.paper, fontSize: 15, paddingVertical: 10 },
  domain: { color: colors.paperFaint, fontSize: 14 },
  hint: { color: colors.paperFaint, fontSize: 12, lineHeight: 18, marginTop: space.s2 },
  error: { color: colors.stateFailed, fontSize: 12, marginTop: space.s2 },

  button: {
    backgroundColor: colors.accent,
    borderRadius: radius.base,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: space.s2,
  },
  buttonDisabled: { opacity: 0.45 },
  buttonLabel: { color: colors.ink, fontSize: 15, fontWeight: '600' },

  notice: {
    flexDirection: 'row',
    gap: space.s3,
    borderLeftWidth: 2,
    borderLeftColor: colors.stateFailed,
    paddingLeft: space.s3,
    paddingVertical: space.s2,
    marginBottom: space.s4,
  },
  noticeText: { color: colors.paperDim, fontSize: 13, lineHeight: 19, flex: 1 },

  footer: {
    flexDirection: 'row',
    marginTop: space.s6,
    paddingTop: space.s4,
    borderTopWidth: 1,
    borderTopColor: colors.inkLine,
  },
  footerText: { color: colors.paperFaint, fontSize: 13 },
  link: { color: colors.accent, fontSize: 13 },

  address: { color: colors.accent, fontFamily: 'monospace', fontSize: 16, marginBottom: space.s5 },
  printLabel: { flexDirection: 'row', alignItems: 'center', gap: space.s2, marginBottom: space.s2 },
  printLabelText: { color: colors.paperFaint, fontSize: 11, letterSpacing: 1 },
  fingerprint: {
    color: colors.paper,
    fontFamily: 'monospace',
    fontSize: 13,
    lineHeight: 24,
    borderLeftWidth: 2,
    borderLeftColor: colors.accent,
    paddingLeft: space.s4,
    marginBottom: space.s4,
  },
  warning: { color: colors.paperDim, fontSize: 13, lineHeight: 20, marginBottom: space.s4 },
});
