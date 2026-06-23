import type { ByteLike } from "./types.js";

export function toBytes(value: ByteLike): Uint8Array {
  if (value instanceof Uint8Array) {
    return new Uint8Array(value);
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  return Uint8Array.from(value);
}

export function bytesToHex(bytes: Uint8Array): string {
  return `0x${Buffer.from(bytes).toString("hex")}`;
}

export function hexToBytes(value: string): Uint8Array {
  if (!value.startsWith("0x")) {
    throw new Error("hex value must start with 0x");
  }
  const hex = value.slice(2);
  if (hex.length % 2 !== 0) {
    throw new Error("hex value must have an even number of digits");
  }
  return Uint8Array.from(Buffer.from(hex, "hex"));
}

export function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

export function u32ToLeBytes(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error("value must fit in an unsigned 32-bit integer");
  }
  const output = new Uint8Array(4);
  new DataView(output.buffer).setUint32(0, value, true);
  return output;
}

export function u64ToLeBytes(value: bigint): Uint8Array {
  if (value < 0n || value > 0xffff_ffff_ffff_ffffn) {
    throw new Error("value must fit in an unsigned 64-bit integer");
  }
  const output = new Uint8Array(8);
  new DataView(output.buffer).setBigUint64(0, value, true);
  return output;
}

export function toHexQuantity(value: bigint | number | string): string {
  if (typeof value === "string") {
    if (value.startsWith("0x")) {
      return normalizeHex(value);
    }
    return toHexQuantity(BigInt(value));
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error("number value must be a non-negative safe integer");
    }
    return `0x${value.toString(16)}`;
  }
  if (value < 0n) {
    throw new Error("bigint value must be non-negative");
  }
  return `0x${value.toString(16)}`;
}

export function hexToBigInt(value: string): bigint {
  return BigInt(normalizeHex(value));
}

function normalizeHex(value: string): string {
  if (!value.startsWith("0x")) {
    throw new Error("hex value must start with 0x");
  }
  const digits = value.slice(2).replace(/^0+/, "");
  return `0x${digits === "" ? "0" : digits.toLowerCase()}`;
}
