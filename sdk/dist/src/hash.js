import { LOCK_ARGS_LEN } from "./constants.js";
import { getWasmApi } from "./crypto.js";
import { toBytes } from "./util.js";
export async function computeLockArgs(publicKey) {
    const bytes = toBytes(publicKey);
    const api = await getWasmApi();
    const output = api.hashPubkey(bytes);
    if (output.length !== LOCK_ARGS_LEN) {
        throw new Error(`lock args must be ${LOCK_ARGS_LEN} bytes`);
    }
    return output;
}
