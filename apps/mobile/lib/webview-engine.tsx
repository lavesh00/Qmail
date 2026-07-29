import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import type { CryptoEngine } from '@qmail/core';
import { CRYPTO_HOST_HTML } from './crypto-host.generated';

/**
 * The React Native half of the crypto bridge.
 *
 * Hermes has neither WebAssembly nor WebCrypto, so `@qmail/crypto` cannot run
 * in the app's own engine. It runs instead inside an offscreen WebView — a
 * Chromium engine, which has both — and this speaks to it over
 * `postMessage`/`onMessage`.
 *
 * Two things follow from bridging the *engine* rather than the individual
 * primitives. Round trips are per mail operation rather than per KEM call, so a
 * send costs one crossing instead of a dozen. And decrypted private keys are
 * created inside the WebView and stay there — React Native asks for a message
 * to be sealed or opened and never holds a secret key itself.
 */

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Generous, because the first call has to instantiate two WASM modules on a
 * cold emulator, and Argon2id is deliberately slow. Short enough that a wedged
 * WebView surfaces as an error rather than a spinner that never resolves.
 */
const CALL_TIMEOUT_MS = 60_000;

const pending = new Map<number, Pending>();
let nextId = 1;
let send: ((message: string) => void) | null = null;

let signalReady: () => void;
let signalFailed: (error: Error) => void;
const ready = new Promise<void>((resolve, reject) => {
  signalReady = resolve;
  signalFailed = reject;
});

function call<T>(method: string, ...params: unknown[]): Promise<T> {
  return ready.then(
    () =>
      new Promise<T>((resolve, reject) => {
        if (!send) {
          reject(new Error('The crypto bridge is not attached.'));
          return;
        }
        const id = nextId;
        nextId += 1;

        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`The crypto bridge did not answer "${method}" in time.`));
        }, CALL_TIMEOUT_MS);

        pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
        send(JSON.stringify({ id, method, params }));
      }),
  );
}

function receive(raw: string): void {
  let payload: { id?: number; ok?: boolean; result?: unknown; error?: string; ready?: boolean };
  try {
    payload = JSON.parse(raw);
  } catch {
    return;
  }

  if (payload.ready) {
    signalReady();
    return;
  }

  if (typeof payload.id !== 'number') {
    return;
  }

  const entry = pending.get(payload.id);
  if (!entry) {
    return;
  }
  pending.delete(payload.id);
  clearTimeout(entry.timer);

  if (payload.ok) {
    entry.resolve(payload.result);
  } else {
    entry.reject(new Error(payload.error ?? 'The crypto bridge reported an unknown failure.'));
  }
}

/**
 * Mount once, above anything that touches crypto. It renders nothing visible;
 * the WebView exists purely as an execution context.
 */
export function CryptoHost() {
  const ref = useRef<WebView>(null);

  useEffect(() => {
    send = (message) => ref.current?.postMessage(message);
    return () => {
      send = null;
    };
  }, []);

  return (
    <View style={styles.hidden} pointerEvents="none">
      <WebView
        ref={ref}
        source={{ html: CRYPTO_HOST_HTML }}
        originWhitelist={['*']}
        javaScriptEnabled
        // The document is inline and its CSP forbids network access, so there
        // is nothing to load and nothing it could reach out to.
        onMessage={(event) => receive(event.nativeEvent.data)}
        onError={() => signalFailed(new Error('The crypto bridge failed to load.'))}
        // Errors inside the host surface as rejected calls; without this a
        // syntax error in the bundle would just look like a hang.
        onHttpError={() => signalFailed(new Error('The crypto bridge failed to load.'))}
        androidLayerType="software"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hidden: {
    position: 'absolute',
    width: 0,
    height: 0,
    opacity: 0,
  },
});

/** A CryptoEngine backed by the WebView mounted by `<CryptoHost />`. */
export function createWebViewEngine(): CryptoEngine {
  return {
    warmUp: () => call<void>('warmUp'),
    createIdentity: () => call('createIdentity'),
    exportKeystore: (password) => call('exportKeystore', password),
    importKeystore: (keystore, password) => call<void>('importKeystore', keystore, password),
    lock: () => call<void>('lock'),
    isUnlocked: () => call<boolean>('isUnlocked'),
    fingerprint: (keys) => call<string>('fingerprint', keys),
    seal: (input) => call('seal', input),
    open: (input) => call('open', input),
    verifyEnvelope: (envelope, key) => call<boolean>('verifyEnvelope', envelope, key),
    parityCheck: (platform) => call('parityCheck', platform),
  };
}
