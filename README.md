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
apps/web            React + Vite client, deployed on Vercel.
apps/mobile         React Native client via Expo (SDK 57 / RN 0.86).
supabase/           Database schema and migrations.
```

The monorepo uses npm workspaces. `@qmail/crypto` is consumed as a workspace
dependency by both apps, so there is exactly one implementation of every
cryptographic operation.

## Stack

| Concern            | Choice                                              |
| ------------------ | --------------------------------------------------- |
| Key encapsulation  | ML-KEM-768 via `@oqs/liboqs-js` (Open Quantum Safe) |
| Signatures         | ML-DSA-65 via `@oqs/liboqs-js`                      |
| Content cipher     | AES-256-GCM (Web Crypto API)                        |
| Backend            | Supabase — Postgres, Auth, Storage, Edge Functions  |
| Web                | React 19 + Vite                                     |
| Mobile             | Expo SDK 57, React Native 0.86, Hermes              |

React Native 0.86 is required: it is past the release where WebAssembly landed
natively in Hermes, which is what lets the same WASM crypto module run unmodified
on both platforms.

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
