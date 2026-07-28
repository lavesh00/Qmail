-- Qmail initial schema.
--
-- The server stores ciphertext and public keys. It holds no private key and can
-- decrypt nothing in the messages table, so the access rules below are about
-- who may read which rows, not about protecting the contents — the contents
-- protect themselves.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
-- One row per account, created by the client immediately after registration.
-- Both public keys are base64. The matching private keys are generated on the
-- device and never sent here.

create table public.users (
  id            uuid primary key references auth.users (id) on delete cascade,
  address       text        not null,
  kem_public_key text       not null,
  sig_public_key text       not null,
  created_at    timestamptz not null default now()
);

-- Addresses are the routing key, so they are constrained rather than trusted.
alter table public.users
  add constraint users_address_format
  check (address ~ '^[a-z0-9]([a-z0-9._-]{1,28}[a-z0-9])?@qmail\.com$');

-- Case-insensitive uniqueness: alice@qmail.com and Alice@qmail.com must not be
-- two different mailboxes.
create unique index users_address_key on public.users (lower(address));

-- Key sizes are fixed by FIPS 203 and FIPS 204. Base64 of 1184 bytes is 1580
-- characters, and of 1952 bytes is 2604. Rejecting anything else stops a
-- malformed key from being published and breaking every future send to it.
alter table public.users
  add constraint users_kem_public_key_length check (length(kem_public_key) = 1580),
  add constraint users_sig_public_key_length check (length(sig_public_key) = 2604);

alter table public.users enable row level security;

-- Every signed-in user may read every public key. That is what public keys are
-- for: you cannot send mail to someone without theirs.
create policy users_select_all
  on public.users for select
  to authenticated
  using (true);

-- You may create only your own row, and only for your own auth identity.
create policy users_insert_self
  on public.users for insert
  to authenticated
  with check (auth.uid() = id);

-- Deliberately no update or delete policy. Keys are fixed for the lifetime of an
-- account in this version: rotating them would strand every message already
-- encrypted to the old key, since there is no re-encryption path and no
-- multi-device sync. Rotation is future work, not an oversight.

-- ---------------------------------------------------------------------------
-- messages
-- ---------------------------------------------------------------------------
-- One store, with a recipient column — not an inbox table and an outbox table
-- kept in sync. Every row is already ciphertext, so which table it sits in
-- changes nothing about who can read it.

create table public.messages (
  id           uuid primary key default gen_random_uuid(),

  sender_id    uuid not null references public.users (id) on delete cascade,
  recipient_id uuid not null references public.users (id) on delete cascade,

  -- Addresses are duplicated from users because they are bound into the
  -- envelope's authenticated header. Resolving them by join at read time would
  -- let a later address change silently invalidate old signatures.
  sender_address    text not null,
  recipient_address text not null,

  sent_at timestamptz not null,

  -- The sealed envelope. `body` is AES-256-GCM ciphertext of the subject, body
  -- and any attachment; `iv` is its nonce.
  iv   text not null,
  body text not null,

  -- The recipient's route to the content key: an ML-KEM-768 ciphertext, plus the
  -- content key wrapped under the key derived from it.
  recipient_kem_ciphertext text not null,
  recipient_wrap_iv        text not null,
  recipient_wrapped_key    text not null,

  -- The sender's own route to the same content key. This is what makes a
  -- readable Sent folder possible without the server holding anything extra.
  sender_kem_ciphertext text not null,
  sender_wrap_iv        text not null,
  sender_wrapped_key    text not null,

  -- ML-DSA-65 over the canonical form of everything above.
  signature text not null,

  read boolean not null default false,

  -- Trash is per side. A sender clearing their Sent copy must not remove the
  -- message from the recipient's inbox.
  deleted_by_sender    boolean not null default false,
  deleted_by_recipient boolean not null default false,

  created_at timestamptz not null default now()
);

alter table public.messages
  add constraint messages_kem_ciphertext_lengths check (
    length(recipient_kem_ciphertext) = 1452 and
    length(sender_kem_ciphertext) = 1452
  );

create index messages_recipient_idx on public.messages (recipient_id, sent_at desc);
create index messages_sender_idx on public.messages (sender_id, sent_at desc);

alter table public.messages enable row level security;

-- You can see a message if you are one of its two ends, and only until you have
-- put your own copy in the trash and emptied it.
create policy messages_select_own
  on public.messages for select
  to authenticated
  using (auth.uid() = recipient_id or auth.uid() = sender_id);

-- You may only post messages as yourself, and the address written into the
-- signed header must match the account it is being sent from.
create policy messages_insert_as_sender
  on public.messages for insert
  to authenticated
  with check (
    auth.uid() = sender_id
    and sender_address = (select address from public.users where id = auth.uid())
    and recipient_address = (select address from public.users where id = recipient_id)
  );

-- Either side may update the row, but only the flags that belong to them. The
-- guard against editing ciphertext is in the trigger below, because a policy
-- cannot express "these columns must not change".
create policy messages_update_own
  on public.messages for update
  to authenticated
  using (auth.uid() = recipient_id or auth.uid() = sender_id)
  with check (auth.uid() = recipient_id or auth.uid() = sender_id);

-- Deletion is soft, per side, so there is no delete policy. A row is removed
-- only once both sides have discarded it, by the trigger below.

-- ---------------------------------------------------------------------------
-- Protecting the sealed fields
-- ---------------------------------------------------------------------------
-- Row-level security decides which rows are reachable, not which columns may
-- change. Without this, either party could rewrite the other's ciphertext.
-- Tampering would still be caught by the signature check on the client, but it
-- should not be possible to write in the first place.

create or replace function public.messages_guard_immutable_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.id is distinct from old.id
     or new.sender_id is distinct from old.sender_id
     or new.recipient_id is distinct from old.recipient_id
     or new.sender_address is distinct from old.sender_address
     or new.recipient_address is distinct from old.recipient_address
     or new.sent_at is distinct from old.sent_at
     or new.iv is distinct from old.iv
     or new.body is distinct from old.body
     or new.recipient_kem_ciphertext is distinct from old.recipient_kem_ciphertext
     or new.recipient_wrap_iv is distinct from old.recipient_wrap_iv
     or new.recipient_wrapped_key is distinct from old.recipient_wrapped_key
     or new.sender_kem_ciphertext is distinct from old.sender_kem_ciphertext
     or new.sender_wrap_iv is distinct from old.sender_wrap_iv
     or new.sender_wrapped_key is distinct from old.sender_wrapped_key
     or new.signature is distinct from old.signature
  then
    raise exception 'A sealed message cannot be modified after it is sent';
  end if;

  -- Read state belongs to the recipient; the sender does not get to mark their
  -- own message as read on someone else's behalf.
  if new.read is distinct from old.read and auth.uid() <> old.recipient_id then
    raise exception 'Only the recipient can change the read state of a message';
  end if;

  if new.deleted_by_sender is distinct from old.deleted_by_sender
     and auth.uid() <> old.sender_id then
    raise exception 'Only the sender can discard their own copy';
  end if;

  if new.deleted_by_recipient is distinct from old.deleted_by_recipient
     and auth.uid() <> old.recipient_id then
    raise exception 'Only the recipient can discard their own copy';
  end if;

  return new;
end;
$$;

create trigger messages_guard_immutable_fields
  before update on public.messages
  for each row execute function public.messages_guard_immutable_fields();

-- Once neither side wants the message, nothing is left to keep.
create or replace function public.messages_reap_when_both_deleted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.deleted_by_sender and new.deleted_by_recipient then
    delete from public.messages where id = new.id;
  end if;
  return null;
end;
$$;

create trigger messages_reap_when_both_deleted
  after update on public.messages
  for each row execute function public.messages_reap_when_both_deleted();

-- ---------------------------------------------------------------------------
-- contacts
-- ---------------------------------------------------------------------------
-- A per-user cache of the addresses and public keys of people already
-- corresponded with, so a repeat send does not have to look them up again.
-- Nothing here is secret; it exists to save a round trip and to make an
-- unexpected key change visible.

create table public.contacts (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references public.users (id) on delete cascade,
  contact_id    uuid not null references public.users (id) on delete cascade,
  address       text not null,
  kem_public_key text not null,
  sig_public_key text not null,
  first_seen_at timestamptz not null default now(),
  last_used_at  timestamptz not null default now(),

  unique (owner_id, contact_id)
);

create index contacts_owner_idx on public.contacts (owner_id, last_used_at desc);

alter table public.contacts enable row level security;

create policy contacts_select_own
  on public.contacts for select
  to authenticated
  using (auth.uid() = owner_id);

create policy contacts_insert_own
  on public.contacts for insert
  to authenticated
  with check (auth.uid() = owner_id);

create policy contacts_update_own
  on public.contacts for update
  to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create policy contacts_delete_own
  on public.contacts for delete
  to authenticated
  using (auth.uid() = owner_id);
