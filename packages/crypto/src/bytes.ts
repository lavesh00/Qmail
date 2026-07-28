/**
 * Byte and string conversion helpers.
 *
 * Everything crossing a network or storage boundary is base64, and everything
 * inside this package is Uint8Array. These are the only two representations —
 * there is no third "sometimes a string, sometimes bytes" form, because that is
 * where cross-platform crypto bugs come from.
 */

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Encode bytes as standard base64.
 *
 * Implemented by hand rather than via `btoa` or `Buffer` because neither exists
 * on every target: `btoa` is absent in React Native, `Buffer` is absent in
 * browsers, and `btoa` mangles anything above U+00FF. One implementation that
 * behaves identically everywhere is worth the twenty lines.
 */
export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] as number;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];

    out += B64_ALPHABET[b0 >> 2];
    out += B64_ALPHABET[((b0 & 0x03) << 4) | (b1 === undefined ? 0 : b1 >> 4)];
    out += b1 === undefined ? '=' : B64_ALPHABET[((b1 & 0x0f) << 2) | (b2 === undefined ? 0 : b2 >> 6)];
    out += b2 === undefined ? '=' : B64_ALPHABET[b2 & 0x3f];
  }
  return out;
}

const B64_LOOKUP: Record<string, number> = {};
for (let i = 0; i < B64_ALPHABET.length; i += 1) {
  B64_LOOKUP[B64_ALPHABET[i] as string] = i;
}

/** Decode standard base64 back to bytes. Throws on any character outside the alphabet. */
export function fromBase64(input: string): Uint8Array {
  const clean = input.replace(/[\r\n\s]/g, '');
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  const body = padding > 0 ? clean.slice(0, -padding) : clean;

  const out = new Uint8Array(Math.floor((body.length * 6) / 8));
  let outIndex = 0;
  let acc = 0;
  let accBits = 0;

  for (const char of body) {
    const value = B64_LOOKUP[char];
    if (value === undefined) {
      throw new Error(`Invalid base64 character: ${JSON.stringify(char)}`);
    }
    acc = (acc << 6) | value;
    accBits += 6;
    if (accBits >= 8) {
      accBits -= 8;
      out[outIndex] = (acc >> accBits) & 0xff;
      outIndex += 1;
    }
  }

  return out.subarray(0, outIndex);
}

/** Encode bytes as lowercase hex. */
export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, '0');
  }
  return out;
}

/** Decode hex back to bytes. Throws on odd length or non-hex characters. */
export function fromHex(input: string): Uint8Array {
  const clean = input.replace(/\s/g, '');
  if (clean.length % 2 !== 0) {
    throw new Error('Hex string must have an even number of characters');
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    const byte = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) {
      throw new Error('Invalid hex string');
    }
    out[i] = byte;
  }
  return out;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** UTF-8 encode a string. */
export function toUtf8(text: string): Uint8Array {
  return encoder.encode(text);
}

/** UTF-8 decode bytes. */
export function fromUtf8(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

/** Concatenate byte arrays into one. */
export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) {
    total += part.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * Compare two byte arrays without leaking, through timing, how far along they
 * first differ. Used wherever a comparison result is attacker-visible.
 */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= (a[i] as number) ^ (b[i] as number);
  }
  return diff === 0;
}

/**
 * Overwrite a buffer holding key material. Best-effort only: a JavaScript
 * runtime is free to have copied the bytes elsewhere, and this cannot reach
 * those copies. It still removes the obvious lingering reference.
 */
export function wipe(bytes: Uint8Array): void {
  bytes.fill(0);
}

/**
 * Serialise a value to bytes deterministically, so that two clients signing
 * "the same" object produce the same signature input. `JSON.stringify` does not
 * guarantee key order across engines, so keys are sorted explicitly.
 */
export function canonicalBytes(value: unknown): Uint8Array {
  return toUtf8(canonicalJson(value));
}

/** Deterministic JSON: object keys sorted, no incidental whitespace. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}
