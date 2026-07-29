import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';
import type { Account, Folder, MessageSummary, OpenedMail } from '@qmail/core';
import { QMAIL_DOMAIN, QmailError } from '@qmail/core';
import { ALGORITHMS } from '@qmail/crypto';
import { qmail } from '../lib/qmail';
import { useSession } from '../state/session';
import { Icon, type IconName } from '../ui/Icon';
import { colors, radius, space } from '../theme/colors';

type View_ =
  | { name: 'folder' }
  | { name: 'message'; id: string }
  | { name: 'compose'; to?: string; subject?: string }
  | { name: 'settings' };

const TABS: { folder: Folder; label: string; icon: IconName }[] = [
  { folder: 'inbox', label: 'Inbox', icon: 'inbox' },
  { folder: 'sent', label: 'Sent', icon: 'send' },
  { folder: 'trash', label: 'Trash', icon: 'trash' },
];

export function Mailbox({ account }: { account: Account }) {
  const [folder, setFolder] = useState<Folder>('inbox');
  const [view, setView] = useState<View_>({ name: 'folder' });
  const [messages, setMessages] = useState<MessageSummary[] | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async (target: Folder) => {
    setError(null);
    try {
      setMessages(await qmail.list(target));
    } catch (cause) {
      setMessages([]);
      setError(cause instanceof Error ? cause.message : 'Could not load your messages.');
    }
  }, []);

  useEffect(() => {
    setMessages(null);
    setQuery('');
    void refresh(folder);
  }, [folder, refresh]);

  const visible = messages ? qmail.search(messages, query) : null;

  return (
    <View style={styles.screen}>
      {view.name === 'folder' ? (
        <>
          <View style={styles.head}>
            <Text style={styles.title}>{TABS.find((t) => t.folder === folder)?.label}</Text>
            <Pressable onPress={() => setView({ name: 'settings' })} hitSlop={10}>
              <Icon name="settings" size={20} color={colors.paperFaint} />
            </Pressable>
          </View>

          <View style={styles.searchBox}>
            <Icon name="search" size={15} color={colors.paperFaint} />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Search this device"
              placeholderTextColor={colors.paperFaint}
              autoCapitalize="none"
            />
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <ScrollView
            style={styles.list}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                tintColor={colors.paperFaint}
                onRefresh={async () => {
                  setRefreshing(true);
                  await refresh(folder);
                  setRefreshing(false);
                }}
              />
            }
          >
            {visible === null ? (
              <View style={styles.centered}>
                <ActivityIndicator color={colors.accent} />
                <Text style={styles.muted}>Decrypting your messages…</Text>
              </View>
            ) : null}

            {visible !== null && visible.length === 0 ? (
              <Text style={styles.empty}>
                {query.trim()
                  ? `Nothing here matches “${query}”. Search only covers messages this device has decrypted — the server holds ciphertext and cannot index it.`
                  : folder === 'inbox'
                    ? 'Nothing here yet. Messages sent to you will appear once they arrive.'
                    : folder === 'sent'
                      ? 'You have not sent anything yet.'
                      : 'Nothing discarded.'}
              </Text>
            ) : null}

            {visible?.map((message) => {
              const counterpart = message.role === 'sender' ? message.to : message.from;
              const unread = !message.read && message.role === 'recipient';
              return (
                <Pressable
                  key={message.id}
                  style={styles.row}
                  onPress={() => setView({ name: 'message', id: message.id })}
                >
                  <View style={styles.rowTop}>
                    <Text style={[styles.who, unread && styles.strong]} numberOfLines={1}>
                      {counterpart}
                    </Text>
                    <Text style={styles.when}>
                      {new Date(message.sentAt).toLocaleDateString(undefined, {
                        day: 'numeric',
                        month: 'short',
                      })}
                    </Text>
                  </View>
                  <Text style={[styles.subject, unread && styles.strong]} numberOfLines={1}>
                    {message.subject !== undefined
                      ? message.subject || '(no subject)'
                      : 'Could not decrypt'}
                  </Text>
                  <VerifiedMark verified={message.verified} />
                </Pressable>
              );
            })}
            <View style={{ height: space.s8 }} />
          </ScrollView>

          <Pressable style={styles.fab} onPress={() => setView({ name: 'compose' })}>
            <Icon name="compose" size={20} color={colors.ink} />
          </Pressable>

          <View style={styles.tabs}>
            {TABS.map((tab) => (
              <Pressable
                key={tab.folder}
                style={styles.tab}
                onPress={() => setFolder(tab.folder)}
              >
                <Icon
                  name={tab.icon}
                  size={20}
                  color={folder === tab.folder ? colors.paper : colors.paperFaint}
                />
                <Text style={folder === tab.folder ? styles.tabLabelOn : styles.tabLabel}>
                  {tab.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}

      {view.name === 'message' ? (
        <MessageView
          id={view.id}
          onBack={() => {
            setView({ name: 'folder' });
            void refresh(folder);
          }}
          onReply={(to, subject) => setView({ name: 'compose', to, subject })}
        />
      ) : null}

      {view.name === 'compose' ? (
        <Compose
          initialTo={view.to ?? ''}
          initialSubject={view.subject ?? ''}
          onClose={() => setView({ name: 'folder' })}
          onSent={() => {
            setFolder('sent');
            setView({ name: 'folder' });
          }}
        />
      ) : null}

      {view.name === 'settings' ? (
        <Settings account={account} onBack={() => setView({ name: 'folder' })} />
      ) : null}
    </View>
  );
}

function VerifiedMark({ verified }: { verified: boolean | null }) {
  if (verified === null) {
    return <Text style={styles.markUnknown}>unverified</Text>;
  }
  return (
    <View style={styles.mark}>
      <Icon
        name={verified ? 'check' : 'alert'}
        size={12}
        color={verified ? colors.stateVerified : colors.stateFailed}
      />
      <Text style={verified ? styles.markOk : styles.markBad}>
        {verified ? 'verified' : 'not verified'}
      </Text>
    </View>
  );
}

function MessageView({
  id,
  onBack,
  onReply,
}: {
  id: string;
  onBack: () => void;
  onReply: (to: string, subject: string) => void;
}) {
  const [mail, setMail] = useState<OpenedMail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const opened = await qmail.open(id);
        if (cancelled) return;
        setMail(opened);
        if (opened.role === 'recipient' && !opened.read) {
          await qmail.markRead(id).catch(() => undefined);
        }
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : 'That message could not be opened.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.pad}>
      <View style={styles.head}>
        <Pressable onPress={onBack} hitSlop={10}>
          <Icon name="back" size={20} color={colors.paperFaint} />
        </Pressable>
        {mail ? (
          <View style={styles.headActions}>
            <Pressable
              onPress={() =>
                onReply(
                  mail.role === 'recipient' ? mail.from : mail.to,
                  mail.subject.startsWith('Re: ') ? mail.subject : `Re: ${mail.subject}`,
                )
              }
              hitSlop={10}
            >
              <Text style={styles.action}>Reply</Text>
            </Pressable>
            <Pressable
              onPress={async () => {
                await qmail.moveToTrash(mail.id, mail.role).catch(() => undefined);
                onBack();
              }}
              hitSlop={10}
            >
              <Icon name="trash" size={20} color={colors.paperFaint} />
            </Pressable>
          </View>
        ) : null}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!mail && !error ? <Text style={styles.muted}>Decrypting…</Text> : null}

      {mail ? (
        <>
          <Text style={styles.mailSubject}>{mail.subject || '(no subject)'}</Text>
          <Text style={styles.mailMeta}>
            {mail.from} → {mail.to}
          </Text>
          <Text style={styles.mailWhen}>{new Date(mail.sentAt).toLocaleString()}</Text>
          <View style={styles.mailBadge}>
            <VerifiedMark verified={mail.verified} />
          </View>
          {mail.verified === false ? (
            <Text style={styles.warnBlock}>
              This message does not match a signature from {mail.from}. Its contents decrypted, but
              nothing vouches for who wrote it — treat it as unattributed.
            </Text>
          ) : null}
          <Text style={styles.mailBody}>{mail.body}</Text>
          {mail.attachment ? (
            <View style={styles.attachment}>
              <Icon name="attachment" size={16} color={colors.paperFaint} />
              <Text style={styles.attachmentName}>{mail.attachment.filename}</Text>
              <Text style={styles.attachmentSize}>
                {(mail.attachment.data.length / 1024).toFixed(0)} KB
              </Text>
            </View>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
}

function Compose({
  initialTo,
  initialSubject,
  onClose,
  onSent,
}: {
  initialTo: string;
  initialSubject: string;
  onClose: () => void;
  onSent: () => void;
}) {
  const [to, setTo] = useState(initialTo.replace(`@${QMAIL_DOMAIN}`, ''));
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function submit() {
    if (!to.trim() || sending) return;
    setError(null);
    setSending(true);
    try {
      await qmail.send({
        to: `${to.trim().toLowerCase()}@${QMAIL_DOMAIN}`,
        subject: subject.trim(),
        body,
      });
      onSent();
    } catch (cause) {
      setError(cause instanceof QmailError ? cause.message : 'Your message could not be sent.');
      setSending(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">
        <View style={styles.head}>
          <Pressable onPress={onClose} hitSlop={10}>
            <Icon name="back" size={20} color={colors.paperFaint} />
          </Pressable>
          <Text style={styles.title}>New message</Text>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.composeRow}>
          <Text style={styles.composeLabel}>To</Text>
          <TextInput
            style={styles.composeInput}
            value={to}
            onChangeText={(v) => setTo(v.toLowerCase().replace(/@.*$/, ''))}
            placeholder="someone"
            placeholderTextColor={colors.paperFaint}
            autoCapitalize="none"
            editable={!sending}
          />
          <Text style={styles.composeDomain}>@{QMAIL_DOMAIN}</Text>
        </View>

        <View style={styles.composeRow}>
          <Text style={styles.composeLabel}>Subject</Text>
          <TextInput
            style={styles.composeInput}
            value={subject}
            onChangeText={setSubject}
            editable={!sending}
          />
        </View>

        <TextInput
          style={styles.composeBody}
          value={body}
          onChangeText={setBody}
          multiline
          textAlignVertical="top"
          placeholder="Write your message. It is encrypted on this device before it is sent."
          placeholderTextColor={colors.paperFaint}
          editable={!sending}
        />

        <Pressable
          style={[styles.sendButton, (!to.trim() || sending) && styles.buttonDisabled]}
          onPress={submit}
          disabled={!to.trim() || sending}
        >
          <Text style={styles.sendLabel}>{sending ? 'Encrypting and sending…' : 'Send'}</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Settings({ account, onBack }: { account: Account; onBack: () => void }) {
  const { signOut, lock } = useSession();
  const [fingerprint, setFingerprint] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    qmail
      .fingerprint()
      .then((v) => !cancelled && setFingerprint(v))
      .catch(() => !cancelled && setFingerprint(null));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.pad}>
      <View style={styles.head}>
        <Pressable onPress={onBack} hitSlop={10}>
          <Icon name="back" size={20} color={colors.paperFaint} />
        </Pressable>
        <Text style={styles.title}>Settings</Text>
      </View>

      <Section title="Account" icon="envelope">
        <Text style={styles.mono}>{account.address}</Text>
      </Section>

      <Section title="Key fingerprint" icon="key">
        <Text style={styles.fingerprint}>{fingerprint ?? 'Loading…'}</Text>
        <Text style={styles.note}>
          Read this aloud to someone over a channel Qmail does not control, and they can confirm the
          keys they hold for you are yours and not a substitute the server handed them.
        </Text>
      </Section>

      <Section title="Cryptography" icon="shield">
        <Text style={styles.mono}>{ALGORITHMS.kem}</Text>
        <Text style={styles.mono}>{ALGORITHMS.signature}</Text>
        <Text style={styles.mono}>{ALGORITHMS.aead}</Text>
        <Text style={styles.note}>
          Both post-quantum algorithms are NIST standards — FIPS 203 and FIPS 204. On this platform
          they run inside a WebView, because React Native's JavaScript engine provides neither
          WebAssembly nor WebCrypto. It is the same module the web client uses, and it is checked
          against the same parity vectors.
        </Text>
      </Section>

      <Section title="Key custody" icon="lock">
        <Text style={styles.note}>
          Your private keys were generated on this device and are stored in its keychain, encrypted
          with your password. The server holds only their public halves and no copy of the password.
          If you forget it or uninstall the app, the mailbox cannot be opened again.
        </Text>
      </Section>

      <Pressable style={styles.quietButton} onPress={() => router.push('/parity')}>
        <Icon name="database" size={16} color={colors.paper} />
        <Text style={styles.quietLabel}>Run the crypto parity check</Text>
      </Pressable>
      <Pressable style={styles.quietButton} onPress={lock}>
        <Icon name="lock" size={16} color={colors.paper} />
        <Text style={styles.quietLabel}>Lock this device</Text>
      </Pressable>
      <Pressable style={styles.quietButton} onPress={() => void signOut()}>
        <Icon name="signout" size={16} color={colors.paper} />
        <Text style={styles.quietLabel}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: IconName;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Icon name={icon} size={15} color={colors.paper} />
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

const mono = 'monospace';

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink },
  pad: { padding: space.s5, paddingTop: space.s7, paddingBottom: space.s8 },

  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s3,
    paddingHorizontal: space.s5,
    paddingTop: space.s7,
    paddingBottom: space.s3,
  },
  headActions: { flexDirection: 'row', alignItems: 'center', gap: space.s4, marginLeft: 'auto' },
  action: { color: colors.accent, fontSize: 14 },
  title: { color: colors.paper, fontSize: 22, fontWeight: '600', flex: 1 },

  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s2,
    marginHorizontal: space.s5,
    marginBottom: space.s3,
    paddingHorizontal: space.s3,
    borderWidth: 1,
    borderColor: colors.inkLine,
    borderRadius: radius.base,
  },
  searchInput: { flex: 1, color: colors.paper, fontSize: 14, paddingVertical: 8 },

  list: { flex: 1, paddingHorizontal: space.s5 },
  centered: { alignItems: 'center', paddingVertical: space.s8, gap: space.s3 },
  muted: { color: colors.paperFaint, fontSize: 14 },
  empty: { color: colors.paperFaint, fontSize: 14, lineHeight: 21, paddingVertical: space.s6 },
  error: {
    color: colors.stateFailed,
    fontSize: 13,
    paddingHorizontal: space.s5,
    paddingBottom: space.s3,
  },

  row: { paddingVertical: space.s3, borderBottomWidth: 1, borderBottomColor: colors.inkLine },
  rowTop: { flexDirection: 'row', alignItems: 'baseline', gap: space.s3 },
  who: { color: colors.paperFaint, fontFamily: mono, fontSize: 12, flex: 1 },
  when: { color: colors.paperFaint, fontFamily: mono, fontSize: 11 },
  subject: { color: colors.paperDim, fontSize: 15, marginTop: 2, marginBottom: 4 },
  strong: { color: colors.paper, fontWeight: '600' },

  mark: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  markOk: { color: colors.stateVerified, fontSize: 11 },
  markBad: { color: colors.stateFailed, fontSize: 11 },
  markUnknown: { color: colors.paperFaint, fontSize: 11 },

  fab: {
    position: 'absolute',
    right: space.s5,
    bottom: 84,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },

  tabs: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.inkLine,
    paddingBottom: space.s5,
    paddingTop: space.s3,
  },
  tab: { flex: 1, alignItems: 'center', gap: 4 },
  tabLabel: { color: colors.paperFaint, fontSize: 11 },
  tabLabelOn: { color: colors.paper, fontSize: 11, fontWeight: '600' },

  mailSubject: { color: colors.paper, fontSize: 21, fontWeight: '600', marginBottom: space.s3 },
  mailMeta: { color: colors.paperDim, fontFamily: mono, fontSize: 12, marginBottom: 2 },
  mailWhen: { color: colors.paperFaint, fontFamily: mono, fontSize: 11, marginBottom: space.s3 },
  mailBadge: {
    paddingBottom: space.s4,
    marginBottom: space.s5,
    borderBottomWidth: 1,
    borderBottomColor: colors.inkLine,
  },
  mailBody: { color: colors.paperDim, fontSize: 15, lineHeight: 24 },
  warnBlock: {
    color: colors.stateFailed,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: space.s4,
    borderLeftWidth: 2,
    borderLeftColor: colors.stateFailed,
    paddingLeft: space.s3,
  },
  attachment: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s3,
    marginTop: space.s6,
    padding: space.s3,
    borderWidth: 1,
    borderColor: colors.inkLine,
    borderRadius: radius.base,
  },
  attachmentName: { color: colors.paperDim, fontSize: 13, flex: 1 },
  attachmentSize: { color: colors.paperFaint, fontFamily: mono, fontSize: 11 },

  composeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s3,
    borderBottomWidth: 1,
    borderBottomColor: colors.inkLine,
    paddingVertical: space.s2,
  },
  composeLabel: { color: colors.paperFaint, fontSize: 13, width: 56 },
  composeInput: { flex: 1, color: colors.paper, fontSize: 15, paddingVertical: 6 },
  composeDomain: { color: colors.paperFaint, fontSize: 14 },
  composeBody: {
    color: colors.paperDim,
    fontSize: 15,
    lineHeight: 23,
    minHeight: 220,
    marginTop: space.s4,
  },
  sendButton: {
    backgroundColor: colors.accent,
    borderRadius: radius.base,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: space.s5,
  },
  buttonDisabled: { opacity: 0.45 },
  sendLabel: { color: colors.ink, fontSize: 15, fontWeight: '600' },

  section: {
    paddingBottom: space.s5,
    marginBottom: space.s5,
    borderBottomWidth: 1,
    borderBottomColor: colors.inkLine,
  },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: space.s2, marginBottom: space.s3 },
  sectionTitle: { color: colors.paper, fontSize: 14, fontWeight: '600' },
  mono: { color: colors.paperDim, fontFamily: mono, fontSize: 13, marginBottom: 2 },
  note: { color: colors.paperFaint, fontSize: 13, lineHeight: 20, marginTop: space.s2 },
  fingerprint: {
    color: colors.paper,
    fontFamily: mono,
    fontSize: 12,
    lineHeight: 22,
    borderLeftWidth: 2,
    borderLeftColor: colors.accent,
    paddingLeft: space.s4,
  },
  quietButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.s2,
    borderWidth: 1,
    borderColor: colors.inkLine,
    borderRadius: radius.base,
    paddingVertical: 12,
    marginBottom: space.s3,
  },
  quietLabel: { color: colors.paper, fontSize: 14 },
});
