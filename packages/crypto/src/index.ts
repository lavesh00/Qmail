/**
 * @qmail/crypto — the single crypto implementation shared by the web and
 * mobile clients.
 *
 * Phase 0 placeholder: the real ML-KEM-768 / ML-DSA-65 / AES-256-GCM surface
 * lands in Phase 1, after the scaffolding is confirmed to run on both
 * platforms.
 */
export const CRYPTO_PACKAGE_VERSION = '0.1.0';

/** Algorithms this module is pinned to. Both are NIST-standardised. */
export const ALGORITHMS = {
  kem: 'ML-KEM-768',
  signature: 'ML-DSA-65',
  cipher: 'AES-256-GCM',
} as const;
