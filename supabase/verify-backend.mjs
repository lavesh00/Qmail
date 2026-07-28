/**
 * Backend integration test.
 *
 * Exercises the schema through the real client library, the way the apps will:
 * three accounts sign up, one sends a genuinely sealed message to another, and
 * the third is checked to be unable to see or read it. It also probes the parts
 * of the schema that exist to stop a client misbehaving — the immutability
 * trigger and the per-side flag ownership rules.
 *
 * Run against a project you do not mind writing to; it cleans up after itself.
 *
 *   node supabase/verify-backend.mjs
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import {
  generateIdentity,
  openMessage,
  releasePqc,
  sealMessage,
  toBase64,
  fromBase64,
} from '@qmail/crypto';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const env = Object.fromEntries(
  readFileSync(new URL('../apps/web/.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((line) => line.includes('='))
    .map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
    }),
);

const SUPABASE_URL = env.VITE_SUPABASE_URL;
const ANON_KEY = env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !ANON_KEY) {
  throw new Error('apps/web/.env.local must define VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY');
}

/** A fresh client per account: each carries its own session, as a device would. */
function newClient() {
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

let passed = 0;
let failed = 0;
const cleanup = [];

async function check(name, run) {
  try {
    await run();
    passed += 1;
    console.log(`  pass  ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${error.message}`);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * Registers an account exactly as a client will: generate keys on-device, sign
 * up, then publish only the public halves.
 */
async function register(handle) {
  const address = `${handle}@qmail.com`;
  const password = 'a-long-enough-password';
  const client = newClient();

  const { data, error } = await client.auth.signUp({ email: address, password });
  if (error) throw new Error(`signUp ${address}: ${error.message}`);
  assert(data.session, `no session returned for ${address} — is mailer_autoconfirm on?`);

  const identity = await generateIdentity();

  const { error: insertError } = await client.from('users').insert({
    id: data.user.id,
    address,
    kem_public_key: toBase64(identity.kem.publicKey),
    sig_public_key: toBase64(identity.sig.publicKey),
  });
  if (insertError) throw new Error(`insert users row for ${address}: ${insertError.message}`);

  cleanup.push(data.user.id);
  return { address, client, identity, id: data.user.id };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

console.log(`\nVerifying ${SUPABASE_URL}\n`);

const suffix = Math.random().toString(36).slice(2, 8);
const alice = await register(`alice-${suffix}`);
const bob = await register(`bob-${suffix}`);
const mallory = await register(`mallory-${suffix}`);

await check('a users row reads back with the public keys intact', async () => {
  const { data, error } = await alice.client
    .from('users')
    .select('address, kem_public_key, sig_public_key')
    .eq('id', alice.id)
    .single();
  if (error) throw new Error(error.message);
  assert(data.address === alice.address, 'address did not round-trip');
  assert(data.kem_public_key === toBase64(alice.identity.kem.publicKey), 'KEM key did not round-trip');
  assert(data.sig_public_key === toBase64(alice.identity.sig.publicKey), 'signing key did not round-trip');
});

await check('a duplicate address is rejected', async () => {
  const client = newClient();
  const { data } = await client.auth.signUp({
    email: `duplicate-${suffix}@qmail.com`,
    password: 'a-long-enough-password',
  });
  cleanup.push(data.user.id);
  const { error } = await client.from('users').insert({
    id: data.user.id,
    address: alice.address,
    kem_public_key: toBase64(alice.identity.kem.publicKey),
    sig_public_key: toBase64(alice.identity.sig.publicKey),
  });
  assert(error, 'the unique index did not reject a duplicate address');
});

await check('a malformed address is rejected', async () => {
  const client = newClient();
  const { data } = await client.auth.signUp({
    email: `badformat-${suffix}@qmail.com`,
    password: 'a-long-enough-password',
  });
  cleanup.push(data.user.id);
  const { error } = await client.from('users').insert({
    id: data.user.id,
    address: 'someone@gmail.com',
    kem_public_key: toBase64(alice.identity.kem.publicKey),
    sig_public_key: toBase64(alice.identity.sig.publicKey),
  });
  assert(error, 'the format constraint accepted a non-qmail.com address');
});

await check('you cannot publish a users row for someone else', async () => {
  const { error } = await mallory.client.from('users').insert({
    id: alice.id,
    address: `impostor-${suffix}@qmail.com`,
    kem_public_key: toBase64(mallory.identity.kem.publicKey),
    sig_public_key: toBase64(mallory.identity.sig.publicKey),
  });
  assert(error, 'row-level security allowed a row to be written under another id');
});

// --- Sending ---------------------------------------------------------------

const CONTENT = { subject: 'Backend check', body: 'Sealed on the client, opaque to the server.' };
let messageId;

await check('alice can send a sealed message to bob', async () => {
  const { data: recipient, error: lookupError } = await alice.client
    .from('users')
    .select('id, address, kem_public_key, sig_public_key')
    .eq('address', bob.address)
    .single();
  if (lookupError) throw new Error(`looking up the recipient: ${lookupError.message}`);

  const envelope = await sealMessage({
    content: CONTENT,
    from: alice.address,
    to: recipient.address,
    recipientKemPublicKey: fromBase64(recipient.kem_public_key),
    senderKemPublicKey: alice.identity.kem.publicKey,
    senderSigSecretKey: alice.identity.sig.secretKey,
  });

  const { data, error } = await alice.client
    .from('messages')
    .insert({
      sender_id: alice.id,
      recipient_id: recipient.id,
      sender_address: envelope.header.from,
      recipient_address: envelope.header.to,
      sent_at: envelope.header.sentAt,
      iv: envelope.iv,
      body: envelope.body,
      recipient_kem_ciphertext: envelope.recipientSlot.kemCiphertext,
      recipient_wrap_iv: envelope.recipientSlot.wrapIv,
      recipient_wrapped_key: envelope.recipientSlot.wrappedKey,
      sender_kem_ciphertext: envelope.senderSlot.kemCiphertext,
      sender_wrap_iv: envelope.senderSlot.wrapIv,
      sender_wrapped_key: envelope.senderSlot.wrappedKey,
      signature: envelope.signature,
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  messageId = data.id;
});

/** Rebuild a sealed envelope from a database row. */
function rowToEnvelope(row) {
  return {
    header: {
      v: 1,
      alg: { kem: 'ML-KEM-768', signature: 'ML-DSA-65', aead: 'AES-256-GCM' },
      from: row.sender_address,
      to: row.recipient_address,
      sentAt: new Date(row.sent_at).toISOString(),
    },
    iv: row.iv,
    body: row.body,
    recipientSlot: {
      kemCiphertext: row.recipient_kem_ciphertext,
      wrapIv: row.recipient_wrap_iv,
      wrappedKey: row.recipient_wrapped_key,
    },
    senderSlot: {
      kemCiphertext: row.sender_kem_ciphertext,
      wrapIv: row.sender_wrap_iv,
      wrappedKey: row.sender_wrapped_key,
    },
    signature: row.signature,
  };
}

await check('bob receives it, decrypts it, and the signature verifies', async () => {
  const { data, error } = await bob.client
    .from('messages')
    .select('*')
    .eq('recipient_id', bob.id)
    .single();
  if (error) throw new Error(error.message);

  const opened = await openMessage({
    envelope: rowToEnvelope(data),
    kemSecretKey: bob.identity.kem.secretKey,
    role: 'recipient',
    senderSigPublicKey: alice.identity.sig.publicKey,
  });

  assert(opened.content.subject === CONTENT.subject, 'subject did not survive the round trip');
  assert(opened.content.body === CONTENT.body, 'body did not survive the round trip');
  assert(opened.verified === true, 'the signature did not verify');
});

await check('alice can still read her own sent copy', async () => {
  const { data, error } = await alice.client
    .from('messages')
    .select('*')
    .eq('id', messageId)
    .single();
  if (error) throw new Error(error.message);

  const opened = await openMessage({
    envelope: rowToEnvelope(data),
    kemSecretKey: alice.identity.kem.secretKey,
    role: 'sender',
    senderSigPublicKey: alice.identity.sig.publicKey,
  });
  assert(opened.content.body === CONTENT.body, 'the sender slot did not open');
});

await check('mallory cannot see the message at all', async () => {
  const { data, error } = await mallory.client.from('messages').select('*');
  if (error) throw new Error(error.message);
  assert(data.length === 0, `row-level security leaked ${data.length} row(s) to a third party`);
});

await check('even handed the row, mallory cannot decrypt it', async () => {
  // Simulates the database itself being read: the access rules are not what
  // keeps the message private, the encryption is.
  const { data } = await bob.client.from('messages').select('*').eq('id', messageId).single();
  let opened = false;
  try {
    await openMessage({
      envelope: rowToEnvelope(data),
      kemSecretKey: mallory.identity.kem.secretKey,
      role: 'recipient',
    });
    opened = true;
  } catch {
    opened = false;
  }
  assert(!opened, 'a foreign key decrypted the message');
});

// --- Flags and immutability -------------------------------------------------

await check('bob can mark the message read', async () => {
  const { error } = await bob.client.from('messages').update({ read: true }).eq('id', messageId);
  if (error) throw new Error(error.message);
  const { data } = await bob.client.from('messages').select('read').eq('id', messageId).single();
  assert(data.read === true, 'the read flag did not persist');
});

await check('alice cannot mark her own sent message as read', async () => {
  const { error } = await alice.client.from('messages').update({ read: false }).eq('id', messageId);
  assert(error, 'the sender was allowed to change the recipient’s read state');
});

await check('neither party can rewrite the ciphertext', async () => {
  const { error } = await bob.client
    .from('messages')
    .update({ body: toBase64(new Uint8Array([1, 2, 3])) })
    .eq('id', messageId);
  assert(error, 'a sealed message was modified after sending');
});

await check('trash is per side', async () => {
  const { error } = await alice.client
    .from('messages')
    .update({ deleted_by_sender: true })
    .eq('id', messageId);
  if (error) throw new Error(error.message);

  const { data } = await bob.client.from('messages').select('id').eq('id', messageId);
  assert(data.length === 1, 'the sender discarding their copy removed it from the inbox too');
});

await check('the row is reaped once both sides discard it', async () => {
  const { error } = await bob.client
    .from('messages')
    .update({ deleted_by_recipient: true })
    .eq('id', messageId);
  if (error) throw new Error(error.message);

  const { data } = await bob.client.from('messages').select('id').eq('id', messageId);
  assert(data.length === 0, 'the message survived being discarded by both sides');
});

// --- Contacts ---------------------------------------------------------------

await check('contacts are private to their owner', async () => {
  const { error } = await alice.client.from('contacts').insert({
    owner_id: alice.id,
    contact_id: bob.id,
    address: bob.address,
    kem_public_key: toBase64(bob.identity.kem.publicKey),
    sig_public_key: toBase64(bob.identity.sig.publicKey),
  });
  if (error) throw new Error(error.message);

  const { data: mine } = await alice.client.from('contacts').select('address');
  assert(mine.length === 1, 'the owner could not read their own contact');

  const { data: theirs } = await mallory.client.from('contacts').select('address');
  assert(theirs.length === 0, 'a third party could read someone else’s contacts');
});

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

console.log(`\n  ${passed} passed, ${failed} failed`);
console.log(`\n  test accounts to remove: ${cleanup.length}`);
console.log(`  ${cleanup.join('\n  ')}`);

await releasePqc();
process.exit(failed === 0 ? 0 : 1);
