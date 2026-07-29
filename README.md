# Qmail

A closed, post-quantum-secure email platform. Web client and mobile app share one
backend and one cryptography module.

Mail is end-to-end encrypted with NIST-standardised post-quantum primitives:
**ML-KEM-768** (FIPS 203) for key encapsulation and **ML-DSA-65** (FIPS 204) for
signatures, with **AES-256-GCM** protecting message content. Private keys are
generated on-device and never leave it — the server stores ciphertext and public
keys only, and cannot read any message it holds.

Final-year capstone project, NMIMS MPSTME.

## Repository layout

```
packages/crypto     Shared crypto module. Written and tested once, imported
                    identically by both clients.
packages/core       Account, mailbox and contact logic. Also shared, so the
                    mailbox is reasoned about once rather than twice.
apps/web            React + Vite client, deployed on Vercel.
apps/mobile         React Native client via Expo (SDK 57 / RN 0.86).
supabase/           Schema, migrations, and the integration and QA scripts.
```

The monorepo uses npm workspaces. `@qmail/crypto` is consumed as a workspace
dependency by both apps, so there is exactly one implementation of every
cryptographic operation. `@qmail/core` sits above it and talks to a
`CryptoEngine` rather than to the crypto directly — in-process on web and Node,
and over a bridge on mobile.

## Checks

```bash
npm run test --workspace @qmail/crypto   # 80 unit and parity tests
node supabase/verify-backend.mjs         # schema and access rules, live
node supabase/qa-end-to-end.mjs          # end-to-end QA, live
```

The two live scripts write to whatever project `apps/web/.env.local` points at
and clean up after themselves.

## Stack

| Concern            | Choice                                              |
| ------------------ | --------------------------------------------------- |
| Key encapsulation  | ML-KEM-768 via `@oqs/liboqs-js` (Open Quantum Safe) |
| Signatures         | ML-DSA-65 via `@oqs/liboqs-js`                      |
| Content cipher     | AES-256-GCM (Web Crypto API)                        |
| Backend            | Supabase — Postgres, Auth, Storage, Edge Functions  |
| Web                | React 19 + Vite                                     |
| Mobile             | Expo SDK 57, React Native 0.86                      |

### How the crypto runs on mobile

React Native 0.86 ships Hermes v0.17.0, which provides **neither WebAssembly nor
WebCrypto**. This was checked on a device rather than assumed — a capability
probe in a release build reported `wasm=false` and `subtle=false`, and there is
no build flag in the React Native or Expo trees that enables either.

So on mobile the crypto module runs inside a WebView, whose Chromium engine has
both, and React Native talks to it over a message channel. No algorithm is
reimplemented and no cipher is substituted: it is the same compiled liboqs and
the same `packages/crypto` the web client uses.

Two things follow from bridging the *engine* rather than the individual
primitives. A send costs one round trip instead of a dozen KEM calls. And
decrypted private keys are created inside the WebView and stay there — React
Native asks for a message to be sealed or opened and never holds a secret key in
its own heap.

**If you are working on the mobile app**, anything that actually computes must go
through `qmail.engine`. Importing a function from `@qmail/crypto` and calling it
directly will run it in Hermes and throw. Only constants and pure JavaScript
(`ALGORITHMS`, `toBase64`) are safe to call there.

### Proving it is the same cryptography

`packages/crypto` exposes `runParityCheck()`, which replays a frozen set of
inputs and returns a digest over the actual computed outputs. Node, Chromium and
the Android WebView all produce:

```
776cc000bb5190ac01dd8ab12b294ff6a77f90aec5443080c0c1825d2619c6ac
```

Any platform that does not is running different cryptography. There is a
diagnostics screen for it in the mobile app under Settings, and at `#parity` on
web.

NIST's known-answer vectors for ML-KEM and ML-DSA cannot be replayed through this
package, because liboqs-js exposes no way to inject the deterministic seed they
depend on. Instead every post-quantum operation is cross-validated against
`@noble/post-quantum`, an independent pure-JavaScript FIPS 203/204
implementation, with keys, ciphertexts and signatures crossing in both
directions.

## Getting started

```bash
npm install
```

Build the crypto package (both apps import its compiled output):

```bash
npm run build:crypto
```

Run the web client:

```bash
npm run dev:web
```

Run the mobile client:

```bash
npm run dev:mobile
```

## Scope

This version is deliberately closed. Addresses are `handle@qmail.com` only and
mail moves between Qmail accounts — there is no SMTP interoperability with Gmail
or Outlook, which is a separate and much larger infrastructure problem. Account
keys live on the device that registered them; multi-device key sync is future
work. The primitives are pure PQC rather than hybrid composite — pairing ML-KEM
and ML-DSA with classical algorithms is a sensible later hardening step, not a
requirement here.

Search runs only across messages already downloaded and decrypted on the device.
The server holds ciphertext and cannot index it. That is the expected consequence
of genuine end-to-end encryption, not a missing feature.

## Team

Lavesh Patil · Om Dhangar · Kundan Patil
