import { createHash } from "node:crypto";

import { bytesToHex, concatBytes, hexToBytes } from "./util.js";
import type { DecodedCkbAddress, LockScript, Network, ScriptHashType } from "./types.js";

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const CHARSET_MAP = new Map(Array.from(CHARSET).map((char, index) => [char, index]));
const BECH32M_CONST = 0x2bc830a3;
const FULL_ADDRESS_TYPE = 0x00;
const CODE_HASH_BYTES = 32;

function hrpForNetwork(network: Network): "ckb" | "ckt" {
  return network === "mainnet" ? "ckb" : "ckt";
}

function networkForHrp(hrp: string): "mainnet" | "testnet" {
  if (hrp === "ckb") {
    return "mainnet";
  }
  if (hrp === "ckt") {
    return "testnet";
  }
  throw new Error(`unsupported CKB address prefix: ${hrp}`);
}

function hashTypeToByte(hashType: ScriptHashType): number {
  if (hashType === "data") {
    return 0;
  }
  if (hashType === "type") {
    return 1;
  }
  if (!hashType.startsWith("data")) {
    throw new Error(`unsupported hash type: ${hashType}`);
  }
  const version = Number(hashType.slice(4));
  if (!Number.isInteger(version) || version < 1 || version > 127) {
    throw new Error(`unsupported hash type: ${hashType}`);
  }
  return version << 1;
}

function byteToHashType(value: number): ScriptHashType {
  if (value === 0) {
    return "data";
  }
  if (value === 1) {
    return "type";
  }
  if (value > 1 && value <= 254 && value % 2 === 0) {
    return `data${value >> 1}`;
  }
  throw new Error(`unsupported hash type byte: ${value}`);
}

function polymod(values: number[]): number {
  const generators = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let checksum = 1;
  for (const value of values) {
    const top = checksum >> 25;
    checksum = ((checksum & 0x1ffffff) << 5) ^ value;
    for (let index = 0; index < generators.length; index += 1) {
      if ((top >> index) & 1) {
        checksum ^= generators[index];
      }
    }
  }
  return checksum >>> 0;
}

function hrpExpand(hrp: string): number[] {
  const result: number[] = [];
  for (const char of hrp) {
    result.push(char.charCodeAt(0) >> 5);
  }
  result.push(0);
  for (const char of hrp) {
    result.push(char.charCodeAt(0) & 31);
  }
  return result;
}

function createChecksum(hrp: string, data: number[]): number[] {
  const values = [...hrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0];
  const mod = polymod(values) ^ BECH32M_CONST;
  return Array.from({ length: 6 }, (_, index) => (mod >> (5 * (5 - index))) & 31);
}

function verifyChecksum(hrp: string, data: number[]): boolean {
  return polymod([...hrpExpand(hrp), ...data]) === BECH32M_CONST;
}

function convertBits(data: Uint8Array | number[], fromBits: number, toBits: number, pad: boolean): number[] {
  let accumulator = 0;
  let bits = 0;
  const result: number[] = [];
  const maxValue = (1 << toBits) - 1;
  for (const value of data) {
    if (value < 0 || value >> fromBits !== 0) {
      throw new Error("invalid value for bit conversion");
    }
    accumulator = (accumulator << fromBits) | value;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      result.push((accumulator >> bits) & maxValue);
    }
  }
  if (pad) {
    if (bits > 0) {
      result.push((accumulator << (toBits - bits)) & maxValue);
    }
  } else if (bits >= fromBits || ((accumulator << (toBits - bits)) & maxValue) !== 0) {
    throw new Error("invalid padding in bit conversion");
  }
  return result;
}

function encodeBech32m(hrp: string, payload: Uint8Array): string {
  const words = convertBits(payload, 8, 5, true);
  const checksum = createChecksum(hrp, words);
  return `${hrp}1${[...words, ...checksum].map((value) => CHARSET[value]).join("")}`;
}

function decodeBech32m(address: string): { hrp: string; payload: Uint8Array } {
  const normalized = address.toLowerCase();
  if (normalized !== address && normalized.toUpperCase() !== address) {
    throw new Error("mixed-case bech32m address is not allowed");
  }
  const separator = normalized.lastIndexOf("1");
  if (separator <= 0 || separator + 7 > normalized.length) {
    throw new Error("invalid bech32m address");
  }
  const hrp = normalized.slice(0, separator);
  const dataPart = normalized.slice(separator + 1);
  const data = Array.from(dataPart, (char) => {
    const value = CHARSET_MAP.get(char);
    if (value === undefined) {
      throw new Error(`invalid bech32m character: ${char}`);
    }
    return value;
  });
  if (!verifyChecksum(hrp, data)) {
    throw new Error("invalid bech32m checksum");
  }
  const payloadWords = data.slice(0, -6);
  return {
    hrp,
    payload: Uint8Array.from(convertBits(payloadWords, 5, 8, false)),
  };
}

export function encodeCkbAddress(script: LockScript, network: Network): string {
  const codeHash = hexToBytes(script.codeHash);
  if (codeHash.length !== CODE_HASH_BYTES) {
    throw new Error("codeHash must be 32 bytes");
  }
  const args = hexToBytes(script.args);
  const hashType = hashTypeToByte(script.hashType);
  const payload = concatBytes(Uint8Array.of(FULL_ADDRESS_TYPE), codeHash, Uint8Array.of(hashType), args);
  return encodeBech32m(hrpForNetwork(network), payload);
}

export function decodeCkbAddress(address: string): DecodedCkbAddress {
  const { hrp, payload } = decodeBech32m(address);
  if (payload.length < 1 + CODE_HASH_BYTES + 1) {
    throw new Error("CKB address payload is too short");
  }
  if (payload[0] !== FULL_ADDRESS_TYPE) {
    throw new Error("only full-format CKB addresses are supported");
  }
  const codeHash = payload.slice(1, 1 + CODE_HASH_BYTES);
  const hashType = payload[1 + CODE_HASH_BYTES];
  const args = payload.slice(1 + CODE_HASH_BYTES + 1);
  return {
    network: networkForHrp(hrp),
    script: {
      codeHash: bytesToHex(codeHash),
      hashType: byteToHashType(hashType),
      args: bytesToHex(args),
    },
  };
}

export function scriptId(script: LockScript): string {
  const digest = createHash("sha256").update(JSON.stringify(script)).digest("hex");
  return `0x${digest}`;
}
