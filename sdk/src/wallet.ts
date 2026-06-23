import { buildLockScript } from "./lock.js";
import { ckbHash, signTxHash } from "./crypto.js";
import { buildWitnessLock } from "./witness.js";
import { DEFAULT_FEE_RATE, SHANNONS_PER_CKB, WITNESS_LOCK_BYTES } from "./constants.js";
import { decodeCkbAddress, encodeCkbAddress } from "./address.js";
import {
  bytesToHex,
  concatBytes,
  hexToBigInt,
  hexToBytes,
  toBytes,
  toHexQuantity,
  u32ToLeBytes,
  u64ToLeBytes,
} from "./util.js";
import type {
  BalanceSourceInspection,
  BalanceSummary,
  BuildSignedTransferOptions,
  BuildTransferOptions,
  CellDep,
  CellOutput,
  ChainTip,
  DilithiumScriptConfig,
  LiveCell,
  LockScript,
  Network,
  OutPoint,
  OutPointInspection,
  OutPointStatus,
  RawTransaction,
  ResolvedOutPointCell,
  RpcConfig,
  SealTransactionOptions,
  SignedTransaction,
  SignedTransferTransaction,
  Transaction,
  TransactionInput,
  TransferPreflight,
  UnsignedTransferTransaction,
  WaitForBalanceOptions,
  WaitForBalanceResult,
  WaitForTransactionConfirmationOptions,
  WaitForTransactionConfirmationResult,
  WalletErrorCode,
  WalletState,
  WalletTransactionStatus,
} from "./types.js";

const SCRIPT_SIZE_BASE = 32n + 1n;
const CELL_OUTPUT_BASE = 8n;
const JSON_RPC_VERSION = "2.0";
const DEFAULT_WAIT_TIMEOUT_MS = 120_000;
const DEFAULT_WAIT_INTERVAL_MS = 5_000;

type JsonRpcResponse<T> = JsonRpcSuccess<T> | JsonRpcFailure;

interface JsonRpcSuccess<T> {
  jsonrpc: string;
  id: number;
  result: T;
}

interface JsonRpcFailure {
  jsonrpc: string;
  id: number;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface RpcOutPoint {
  tx_hash: string;
  index: string;
}

interface RpcCellDep {
  out_point: RpcOutPoint;
  dep_type: "code" | "dep_group";
}

interface RpcScript {
  code_hash: string;
  hash_type: string;
  args: string;
}

interface RpcCellOutput {
  capacity: string;
  lock: RpcScript;
  type?: RpcScript | null;
}

interface RpcInput {
  previous_output: RpcOutPoint;
  since: string;
}

interface RpcTransaction {
  version: string;
  cell_deps: RpcCellDep[];
  header_deps: string[];
  inputs: RpcInput[];
  outputs: RpcCellOutput[];
  outputs_data: string[];
  witnesses: string[];
}

interface RpcIndexerCell {
  block_number: string;
  out_point: RpcOutPoint;
  output: RpcCellOutput;
  output_data: string;
  tx_index: string;
}

interface IndexerCellsResponse {
  last_cursor: string;
  objects: RpcIndexerCell[];
}

interface RpcTipHeader {
  hash?: string;
  number?: string;
  block_hash?: string;
  block_number?: string;
}

interface RpcCellData {
  content: string;
}

interface RpcLiveCell {
  cell?: {
    output: RpcCellOutput;
    data: RpcCellData;
  } | null;
  status?: string;
}

export class WalletError extends Error {
  constructor(
    public readonly code: WalletErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "WalletError";
  }
}

export class CkbRpcClient {
  private nextId = 0;

  constructor(private readonly config: RpcConfig) {}

  async getTipHeader(): Promise<ChainTip> {
    const tip = await this.request<RpcTipHeader>("get_tip_header", []);
    return fromRpcTipHeader(tip);
  }

  async getIndexerTip(): Promise<ChainTip> {
    const endpoint = this.config.indexerUrl ?? this.config.rpcUrl;
    const tip = await this.request<RpcTipHeader>("get_indexer_tip", [], endpoint).catch((error: unknown) => {
      throw wrapIndexerError(error, endpoint);
    });
    return fromRpcTipHeader(tip);
  }

  async getLiveCell(outPoint: OutPoint, withData = true): Promise<{ status: OutPointStatus; cell?: ResolvedOutPointCell }> {
    const result = await this.request<RpcLiveCell>("get_live_cell", [toRpcOutPoint(outPoint), withData]);
    return {
      status: liveCellStatus(result.status),
      cell: result.cell ? fromRpcResolvedOutPointCell(result.cell) : undefined,
    };
  }

  async sendTransaction(transaction: Transaction): Promise<string> {
    return this.request("send_transaction", [toRpcTransaction(transaction), "passthrough"]);
  }

  async getTransaction(txHash: string): Promise<unknown> {
    return this.request("get_transaction", [txHash]);
  }

  async getCells(lock: LockScript, limit = 100): Promise<LiveCell[]> {
    const endpoint = this.config.indexerUrl ?? this.config.rpcUrl;
    const objects: LiveCell[] = [];
    let cursor: string | undefined;
    for (;;) {
      const params: unknown[] = [
        {
          script: toRpcScript(lock),
          script_type: "lock",
        },
        "asc",
        toHexQuantity(limit),
      ];
      if (cursor !== undefined) {
        params.push(cursor);
      }
      const page = await this.request<IndexerCellsResponse>("get_cells", params, endpoint).catch((error: unknown) => {
        throw wrapIndexerError(error, endpoint);
      });
      objects.push(...page.objects.map(fromRpcIndexerCell));
      if (!page.objects.length || page.last_cursor === cursor) {
        return objects;
      }
      cursor = page.last_cursor;
    }
  }

  private async request<T>(method: string, params: unknown[], url = this.config.rpcUrl): Promise<T> {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        id: ++this.nextId,
        jsonrpc: JSON_RPC_VERSION,
        method,
        params,
      }),
    });
    if (!response.ok) {
      throw new Error(`${method} failed with HTTP ${response.status}`);
    }
    const body = (await response.json()) as JsonRpcResponse<T>;
    if ("error" in body) {
      throw new Error(`${method} failed: ${body.error.message}`);
    }
    return body.result;
  }
}

export async function addressFromPublicKey(publicKey: Uint8Array, scriptConfig: DilithiumScriptConfig): Promise<string> {
  const lock = await buildLockScript({
    codeHash: scriptConfig.codeHash,
    hashType: scriptConfig.hashType,
    publicKey,
  });
  return encodeCkbAddress(lock, scriptConfig.network);
}

export async function getBalanceSummary(client: CkbRpcClient, lock: LockScript): Promise<BalanceSummary> {
  const cells = await client.getCells(lock);
  const totalCapacity = cells.reduce((sum, cell) => sum + hexToBigInt(cell.output.capacity), 0n);
  return {
    lock,
    totalCapacity,
    liveCells: cells.length,
  };
}

export async function inspectOutPoint(
  client: CkbRpcClient,
  outPoint: OutPoint,
  expectedLock?: LockScript,
): Promise<OutPointInspection> {
  const { status, cell } = await client.getLiveCell(outPoint);
  return {
    outPoint,
    status,
    cell,
    expectedLock,
    lockMatchesExpected: cell && expectedLock ? sameLock(cell.output.lock, expectedLock) : undefined,
  };
}

export async function getBalanceSourceInspection(client: CkbRpcClient): Promise<BalanceSourceInspection> {
  const rpcTip = await client.getTipHeader().catch(() => undefined);
  try {
    const indexerTip = await client.getIndexerTip();
    return {
      rpcTip,
      indexerTip,
      indexerReachable: true,
      indexerLag: rpcTip ? tipLag(rpcTip, indexerTip) : undefined,
    };
  } catch (error) {
    const message = error instanceof WalletError ? error.message : error instanceof Error ? error.message : String(error);
    return {
      rpcTip,
      indexerReachable: false,
      indexerError: message,
    };
  }
}

export function parseAddressToLock(address: string): LockScript {
  return decodeCkbAddress(address).script;
}

export async function getWalletState(
  client: CkbRpcClient,
  publicKey: Uint8Array,
  scriptConfig: DilithiumScriptConfig,
): Promise<WalletState> {
  const lock = await buildLockScript({
    codeHash: scriptConfig.codeHash,
    hashType: scriptConfig.hashType,
    publicKey,
  });
  const address = encodeCkbAddress(lock, scriptConfig.network);
  const balance = await getBalanceSummary(client, lock);
  const minimum = minimumCellCapacity(lock);
  return {
    address,
    lock,
    totalCapacity: balance.totalCapacity,
    liveCells: balance.liveCells,
    minimumCellCapacity: minimum,
    funded: balance.liveCells > 0 && balance.totalCapacity >= minimum,
  };
}

export async function waitForBalance(
  client: CkbRpcClient,
  publicKey: Uint8Array,
  scriptConfig: DilithiumScriptConfig,
  options: WaitForBalanceOptions = {},
): Promise<WaitForBalanceResult> {
  const start = Date.now();
  const timeoutMs = options.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? DEFAULT_WAIT_INTERVAL_MS;
  const minCapacity = options.minCapacity === undefined ? undefined : normalizeBigInt(options.minCapacity, "minCapacity");

  let attempts = 0;
  for (;;) {
    attempts += 1;
    const state = await getWalletState(client, publicKey, scriptConfig);
    const threshold = minCapacity ?? state.minimumCellCapacity;
    if (state.totalCapacity >= threshold && state.liveCells > 0) {
      return {
        state,
        attempts,
        elapsedMs: Date.now() - start,
      };
    }
    if (Date.now() - start >= timeoutMs) {
      throw new WalletError(
        "balance_wait_timeout",
        `timed out waiting for wallet funding after ${timeoutMs}ms`,
        {
          address: state.address,
          attempts,
          elapsedMs: Date.now() - start,
          minCapacity: threshold.toString(),
          observedCapacity: state.totalCapacity.toString(),
          liveCells: state.liveCells,
        },
      );
    }
    await sleep(intervalMs);
  }
}

export async function waitForTransactionConfirmation(
  client: CkbRpcClient,
  options: WaitForTransactionConfirmationOptions,
): Promise<WaitForTransactionConfirmationResult> {
  const start = Date.now();
  const timeoutMs = options.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? DEFAULT_WAIT_INTERVAL_MS;
  const accepted = options.acceptedStatuses ?? ["committed", "proposed", "pending"];

  let attempts = 0;
  for (;;) {
    attempts += 1;
    const transaction = await client.getTransaction(options.txHash);
    const status = transactionStatus(transaction);
    if (accepted.includes(status)) {
      return {
        txHash: options.txHash,
        status,
        transaction,
        attempts,
        elapsedMs: Date.now() - start,
      };
    }
    if (Date.now() - start >= timeoutMs) {
      throw new WalletError(
        "transaction_confirmation_timeout",
        `timed out waiting for transaction ${options.txHash} after ${timeoutMs}ms`,
        {
          txHash: options.txHash,
          attempts,
          elapsedMs: Date.now() - start,
          lastStatus: status,
        },
      );
    }
    await sleep(intervalMs);
  }
}

export function validateTransferRequest(options: BuildTransferOptions, recipientNetwork?: Network): TransferPreflight {
  if (recipientNetwork && !recipientMatchesNetwork(options.scriptConfig.network, recipientNetwork)) {
    throw new WalletError(
      "invalid_recipient_network",
      `recipient network ${recipientNetwork} does not match sender network ${options.scriptConfig.network}`,
      {
        senderNetwork: options.scriptConfig.network,
        recipientNetwork,
      },
    );
  }

  const amount = normalizeBigInt(options.amount, "amount");
  const changeLock = options.changeLock ?? options.fromLock;
  const recipientMinimumCapacity = minimumCellCapacity(options.toLock);
  const minimumChangeCapacity = minimumCellCapacity(changeLock);

  if (amount < recipientMinimumCapacity) {
    throw new WalletError(
      "amount_below_minimum_capacity",
      `amount is below the recipient minimum capacity of ${recipientMinimumCapacity} shannons`,
      {
        amount: amount.toString(),
        recipientMinimumCapacity: recipientMinimumCapacity.toString(),
      },
    );
  }

  const totalCapacity = options.cells
    .filter((cell) => sameLock(cell.output.lock, options.fromLock))
    .reduce((sum, cell) => sum + hexToBigInt(cell.output.capacity), 0n);

  if (totalCapacity < amount) {
    throw new WalletError(
      "insufficient_total_capacity",
      `wallet has ${totalCapacity} shannons but transfer requires at least ${amount} shannons before fees`,
      {
        totalCapacity: totalCapacity.toString(),
        amount: amount.toString(),
      },
    );
  }

  try {
    const unsigned = buildTransferTransaction(options);
    return {
      amount,
      recipientMinimumCapacity,
      minimumChangeCapacity,
      unsigned,
    };
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error;
    }
    if (error.message.includes("insufficient capacity to build transfer transaction")) {
      throw new WalletError(
        "insufficient_capacity_for_fee",
        `insufficient capacity to cover amount plus fee or create a valid change cell`,
        {
          totalCapacity: totalCapacity.toString(),
          amount: amount.toString(),
          minimumChangeCapacity: minimumChangeCapacity.toString(),
        },
      );
    }
    if (error.message.includes("recipient minimum capacity")) {
      throw new WalletError(
        "amount_below_minimum_capacity",
        error.message,
        {
          amount: amount.toString(),
          recipientMinimumCapacity: recipientMinimumCapacity.toString(),
        },
      );
    }
    throw error;
  }
}

export function buildTransferTransaction(options: BuildTransferOptions): UnsignedTransferTransaction {
  const amount = normalizeBigInt(options.amount, "amount");
  const feeRate = normalizeBigInt(options.feeRate ?? DEFAULT_FEE_RATE, "feeRate");
  const changeLock = options.changeLock ?? options.fromLock;
  const minimumRecipientCapacity = minimumCellCapacity(options.toLock);
  if (amount < minimumRecipientCapacity) {
    throw new Error(`amount is below the recipient minimum capacity of ${minimumRecipientCapacity} shannons`);
  }

  const sortedCells = [...options.cells].sort((left, right) => {
    const leftCapacity = hexToBigInt(left.output.capacity);
    const rightCapacity = hexToBigInt(right.output.capacity);
    if (leftCapacity < rightCapacity) {
      return -1;
    }
    if (leftCapacity > rightCapacity) {
      return 1;
    }
    return 0;
  });

  const selectedCells: LiveCell[] = [];
  let inputCapacity = 0n;
  let best: UnsignedTransferTransaction | undefined;

  for (const cell of sortedCells) {
    if (!sameLock(cell.output.lock, options.fromLock)) {
      continue;
    }

    selectedCells.push(cell);
    inputCapacity += hexToBigInt(cell.output.capacity);

    const tentativeOutputs: CellOutput[] = [
      {
        capacity: toHexQuantity(amount),
        lock: options.toLock,
      },
    ];
    const outputsData = ["0x"];

    const rawTransaction: RawTransaction = {
      version: "0x0",
      cellDeps: [options.scriptConfig.cellDep],
      headerDeps: [],
      inputs: selectedCells.map((selected) => ({
        previousOutput: selected.outPoint,
        since: "0x0",
      })),
      outputs: tentativeOutputs,
      outputsData,
    };

    const fee = estimateTransactionFee(rawTransaction, feeRate, selectedCells.length);
    const adjustedChange = inputCapacity - amount - fee;
    if (adjustedChange < 0n) {
      continue;
    }

    const minimumChange = minimumCellCapacity(changeLock);
    const finalizedOutputs = [...tentativeOutputs];
    const finalizedOutputsData = [...outputsData];
    let changeOutputCapacity = 0n;

    if (adjustedChange > 0n) {
      if (adjustedChange < minimumChange) {
        continue;
      }
      finalizedOutputs.push({
        capacity: toHexQuantity(adjustedChange),
        lock: changeLock,
      });
      finalizedOutputsData.push("0x");
      changeOutputCapacity = adjustedChange;
    }

    const finalizedRawTransaction: RawTransaction = {
      ...rawTransaction,
      outputs: finalizedOutputs,
      outputsData: finalizedOutputsData,
    };
    const txSize = estimateTransactionSize(finalizedRawTransaction, selectedCells.length);
    best = {
      rawTransaction: finalizedRawTransaction,
      placeholderTransaction: withPlaceholderWitnesses(finalizedRawTransaction, selectedCells.length),
      fee,
      inputCapacity,
      outputCapacity: amount + changeOutputCapacity,
      changeCapacity: changeOutputCapacity,
      selectedCells: [...selectedCells],
      txSize,
    };
    break;
  }

  if (!best) {
    throw new Error("insufficient capacity to build transfer transaction");
  }

  return best;
}

export async function sealTransaction(options: SealTransactionOptions): Promise<SignedTransaction> {
  const txHashBytes = await computeTransactionHash(options.rawTransaction);
  const publicKey = toBytes(options.publicKey);
  const secretKey = toBytes(options.secretKey);
  const signature = await signTxHash(secretKey, txHashBytes);
  const witnessLock = buildWitnessLock(publicKey, signature);
  const witnessCount = options.witnessCount ?? options.rawTransaction.inputs.length;
  const witnesses = Array.from({ length: witnessCount }, (_, index) =>
    index === 0 ? encodeWitnessArgs(witnessLock) : encodeWitnessArgs(),
  );
  return {
    transaction: {
      ...options.rawTransaction,
      witnesses,
    },
    txHash: bytesToHex(txHashBytes),
    witnessLock: bytesToHex(witnessLock),
  };
}

export async function buildSignedTransfer(options: BuildSignedTransferOptions): Promise<SignedTransferTransaction> {
  const unsigned = buildTransferTransaction(options);
  const signed = await sealTransaction({
    rawTransaction: unsigned.rawTransaction,
    publicKey: options.publicKey,
    secretKey: options.secretKey,
    witnessCount: unsigned.selectedCells.length,
  });
  return {
    ...unsigned,
    transaction: signed.transaction,
    txHash: signed.txHash,
    witnessLock: signed.witnessLock,
  };
}

export async function computeTransactionHash(rawTransaction: RawTransaction): Promise<Uint8Array> {
  return ckbHash(serializeRawTransaction(rawTransaction));
}

export function minimumCellCapacity(lock: LockScript, dataHex = "0x", type?: LockScript | null): bigint {
  const lockArgs = BigInt(hexToBytes(lock.args).length);
  const lockBytes = SCRIPT_SIZE_BASE + lockArgs;
  const typeBytes = type ? SCRIPT_SIZE_BASE + BigInt(hexToBytes(type.args).length) : 0n;
  const dataBytes = BigInt(hexToBytes(dataHex).length);
  return (CELL_OUTPUT_BASE + lockBytes + typeBytes + dataBytes) * SHANNONS_PER_CKB;
}

function withPlaceholderWitnesses(rawTransaction: RawTransaction, witnessCount: number): Transaction {
  return {
    ...rawTransaction,
    witnesses: Array.from({ length: witnessCount }, (_, index) =>
      index === 0 ? encodeWitnessArgs(new Uint8Array(WITNESS_LOCK_BYTES)) : encodeWitnessArgs(),
    ),
  };
}

function estimateTransactionFee(rawTransaction: RawTransaction, feeRate: bigint, witnessCount: number): bigint {
  const txSize = estimateTransactionSize(rawTransaction, witnessCount);
  return (BigInt(txSize) * feeRate + 999n) / 1000n;
}

function estimateTransactionSize(rawTransaction: RawTransaction, witnessCount: number): number {
  const tx = withPlaceholderWitnesses(rawTransaction, witnessCount);
  return serializeTransaction(tx).length;
}

function encodeWitnessArgs(lock?: Uint8Array): string {
  return bytesToHex(serializeTable([encodeOptionBytes(lock), encodeOptionBytes(), encodeOptionBytes()]));
}

function encodeOptionBytes(value?: Uint8Array): Uint8Array {
  return value ? serializeBytes(value) : new Uint8Array();
}

function serializeTransaction(transaction: Transaction): Uint8Array {
  return serializeTable([
    serializeRawTransaction(transaction),
    serializeBytesVec(transaction.witnesses.map(hexToBytes)),
  ]);
}

function serializeRawTransaction(rawTransaction: RawTransaction): Uint8Array {
  return serializeTable([
    u32ToLeBytes(Number(hexToBigInt(rawTransaction.version))),
    serializeCellDepVec(rawTransaction.cellDeps),
    serializeByte32Vec(rawTransaction.headerDeps.map(hexToBytes)),
    serializeCellInputVec(rawTransaction.inputs),
    serializeCellOutputVec(rawTransaction.outputs),
    serializeBytesVec(rawTransaction.outputsData.map(hexToBytes)),
  ]);
}

function serializeCellDepVec(cellDeps: CellDep[]): Uint8Array {
  return serializeFixVec(
    cellDeps.map((cellDep) => concatBytes(serializeOutPoint(cellDep.outPoint), Uint8Array.of(cellDep.depType === "code" ? 0 : 1))),
  );
}

function serializeCellInputVec(inputs: TransactionInput[]): Uint8Array {
  return serializeFixVec(
    inputs.map((input) => concatBytes(u64ToLeBytes(hexToBigInt(input.since)), serializeOutPoint(input.previousOutput))),
  );
}

function serializeCellOutputVec(outputs: CellOutput[]): Uint8Array {
  return serializeDynVec(outputs.map((output) => serializeCellOutput(output)));
}

function serializeCellOutput(output: CellOutput): Uint8Array {
  return serializeTable([
    u64ToLeBytes(hexToBigInt(output.capacity)),
    serializeScript(output.lock),
    serializeScriptOpt(output.type ?? null),
  ]);
}

function serializeScript(script: LockScript): Uint8Array {
  return serializeTable([
    hexToBytes(script.codeHash),
    Uint8Array.of(hashTypeByte(script.hashType)),
    serializeBytes(hexToBytes(script.args)),
  ]);
}

function serializeScriptOpt(script: LockScript | null): Uint8Array {
  return script ? serializeScript(script) : new Uint8Array();
}

function serializeOutPoint(outPoint: OutPoint): Uint8Array {
  return concatBytes(hexToBytes(outPoint.txHash), u32ToLeBytes(Number(hexToBigInt(outPoint.index))));
}

function serializeByte32Vec(items: Uint8Array[]): Uint8Array {
  return serializeFixVec(items);
}

function serializeBytes(bytes: Uint8Array): Uint8Array {
  return serializeFixVec(Array.from(bytes, (byte) => Uint8Array.of(byte)));
}

function serializeBytesVec(items: Uint8Array[]): Uint8Array {
  return serializeDynVec(items.map((item) => serializeBytes(item)));
}

function serializeFixVec(items: Uint8Array[]): Uint8Array {
  return concatBytes(u32ToLeBytes(items.length), ...items);
}

function serializeDynVec(items: Uint8Array[]): Uint8Array {
  const headerSize = 4 + items.length * 4;
  let offset = headerSize;
  const offsets = items.map((item) => {
    const current = u32ToLeBytes(offset);
    offset += item.length;
    return current;
  });
  return concatBytes(u32ToLeBytes(offset), ...offsets, ...items);
}

function serializeTable(fields: Uint8Array[]): Uint8Array {
  return serializeDynVec(fields);
}

function hashTypeByte(hashType: LockScript["hashType"]): number {
  if (hashType === "data") {
    return 0;
  }
  if (hashType === "type") {
    return 1;
  }
  const version = Number(hashType.slice(4));
  if (!Number.isInteger(version) || version < 1 || version > 127) {
    throw new Error(`unsupported hash type: ${hashType}`);
  }
  return version << 1;
}

function normalizeBigInt(value: bigint | number | string, label: string): bigint {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new Error(`${label} must be a safe integer when provided as a number`);
    }
    return BigInt(value);
  }
  return value.startsWith("0x") ? hexToBigInt(value) : BigInt(value);
}

function sameLock(left: LockScript, right: LockScript): boolean {
  return left.codeHash === right.codeHash && left.hashType === right.hashType && left.args === right.args;
}

function recipientMatchesNetwork(sender: Network, recipient: Network): boolean {
  if (sender === "mainnet") {
    return recipient === "mainnet";
  }
  return recipient !== "mainnet";
}

function wrapIndexerError(error: unknown, endpoint: string): WalletError {
  if (error instanceof WalletError) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  return new WalletError(
    "indexer_unavailable",
    `unable to query live cells from ${endpoint}; an indexer-backed endpoint is required`,
    {
      endpoint,
      cause: message,
    },
  );
}

function transactionStatus(transaction: unknown): WalletTransactionStatus {
  if (transaction == null) {
    return "unknown";
  }
  if (typeof transaction !== "object") {
    return "unknown";
  }
  const maybeTx = transaction as {
    tx_status?: { status?: unknown };
    txStatus?: { status?: unknown };
  };
  const rawStatus = maybeTx.tx_status?.status ?? maybeTx.txStatus?.status;
  if (typeof rawStatus !== "string") {
    return "pending";
  }
  if (rawStatus === "pending" || rawStatus === "proposed" || rawStatus === "committed" || rawStatus === "rejected") {
    return rawStatus;
  }
  return "unknown";
}

function toRpcScript(lock: LockScript): RpcScript {
  return {
    code_hash: lock.codeHash,
    hash_type: lock.hashType,
    args: lock.args,
  };
}

function toRpcOutPoint(outPoint: OutPoint): RpcOutPoint {
  return {
    tx_hash: outPoint.txHash,
    index: outPoint.index,
  };
}

function toRpcCellDep(cellDep: CellDep): RpcCellDep {
  return {
    out_point: toRpcOutPoint(cellDep.outPoint),
    dep_type: cellDep.depType === "code" ? "code" : "dep_group",
  };
}

function toRpcCellOutput(output: CellOutput): RpcCellOutput {
  return {
    capacity: output.capacity,
    lock: toRpcScript(output.lock),
    type: output.type ? toRpcScript(output.type) : output.type ?? null,
  };
}

function toRpcInput(input: TransactionInput): RpcInput {
  return {
    previous_output: toRpcOutPoint(input.previousOutput),
    since: input.since,
  };
}

function toRpcTransaction(transaction: Transaction): RpcTransaction {
  return {
    version: transaction.version,
    cell_deps: transaction.cellDeps.map(toRpcCellDep),
    header_deps: transaction.headerDeps,
    inputs: transaction.inputs.map(toRpcInput),
    outputs: transaction.outputs.map(toRpcCellOutput),
    outputs_data: transaction.outputsData,
    witnesses: transaction.witnesses,
  };
}

function fromRpcScript(script: RpcScript): LockScript {
  return {
    codeHash: script.code_hash,
    hashType: script.hash_type as LockScript["hashType"],
    args: script.args,
  };
}

function fromRpcOutPoint(outPoint: RpcOutPoint): OutPoint {
  return {
    txHash: outPoint.tx_hash,
    index: outPoint.index,
  };
}

function fromRpcCellOutput(output: RpcCellOutput): CellOutput {
  return {
    capacity: output.capacity,
    lock: fromRpcScript(output.lock),
    type: output.type ? fromRpcScript(output.type) : output.type ?? null,
  };
}

function fromRpcResolvedOutPointCell(cell: { output: RpcCellOutput; data: RpcCellData }): ResolvedOutPointCell {
  return {
    output: fromRpcCellOutput(cell.output),
    outputData: cell.data.content,
  };
}

function fromRpcIndexerCell(cell: RpcIndexerCell): LiveCell {
  return {
    blockNumber: cell.block_number,
    outPoint: fromRpcOutPoint(cell.out_point),
    output: fromRpcCellOutput(cell.output),
    outputData: cell.output_data,
    txIndex: cell.tx_index,
  };
}

function fromRpcTipHeader(tip: RpcTipHeader): ChainTip {
  return {
    blockHash: tip.hash ?? tip.block_hash,
    blockNumber: tip.number ?? tip.block_number ?? "0x0",
  };
}

function liveCellStatus(status: string | undefined): OutPointStatus {
  if (status === "live" || status === "dead" || status === "unknown") {
    return status;
  }
  return "unknown";
}

function tipLag(rpcTip: ChainTip, indexerTip: ChainTip): bigint {
  const rpcBlock = hexToBigInt(rpcTip.blockNumber);
  const indexerBlock = hexToBigInt(indexerTip.blockNumber);
  return rpcBlock > indexerBlock ? rpcBlock - indexerBlock : 0n;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
