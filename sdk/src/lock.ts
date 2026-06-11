import { bytesToHex } from "./util.js";
import { computeLockArgs } from "./hash.js";
import type { ByteLike, LockScript } from "./types.js";

export async function buildLockScript(input: {
  codeHash: string;
  hashType: string;
  publicKey: ByteLike;
}): Promise<LockScript> {
  const args = await computeLockArgs(input.publicKey);
  return {
    codeHash: input.codeHash,
    hashType: input.hashType,
    args: bytesToHex(args),
  };
}
