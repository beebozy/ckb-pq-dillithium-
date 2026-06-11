import { bytesToHex } from "./util.js";
import { computeLockArgs } from "./hash.js";
export async function buildLockScript(input) {
    const args = await computeLockArgs(input.publicKey);
    return {
        codeHash: input.codeHash,
        hashType: input.hashType,
        args: bytesToHex(args),
    };
}
