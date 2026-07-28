/**
 * Encoding helpers, checked against RFC 4648's published vectors.
 *
 * These run against the built package rather than the TypeScript source, so a
 * broken build is caught here rather than in an app.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalJson,
  concatBytes,
  constantTimeEqual,
  fromBase64,
  fromHex,
  fromUtf8,
  toBase64,
  toHex,
  toUtf8,
} from '../dist/index.js';

/** RFC 4648 section 10. */
const RFC4648_BASE64 = [
  ['', ''],
  ['f', 'Zg=='],
  ['fo', 'Zm8='],
  ['foo', 'Zm9v'],
  ['foob', 'Zm9vYg=='],
  ['fooba', 'Zm9vYmE='],
  ['foobar', 'Zm9vYmFy'],
];

test('base64 encoding matches the RFC 4648 test vectors', () => {
  for (const [plain, encoded] of RFC4648_BASE64) {
    assert.equal(toBase64(toUtf8(plain)), encoded, `encoding ${JSON.stringify(plain)}`);
  }
});

test('base64 decoding matches the RFC 4648 test vectors', () => {
  for (const [plain, encoded] of RFC4648_BASE64) {
    assert.equal(fromUtf8(fromBase64(encoded)), plain, `decoding ${encoded}`);
  }
});

test('base64 round-trips every byte value', () => {
  const all = new Uint8Array(256);
  for (let i = 0; i < 256; i += 1) {
    all[i] = i;
  }
  assert.deepEqual(fromBase64(toBase64(all)), all);
});

test('base64 round-trips at every length modulo 3', () => {
  for (let length = 0; length < 64; length += 1) {
    const bytes = new Uint8Array(length).map((_, i) => (i * 37 + 11) % 256);
    assert.deepEqual(fromBase64(toBase64(bytes)), bytes, `length ${length}`);
  }
});

test('base64 decoding rejects characters outside the alphabet', () => {
  assert.throws(() => fromBase64('Zm9v!!'), /Invalid base64/);
});

/** RFC 4648 section 10. */
test('hex encoding matches the RFC 4648 test vectors', () => {
  assert.equal(toHex(toUtf8('foobar')), '666f6f626172');
  assert.equal(fromUtf8(fromHex('666f6f626172')), 'foobar');
});

test('hex decoding rejects odd-length input', () => {
  assert.throws(() => fromHex('abc'), /even number/);
});

test('UTF-8 survives characters outside the BMP', () => {
  // btoa would throw on these; the hand-rolled encoder must not.
  const text = 'नमस्ते 🔐 Ω';
  assert.equal(fromUtf8(toUtf8(text)), text);
  assert.equal(fromUtf8(fromBase64(toBase64(toUtf8(text)))), text);
});

test('concatBytes joins in order', () => {
  const joined = concatBytes(new Uint8Array([1, 2]), new Uint8Array([]), new Uint8Array([3]));
  assert.deepEqual(joined, new Uint8Array([1, 2, 3]));
});

test('constantTimeEqual agrees with a plain comparison', () => {
  assert.equal(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3])), true);
  assert.equal(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4])), false);
  assert.equal(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3])), false);
});

test('canonical JSON is independent of key insertion order', () => {
  // Two clients building "the same" header must produce identical signing
  // input, or signatures will verify on one platform and fail on the other.
  const a = { to: 'bob@qmail.com', from: 'alice@qmail.com', v: 1 };
  const b = { v: 1, from: 'alice@qmail.com', to: 'bob@qmail.com' };
  assert.equal(canonicalJson(a), canonicalJson(b));
  assert.equal(canonicalJson(a), '{"from":"alice@qmail.com","to":"bob@qmail.com","v":1}');
});

test('canonical JSON sorts nested objects too', () => {
  const value = { b: { z: 1, a: 2 }, a: [3, { y: 1, x: 2 }] };
  assert.equal(canonicalJson(value), '{"a":[3,{"x":2,"y":1}],"b":{"a":2,"z":1}}');
});

test('canonical JSON omits undefined fields rather than emitting them', () => {
  assert.equal(canonicalJson({ a: 1, b: undefined }), '{"a":1}');
});
