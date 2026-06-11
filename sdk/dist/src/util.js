export function toBytes(value) {
    if (value instanceof Uint8Array) {
        return new Uint8Array(value);
    }
    if (value instanceof ArrayBuffer) {
        return new Uint8Array(value);
    }
    return Uint8Array.from(value);
}
export function bytesToHex(bytes) {
    return `0x${Buffer.from(bytes).toString("hex")}`;
}
