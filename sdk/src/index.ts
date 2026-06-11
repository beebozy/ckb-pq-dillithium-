export { CKB_PERSONALIZATION, LOCK_ARGS_LEN, PUBLIC_KEY_LEN, SECRET_KEY_LEN, SIGNATURE_LEN } from "./constants.js";
export { buildLockScript } from "./lock.js";
export { computeLockArgs } from "./hash.js";
export { buildWitnessLock, parseWitnessLock } from "./witness.js";
export { generateKeypair, signTxHash, verifySignature } from "./crypto.js";
export type { ByteLike, DilithiumKeypair, LockScript, ParsedWitnessLock } from "./types.js";
