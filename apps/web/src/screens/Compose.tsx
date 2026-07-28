import { useState, type ChangeEvent, type FormEvent } from 'react';
import { MAX_ATTACHMENT_BYTES, QMAIL_DOMAIN, QmailError, type Attachment } from '@qmail/core';
import { qmail } from '../lib/qmail';
import { Icon } from '../ui/Icon';

export function Compose({
  initialTo,
  initialSubject,
  onCancel,
  onSent,
}: {
  initialTo: string;
  initialSubject: string;
  onCancel: () => void;
  onSent: () => void;
}) {
  const [to, setTo] = useState(initialTo.replace(`@${QMAIL_DOMAIN}`, ''));
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState('');
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function onPickFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_ATTACHMENT_BYTES) {
      setError(`Attachments are limited to ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB.`);
      event.target.value = '';
      return;
    }

    setError(null);
    setAttachment({
      filename: file.name,
      mimeType: file.type || 'application/octet-stream',
      data: new Uint8Array(await file.arrayBuffer()),
    });
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!to.trim() || sending) return;

    setError(null);
    setSending(true);
    try {
      await qmail.send({
        to: `${to.trim().toLowerCase()}@${QMAIL_DOMAIN}`,
        subject: subject.trim(),
        body,
        ...(attachment ? { attachment } : {}),
      });
      onSent();
    } catch (cause) {
      setError(cause instanceof QmailError ? cause.message : 'Your message could not be sent.');
      setSending(false);
    }
  }

  return (
    <>
      <header className="panel__head">
        <button type="button" className="iconbutton" onClick={onCancel} title="Discard">
          <Icon name="back" size={18} label="Discard" />
        </button>
        <h1 className="panel__title">New message</h1>
      </header>

      {error ? (
        <div className="notice notice--panel">
          <Icon name="alert" size={16} className="notice__icon" />
          <span>{error}</span>
        </div>
      ) : null}

      {/*
        No boxes around the fields. The labels and the rules between rows carry
        the structure; a card per input would only add weight.
      */}
      <form className="compose" onSubmit={onSubmit}>
        <div className="compose__row">
          <label className="compose__label" htmlFor="to">
            To
          </label>
          <div className="compose__address">
            <input
              id="to"
              className="compose__input"
              value={to}
              onChange={(event) => setTo(event.target.value.toLowerCase().replace(/@.*$/, ''))}
              placeholder="someone"
              autoCapitalize="none"
              spellCheck={false}
              disabled={sending}
            />
            <span className="compose__domain">@{QMAIL_DOMAIN}</span>
          </div>
        </div>

        <div className="compose__row">
          <label className="compose__label" htmlFor="subject">
            Subject
          </label>
          <input
            id="subject"
            className="compose__input"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            disabled={sending}
          />
        </div>

        <textarea
          className="compose__body"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Write your message. It is encrypted on this device before it is sent."
          rows={16}
          disabled={sending}
        />

        <div className="compose__foot">
          <label className="compose__attach">
            <Icon name="attachment" size={16} />
            {attachment ? attachment.filename : 'Attach a file'}
            <input type="file" onChange={onPickFile} hidden disabled={sending} />
          </label>

          {attachment ? (
            <button
              type="button"
              className="link compose__clear"
              onClick={() => setAttachment(null)}
              disabled={sending}
            >
              Remove
            </button>
          ) : null}

          <button type="submit" className="button compose__send" disabled={!to.trim() || sending}>
            {sending ? 'Encrypting and sending…' : 'Send'}
          </button>
        </div>
      </form>
    </>
  );
}
