# @ckb/dillithium-sdk

Node.js SDK for the CKB Dilithium lock script.

This package provides the off-chain utilities needed to work with the on-chain ML-DSA-65 (Dilithium) lock:

- generate ML-DSA-65 keypairs
- derive 32-byte lock args from a public key
- sign CKB transaction hashes
- build witness lock bytes in the exact format expected by the lock script

## Install

```bash
npm install @ckb/dillithium-sdk
```

## What this package does

The on-chain lock script expects:

- `args`: `blake2b-256(publicKey)` using CKB personalization
- `witness.lock`: serialized as  
  `[u32 pubkey_len LE | pubkey | u32 sig_len LE | sig]`
- ML-DSA-65 public keys and signatures

This SDK mirrors those exact formats.

## Runtime

This package is currently **Node.js-first**.

It bundles a compiled WebAssembly module and loads it from the installed package at runtime. It is suitable for:

- Node.js apps
- CLI tools
- server-side wallet tooling
- test scripts

It is **not yet packaged for direct browser use**.

## Quick start

```ts
import {
  buildLockScript,
  buildWitnessLock,
  computeLockArgs,
  generateKeypair,
  signTxHash,
  verifySignature,
} from "@ckb/dillithium-sdk";

const { publicKey, secretKey } = await generateKeypair();

const lockArgs = await computeLockArgs(publicKey);

const lock = await buildLockScript({
  codeHash: "0x<deployed_code_hash>",
  hashType: "type",
  publicKey,
});

const txHash = new Uint8Array(32); // replace with the real transaction hash
const signature = await signTxHash(secretKey, txHash);

const ok = await verifySignature(publicKey, txHash, signature);
console.log("signature valid:", ok);

const witnessLock = buildWitnessLock(publicKey, signature);

console.log("lock args:", Buffer.from(lockArgs).toString("hex"));
console.log("witness bytes:", witnessLock.length);
console.log("lock script:", lock);
```

## API

### `generateKeypair(): Promise<{ publicKey: Uint8Array; secretKey: Uint8Array }>`

Generates a new ML-DSA-65 keypair.

### `computeLockArgs(publicKey): Promise<Uint8Array>`

Computes the 32-byte Blake2b lock args for a public key.

### `buildLockScript({ codeHash, hashType, publicKey }): Promise<{ codeHash: string; hashType: string; args: string }>`

Builds a CKB lock script object using the hashed public key as `args`.

### `signTxHash(secretKey, txHash): Promise<Uint8Array>`

Signs a transaction hash using the secret key.

### `verifySignature(publicKey, txHash, signature): Promise<boolean>`

Verifies a signature against a transaction hash and public key.

### `buildWitnessLock(publicKey, signature): Uint8Array`

Builds witness lock bytes in the exact format expected by the on-chain Dilithium lock script.

### `parseWitnessLock(bytes): { publicKey: Uint8Array; signature: Uint8Array }`

Parses witness lock bytes back into their public key and signature components.

## Notes

- This SDK signs **transaction hashes**, not complete transactions.
- This SDK does **not** assemble or submit CKB transactions by itself.
- You will typically combine it with your preferred CKB transaction-building stack.
- You must know the deployed Dilithium lock script's `codeHash` and `hashType` to build usable lock scripts.

## Example workflow

1. Generate a keypair
2. Derive lock args from the public key
3. Create a CKB output locked by the Dilithium script
4. When spending, compute the transaction hash
5. Sign the hash
6. Build witness bytes with the public key and signature
7. Put the witness bytes into the transaction

## Development

From the repository root:

```bash
npm install
npm run build:wasm
npm run build:sdk
npm test
```

The published package includes the compiled `.wasm` artifact, so downstream users should not need Rust or Cargo.

## Publishing checklist

From the repository root:

```bash
npm install
npm run build:wasm
npm run build:sdk
npm test
```

From `sdk/`:

```bash
npm pack --dry-run
npm publish --access public
```

If this is your first publish on the machine:

```bash
npm login
```

## Repository

Source: https://github.com/beebozy/ckb-pq-dillithium-
