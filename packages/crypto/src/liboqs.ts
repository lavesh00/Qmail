/**
 * A minimal loader and calling convention for the vendored liboqs WASM builds.
 *
 * This replaces `@oqs/liboqs-js`'s own loader, which resolves its WASM build
 * through a dynamic import with a computed path — something Metro refuses to
 * bundle and other bundlers only survive by including all 194 algorithm builds.
 * Importing the two builds we use directly makes the dependency static and
 * legible to every bundler.
 *
 * What is reimplemented here is the marshalling: copy bytes into the WASM heap,
 * call the liboqs C entry point, copy the result out, free. The cryptography is
 * entirely liboqs's, running from the same compiled artefact the upstream
 * package ships. The cross-implementation tests against @noble/post-quantum
 * confirm the marshalling is right.
 */
import createKemModule from '../wasm/ml-kem-768.min.js';
import createSigModule from '../wasm/ml-dsa-65.min.js';
import type { LibOqsKemModule } from '../wasm/ml-kem-768.min.js';
import type { LibOqsSigModule } from '../wasm/ml-dsa-65.min.js';
import { SIZES } from './types.js';

/** Emscripten stores a `size_t` as 64 bits in these builds. */
const SIZE_T = 'i64';

/** Write a NUL-terminated UTF-8 string into the heap. Caller frees. */
function allocString(module: LibOqsKemModule | LibOqsSigModule, text: string): number {
  const length = module.lengthBytesUTF8(text);
  const ptr = module._malloc(length + 1);
  module.stringToUTF8(text, ptr, length + 1);
  return ptr;
}

/** Copy `length` bytes out of the WASM heap into a detached array. */
function readHeap(module: LibOqsKemModule | LibOqsSigModule, ptr: number, length: number): Uint8Array {
  const out = new Uint8Array(length);
  out.set(module.HEAPU8.subarray(ptr, ptr + length));
  return out;
}

export interface KemBackend {
  generateKeyPair(): { publicKey: Uint8Array; secretKey: Uint8Array };
  encapsulate(publicKey: Uint8Array): { ciphertext: Uint8Array; sharedSecret: Uint8Array };
  decapsulate(ciphertext: Uint8Array, secretKey: Uint8Array): Uint8Array;
  destroy(): void;
}

export interface SigBackend {
  generateKeyPair(): { publicKey: Uint8Array; secretKey: Uint8Array };
  sign(message: Uint8Array, secretKey: Uint8Array): Uint8Array;
  verify(message: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): boolean;
  destroy(): void;
}

/** Instantiate ML-KEM-768. */
export async function loadKem(): Promise<KemBackend> {
  const module = await createKemModule();
  module._OQS_init();

  const namePtr = allocString(module, 'ML-KEM-768');
  const kem = module._OQS_KEM_new(namePtr);
  module._free(namePtr);

  if (!kem) {
    throw new Error('liboqs could not create an ML-KEM-768 instance');
  }

  let destroyed = false;
  const assertLive = () => {
    if (destroyed) {
      throw new Error('ML-KEM-768 instance has been destroyed');
    }
  };

  return {
    generateKeyPair() {
      assertLive();
      const pk = module._malloc(SIZES.kemPublicKey);
      const sk = module._malloc(SIZES.kemSecretKey);
      try {
        const status = module._OQS_KEM_keypair(kem, pk, sk);
        if (status !== 0) {
          throw new Error(`ML-KEM-768 key generation failed (liboqs status ${status})`);
        }
        return {
          publicKey: readHeap(module, pk, SIZES.kemPublicKey),
          secretKey: readHeap(module, sk, SIZES.kemSecretKey),
        };
      } finally {
        module._free(pk);
        module._free(sk);
      }
    },

    encapsulate(publicKey) {
      assertLive();
      const pk = module._malloc(SIZES.kemPublicKey);
      const ct = module._malloc(SIZES.kemCiphertext);
      const ss = module._malloc(SIZES.kemSharedSecret);
      try {
        module.HEAPU8.set(publicKey, pk);
        const status = module._OQS_KEM_encaps(kem, ct, ss, pk);
        if (status !== 0) {
          throw new Error(`ML-KEM-768 encapsulation failed (liboqs status ${status})`);
        }
        return {
          ciphertext: readHeap(module, ct, SIZES.kemCiphertext),
          sharedSecret: readHeap(module, ss, SIZES.kemSharedSecret),
        };
      } finally {
        module._free(pk);
        module._free(ct);
        module._free(ss);
      }
    },

    decapsulate(ciphertext, secretKey) {
      assertLive();
      const ct = module._malloc(SIZES.kemCiphertext);
      const sk = module._malloc(SIZES.kemSecretKey);
      const ss = module._malloc(SIZES.kemSharedSecret);
      try {
        module.HEAPU8.set(ciphertext, ct);
        module.HEAPU8.set(secretKey, sk);
        const status = module._OQS_KEM_decaps(kem, ss, ct, sk);
        if (status !== 0) {
          throw new Error(`ML-KEM-768 decapsulation failed (liboqs status ${status})`);
        }
        return readHeap(module, ss, SIZES.kemSharedSecret);
      } finally {
        module._free(ct);
        module._free(sk);
        module._free(ss);
      }
    },

    destroy() {
      if (!destroyed) {
        module._OQS_KEM_free(kem);
        destroyed = true;
      }
    },
  };
}

/** Instantiate ML-DSA-65. */
export async function loadSig(): Promise<SigBackend> {
  const module = await createSigModule();
  module._OQS_init();

  const namePtr = allocString(module, 'ML-DSA-65');
  const sig = module._OQS_SIG_new(namePtr);
  module._free(namePtr);

  if (!sig) {
    throw new Error('liboqs could not create an ML-DSA-65 instance');
  }

  let destroyed = false;
  const assertLive = () => {
    if (destroyed) {
      throw new Error('ML-DSA-65 instance has been destroyed');
    }
  };

  return {
    generateKeyPair() {
      assertLive();
      const pk = module._malloc(SIZES.sigPublicKey);
      const sk = module._malloc(SIZES.sigSecretKey);
      try {
        const status = module._OQS_SIG_keypair(sig, pk, sk);
        if (status !== 0) {
          throw new Error(`ML-DSA-65 key generation failed (liboqs status ${status})`);
        }
        return {
          publicKey: readHeap(module, pk, SIZES.sigPublicKey),
          secretKey: readHeap(module, sk, SIZES.sigSecretKey),
        };
      } finally {
        module._free(pk);
        module._free(sk);
      }
    },

    sign(message, secretKey) {
      assertLive();
      const sigPtr = module._malloc(SIZES.signature);
      // liboqs reads the buffer capacity from here and writes the actual length
      // back into it. ML-DSA signatures are fixed length in practice, but the
      // API is written for schemes where they are not.
      const sigLenPtr = module._malloc(8);
      const msgPtr = module._malloc(Math.max(message.length, 1));
      const skPtr = module._malloc(SIZES.sigSecretKey);
      try {
        module.HEAPU8.set(message, msgPtr);
        module.HEAPU8.set(secretKey, skPtr);
        module.setValue(sigLenPtr, SIZES.signature, SIZE_T);

        const status = module._OQS_SIG_sign(
          sig,
          sigPtr,
          sigLenPtr,
          msgPtr,
          message.length,
          skPtr,
        );
        if (status !== 0) {
          throw new Error(`ML-DSA-65 signing failed (liboqs status ${status})`);
        }
        return readHeap(module, sigPtr, module.getValue(sigLenPtr, 'i32'));
      } finally {
        module._free(sigPtr);
        module._free(sigLenPtr);
        module._free(msgPtr);
        module._free(skPtr);
      }
    },

    verify(message, signature, publicKey) {
      assertLive();
      const msgPtr = module._malloc(Math.max(message.length, 1));
      const sigPtr = module._malloc(Math.max(signature.length, 1));
      const pkPtr = module._malloc(SIZES.sigPublicKey);
      try {
        module.HEAPU8.set(message, msgPtr);
        module.HEAPU8.set(signature, sigPtr);
        module.HEAPU8.set(publicKey, pkPtr);

        return (
          module._OQS_SIG_verify(
            sig,
            msgPtr,
            message.length,
            sigPtr,
            signature.length,
            pkPtr,
          ) === 0
        );
      } finally {
        module._free(msgPtr);
        module._free(sigPtr);
        module._free(pkPtr);
      }
    },

    destroy() {
      if (!destroyed) {
        module._OQS_SIG_free(sig);
        destroyed = true;
      }
    },
  };
}
