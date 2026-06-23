import type { ByteLike } from "./types.js";
export declare function toBytes(value: ByteLike): Uint8Array;
export declare function bytesToHex(bytes: Uint8Array): string;
export declare function hexToBytes(value: string): Uint8Array;
export declare function concatBytes(...chunks: Uint8Array[]): Uint8Array;
export declare function u32ToLeBytes(value: number): Uint8Array;
export declare function u64ToLeBytes(value: bigint): Uint8Array;
export declare function toHexQuantity(value: bigint | number | string): string;
export declare function hexToBigInt(value: string): bigint;
