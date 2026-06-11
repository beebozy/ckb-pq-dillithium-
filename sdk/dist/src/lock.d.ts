import type { ByteLike, LockScript } from "./types.js";
export declare function buildLockScript(input: {
    codeHash: string;
    hashType: string;
    publicKey: ByteLike;
}): Promise<LockScript>;
