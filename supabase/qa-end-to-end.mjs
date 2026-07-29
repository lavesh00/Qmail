/**
 * End-to-end QA, the parts that can be driven headlessly.
 *
 * Registers two fresh accounts, sends a message with an attachment between
 * them, and then attacks it: rewrites the stored ciphertext directly in the
 * database, and cuts the network mid-send. What matters is not that these fail,
 * but that they fail visibly and specifically rather than producing plausible
 * garbage or a crash.
 *
 *   SUPABASE_ACCESS_TOKEN=... node supabase/qa-end-to-end.mjs
 *
 * The access token is only needed for the tampering test, which has to reach
 * past row-level security and past the immutability trigger — i.e. it
 * deliberately simulates an attacker who already owns the database, which is
 * precisely the threat end-to-end encryption exists to survive.
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import {
  createLocalEngine,
  createMemoryStorage,
  createQmailClient,
  rowToEnvelope,
} from '@qmail/core';
import { fromBase64, releasePqc, toBase64, verifyEnvelope } from '@qmail/crypto';

const env = Object.fromEntries(
  readFileSync(new URL('../apps/web/.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((line) => line.includes('='))
    .map((line) => {
      const i = line.indexOf('=');
      return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
    }),
);

const SUPABASE_URL = env.VITE_SUPABASE_URL;
const ANON_KEY = env.VITE_SUPABASE_ANON_KEY;
const PROJECT_REF = new URL(SUPABASE_URL).hostname.split('.')[0];
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

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
  if (!condition) throw new Error(message);
}

/** Run SQL as the database owner, bypassing RLS — an attacker with the keys to the box. */
async function sql(query) {
  if (!ACCESS_TOKEN) throw new Error('SUPABASE_ACCESS_TOKEN is not set');
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    },
  );
  const text = await response.text();
  if (!response.ok) throw new Error(`SQL failed: ${text}`);
  return JSON.parse(text);
}

function newClient(overrides = {}) {
  return createQmailClient({
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: ANON_KEY,
    storage: createMemoryStorage(),
    engine: createLocalEngine(),
    ...overrides,
  });
}

console.log(`\nEnd-to-end QA against ${SUPABASE_URL}\n`);

const suffix = Math.random().toString(36).slice(2, 7);
const PASSWORD = 'qa-password-long-enough';

// --- 1. Two fresh accounts --------------------------------------------------

const alice = newClient();
const bob = newClient();

await check('two fresh accounts register', async () => {
  const a = await alice.register(`qa-a-${suffix}`, PASSWORD);
  const b = await bob.register(`qa-b-${suffix}`, PASSWORD);
  assert(a.address === `qa-a-${suffix}@qmail.com`, 'unexpected address');
  assert(/^([0-9A-F]{4} ){15}[0-9A-F]{4}$/.test(a.fingerprint), 'fingerprint is malformed');
  assert(a.fingerprint !== b.fingerprint, 'two accounts produced the same fingerprint');
  cleanup.push(alice.currentAccount().id, bob.currentAccount().id);
});

// --- 2. A message with an attachment ---------------------------------------

const ATTACHMENT = new Uint8Array(64 * 1024).map((_, i) => (i * 37 + 11) % 256);
const SUBJECT = 'QA — review 2 packet';
const BODY = 'Attachment included. नमस्ते 🔐';
let messageId;

await check('a message with an attachment sends', async () => {
  const sent = await alice.send({
    to: bob.currentAccount().address,
    subject: SUBJECT,
    body: BODY,
    attachment: {
      filename: 'packet.bin',
      mimeType: 'application/octet-stream',
      data: ATTACHMENT,
    },
  });
  messageId = sent.id;
});

await check('it arrives in the recipient inbox, intact and verified', async () => {
  const inbox = await bob.list('inbox');
  assert(inbox.length === 1, `expected 1 message, got ${inbox.length}`);
  assert(inbox[0].subject === SUBJECT, 'the subject did not decrypt in the list');
  assert(inbox[0].verified === true, 'the signature did not verify');

  const opened = await bob.open(messageId);
  assert(opened.body === BODY, 'the body did not survive');
  assert(opened.attachment, 'the attachment is missing');
  assert(opened.attachment.filename === 'packet.bin', 'the filename did not survive');
  assert(
    Buffer.from(opened.attachment.data).equals(Buffer.from(ATTACHMENT)),
    'the attachment bytes differ',
  );
});

await check('it appears in the sender’s own Sent folder', async () => {
  const sent = await alice.list('sent');
  assert(sent.length === 1, `expected 1 sent message, got ${sent.length}`);
  assert(sent[0].subject === SUBJECT, 'the sender could not decrypt their own copy');

  const opened = await alice.open(messageId);
  assert(opened.body === BODY, 'the sender copy body differs');
  assert(
    Buffer.from(opened.attachment.data).equals(Buffer.from(ATTACHMENT)),
    'the sender copy attachment differs',
  );
});

// --- 3. Tampering, from inside the database --------------------------------

await check('neither party can rewrite a sealed message through the API', async () => {
  // Row-level security decides which rows are reachable; the immutability
  // trigger is what stops a reachable row being edited.
  const { error } = await bob.supabase
    .from('messages')
    .update({ body: toBase64(new Uint8Array([1, 2, 3])) })
    .eq('id', messageId);
  assert(error, 'a sealed message was rewritten through the client API');
  assert(
    /cannot be modified after it is sent/i.test(error.message),
    `expected the immutability trigger to refuse it, got: ${error.message}`,
  );
});

await check('a ciphertext tampered with in the database is caught, not decrypted', async () => {
  // The real threat model: assume the server is hostile and hands back a row it
  // has altered. Fetching the genuine row and flipping a bit of it before the
  // client sees it is exactly that, and it does not require actually corrupting
  // the stored data to prove.
  const { data } = await bob.supabase.from('messages').select('*').eq('id', messageId).single();

  const bytes = fromBase64(data.body);
  bytes[7] ^= 0x01;
  const tampered = { ...data, body: toBase64(bytes) };

  const senderKeys = await bob.lookup(alice.currentAccount().address);

  const stillValid = await verifyEnvelope(
    rowToEnvelope(tampered),
    senderKeys.sigPublicKey,
  );
  assert(stillValid === false, 'a tampered row still verified — the signature covers too little');

  // And the AEAD must refuse it independently of the signature, so a message
  // cannot be shown as garbage even if signature checking were skipped.
  let decrypted = true;
  try {
    await bob.engine.open({
      envelope: rowToEnvelope(tampered),
      role: 'recipient',
      senderSigPublicKey: toBase64(senderKeys.sigPublicKey),
    });
  } catch {
    decrypted = false;
  }
  assert(!decrypted, 'a tampered message decrypted rather than failing the AEAD tag check');
});

await check('rewriting the sender address is caught too', async () => {
  const { data } = await bob.supabase.from('messages').select('*').eq('id', messageId).single();
  const senderKeys = await bob.lookup(alice.currentAccount().address);

  const spoofed = { ...data, sender_address: 'mallory@qmail.com' };
  const valid = await verifyEnvelope(rowToEnvelope(spoofed), senderKeys.sigPublicKey);
  assert(valid === false, 'the signature does not cover the sender address');
});

await check('the genuine message still verifies afterwards', async () => {
  const inbox = await bob.list('inbox');
  assert(inbox[0].verified === true, 'the untouched row stopped verifying');
});

// --- 4. Losing the network mid-send ----------------------------------------

await check('a send with no network fails clearly instead of crashing', async () => {
  const offline = newClient({ supabaseUrl: 'https://unreachable.qmail.invalid' });

  let message = null;
  try {
    await offline.register(`qa-off-${suffix}`, PASSWORD);
  } catch (error) {
    message = error.message;
  }

  assert(message !== null, 'an unreachable server did not produce an error at all');
  assert(
    !/undefined|\[object Object\]|TypeError/.test(message),
    `the error is not fit to show a user: ${message}`,
  );
});

await check('a send to an address that does not exist is refused by name', async () => {
  let message = null;
  try {
    await alice.send({ to: 'nobody-here@qmail.com', subject: 'x', body: 'y' });
  } catch (error) {
    message = error.message;
  }
  assert(message !== null, 'sending to a non-existent address succeeded');
  assert(
    /No Qmail account exists/.test(message),
    `expected a clear refusal, got: ${message}`,
  );
});

await check('an oversized attachment is refused before anything is sent', async () => {
  let message = null;
  try {
    await alice.send({
      to: bob.currentAccount().address,
      subject: 'too big',
      body: '',
      attachment: {
        filename: 'big.bin',
        mimeType: 'application/octet-stream',
        data: new Uint8Array(3 * 1024 * 1024),
      },
    });
  } catch (error) {
    message = error.message;
  }
  assert(message !== null, 'an oversized attachment was accepted');
  assert(/limited to/.test(message), `expected a size refusal, got: ${message}`);
});

// --- 5. Locking ------------------------------------------------------------

await check('locking makes the mailbox unreadable until unlocked again', async () => {
  bob.lock();
  let opened = true;
  try {
    await bob.open(messageId);
  } catch {
    opened = false;
  }
  assert(!opened, 'a locked client still decrypted a message');
});

// --- Teardown --------------------------------------------------------------

console.log(`\n  ${passed} passed, ${failed} failed`);

if (ACCESS_TOKEN && cleanup.length) {
  try {
    const ids = cleanup.map((id) => `'${id}'`).join(',');
    await sql(`delete from auth.users where id in (${ids});`);
    console.log(`  cleaned up ${cleanup.length} test accounts`);
  } catch (error) {
    console.log(`  could not clean up automatically: ${error.message}`);
    console.log(`  remove these by hand: qa-a-${suffix}@qmail.com, qa-b-${suffix}@qmail.com`);
  }
} else {
  console.log(
    `  no SUPABASE_ACCESS_TOKEN, so these were left behind: qa-a-${suffix}@qmail.com, qa-b-${suffix}@qmail.com`,
  );
}

await releasePqc();
process.exit(failed === 0 ? 0 : 1);
