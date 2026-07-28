import { useEffect, useState } from 'react';
import type { OpenedMail } from '@qmail/core';
import { qmail } from '../lib/qmail';
import { Icon } from '../ui/Icon';
import { VerifiedMark } from './MessageList';

export function MessageView({
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
    setMail(null);
    setError(null);

    (async () => {
      try {
        const opened = await qmail.open(id);
        if (cancelled) return;
        setMail(opened);

        // Reading it is what marks it read, and only the recipient can.
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

  function download(attachment: NonNullable<OpenedMail['attachment']>) {
    // The bytes only exist decrypted in memory, so the download is built here
    // rather than pointed at any URL the server could serve.
    const blob = new Blob([attachment.data as BlobPart], { type: attachment.mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = attachment.filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <header className="panel__head">
        <button type="button" className="iconbutton" onClick={onBack} title="Back">
          <Icon name="back" size={18} label="Back" />
        </button>
        {mail ? (
          <button
            type="button"
            className="button button--quiet panel__headAction"
            onClick={() =>
              onReply(
                mail.role === 'recipient' ? mail.from : mail.to,
                mail.subject.startsWith('Re: ') ? mail.subject : `Re: ${mail.subject}`,
              )
            }
          >
            Reply
          </button>
        ) : null}
      </header>

      {error ? (
        <div className="notice notice--panel">
          <Icon name="alert" size={16} className="notice__icon" />
          <span>{error}</span>
        </div>
      ) : null}

      {!mail && !error ? <p className="panel__muted">Decrypting…</p> : null}

      {mail ? (
        <article className="mail">
          <h1 className="mail__subject">{mail.subject}</h1>

          <div className="mail__meta">
            <span className="mail__from">{mail.from}</span>
            <span className="mail__arrow">to</span>
            <span className="mail__to">{mail.to}</span>
            <time className="mail__when" dateTime={mail.sentAt}>
              {new Date(mail.sentAt).toLocaleString()}
            </time>
          </div>

          <div className="mail__badge">
            <VerifiedMark verified={mail.verified} />
          </div>

          {mail.verified === false ? (
            <div className="notice notice--panel">
              <Icon name="alert" size={16} className="notice__icon" />
              <span>
                This message does not match a signature from {mail.from}. Its contents decrypted, but
                nothing vouches for who wrote it — treat it as unattributed.
              </span>
            </div>
          ) : null}

          <div className="mail__body">{mail.body}</div>

          {mail.attachment ? (
            <button
              type="button"
              className="attachment"
              onClick={() => download(mail.attachment as NonNullable<OpenedMail['attachment']>)}
            >
              <Icon name="attachment" size={16} />
              <span className="attachment__name">{mail.attachment.filename}</span>
              <span className="attachment__size">
                {(mail.attachment.data.length / 1024).toFixed(0)} KB
              </span>
            </button>
          ) : null}
        </article>
      ) : null}
    </>
  );
}
