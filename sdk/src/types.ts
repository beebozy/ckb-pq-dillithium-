export type ByteLike = Uint8Array | ArrayBuffer | ArrayLike<number>;

export type ScriptHashType = "data" | "type" | `data${number}`;
export type DepType = "code" | "depGroup";
export type Network = "mainnet" | "testnet" | "devnet";
export type WalletTransactionStatus = "unknown" | "pending" | "proposed" | "committed" | "rejected";
export type WalletErrorCode =
  | "amount_below_minimum_capacity"
  | "insufficient_total_capacity"
  | "insufficient_capacity_for_fee"
  | "change_below_minimum_capacity"
  | "indexer_unavailable"
  | "transaction_confirmation_timeout"
  | "balance_wait_timeout"
  | "invalid_key_file"
  | "invalid_recipient_network";

export interface DilithiumKeypair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

export interface ParsedWitnessLock {
  publicKey: Uint8Array;
  signature: Uint8Array;
}

export interface LockScript {
  codeHash: string;
  hashType: ScriptHashType;
  args: string;
}

export interface OutPoint {
  txHash: string;
  index: string;
}

export type OutPointStatus = "live" | "dead" | "unknown";

export interface ChainTip {
  blockHash?: string;
  blockNumber: string;
}

export interface ResolvedOutPointCell {
  output: CellOutput;
  outputData: string;
}

export interface OutPointInspection {
  outPoint: OutPoint;
  status: OutPointStatus;
  cell?: ResolvedOutPointCell;
  expectedLock?: LockScript;
  lockMatchesExpected?: boolean;
}

export interface BalanceSourceInspection {
  rpcTip?: ChainTip;
  indexerTip?: ChainTip;
  indexerReachable: boolean;
  indexerLag?: bigint;
  indexerError?: string;
}

export interface CellDep {
  outPoint: OutPoint;
  depType: DepType;
}

export interface CellOutput {
  capacity: string;
  lock: LockScript;
  type?: LockScript | null;
}

export interface TransactionInput {
  previousOutput: OutPoint;
  since: string;
}

export interface RawTransaction {
  version: string;
  cellDeps: CellDep[];
  headerDeps: string[];
  inputs: TransactionInput[];
  outputs: CellOutput[];
  outputsData: string[];
}

export interface Transaction extends RawTransaction {
  witnesses: string[];
}

export interface DilithiumScriptConfig {
  codeHash: string;
  hashType: ScriptHashType;
  cellDep: CellDep;
  network: Network;
}

export interface RpcConfig {
  rpcUrl: string;
  indexerUrl?: string;
}

export interface LiveCell {
  blockNumber: string;
  outPoint: OutPoint;
  output: CellOutput;
  outputData: string;
  txIndex: string;
}

export interface DecodedCkbAddress {
  network: "mainnet" | "testnet";
  script: LockScript;
}

export interface BalanceSummary {
  lock: LockScript;
  totalCapacity: bigint;
  liveCells: number;
}

export interface WalletState {
  address: string;
  lock: LockScript;
  totalCapacity: bigint;
  liveCells: number;
  minimumCellCapacity: bigint;
  funded: boolean;
}

export interface WaitForBalanceOptions {
  minCapacity?: bigint | number | string;
  timeoutMs?: number;
  intervalMs?: number;
}

export interface WaitForBalanceResult {
  state: WalletState;
  attempts: number;
  elapsedMs: number;
}

export interface WaitForTransactionConfirmationOptions {
  txHash: string;
  timeoutMs?: number;
  intervalMs?: number;
  acceptedStatuses?: WalletTransactionStatus[];
}

export interface WaitForTransactionConfirmationResult {
  txHash: string;
  status: WalletTransactionStatus;
  transaction: unknown;
  attempts: number;
  elapsedMs: number;
}

export interface BuildTransferOptions {
  cells: LiveCell[];
  fromLock: LockScript;
  toLock: LockScript;
  amount: bigint | number | string;
  scriptConfig: DilithiumScriptConfig;
  changeLock?: LockScript;
  feeRate?: bigint | number | string;
}

export interface UnsignedTransferTransaction {
  rawTransaction: RawTransaction;
  placeholderTransaction: Transaction;
  fee: bigint;
  inputCapacity: bigint;
  outputCapacity: bigint;
  changeCapacity: bigint;
  selectedCells: LiveCell[];
  txSize: number;
}

export interface TransferPreflight {
  amount: bigint;
  recipientMinimumCapacity: bigint;
  minimumChangeCapacity: bigint;
  unsigned: UnsignedTransferTransaction;
}

export interface SealTransactionOptions {
  rawTransaction: RawTransaction;
  publicKey: ByteLike;
  secretKey: ByteLike;
  witnessCount?: number;
}

export interface SignedTransaction {
  transaction: Transaction;
  txHash: string;
  witnessLock: string;
}

export interface BuildSignedTransferOptions extends BuildTransferOptions {
  publicKey: ByteLike;
  secretKey: ByteLike;
}

export interface SignedTransferTransaction extends UnsignedTransferTransaction {
  transaction: Transaction;
  txHash: string;
  witnessLock: string;
}
