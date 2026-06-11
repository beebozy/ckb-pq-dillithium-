import type { ByteLike, ParsedWitnessLock } from "./types.js";
export declare function buildWitnessLock(publicKey: ByteLike, signature: ByteLike): Uint8Array;
export declare function parseWitnessLock(bytes: ByteLike): ParsedWitnessLock;
