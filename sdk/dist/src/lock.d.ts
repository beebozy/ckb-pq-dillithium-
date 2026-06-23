import type { ByteLike, LockScript, ScriptHashType } from "./types.js";
export declare function buildLockScript(input: {
    codeHash: string;
    hashType: ScriptHashType;
    publicKey: ByteLike;
}): Promise<LockScript>;
