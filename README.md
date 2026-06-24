# CKB Dilithium Lock Script

> **Disclaimer**
> This repository is experimental post-quantum infrastructure for CKB. It implements a custom ML-DSA-65 (Dilithium) lock, off-chain signing helpers, and a CLI wallet flow intended for development and evaluation. It has not been presented here as production-audited software — **use at your own risk**.

`ckb-rust-script` is a full-stack reference project for using **FIPS 204 ML-DSA-65 (Dilithium)** signatures on the **Nervos CKB** blockchain.

It includes:

- an on-chain `no_std` CKB lock script written in Rust
- a Rust-to-WASM crypto bridge for off-chain Dilithium operations
- a Node-first TypeScript SDK
- a CLI wallet for key generation, address derivation, balance checks, and plain CKB transfers
- deployment metadata for devnet and testnet
- Rust and Node test suites covering the contract and wallet flow

The goal is simple: replace the usual secp256k1-style lock flow with a **quantum-resistant custom lock** while keeping the CKB developer experience familiar.

## Feature summary

| Feature | Details |
| --- | --- |
| Signature scheme | **FIPS 204 ML-DSA-65 (Dilithium)** via `fips204` |
| On-chain target | `riscv64imac-unknown-none-elf` / CKB-VM |
| Contract model | Custom CKB lock script |
| Lock args | `blake2b-256(public_key)` with CKB personalization `ckb-default-hash` |
| Witness format | `[u32 pubkey_len LE | pubkey | u32 sig_len LE | sig]` |
| Off-chain tooling | Rust WASM crate + TypeScript SDK + CLI wallet |
| Network metadata | `deployment/scripts.json` for devnet/testnet |
| Current transfer support | **Plain CKB transfers only** |
| Test coverage | `ckb-testtool` contract tests + Node SDK/wallet tests |

## Architecture overview

```text
Dilithium keypair
   │
   ├─ public key ──blake2b-256──► lock args
   │                                │
   │                                ▼
   │                        deployed dillithium-lock script
   │
   └─ secret key ──sign tx hash──► witness.lock
                                   [pubkey_len | pubkey | sig_len | sig]
                                                │
                                                ▼
                                   on-chain verification in CKB-VM
```

### Repository components

```text
ckb-rust-script/
├── contracts/dillithium-lock/   # On-chain CKB lock script
├── wasm/                        # Rust WASM crypto bridge
├── sdk/                         # TypeScript SDK + CLI wallet
├── tests/                       # Rust integration tests with ckb-testtool
├── deployment/                  # Devnet/testnet deployment metadata
├── patches/bytes/               # Local patch needed for bare-metal RISC-V builds
└── Makefile                     # Build, test, coverage, and helper targets
```

## How the lock works

The on-chain contract verifies a spender in four steps:

1. Load script args and require exactly **32 bytes**.
2. Load `witness.lock` and parse it as:
   - `u32` little-endian public-key length
   - public key bytes
   - `u32` little-endian signature length
   - signature bytes
3. Compute `blake2b-256(pubkey)` using CKB personalization `ckb-default-hash` and require it to match the script args.
4. Verify the ML-DSA-65 signature against the raw CKB transaction hash.

This means the SDK, wallet, and contract all share the same canonical formats for:

- public-key hashing
- lock args derivation
- witness serialization
- transaction-hash signing

## What is in this repository today?

### 1. On-chain lock script

The contract lives in `contracts/dillithium-lock/` and targets CKB-VM with:

- `no_std`
- `no_main`
- `ckb-std`
- `fips204` with `ml-dsa-65`
- `blake2b-ref`

It returns these error codes:

| Code | Constant | Meaning |
| --- | --- | --- |
| 1 | `ERR_INVALID_ARGS_LENGTH` | Script args are not 32 bytes |
| 2 | `ERR_INVALID_WITNESS` | Witness is missing or malformed |
| 3 | `ERR_PUBKEY_HASH_MISMATCH` | Embedded public key does not match args |
| 4 | `ERR_INVALID_PUBKEY` | Public key deserialization failed |
| 5 | `ERR_INVALID_SIGNATURE` | Signature size/format is invalid |
| 6 | `ERR_SIGNATURE_VERIFICATION` | Signature verification failed |

### 2. Rust WASM crypto bridge

The `wasm/` crate provides a low-level WASM module used by the SDK for:

- deterministic key generation from a 32-byte seed
- CKB-style Blake2b hashing
- public-key hashing for lock args
- ML-DSA-65 signing
- signature verification

This is currently a **Node-first** packaging flow, not a browser-ready wallet frontend.

### 3. TypeScript SDK

The `sdk/` package exposes utilities for:

- key generation
- lock args derivation
- witness construction
- address encode/decode
- lock script construction
- transaction hashing/signing
- live cell discovery via RPC/indexer
- balance summaries
- transfer building and sealing
- transaction submission and confirmation polling

Package name:

```bash
@ckb/dillithium-sdk
```

### 4. CLI wallet

The repository includes a CLI wallet named:

```bash
dillithium-wallet
```

Current CLI scope:

- generate Dilithium keypairs
- derive CKB addresses for the custom lock
- check balances using RPC + indexer
- wait for funding to appear
- inspect a specific outpoint over raw RPC
- build, sign, and send **plain CKB transfers**

Not supported yet:

- xUDT / UDT flows
- DAO
- multisig
- browser packaging
- direct faucet claiming from the CLI

## Current deployments

Deployment metadata is stored in `deployment/scripts.json`.

| Network | Script name | Code hash | Hash type | Cell dep tx |
| --- | --- | --- | --- | --- |
| Devnet | `dillithium-lock` | `0x33c0ab2e6c1fdd3591336344a33aacf86929a8605f36b6c202e6c34593cb690b` | `data2` | `0x7ff54a362b8246d41e7f28f85b1439f12e8d432de8ebb513033699139c88e4f7` |
| Testnet | `dillithium-lock` | `0x33c0ab2e6c1fdd3591336344a33aacf86929a8605f36b6c202e6c34593cb690b` | `data2` | `0x4572a31a4b6a3d86396c7f344c5d7d8a51b288c8962bad52179a1724e177ef6b` |
| Mainnet | _not deployed in this repo_ | — | — | — |

## Benchmarks

Current documented benchmark values for the lock script:

- **Cycles:** `1,645,604`
- **Script size:** `94,372` bytes
- **Reference testnet deployment tx:** `0x4572a31a4b6a3d86396c7f344c5d7d8a51b288c8962bad52179a1724e177ef6b`

Because Dilithium public keys and signatures are much larger than secp256k1 equivalents, expect:

- larger witnesses
- higher verification cost
- more sensitivity to minimum cell capacity and fees

Use transfer dry-runs before broadcasting real transactions.

## Build from source

### Prerequisites

- Rust toolchain
- target: `riscv64imac-unknown-none-elf`
- Node.js **20+**
- npm
- access to a CKB RPC endpoint and an indexer endpoint for live wallet operations

### Bootstrap

```bash
make prepare
npm install
```

### Build the contract

```bash
make build CONTRACT=dillithium-lock
```

This produces the contract artifact expected by the Rust test suite:

```text
build/release/dillithium-lock
```

### Build the WASM module and SDK

```bash
npm run build
```

Equivalent split commands:

```bash
npm run build:wasm
npm run build:sdk
```

## Test locally

### Rust contract tests

```bash
cargo test --package tests
```

### SDK / wallet tests

```bash
npm test
```

### Typical verification flow

```bash
make build CONTRACT=dillithium-lock
cargo test --package tests
npm test
```

## Coverage

The root `Makefile` also includes native-simulator coverage helpers.

### Install LLVM tools

```bash
make coverage-install
```

### Text coverage report

```bash
make coverage
```

### HTML coverage report

```bash
make coverage-html
```

### LCOV output

```bash
make coverage-lcov
```

## CLI wallet quick start

For local development from this repository, run the built CLI directly:

```bash
node ./sdk/dist/src/cli.js
```

### 1. Generate a key file

```bash
node ./sdk/dist/src/cli.js keygen --out ./wallet.json --network testnet
```

### 2. Print the custom CKB address

```bash
node ./sdk/dist/src/cli.js address \
  --key-file ./wallet.json \
  --network testnet
```

### 3. Wait for funding to appear

```bash
node ./sdk/dist/src/cli.js wait \
  --key-file ./wallet.json \
  --network testnet \
  --rpc-url https://testnet.ckb.dev/rpc \
  --indexer-url https://testnet.ckb.dev/indexer \
  --min-ckb 80
```

### 4. Check balance

```bash
node ./sdk/dist/src/cli.js balance \
  --key-file ./wallet.json \
  --network testnet \
  --rpc-url https://testnet.ckb.dev/rpc \
  --indexer-url https://testnet.ckb.dev/indexer
```

### 5. Inspect a known funding outpoint

```bash
node ./sdk/dist/src/cli.js check-outpoint \
  --key-file ./wallet.json \
  --network testnet \
  --rpc-url https://testnet.ckb.dev/rpc \
  --tx-hash 0x132b03333e9e8272ed59ed57beefbe00a6955021a03e349987d150decbe6e6a7 \
  --index 0
```

Use this when an explorer shows a funding cell but the indexer-backed balance still reports zero.

### 6. Dry-run a transfer

```bash
node ./sdk/dist/src/cli.js transfer \
  --key-file ./wallet.json \
  --network testnet \
  --rpc-url https://testnet.ckb.dev/rpc \
  --indexer-url https://testnet.ckb.dev/indexer \
  --to ckt1... \
  --amount-ckb 80 \
  --dry-run
```

### 7. Broadcast a transfer and wait for visibility

```bash
node ./sdk/dist/src/cli.js transfer \
  --key-file ./wallet.json \
  --network testnet \
  --rpc-url https://testnet.ckb.dev/rpc \
  --indexer-url https://testnet.ckb.dev/indexer \
  --to ckt1... \
  --amount-ckb 80 \
  --wait
```

## Recommended end-to-end flow

1. Build the contract and SDK.
2. Generate a fresh Dilithium wallet file.
3. Print the derived address.
4. Fund it from the faucet UI or another funded CKB wallet.
5. Wait for indexer visibility with `wait` or `balance --wait`.
6. If the explorer shows funds but balance remains zero, use `check-outpoint`.
7. Run `transfer --dry-run` first.
8. Broadcast with `transfer --wait`.
9. Re-check the balance after confirmation/indexer visibility.

## SDK quick start

```ts
import {
  CkbRpcClient,
  buildLockScript,
  buildSignedTransfer,
  generateKeypair,
  getBalanceSummary,
} from "@ckb/dillithium-sdk";

const scriptConfig = {
  codeHash: "0x<dillithium_code_hash>",
  hashType: "data2",
  network: "testnet",
  cellDep: {
    outPoint: {
      txHash: "0x<deployment_tx_hash>",
      index: "0x0",
    },
    depType: "code",
  },
};

const { publicKey, secretKey } = await generateKeypair();

const lock = await buildLockScript({
  codeHash: scriptConfig.codeHash,
  hashType: scriptConfig.hashType,
  publicKey,
});

const client = new CkbRpcClient({
  rpcUrl: "https://testnet.ckb.dev/rpc",
  indexerUrl: "https://testnet.ckb.dev/indexer",
});

const balance = await getBalanceSummary(client, lock);
console.log(balance.totalCapacity.toString());

const cells = await client.getCells(lock);
const signed = await buildSignedTransfer({
  cells,
  fromLock: lock,
  toLock: lock,
  amount: 80_00000000n,
  scriptConfig,
  publicKey,
  secretKey,
});

const txHash = await client.sendTransaction(signed.transaction);
console.log(txHash);
```

## Tests and what they cover

### Rust contract tests

The Rust suite in `tests/` verifies the lock script accepts a valid signature and rejects key failure modes, including:

- invalid args length
- malformed witness
- public-key hash mismatch
- invalid signature

### SDK / wallet tests

The Node suite covers helpers such as:

- key generation
- lock-args derivation
- witness round-trips
- address encode/decode
- capacity calculations
- transfer construction
- transaction sealing
- funding wait helpers
- transaction confirmation polling
- transfer preflight validation

## Known constraints

- The wallet flow currently requires an **indexer-backed endpoint** for balance discovery and live-cell collection.
- `check-outpoint` uses raw RPC and is useful for investigating a known cell, but it does **not** replace indexer-backed wallet discovery.
- Deployment metadata must be present and correct in `deployment/scripts.json` for the selected network.
- This repository includes a local `bytes` patch for bare-metal RISC-V compatibility. **Do not remove the patch section in the root `Cargo.toml`.**
- The CLI currently supports **plain CKB only**.

## Troubleshooting

### Zero balance after funding

- The funding transaction may not be indexed yet.
- Retry with `wait` or `balance --wait`.
- If a block explorer already shows the output, run `check-outpoint` against the exact tx hash and index.
- If needed, switch to a healthier indexer endpoint.

### Transfer fails or amount is too small

- Dilithium locks use 32-byte args and large witnesses, so fee and capacity margins matter more.
- Run `transfer --dry-run` first to inspect selected inputs, fee, and expected change.

### Balance does not decrease immediately after send

- Submission can succeed before indexer visibility catches up.
- Use `transfer --wait`, then re-run `balance --wait`.

## Development notes

- The contract, SDK exports, deployment metadata, and CLI use the shared script name `dillithium-lock`.
- The Rust integration harness expects the built artifact at `build/release/dillithium-lock`.
- The SDK is currently packaged for **Node.js-first** usage rather than direct browser consumption.

## Contributing

Issues and pull requests are welcome.

If you are extending the repository, a safe local workflow is:

```bash
make build CONTRACT=dillithium-lock
npm test
```



