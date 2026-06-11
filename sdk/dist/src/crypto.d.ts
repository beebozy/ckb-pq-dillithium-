import type { ByteLike, DilithiumKeypair } from "./types.js";
export interface WasmApi {
    generateKeypair(): DilithiumKeypair;
    hashPubkey(publicKey: Uint8Array): Uint8Array;
    signMessage(secretKey: Uint8Array, message: Uint8Array): Uint8Array;
    verifySignature(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean;
}
export declare function getWasmApi(): Promise<WasmApi>;
export declare function generateKeypair(): Promise<DilithiumKeypair>;
export declare function signTxHash(secretKey: ByteLike, txHash: ByteLike): Promise<Uint8Array>;
export declare function verifySignature(publicKey: ByteLike, txHash: ByteLike, signature: ByteLike): Promise<boolean>;
