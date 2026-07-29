import { useCallback, useEffect, useState } from 'react';
import type { Account, Draft, Folder, MessageSummary } from '@qmail/core';
import { qmail } from '../lib/qmail';
import { useSession } from '../state/session';
import { Icon, type IconName } from '../ui/Icon';
import { MessageList } from './MessageList';
import { MessageView } from './MessageView';
import { Compose } from './Compose';
import { Drafts } from './Drafts';
import { Contacts } from './Contacts';
import { Settings } from './Settings';
import './mailbox.css';

type View =
  | { name: 'folder'; folder: Folder }
  | { name: 'message'; id: string }
  | { name: 'compose'; draft?: Draft; to?: string; subject?: string }
  | { name: 'drafts' }
  | { name: 'contacts' }
  | { name: 'settings' };

const FOLDERS: { folder: Folder; label: string; icon: IconName }[] = [
  { folder: 'inbox', label: 'Inbox', icon: 'inbox' },
  { folder: 'sent', label: 'Sent', icon: 'send' },
  { folder: 'trash', label: 'Trash', icon: 'trash' },
];

export function Mailbox({ account }: { account: Account }) {
  const { signOut, lock } = useSession();
  const [view, setView] = useState<View>({ name: 'folder', folder: 'inbox' });
  const [messages, setMessages] = useState<MessageSummary[] | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  const currentFolder = view.name === 'folder' ? view.folder : null;

  const refresh = useCallback(async (folder: Folder) => {
    setError(null);
    try {
      setMessages(await qmail.list(folder));
    } catch (cause) {
      setMessages([]);
      setError(cause instanceof Error ? cause.message : 'Could not load your messages.');
    }
  }, []);

  useEffect(() => {
    if (currentFolder) {
      setMessages(null);
      setQuery('');
      void refresh(currentFolder);
    }
  }, [currentFolder, refresh]);

  const unreadCount = messages?.filter((m) => !m.read && m.role === 'recipient').length ?? 0;
  const visible = messages ? qmail.search(messages, query) : null;

  function goToFolder(folder: Folder) {
    setView({ name: 'folder', folder });
  }

  return (
    <div className="shell">
      <nav className="rail">
        <div className="rail__brand">
          <Icon name="shield" size={20} />
          <span className="rail__wordmark">Qmail</span>
        </div>

        <button type="button" className="rail__compose" onClick={() => setView({ name: 'compose' })}>
          <Icon name="compose" size={16} />
          Compose
        </button>

        <ul className="rail__folders">
          {FOLDERS.map(({ folder, label, icon }) => (
            <li key={folder}>
              <button
                type="button"
                className={
                  currentFolder === folder ? 'rail__folder rail__folder--current' : 'rail__folder'
                }
                onClick={() => goToFolder(folder)}
              >
                <Icon name={icon} size={18} />
                <span className="rail__folderLabel">{label}</span>
                {folder === 'inbox' && unreadCount > 0 ? (
                  <span className="rail__count">{unreadCount}</span>
                ) : null}
              </button>
            </li>
          ))}
          <li>
            <button
              type="button"
              className={view.name === 'drafts' ? 'rail__folder rail__folder--current' : 'rail__folder'}
              onClick={() => setView({ name: 'drafts' })}
            >
              <Icon name="compose" size={18} />
              <span className="rail__folderLabel">Drafts</span>
            </button>
          </li>
          <li>
            <button
              type="button"
              className={
                view.name === 'contacts' ? 'rail__folder rail__folder--current' : 'rail__folder'
              }
              onClick={() => setView({ name: 'contacts' })}
            >
              <Icon name="users" size={18} />
              <span className="rail__folderLabel">Contacts</span>
            </button>
          </li>
        </ul>

        <div className="rail__foot">
          <button
            type="button"
            className={
              view.name === 'settings' ? 'rail__folder rail__folder--current' : 'rail__folder'
            }
            onClick={() => setView({ name: 'settings' })}
          >
            <Icon name="settings" size={18} />
            <span className="rail__folderLabel">Settings</span>
          </button>
          <button type="button" className="rail__folder" onClick={lock}>
            <Icon name="lock" size={18} />
            <span className="rail__folderLabel">Lock</span>
          </button>
          <button type="button" className="rail__folder" onClick={() => void signOut()}>
            <Icon name="signout" size={18} />
            <span className="rail__folderLabel">Sign out</span>
          </button>
          <p className="rail__address">{account.address}</p>
        </div>
      </nav>

      <main className="panel">
        {view.name === 'folder' ? (
          <MessageList
            folder={view.folder}
            messages={visible}
            total={messages?.length ?? 0}
            query={query}
            onQueryChange={setQuery}
            error={error}
            onOpen={(id) => setView({ name: 'message', id })}
            onCompose={() => setView({ name: 'compose' })}
            onRefresh={() => void refresh(view.folder)}
          />
        ) : null}

        {view.name === 'message' ? (
          <MessageView
            id={view.id}
            onBack={() => goToFolder(currentFolder ?? 'inbox')}
            onReply={(to, subject) => setView({ name: 'compose', to, subject })}
            onDiscarded={() => goToFolder(currentFolder ?? 'inbox')}
          />
        ) : null}

        {view.name === 'compose' ? (
          <Compose
            address={account.address}
            draft={view.draft}
            initialTo={view.to ?? ''}
            initialSubject={view.subject ?? ''}
            onCancel={() => goToFolder('inbox')}
            onSent={() => goToFolder('sent')}
            onSavedDraft={() => setView({ name: 'drafts' })}
          />
        ) : null}

        {view.name === 'drafts' ? (
          <Drafts
            address={account.address}
            onOpen={(draft) => setView({ name: 'compose', draft })}
            onCompose={() => setView({ name: 'compose' })}
          />
        ) : null}

        {view.name === 'contacts' ? (
          <Contacts onWrite={(to) => setView({ name: 'compose', to })} />
        ) : null}

        {view.name === 'settings' ? <Settings account={account} /> : null}
      </main>
    </div>
  );
}
