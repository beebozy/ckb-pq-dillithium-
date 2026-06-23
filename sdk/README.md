# @ckb/dillithium-sdk

Node.js SDK and CLI wallet for the CKB Dilithium lock script.

This package now provides both:

- low-level Dilithium helpers for key generation, lock args derivation, hashing, signing, and witness encoding
- a Node-first wallet layer for CKB address derivation, live-cell lookup, balance polling, transaction construction, signing, submission, and confirmation waiting

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
- signatures over the raw CKB transaction hash

This SDK mirrors those exact formats and adds wallet helpers around them.

## Runtime

This package is currently **Node.js-first**.

It bundles a compiled WebAssembly module and loads it from the installed package at runtime. It is suitable for:

- Node.js apps
- CLI tools
- server-side wallet tooling
- test scripts

It is **not yet packaged for direct browser use**.

## Quick start: low-level SDK

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
  hashType: "data2",
  publicKey,
});

const txHash = new Uint8Array(32);
const signature = await signTxHash(secretKey, txHash);
const ok = await verifySignature(publicKey, txHash, signature);
const witnessLock = buildWitnessLock(publicKey, signature);

console.log({
  lockArgs: Buffer.from(lockArgs).toString("hex"),
  lock,
  witnessBytes: witnessLock.length,
  ok,
});
```

## Quick start: wallet helpers

```ts
import {
  CkbRpcClient,
  addressFromPublicKey,
  buildLockScript,
  buildSignedTransfer,
  generateKeypair,
  getBalanceSummary,
  waitForBalance,
  waitForTransactionConfirmation,
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
const address = await addressFromPublicKey(publicKey, scriptConfig);

const client = new CkbRpcClient({
  rpcUrl: "https://testnet.ckb.dev/rpc",
  indexerUrl: "https://testnet.ckb.dev/indexer",
});

await waitForBalance(client, publicKey, scriptConfig, {
  minCapacity: 80_00000000n,
});

const balance = await getBalanceSummary(client, lock);
console.log(address, balance.totalCapacity.toString());

const liveCells = await client.getCells(lock);
const signed = await buildSignedTransfer({
  cells: liveCells,
  fromLock: lock,
  toLock: lock,
  amount: 80_00000000n,
  scriptConfig,
  publicKey,
  secretKey,
});

const txHash = await client.sendTransaction(signed.transaction);
await waitForTransactionConfirmation(client, { txHash });
console.log(txHash);
```

## CLI wallet

The package exposes a CLI named `dillithium-wallet`.

### Generate a key file

```bash
dillithium-wallet keygen --out ./wallet.json --network testnet
```

### Print the Dilithium CKB address

```bash
dillithium-wallet address \
  --key-file ./wallet.json \
  --network testnet
```

### Wait for funding to appear

```bash
dillithium-wallet wait \
  --key-file ./wallet.json \
  --network testnet \
  --rpc-url https://testnet.ckb.dev/rpc \
  --indexer-url https://testnet.ckb.dev/indexer \
  --min-ckb 80
```

### Check balance or wait for it

```bash
dillithium-wallet balance \
  --key-file ./wallet.json \
  --network testnet \
  --rpc-url https://testnet.ckb.dev/rpc \
  --indexer-url https://testnet.ckb.dev/indexer
```

```bash
dillithium-wallet balance \
  --key-file ./wallet.json \
  --network testnet \
  --rpc-url https://testnet.ckb.dev/rpc \
  --indexer-url https://testnet.ckb.dev/indexer \
  --wait \
  --min-ckb 80
```

### Confirm a known outpoint over RPC

```bash
dillithium-wallet check-outpoint \
  --key-file ./wallet.json \
  --network testnet \
  --rpc-url https://testnet.ckb.dev/rpc \
  --tx-hash 0x132b03333e9e8272ed59ed57beefbe00a6955021a03e349987d150decbe6e6a7 \
  --index 0
```

Use this when explorer or raw RPC shows a funding transaction but `balance` still reports zero. The command checks the exact outpoint with node RPC and tells you whether it is still live and whether its lock matches the wallet derived from the selected key file.

### Dry-run a transfer

```bash
dillithium-wallet transfer \
  --key-file ./wallet.json \
  --network testnet \
  --rpc-url https://testnet.ckb.dev/rpc \
  --indexer-url https://testnet.ckb.dev/indexer \
  --to ckt1... \
  --amount-ckb 80 \
  --dry-run
```

### Broadcast a transfer and wait for follow-up visibility

```bash
dillithium-wallet transfer \
  --key-file ./wallet.json \
  --network testnet \
  --rpc-url https://testnet.ckb.dev/rpc \
  --indexer-url https://testnet.ckb.dev/indexer \
  --to ckt1... \
  --amount-ckb 80 \
  --wait
```

## API additions

### Address helpers

- `encodeCkbAddress(script, network)`
- `decodeCkbAddress(address)`
- `addressFromPublicKey(publicKey, scriptConfig)`
- `parseAddressToLock(address)`

### Wallet helpers

- `CkbRpcClient`
- `WalletError`
- `getBalanceSummary(client, lock)`
- `getWalletState(client, publicKey, scriptConfig)`
- `waitForBalance(client, publicKey, scriptConfig, options?)`
- `waitForTransactionConfirmation(client, options)`
- `validateTransferRequest(options, recipientNetwork?)`
- `buildTransferTransaction(options)`
- `sealTransaction(options)`
- `buildSignedTransfer(options)`
- `computeTransactionHash(rawTransaction)`
- `minimumCellCapacity(lock, dataHex?, type?)`

### Constants

- `WITNESS_LOCK_BYTES`
- `DEFAULT_FEE_RATE`
- `SHANNONS_PER_CKB`

## Notes

- This wallet path currently supports **plain CKB transfers only**.
- It uses the repo’s current signing model: **sign the raw transaction hash**.
- It does **not** yet support UDTs, DAO, multisig, or browser packaging.
- The CLI expects deployment metadata in `deployment/scripts.json` to include the `dillithium-lock` entry for the chosen network.
- The balance/transfer flow requires an indexer-backed endpoint for `get_cells`.
- `check-outpoint` uses raw RPC `get_live_cell`, which is useful for confirming a known funding cell but does not replace indexer-backed balance discovery.
- For test suites, build the contract artifact first so `ckb-testtool` can load `build/release/dillithium-lock`.

## Practical wallet lifecycle

1. generate wallet
2. derive address
3. fund from faucet or another wallet
4. wait for the funding tx to be indexed
5. confirm funded balance
6. if explorer shows funds but `balance` stays zero, run `check-outpoint` on the known funding outpoint to confirm the cell is live and belongs to this wallet
7. dry-run the transfer
8. broadcast the transfer
9. wait for tx visibility
10. verify the balance decreased

## Can the faucet be used directly from the CLI?

Not in this package today.

The current supported CLI flow starts before and after the faucet step, but does not claim faucet funds programmatically. That means:

- use CLI to generate wallet and print address
- fund that address via faucet UI or another funded sender
- return to CLI for waiting, balance checks, dry-run, signing, and sending

## Development

From the repository root:

```bash
make build CONTRACT=dillithium-lock
npm install
npm run build:wasm
npm run build:sdk
npm test
cargo test --package tests
```

## Publishing checklist

From the repository root:

```bash
make build CONTRACT=dillithium-lock
npm install
npm run build:wasm
npm run build:sdk
npm test
cargo test --package tests
```

From `sdk/`:

```bash
npm pack --dry-run
npm publish --access public
```

## Repository

Source: https://github.com/beebozy/ckb-pq-dillithium-
