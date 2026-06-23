import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { LOCK_ARGS_LEN, PUBLIC_KEY_LEN, SECRET_KEY_LEN, SIGNATURE_LEN } from "./constants.js";
import { toBytes } from "./util.js";
import type { ByteLike, DilithiumKeypair } from "./types.js";

const ERRORS: Record<number, string> = {
  1: "invalid input length",
  2: "key generation failed",
  3: "key deserialization failed",
  4: "signature operation failed",
};

interface WasmExports {
  memory: WebAssembly.Memory;
  alloc(length: number): number;
  dealloc(ptr: number, len: number): void;
  pk_len(): number;
  sk_len(): number;
  sig_len(): number;
  args_len(): number;
  generate_keypair_from_seed(seedPtr: number, seedLen: number, publicKeyOutPtr: number, secretKeyOutPtr: number): number;
  hash_pubkey(pubkeyPtr: number, pubkeyLen: number, outPtr: number): number;
  ckb_hash(dataPtr: number, dataLen: number, outPtr: number): number;
  sign_message_with_seed(secretKeyPtr: number, secretKeyLen: number, messagePtr: number, messageLen: number, seedPtr: number, seedLen: number, outPtr: number): number;
  verify_signature(publicKeyPtr: number, publicKeyLen: number, messagePtr: number, messageLen: number, signaturePtr: number, signatureLen: number): number;
}

export interface WasmApi {
  generateKeypair(): DilithiumKeypair;
  hashPubkey(publicKey: Uint8Array): Uint8Array;
  ckbHash(data: Uint8Array): Uint8Array;
  signMessage(secretKey: Uint8Array, message: Uint8Array): Uint8Array;
  verifySignature(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean;
}

let wasmApiPromise: Promise<WasmApi> | undefined;

function wasmPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "../wasm/dillithium_wasm.wasm");
}

function encodeError(code: number): never {
  throw new Error(ERRORS[code] ?? `wasm error ${code}`);
}

function readBytes(memory: WebAssembly.Memory, ptr: number, len: number): Uint8Array {
  return new Uint8Array(memory.buffer.slice(ptr, ptr + len));
}

function withInput<T>(exports: WasmExports, bytes: Uint8Array, callback: (ptr: number) => T): T {
  const ptr = exports.alloc(bytes.length);
  const memory = new Uint8Array(exports.memory.buffer);
  memory.set(bytes, ptr);
  try {
    return callback(ptr);
  } finally {
    exports.dealloc(ptr, bytes.length);
  }
}

async function instantiateWasm(): Promise<WasmApi> {
  let moduleBytes: Buffer;
  try {
    moduleBytes = await readFile(wasmPath());
  } catch (error) {
    throw new Error(`Unable to load bundled wasm at ${wasmPath()}. The SDK package may be incomplete.`, { cause: error });
  }
  const instantiated = await WebAssembly.instantiate(moduleBytes as BufferSource, {});
  const exports = instantiated.instance.exports as unknown as WasmExports;

  return {
    generateKeypair(): DilithiumKeypair {
      const seed = randomBytes(32);
      const publicKeyPtr = exports.alloc(PUBLIC_KEY_LEN);
      const secretKeyPtr = exports.alloc(SECRET_KEY_LEN);
      try {
        return withInput(exports, seed, (seedPtr) => {
          const status = exports.generate_keypair_from_seed(seedPtr, seed.length, publicKeyPtr, secretKeyPtr);
          if (status !== 0) {
            encodeError(status);
          }
          return {
            publicKey: readBytes(exports.memory, publicKeyPtr, PUBLIC_KEY_LEN),
            secretKey: readBytes(exports.memory, secretKeyPtr, SECRET_KEY_LEN),
          };
        }) as DilithiumKeypair;
      } finally {
        exports.dealloc(publicKeyPtr, PUBLIC_KEY_LEN);
        exports.dealloc(secretKeyPtr, SECRET_KEY_LEN);
      }
    },
    hashPubkey(publicKey: Uint8Array): Uint8Array {
      const outputPtr = exports.alloc(exports.args_len());
      try {
        return withInput(exports, publicKey, (publicKeyPtr) => {
          const status = exports.hash_pubkey(publicKeyPtr, publicKey.length, outputPtr);
          if (status !== 0) {
            encodeError(status);
          }
          return readBytes(exports.memory, outputPtr, exports.args_len());
        }) as Uint8Array;
      } finally {
        exports.dealloc(outputPtr, exports.args_len());
      }
    },
    ckbHash(data: Uint8Array): Uint8Array {
      const outputPtr = exports.alloc(exports.args_len());
      try {
        return withInput(exports, data, (dataPtr) => {
          const status = exports.ckb_hash(dataPtr, data.length, outputPtr);
          if (status !== 0) {
            encodeError(status);
          }
          return readBytes(exports.memory, outputPtr, exports.args_len());
        }) as Uint8Array;
      } finally {
        exports.dealloc(outputPtr, exports.args_len());
      }
    },
    signMessage(secretKey: Uint8Array, message: Uint8Array): Uint8Array {
      const seed = randomBytes(32);
      const outputPtr = exports.alloc(exports.sig_len());
      try {
        return withInput(exports, secretKey, (secretKeyPtr) =>
          withInput(exports, message, (messagePtr) =>
            withInput(exports, seed, (seedPtr) => {
              const status = exports.sign_message_with_seed(
                secretKeyPtr,
                secretKey.length,
                messagePtr,
                message.length,
                seedPtr,
                seed.length,
                outputPtr,
              );
              if (status !== 0) {
                encodeError(status);
              }
              return readBytes(exports.memory, outputPtr, SIGNATURE_LEN);
            }) as Uint8Array,
          ) as Uint8Array,
        ) as Uint8Array;
      } finally {
        exports.dealloc(outputPtr, exports.sig_len());
      }
    },
    verifySignature(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean {
      return withInput(exports, publicKey, (publicKeyPtr) =>
        withInput(exports, message, (messagePtr) =>
          withInput(exports, signature, (signaturePtr) => {
            const status = exports.verify_signature(
              publicKeyPtr,
              publicKey.length,
              messagePtr,
              message.length,
              signaturePtr,
              signature.length,
            );
            if (status === 0) {
              return true;
            }
            if (status === 4) {
              return false;
            }
            encodeError(status);
          }) as boolean,
        ) as boolean,
      ) as boolean;
    },
  };
}

export async function getWasmApi(): Promise<WasmApi> {
  wasmApiPromise ??= instantiateWasm();
  return wasmApiPromise;
}

export async function generateKeypair(): Promise<DilithiumKeypair> {
  const api = await getWasmApi();
  return api.generateKeypair();
}

export async function ckbHash(data: ByteLike): Promise<Uint8Array> {
  const dataBytes = toBytes(data);
  const api = await getWasmApi();
  const output = api.ckbHash(dataBytes);
  if (output.length !== LOCK_ARGS_LEN) {
    throw new Error(`CKB hash must be ${LOCK_ARGS_LEN} bytes`);
  }
  return output;
}

export async function signTxHash(secretKey: ByteLike, txHash: ByteLike): Promise<Uint8Array> {
  const secretKeyBytes = toBytes(secretKey);
  const messageBytes = toBytes(txHash);
  if (secretKeyBytes.length !== SECRET_KEY_LEN) {
    throw new Error(`secret key must be ${SECRET_KEY_LEN} bytes`);
  }
  const api = await getWasmApi();
  return api.signMessage(secretKeyBytes, messageBytes);
}

export async function verifySignature(publicKey: ByteLike, txHash: ByteLike, signature: ByteLike): Promise<boolean> {
  const publicKeyBytes = toBytes(publicKey);
  const messageBytes = toBytes(txHash);
  const signatureBytes = toBytes(signature);
  if (publicKeyBytes.length !== PUBLIC_KEY_LEN) {
    throw new Error(`public key must be ${PUBLIC_KEY_LEN} bytes`);
  }
  if (signatureBytes.length !== SIGNATURE_LEN) {
    throw new Error(`signature must be ${SIGNATURE_LEN} bytes`);
  }
  const api = await getWasmApi();
  return api.verifySignature(publicKeyBytes, messageBytes, signatureBytes);
}
