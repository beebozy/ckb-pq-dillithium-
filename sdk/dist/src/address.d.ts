import type { DecodedCkbAddress, LockScript, Network } from "./types.js";
export declare function encodeCkbAddress(script: LockScript, network: Network): string;
export declare function decodeCkbAddress(address: string): DecodedCkbAddress;
export declare function scriptId(script: LockScript): string;
