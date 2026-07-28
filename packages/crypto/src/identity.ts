/**
 * Identity generation and fingerprinting.
 */
import { sha256 } from './aes.js';
import { concatBytes, toHex } from './bytes.js';
import { generateKemKeyPair, generateSigKeyPair } from './pqc.js';
import type { Identity, PublicIdentity } from './types.js';

/**
 * Generate a fresh Qmail identity: one ML-KEM-768 keypair for receiving mail and
 * one ML-DSA-65 keypair for signing it.
 *
 * This runs entirely on the device, before anything touches the network.
 */
export async function generateIdentity(): Promise<Identity> {
  const [kem, sig] = await Promise.all([generateKemKeyPair(), generateSigKeyPair()]);
  return { kem, sig };
}

/**
 * Compute the fingerprint of a public identity: SHA-256 over both public keys.
 *
 * Two users who read this aloud to each other over a channel Qmail does not
 * control can confirm they hold each other's real keys and not a server-supplied
 * substitute. Binding both keys into one digest matters — a fingerprint covering
 * only the KEM key would let a signing key be swapped without the fingerprint
 * changing.
 */
export async function fingerprint(identity: PublicIdentity): Promise<Uint8Array> {
  return sha256(concatBytes(identity.kemPublicKey, identity.sigPublicKey));
}

/**
 * Render a fingerprint for a human to read out: uppercase hex in groups of
 * four. Grouping is what makes it checkable by eye; an unbroken 64-character
 * string is not.
 */
export function formatFingerprint(digest: Uint8Array): string {
  const hex = toHex(digest).toUpperCase();
  const groups: string[] = [];
  for (let i = 0; i < hex.length; i += 4) {
    groups.push(hex.slice(i, i + 4));
  }
  return groups.join(' ');
}

/** Convenience: compute and format a public identity's fingerprint in one step. */
export async function identityFingerprint(identity: PublicIdentity): Promise<string> {
  return formatFingerprint(await fingerprint(identity));
}
