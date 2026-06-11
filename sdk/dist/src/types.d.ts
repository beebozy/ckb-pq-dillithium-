export type ByteLike = Uint8Array | ArrayBuffer | ArrayLike<number>;
export interface DilithiumKeypair {
    publicKey: Uint8Array;
    secretKey: Uint8Array;
}
export interface ParsedWitnessLock {
    publicKey: Uint8Array;
    signature: Uint8Array;
}
export interface LockScript {
    codeHash: string;
    hashType: string;
    args: string;
}
