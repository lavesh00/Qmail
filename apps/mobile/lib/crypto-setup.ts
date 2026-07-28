/**
 * Installs the host capabilities @qmail/crypto needs, before any crypto runs.
 *
 * React Native does not ship the WebCrypto API that the browser and Node both
 * provide, so whatever is missing has to be supplied here. Nothing about the
 * algorithms changes — this only hands the shared module an implementation of
 * the same interface it already expects, which is what keeps one crypto
 * implementation rather than two.
 */
import { setCryptoProvider, type CryptoProvider } from '@qmail/crypto';

export interface CryptoCapabilities {
  hasGlobalCrypto: boolean;
  hasGetRandomValues: boolean;
  hasSubtle: boolean;
  hasWebAssembly: boolean;
  wasmCanInstantiate: boolean;
  provider: string;
  notes: string[];
}

/** What the runtime offers before we touch anything. Reported on the diagnostics screen. */
export function probeCapabilities(): CryptoCapabilities {
  const g = globalThis as {
    crypto?: { getRandomValues?: unknown; subtle?: unknown };
    WebAssembly?: typeof WebAssembly;
  };
  const notes: string[] = [];

  let wasmCanInstantiate = false;
  if (typeof g.WebAssembly !== 'undefined') {
    try {
      // The smallest valid WebAssembly module: magic number plus version.
      const empty = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
      wasmCanInstantiate = g.WebAssembly.validate(empty);
    } catch (error) {
      notes.push(`WebAssembly.validate threw: ${(error as Error).message}`);
    }
  } else {
    notes.push('WebAssembly is not defined on this runtime.');
  }

  return {
    hasGlobalCrypto: typeof g.crypto !== 'undefined',
    hasGetRandomValues: typeof g.crypto?.getRandomValues === 'function',
    hasSubtle: typeof g.crypto?.subtle !== 'undefined',
    hasWebAssembly: typeof g.WebAssembly !== 'undefined',
    wasmCanInstantiate,
    provider: 'unset',
    notes,
  };
}

let installed = false;

/**
 * Install a WebCrypto provider. Safe to call more than once.
 *
 * Returns which implementation ended up in use, so the diagnostics screen can
 * say plainly whether the platform supplied it or a polyfill did.
 */
export function installCrypto(): string {
  const g = globalThis as { crypto?: CryptoProvider };

  if (g.crypto?.subtle && typeof g.crypto.getRandomValues === 'function') {
    if (!installed) {
      setCryptoProvider(g.crypto);
      installed = true;
    }
    return 'runtime WebCrypto';
  }

  throw new Error(
    'This runtime provides no WebCrypto. A polyfill must be installed before @qmail/crypto is used.',
  );
}
