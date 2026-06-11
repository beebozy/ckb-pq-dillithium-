import { PUBLIC_KEY_LEN, SIGNATURE_LEN } from "./constants.js";
import type { ByteLike, ParsedWitnessLock } from "./types.js";

function toBytes(value: ByteLike): Uint8Array {
  if (value instanceof Uint8Array) {
    return new Uint8Array(value);
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  return Uint8Array.from(value);
}

function writeU32LE(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value, true);
}

export function buildWitnessLock(publicKey: ByteLike, signature: ByteLike): Uint8Array {
  const publicKeyBytes = toBytes(publicKey);
  const signatureBytes = toBytes(signature);

  if (publicKeyBytes.length !== PUBLIC_KEY_LEN) {
    throw new Error(`public key must be ${PUBLIC_KEY_LEN} bytes`);
  }
  if (signatureBytes.length !== SIGNATURE_LEN) {
    throw new Error(`signature must be ${SIGNATURE_LEN} bytes`);
  }

  const output = new Uint8Array(4 + publicKeyBytes.length + 4 + signatureBytes.length);
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength);

  writeU32LE(view, 0, publicKeyBytes.length);
  output.set(publicKeyBytes, 4);
  writeU32LE(view, 4 + publicKeyBytes.length, signatureBytes.length);
  output.set(signatureBytes, 8 + publicKeyBytes.length);

  return output;
}

export function parseWitnessLock(bytes: ByteLike): ParsedWitnessLock {
  const input = toBytes(bytes);
  if (input.length < 8) {
    throw new Error("witness lock is too short");
  }

  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const publicKeyLen = view.getUint32(0, true);
  const publicKeyStart = 4;
  const publicKeyEnd = publicKeyStart + publicKeyLen;
  if (input.length < publicKeyEnd + 4) {
    throw new Error("witness lock is missing the signature length field");
  }

  const signatureLen = view.getUint32(publicKeyEnd, true);
  const signatureStart = publicKeyEnd + 4;
  const signatureEnd = signatureStart + signatureLen;
  if (input.length !== signatureEnd) {
    throw new Error("witness lock length does not match encoded contents");
  }

  const publicKey = input.slice(publicKeyStart, publicKeyEnd);
  const signature = input.slice(signatureStart, signatureEnd);

  if (publicKey.length !== PUBLIC_KEY_LEN) {
    throw new Error(`public key must be ${PUBLIC_KEY_LEN} bytes`);
  }
  if (signature.length !== SIGNATURE_LEN) {
    throw new Error(`signature must be ${SIGNATURE_LEN} bytes`);
  }

  return { publicKey, signature };
}
