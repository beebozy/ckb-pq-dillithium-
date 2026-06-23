#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  CkbRpcClient,
  PUBLIC_KEY_LEN,
  SECRET_KEY_LEN,
  SHANNONS_PER_CKB,
  WalletError,
  addressFromPublicKey,
  buildLockScript,
  buildSignedTransfer,
  decodeCkbAddress,
  generateKeypair,
  getBalanceSourceInspection,
  getWalletState,
  inspectOutPoint,
  type DilithiumScriptConfig,
  validateTransferRequest,
  waitForBalance,
  waitForTransactionConfirmation,
} from "./index.js";
import { bytesToHex, toHexQuantity } from "./util.js";

interface DeploymentCellDep {
  cellDep: {
    outPoint: {
      txHash: string;
      index: number;
    };
    depType: "code" | "depGroup";
  };
}

interface DeploymentNetworkConfig {
  codeHash: string;
  hashType: DilithiumScriptConfig["hashType"];
  cellDeps: DeploymentCellDep[];
}

interface DeploymentFile {
  devnet?: Record<string, DeploymentNetworkConfig>;
  testnet?: Record<string, DeploymentNetworkConfig>;
  mainnet?: Record<string, DeploymentNetworkConfig>;
}

interface StoredKeypair {
  publicKey: string;
  secretKey: string;
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case "keygen":
      await runKeygen(args);
      return;
    case "address":
      await runAddress(args);
      return;
    case "balance":
      await runBalance(args);
      return;
    case "check-outpoint":
      await runCheckOutpoint(args);
      return;
    case "wait":
      await runWait(args);
      return;
    case "transfer":
      await runTransfer(args);
      return;
    default:
      printUsage();
      process.exitCode = command ? 1 : 0;
  }
}

async function runKeygen(args: string[]): Promise<void> {
  const outputPath = requireOption(args, "--out");
  const network = optionalOption(args, "--network");
  const keypair = await generateKeypair();
  const payload: StoredKeypair = {
    publicKey: bytesToHex(keypair.publicKey),
    secretKey: bytesToHex(keypair.secretKey),
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  console.log(`Saved Dilithium keypair to ${outputPath}`);
  if (network) {
    console.log(`Next: dillithium-wallet address --key-file ${quote(outputPath)} --network ${network}`);
    console.log(
      `Then: dillithium-wallet wait --key-file ${quote(outputPath)} --network ${network} --rpc-url <rpc> --indexer-url <indexer>`,
    );
  }
}

async function runAddress(args: string[]): Promise<void> {
  const keyFile = requireOption(args, "--key-file");
  const network = parseNetwork(requireOption(args, "--network"));
  const keypair = await readKeypair(keyFile);
  const config = await loadScriptConfig(network);
  const address = await addressFromPublicKey(keypair.publicKey, config);
  const lock = await buildLockScript({
    codeHash: config.codeHash,
    hashType: config.hashType,
    publicKey: keypair.publicKey,
  });
  printJson({
    network,
    address,
    lock,
    next: {
      fund: "Send test CKB from the faucet or another funded wallet to this address.",
      wait: `dillithium-wallet wait --key-file ${keyFile} --network ${network} --rpc-url <rpc> --indexer-url <indexer>`,
    },
  });
}

async function runBalance(args: string[]): Promise<void> {
  const keyFile = requireOption(args, "--key-file");
  const rpcUrl = requireOption(args, "--rpc-url");
  const indexerUrl = optionalOption(args, "--indexer-url") ?? rpcUrl;
  const network = parseNetwork(requireOption(args, "--network"));
  const wait = hasFlag(args, "--wait");
  const minCapacity = parseOptionalCkbAmount(optionalOption(args, "--min-ckb"));
  const timeoutMs = parseOptionalInteger(optionalOption(args, "--timeout-ms"), "timeoutMs");
  const intervalMs = parseOptionalInteger(optionalOption(args, "--interval-ms"), "intervalMs");

  const keypair = await readKeypair(keyFile);
  const config = await loadScriptConfig(network);
  const client = new CkbRpcClient({ rpcUrl, indexerUrl });
  const state = wait
    ? (
        await waitForBalance(client, keypair.publicKey, config, {
          minCapacity,
          timeoutMs,
          intervalMs,
        })
      ).state
    : await getWalletState(client, keypair.publicKey, config);

  printJson({
    network,
    rpcUrl,
    indexerUrl,
    address: state.address,
    lock: state.lock,
    totalCapacity: state.totalCapacity.toString(),
    totalCapacityCkb: formatCkb(state.totalCapacity),
    liveCells: state.liveCells,
    minimumCellCapacity: state.minimumCellCapacity.toString(),
    minimumCellCapacityCkb: formatCkb(state.minimumCellCapacity),
    funded: state.funded,
    hint:
      state.liveCells === 0
        ? "No live cells were returned by the configured indexer. See diagnostics for indexer-vs-RPC guidance."
        : undefined,
    diagnostics: state.liveCells === 0 ? await buildZeroBalanceDiagnostics(client, network, keyFile, state.address) : undefined,
  });
}

async function runCheckOutpoint(args: string[]): Promise<void> {
  const keyFile = requireOption(args, "--key-file");
  const rpcUrl = requireOption(args, "--rpc-url");
  const network = parseNetwork(requireOption(args, "--network"));
  const txHash = requireOption(args, "--tx-hash");
  const index = parseOutPointIndex(requireOption(args, "--index"));

  const keypair = await readKeypair(keyFile);
  const config = await loadScriptConfig(network);
  const client = new CkbRpcClient({ rpcUrl });
  const address = await addressFromPublicKey(keypair.publicKey, config);
  const expectedLock = await buildLockScript({
    codeHash: config.codeHash,
    hashType: config.hashType,
    publicKey: keypair.publicKey,
  });
  const outPoint = {
    txHash,
    index,
  };
  const inspection = await inspectOutPoint(client, outPoint, expectedLock);
  const diagnosis =
    inspection.status === "live"
      ? inspection.lockMatchesExpected
        ? "live_and_matches_wallet"
        : "live_but_lock_mismatch"
      : inspection.status === "dead"
        ? "outpoint_spent"
        : "outpoint_unknown";

  printJson({
    network,
    rpcUrl,
    address,
    expectedLock,
    outPoint,
    status: inspection.status,
    live: inspection.status === "live",
    observedCell: inspection.cell
      ? {
          capacity: inspection.cell.output.capacity,
          capacityCkb: formatCkb(hexQuantityToBigInt(inspection.cell.output.capacity)),
          lock: inspection.cell.output.lock,
          type: inspection.cell.output.type ?? null,
          outputData: inspection.cell.outputData,
        }
      : null,
    lockMatchesWallet: inspection.lockMatchesExpected ?? null,
    diagnosis,
    nextSteps: checkOutpointNextSteps(diagnosis),
  });
}

async function runWait(args: string[]): Promise<void> {
  const keyFile = requireOption(args, "--key-file");
  const rpcUrl = requireOption(args, "--rpc-url");
  const indexerUrl = optionalOption(args, "--indexer-url") ?? rpcUrl;
  const network = parseNetwork(requireOption(args, "--network"));
  const minCapacity = parseOptionalCkbAmount(optionalOption(args, "--min-ckb"));
  const timeoutMs = parseOptionalInteger(optionalOption(args, "--timeout-ms"), "timeoutMs");
  const intervalMs = parseOptionalInteger(optionalOption(args, "--interval-ms"), "intervalMs");

  const keypair = await readKeypair(keyFile);
  const config = await loadScriptConfig(network);
  const client = new CkbRpcClient({ rpcUrl, indexerUrl });
  const result = await waitForBalance(client, keypair.publicKey, config, {
    minCapacity,
    timeoutMs,
    intervalMs,
  });

  printJson({
    network,
    rpcUrl,
    indexerUrl,
    address: result.state.address,
    lock: result.state.lock,
    totalCapacity: result.state.totalCapacity.toString(),
    totalCapacityCkb: formatCkb(result.state.totalCapacity),
    liveCells: result.state.liveCells,
    funded: result.state.funded,
    attempts: result.attempts,
    elapsedMs: result.elapsedMs,
  });
}

async function runTransfer(args: string[]): Promise<void> {
  const keyFile = requireOption(args, "--key-file");
  const rpcUrl = requireOption(args, "--rpc-url");
  const indexerUrl = optionalOption(args, "--indexer-url") ?? rpcUrl;
  const network = parseNetwork(requireOption(args, "--network"));
  const toAddress = requireOption(args, "--to");
  const amountCkb = requireOption(args, "--amount-ckb");
  const feeRate = optionalOption(args, "--fee-rate");
  const wait = hasFlag(args, "--wait");
  const dryRun = hasFlag(args, "--dry-run");
  const timeoutMs = parseOptionalInteger(optionalOption(args, "--timeout-ms"), "timeoutMs");
  const intervalMs = parseOptionalInteger(optionalOption(args, "--interval-ms"), "intervalMs");

  const keypair = await readKeypair(keyFile);
  const config = await loadScriptConfig(network);
  const client = new CkbRpcClient({ rpcUrl, indexerUrl });
  const fromLock = await buildLockScript({
    codeHash: config.codeHash,
    hashType: config.hashType,
    publicKey: keypair.publicKey,
  });
  const toDecoded = decodeCkbAddress(toAddress);
  const amount = parseCkbAmount(amountCkb);
  const cells = await client.getCells(fromLock);
  const preflight = validateTransferRequest(
    {
      cells,
      fromLock,
      toLock: toDecoded.script,
      amount,
      scriptConfig: config,
      feeRate: feeRate ? BigInt(feeRate) : undefined,
    },
    toDecoded.network,
  );

  const senderAddress = await addressFromPublicKey(keypair.publicKey, config);
  const summary = {
    network,
    rpcUrl,
    indexerUrl,
    fromAddress: senderAddress,
    toAddress,
    amount: preflight.amount.toString(),
    amountCkb: formatCkb(preflight.amount),
    fee: preflight.unsigned.fee.toString(),
    feeCkb: formatCkb(preflight.unsigned.fee),
    inputCapacity: preflight.unsigned.inputCapacity.toString(),
    inputCapacityCkb: formatCkb(preflight.unsigned.inputCapacity),
    changeCapacity: preflight.unsigned.changeCapacity.toString(),
    changeCapacityCkb: formatCkb(preflight.unsigned.changeCapacity),
    recipientMinimumCapacity: preflight.recipientMinimumCapacity.toString(),
    recipientMinimumCapacityCkb: formatCkb(preflight.recipientMinimumCapacity),
    minimumChangeCapacity: preflight.minimumChangeCapacity.toString(),
    minimumChangeCapacityCkb: formatCkb(preflight.minimumChangeCapacity),
    inputs: preflight.unsigned.selectedCells.length,
    txSize: preflight.unsigned.txSize,
  };

  if (dryRun) {
    printJson({
      ...summary,
      dryRun: true,
      message: "Transfer preflight succeeded. No transaction was broadcast.",
    });
    return;
  }

  const signed = await buildSignedTransfer({
    cells,
    fromLock,
    toLock: toDecoded.script,
    amount,
    scriptConfig: config,
    publicKey: keypair.publicKey,
    secretKey: keypair.secretKey,
    feeRate: feeRate ? BigInt(feeRate) : undefined,
  });
  const txHash = await client.sendTransaction(signed.transaction);

  let confirmation:
    | {
        status: string;
        attempts: number;
        elapsedMs: number;
      }
    | undefined;
  if (wait) {
    try {
      const result = await waitForTransactionConfirmation(client, {
        txHash,
        timeoutMs,
        intervalMs,
      });
      confirmation = {
        status: result.status,
        attempts: result.attempts,
        elapsedMs: result.elapsedMs,
      };
    } catch (error) {
      if (error instanceof WalletError && error.code === "transaction_confirmation_timeout") {
        confirmation = {
          status: "timeout",
          attempts: Number(error.details?.attempts ?? 0),
          elapsedMs: Number(error.details?.elapsedMs ?? 0),
        };
      } else {
        throw error;
      }
    }
  }

  printJson({
    ...summary,
    txHash,
    confirmation,
    next: `dillithium-wallet balance --key-file ${keyFile} --network ${network} --rpc-url ${rpcUrl} --indexer-url ${indexerUrl} --wait`,
  });
}

async function loadScriptConfig(network: DilithiumScriptConfig["network"]): Promise<DilithiumScriptConfig> {
  const deploymentPath = resolve(process.cwd(), "deployment/scripts.json");
  const deployment = JSON.parse(await readFile(deploymentPath, "utf8")) as DeploymentFile;
  const networkConfig = deployment[network]?.["dillithium-lock"];
  if (!networkConfig) {
    throw new Error(`No dillithium-lock deployment config found for ${network} in ${deploymentPath}`);
  }
  if (!networkConfig.codeHash || !networkConfig.hashType) {
    throw new Error(`Incomplete dillithium-lock deployment config for ${network} in ${deploymentPath}`);
  }
  const firstDep = networkConfig.cellDeps[0]?.cellDep;
  if (!firstDep) {
    throw new Error(`No cell dep configured for dillithium-lock on ${network} in ${deploymentPath}`);
  }
  return {
    codeHash: networkConfig.codeHash,
    hashType: networkConfig.hashType,
    network,
    cellDep: {
      outPoint: {
        txHash: firstDep.outPoint.txHash,
        index: toHexQuantity(firstDep.outPoint.index),
      },
      depType: firstDep.depType,
    },
  };
}

async function readKeypair(filePath: string): Promise<{ publicKey: Uint8Array; secretKey: Uint8Array }> {
  let content: StoredKeypair;
  try {
    content = JSON.parse(await readFile(filePath, "utf8")) as StoredKeypair;
  } catch (error) {
    throw new WalletError("invalid_key_file", `Unable to read key file at ${filePath}`, {
      filePath,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  if (typeof content.publicKey !== "string" || typeof content.secretKey !== "string") {
    throw new WalletError("invalid_key_file", `Key file ${filePath} must contain publicKey and secretKey strings`, {
      filePath,
    });
  }
  const publicKey = hexToBytes(content.publicKey, filePath, "publicKey");
  const secretKey = hexToBytes(content.secretKey, filePath, "secretKey");
  if (publicKey.length !== PUBLIC_KEY_LEN) {
    throw new WalletError("invalid_key_file", `publicKey in ${filePath} must be ${PUBLIC_KEY_LEN} bytes`, {
      filePath,
      actualLength: publicKey.length,
      expectedLength: PUBLIC_KEY_LEN,
    });
  }
  if (secretKey.length !== SECRET_KEY_LEN) {
    throw new WalletError("invalid_key_file", `secretKey in ${filePath} must be ${SECRET_KEY_LEN} bytes`, {
      filePath,
      actualLength: secretKey.length,
      expectedLength: SECRET_KEY_LEN,
    });
  }
  return {
    publicKey,
    secretKey,
  };
}

function parseNetwork(value: string): DilithiumScriptConfig["network"] {
  if (value === "devnet" || value === "testnet" || value === "mainnet") {
    return value;
  }
  throw new Error(`Unsupported network: ${value}`);
}

function parseCkbAmount(value: string): bigint {
  const [whole, fractional = ""] = value.split(".");
  if (!/^\d+$/.test(whole) || !/^\d*$/.test(fractional)) {
    throw new Error(`Invalid CKB amount: ${value}`);
  }
  const wholePart = BigInt(whole) * SHANNONS_PER_CKB;
  const fractionalDigits = fractional.padEnd(8, "0").slice(0, 8);
  return wholePart + BigInt(fractionalDigits || "0");
}

function parseOptionalCkbAmount(value: string | undefined): bigint | undefined {
  return value === undefined ? undefined : parseCkbAmount(value);
}

function parseOptionalInteger(value: string | undefined, label: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return parsed;
}

function formatCkb(value: bigint): string {
  const whole = value / SHANNONS_PER_CKB;
  const fractional = (value % SHANNONS_PER_CKB).toString().padStart(8, "0").replace(/0+$/, "");
  return fractional ? `${whole}.${fractional}` : `${whole}`;
}

async function buildZeroBalanceDiagnostics(
  client: CkbRpcClient,
  network: DilithiumScriptConfig["network"],
  keyFile: string,
  address: string,
): Promise<{
  balanceSource: string;
  rpcTipBlock?: string;
  indexerTipBlock?: string;
  indexerLagBlocks?: string;
  indexerReachable: boolean;
  indexerError?: string;
  explanation: string;
  nextSteps: string[];
}> {
  const inspection = await getBalanceSourceInspection(client);
  const lag = inspection.indexerLag;
  const explanation = !inspection.indexerReachable
    ? "The configured indexer endpoint could not answer indexer RPC calls. Balance discovery needs an indexer-backed endpoint, while raw RPC can only confirm specific known outpoints."
    : lag && lag > 0n
      ? `The indexer appears to lag the node tip by ${lag.toString()} block(s). Your balance query uses indexer get_cells, so recently funded cells may not appear yet even though RPC or an explorer can already see them.`
      : "The indexer is reachable, but it returned zero live cells for this lock. If explorer or raw RPC confirms a funded outpoint, compare the funding outpoint with this wallet using check-outpoint and verify the selected network and deployment config.";

  return {
    balanceSource: "indexer:get_cells",
    rpcTipBlock: inspection.rpcTip?.blockNumber,
    indexerTipBlock: inspection.indexerTip?.blockNumber,
    indexerLagBlocks: lag === undefined ? undefined : lag.toString(),
    indexerReachable: inspection.indexerReachable,
    indexerError: inspection.indexerError,
    explanation,
    nextSteps: [
      `Retry: dillithium-wallet balance --key-file ${quote(keyFile)} --network ${network} --rpc-url <rpc> --indexer-url <indexer> --wait`,
      "Try another --indexer-url if you have one.",
      `If you know the funding tx/output, run: dillithium-wallet check-outpoint --key-file ${quote(keyFile)} --network ${network} --rpc-url <rpc> --tx-hash <tx> --index <n>`,
      `Verify deployment/scripts.json and the derived address ${address} match the intended ${network} deployment.`,
    ],
  };
}

function parseOutPointIndex(value: string): string {
  return toHexQuantity(value);
}

function hexQuantityToBigInt(value: string): bigint {
  return BigInt(value);
}

function checkOutpointNextSteps(diagnosis: string): string[] {
  if (diagnosis === "live_and_matches_wallet") {
    return [
      "The outpoint is live and belongs to this wallet lock.",
      "If balance is still zero, the indexer is the likely issue; retry balance --wait or use another --indexer-url.",
    ];
  }
  if (diagnosis === "live_but_lock_mismatch") {
    return [
      "The outpoint is live, but its lock does not match this wallet.",
      "Re-check the key file, selected network, and the funding address used.",
    ];
  }
  if (diagnosis === "outpoint_spent") {
    return [
      "The referenced outpoint is not live anymore.",
      "Check later transactions or change outputs if you are tracing spent funds.",
    ];
  }
  return [
    "The node could not confirm this outpoint as a live cell.",
    "Double-check the tx hash and output index, or inspect the funding transaction again.",
  ];
}

function requireOption(args: string[], name: string): string {
  const value = optionalOption(args, name);
  if (!value) {
    throw new Error(`Missing required option: ${name}`);
  }
  return value;
}

function optionalOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return args[index + 1];
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function printUsage(): void {
  console.log(`Dilithium wallet CLI

Commands:
  keygen --out <file> [--network <devnet|testnet|mainnet>]
  address --key-file <file> --network <devnet|testnet|mainnet>
  balance --key-file <file> --network <devnet|testnet|mainnet> --rpc-url <url> [--indexer-url <url>] [--wait] [--min-ckb <amount>] [--timeout-ms <ms>] [--interval-ms <ms>]
  check-outpoint --key-file <file> --network <devnet|testnet|mainnet> --rpc-url <url> --tx-hash <0x...> --index <n|0x...>
  wait --key-file <file> --network <devnet|testnet|mainnet> --rpc-url <url> [--indexer-url <url>] [--min-ckb <amount>] [--timeout-ms <ms>] [--interval-ms <ms>]
  transfer --key-file <file> --network <devnet|testnet|mainnet> --rpc-url <url> [--indexer-url <url>] --to <ckt...|ckb...> --amount-ckb <amount> [--fee-rate <shannons-per-kb>] [--wait] [--dry-run] [--timeout-ms <ms>] [--interval-ms <ms>]
`);
}

function hexToBytes(value: string, filePath: string, field: string): Uint8Array {
  if (!value.startsWith("0x")) {
    throw new WalletError("invalid_key_file", `${field} in ${filePath} must start with 0x`, {
      filePath,
      field,
    });
  }
  return Uint8Array.from(Buffer.from(value.slice(2), "hex"));
}

function quote(value: string): string {
  return value.includes(" ") ? JSON.stringify(value) : value;
}

main().catch((error) => {
  console.error(renderError(error));
  process.exitCode = 1;
});

function renderError(error: unknown): string {
  if (error instanceof WalletError) {
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}
