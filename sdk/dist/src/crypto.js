import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PUBLIC_KEY_LEN, SECRET_KEY_LEN, SIGNATURE_LEN } from "./constants.js";
import { toBytes } from "./util.js";
const ERRORS = {
    1: "invalid input length",
    2: "key generation failed",
    3: "key deserialization failed",
    4: "signature operation failed",
};
let wasmApiPromise;
function wasmPath() {
    const here = dirname(fileURLToPath(import.meta.url));
    return resolve(here, "../wasm/dillithium_wasm.wasm");
}
function encodeError(code) {
    throw new Error(ERRORS[code] ?? `wasm error ${code}`);
}
function readBytes(memory, ptr, len) {
    return new Uint8Array(memory.buffer.slice(ptr, ptr + len));
}
function withInput(exports, bytes, callback) {
    const ptr = exports.alloc(bytes.length);
    const memory = new Uint8Array(exports.memory.buffer);
    memory.set(bytes, ptr);
    try {
        return callback(ptr);
    }
    finally {
        exports.dealloc(ptr, bytes.length);
    }
}
async function instantiateWasm() {
    let moduleBytes;
    try {
        moduleBytes = await readFile(wasmPath());
    }
    catch (error) {
        throw new Error(`Unable to load bundled wasm at ${wasmPath()}. The SDK package may be incomplete.`, { cause: error });
    }
    const instantiated = await WebAssembly.instantiate(moduleBytes, {});
    const exports = instantiated.instance.exports;
    return {
        generateKeypair() {
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
                });
            }
            finally {
                exports.dealloc(publicKeyPtr, PUBLIC_KEY_LEN);
                exports.dealloc(secretKeyPtr, SECRET_KEY_LEN);
            }
        },
        hashPubkey(publicKey) {
            const outputPtr = exports.alloc(exports.args_len());
            try {
                return withInput(exports, publicKey, (publicKeyPtr) => {
                    const status = exports.hash_pubkey(publicKeyPtr, publicKey.length, outputPtr);
                    if (status !== 0) {
                        encodeError(status);
                    }
                    return readBytes(exports.memory, outputPtr, exports.args_len());
                });
            }
            finally {
                exports.dealloc(outputPtr, exports.args_len());
            }
        },
        signMessage(secretKey, message) {
            const seed = randomBytes(32);
            const outputPtr = exports.alloc(exports.sig_len());
            try {
                return withInput(exports, secretKey, (secretKeyPtr) => withInput(exports, message, (messagePtr) => withInput(exports, seed, (seedPtr) => {
                    const status = exports.sign_message_with_seed(secretKeyPtr, secretKey.length, messagePtr, message.length, seedPtr, seed.length, outputPtr);
                    if (status !== 0) {
                        encodeError(status);
                    }
                    return readBytes(exports.memory, outputPtr, SIGNATURE_LEN);
                })));
            }
            finally {
                exports.dealloc(outputPtr, exports.sig_len());
            }
        },
        verifySignature(publicKey, message, signature) {
            return withInput(exports, publicKey, (publicKeyPtr) => withInput(exports, message, (messagePtr) => withInput(exports, signature, (signaturePtr) => {
                const status = exports.verify_signature(publicKeyPtr, publicKey.length, messagePtr, message.length, signaturePtr, signature.length);
                if (status === 0) {
                    return true;
                }
                if (status === 4) {
                    return false;
                }
                encodeError(status);
            })));
        },
    };
}
export async function getWasmApi() {
    wasmApiPromise ??= instantiateWasm();
    return wasmApiPromise;
}
export async function generateKeypair() {
    const api = await getWasmApi();
    return api.generateKeypair();
}
export async function signTxHash(secretKey, txHash) {
    const secretKeyBytes = toBytes(secretKey);
    const messageBytes = toBytes(txHash);
    if (secretKeyBytes.length !== SECRET_KEY_LEN) {
        throw new Error(`secret key must be ${SECRET_KEY_LEN} bytes`);
    }
    const api = await getWasmApi();
    return api.signMessage(secretKeyBytes, messageBytes);
}
export async function verifySignature(publicKey, txHash, signature) {
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
