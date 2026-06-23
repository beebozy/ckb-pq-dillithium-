# ckb-rust-script

This repository contains a custom CKB Dilithium lock script, a WASM crypto bridge, a TypeScript SDK, and a Node-first CLI wallet for ML-DSA-65 (Dilithium) accounts on CKB.

## Repository pieces

- `contracts/dillithium-lock/` — on-chain CKB lock script
- `tests/` — Rust integration harness built on `ckb-testtool`
- `wasm/` — Rust WebAssembly crate for off-chain Dilithium operations
- `sdk/` — Node-first TypeScript SDK and CLI wallet
- `deployment/` — deployment metadata for devnet and testnet

## Contract boundary

The on-chain contract expects:

- script args = Blake2b-256 hash of the public key using personalization `ckb-default-hash`
- witness lock bytes = `[u32 pubkey_len LE | pubkey | u32 sig_len LE | sig]`
- ML-DSA-65 public keys and signatures
- the signature to verify against the raw CKB transaction hash

The SDK and CLI mirror those exact formats.

## Wallet MVP

The repository now includes a Node-first wallet path that can:

- generate Dilithium keypairs
- derive CKB full-format addresses for the custom lock
- load live cells from CKB RPC/indexer endpoints
- calculate balances
- wait for funding to appear in the indexer
- build plain CKB transfer transactions
- sign transactions with Dilithium
- serialize `witness.lock` and submit the transaction
- wait for a submitted transaction to become visible before re-checking balance

Current MVP scope:

- supported: plain CKB transfers on devnet/testnet
- not yet supported: UDTs, DAO, multisig, browser wallet packaging

## Run locally

### Prerequisites

- Rust toolchain with the `riscv64imac-unknown-none-elf` target
- Node.js 20+
- access to a CKB RPC endpoint and an indexer endpoint for live balance/transfer flows

### Bootstrap the repo

```bash
make prepare
npm install
```

### Build the contract, WASM bridge, and SDK/CLI

```bash
make build CONTRACT=dillithium-lock
npm run build
```

### Run the wallet locally from this checkout

After `npm run build`, invoke the CLI directly from the generated workspace output:

```bash
node ./sdk/dist/src/cli.js keygen --out ./wallet.json --network testnet
node ./sdk/dist/src/cli.js address --key-file ./wallet.json --network testnet
node ./sdk/dist/src/cli.js balance \
  --key-file ./wallet.json \
  --network testnet \
  --rpc-url https://testnet.ckb.dev/rpc \
  --indexer-url https://testnet.ckb.dev/indexer
```

For a full live flow, continue with `wait`, `transfer --dry-run`, and `transfer --wait` examples from the CLI section below.

## Test locally

### Rust contract tests

```bash
cargo test --package tests
```

### SDK / wallet tests

```bash
npm test
```

### Typical local verification flow

```bash
make build CONTRACT=dillithium-lock
cargo test --package tests
npm test
```

## CLI wallet

For local testing from this repository, run the built CLI directly with `node ./sdk/dist/src/cli.js` after `npm run build`.

### Generate a key file

```bash
node ./sdk/dist/src/cli.js keygen --out ./wallet.json --network testnet
```

### Print the custom CKB address

```bash
node ./sdk/dist/src/cli.js address \
  --key-file ./wallet.json \
  --network testnet
```

### Wait for faucet/manual funding to appear

```bash
node ./sdk/dist/src/cli.js wait \
  --key-file ./wallet.json \
  --network testnet \
  --rpc-url https://testnet.ckb.dev/rpc \
  --indexer-url https://testnet.ckb.dev/indexer \
  --min-ckb 80
```

### Check balance once or wait for it

```bash
node ./sdk/dist/src/cli.js balance \
  --key-file ./wallet.json \
  --network testnet \
  --rpc-url https://testnet.ckb.dev/rpc \
  --indexer-url https://testnet.ckb.dev/indexer
```

```bash
node ./sdk/dist/src/cli.js balance \
  --key-file ./wallet.json \
  --network testnet \
  --rpc-url https://testnet.ckb.dev/rpc \
  --indexer-url https://testnet.ckb.dev/indexer \
  --wait \
  --min-ckb 80
```

### Confirm a known funding outpoint over RPC

```bash
node ./sdk/dist/src/cli.js check-outpoint \
  --key-file ./wallet.json \
  --network testnet \
  --rpc-url https://testnet.ckb.dev/rpc \
  --tx-hash 0x132b03333e9e8272ed59ed57beefbe00a6955021a03e349987d150decbe6e6a7 \
  --index 0
```

Use this when explorer shows a committed funding transaction but `balance` still reports zero. The command checks the specific outpoint with raw RPC and confirms whether it is still live and whether its lock matches the Dilithium wallet derived from the key file.

### Dry-run a transfer before broadcasting

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

### Send plain CKB and wait for visibility

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

## End-to-end wallet flow

1. Generate a fresh wallet file.
2. Derive the Dilithium address.
3. Paste that address into the faucet or fund it from another testnet/devnet wallet.
4. Run `wait` or `balance --wait` until funding is visible in the indexer.
5. If explorer shows funds but `balance` stays at zero, run `check-outpoint` on the known funding tx/output to confirm the cell is live and belongs to this wallet.
6. Record the starting balance.
7. Use `transfer --dry-run` first to confirm fees, selected inputs, and expected change.
8. Broadcast the transfer with `transfer --wait`.
9. Re-run `balance --wait` and verify the sender balance decreased by the amount plus fee, or matches the expected remaining change cell.

## Can the faucet be driven directly from the CLI?

Not from this repository today.

The Nervos faucet page exposes a web form and claim history, but this repo does not include a documented faucet-claim API integration. So the supported CLI flow is:

- generate wallet in CLI
- print address in CLI
- fund the address using the faucet UI or another funded sender
- wait/check balance from the CLI
- spend from the CLI

If you already control another funded wallet, that is the easiest way to fully test balance decrease end-to-end.

## SDK quick start

```ts
import {
  buildLockScript,
  buildSignedTransfer,
  generateKeypair,
  getBalanceSummary,
  CkbRpcClient,
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

## Testing and verification

- `cargo test --package tests` covers the Dilithium lock’s success path and key rejection cases:
  - invalid args length
  - malformed witness
  - pubkey hash mismatch
  - invalid signature
- `npm test` covers SDK and wallet helpers:
  - key generation
  - lock-args derivation
  - witness round-trip
  - address encode/decode
  - capacity calculation
  - transfer construction
  - transaction sealing
  - funding wait helpers
  - transaction confirmation polling
  - transfer preflight validation

## Troubleshooting

- **Zero balance after funding**
  - The address may be valid but the faucet/send transaction may not be indexed yet. Use `wait` or `balance --wait`.
  - If explorer or raw RPC already shows a committed funding output, use `check-outpoint` with the tx hash and output index to confirm the exact cell is live and matches this wallet.
  - The `balance` command now reports diagnostics that compare node RPC and indexer visibility; if the indexer is lagging or unavailable, switch `--indexer-url` or retry later.
- **Indexer errors**
  - The CLI balance/transfer flow requires an indexer-backed endpoint for `get_cells`, not only a plain RPC endpoint. Raw RPC can confirm a known outpoint, but it cannot discover the full wallet balance on its own.
- **Deployment metadata problems**
  - The CLI reads `deployment/scripts.json`; if the selected network’s `dillithium-lock` entry is stale or missing, the wallet will derive/query the wrong lock.
- **Amount too small**
  - This lock uses 32-byte args, so minimum capacity is higher than many standard cases. Use `transfer --dry-run` first.
- **Balance does not decrease immediately after send**
  - Submission can succeed before the transaction is visible in the indexer. Use `transfer --wait` followed by `balance --wait`.

## Current repo state

The Dilithium contract, deployment metadata, SDK exports, and CLI now consistently use the `dillithium-lock` name. Contract tests expect the built artifact at `build/release/dillithium-lock`.
