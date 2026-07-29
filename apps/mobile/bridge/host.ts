/**
 * The crypto host. This runs inside a WebView, not in React Native.
 *
 * Hermes provides neither WebAssembly nor WebCrypto, so `@qmail/crypto` cannot
 * execute in the app's own JavaScript engine. The WebView's engine is Chromium,
 * which has both, so the module runs here unmodified and the app talks to it
 * over a message channel.
 *
 * The important consequence of putting the *engine* behind the channel rather
 * than the individual primitives: decrypted private keys are created here, held
 * here, and never serialised back across the boundary. React Native asks for a
 * message to be sealed or opened; it never holds a secret key.
 */
import { createLocalEngine } from '@qmail/core/local-engine';

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage(message: string): void };
  }
}

const engine = createLocalEngine();

interface Request {
  id: number;
  method: string;
  params?: unknown[];
}

function reply(payload: unknown): void {
  const message = JSON.stringify(payload);
  if (window.ReactNativeWebView) {
    window.ReactNativeWebView.postMessage(message);
  }
}

/**
 * Methods the app may call. Listed explicitly rather than dispatched by lookup
 * on the engine object, so the channel cannot be talked into invoking something
 * that was never meant to be reachable from outside.
 */
const METHODS: Record<string, (...args: never[]) => Promise<unknown>> = {
  warmUp: () => engine.warmUp(),
  createIdentity: () => engine.createIdentity(),
  exportKeystore: (password: never) => engine.exportKeystore(password),
  importKeystore: (keystore: never, password: never) => engine.importKeystore(keystore, password),
  lock: () => engine.lock(),
  isUnlocked: () => engine.isUnlocked(),
  fingerprint: (keys: never) => engine.fingerprint(keys),
  seal: (input: never) => engine.seal(input),
  open: (input: never) => engine.open(input),
  verifyEnvelope: (envelope: never, key: never) => engine.verifyEnvelope(envelope, key),
  parityCheck: (platform: never) => engine.parityCheck(platform),
};

async function handle(raw: string): Promise<void> {
  let request: Request;
  try {
    request = JSON.parse(raw) as Request;
  } catch {
    return;
  }

  const method = METHODS[request.method];
  if (!method) {
    reply({ id: request.id, ok: false, error: `Unknown method: ${request.method}` });
    return;
  }

  try {
    const result = await method(...((request.params ?? []) as never[]));
    reply({ id: request.id, ok: true, result: result ?? null });
  } catch (error) {
    reply({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// react-native-webview delivers injected messages on `window` on Android and on
// `document` on iOS, depending on version. Listening to both is the portable
// thing to do and costs nothing.
function onMessage(event: MessageEvent | Event): void {
  const data = (event as MessageEvent).data;
  if (typeof data === 'string') {
    void handle(data);
  }
}

window.addEventListener('message', onMessage);
document.addEventListener('message', onMessage as EventListener);

// Announce readiness. The app queues calls until it sees this, so a request
// made during startup is not dropped on the floor.
reply({ ready: true });
