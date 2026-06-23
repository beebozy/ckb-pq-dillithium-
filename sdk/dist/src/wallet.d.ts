import type { BalanceSourceInspection, BalanceSummary, BuildSignedTransferOptions, BuildTransferOptions, ChainTip, DilithiumScriptConfig, LiveCell, LockScript, Network, OutPoint, OutPointInspection, OutPointStatus, RawTransaction, ResolvedOutPointCell, RpcConfig, SealTransactionOptions, SignedTransaction, SignedTransferTransaction, Transaction, TransferPreflight, UnsignedTransferTransaction, WaitForBalanceOptions, WaitForBalanceResult, WaitForTransactionConfirmationOptions, WaitForTransactionConfirmationResult, WalletErrorCode, WalletState } from "./types.js";
export declare class WalletError extends Error {
    readonly code: WalletErrorCode;
    readonly details?: Record<string, unknown> | undefined;
    constructor(code: WalletErrorCode, message: string, details?: Record<string, unknown> | undefined);
}
export declare class CkbRpcClient {
    private readonly config;
    private nextId;
    constructor(config: RpcConfig);
    getTipHeader(): Promise<ChainTip>;
    getIndexerTip(): Promise<ChainTip>;
    getLiveCell(outPoint: OutPoint, withData?: boolean): Promise<{
        status: OutPointStatus;
        cell?: ResolvedOutPointCell;
    }>;
    sendTransaction(transaction: Transaction): Promise<string>;
    getTransaction(txHash: string): Promise<unknown>;
    getCells(lock: LockScript, limit?: number): Promise<LiveCell[]>;
    private request;
}
export declare function addressFromPublicKey(publicKey: Uint8Array, scriptConfig: DilithiumScriptConfig): Promise<string>;
export declare function getBalanceSummary(client: CkbRpcClient, lock: LockScript): Promise<BalanceSummary>;
export declare function inspectOutPoint(client: CkbRpcClient, outPoint: OutPoint, expectedLock?: LockScript): Promise<OutPointInspection>;
export declare function getBalanceSourceInspection(client: CkbRpcClient): Promise<BalanceSourceInspection>;
export declare function parseAddressToLock(address: string): LockScript;
export declare function getWalletState(client: CkbRpcClient, publicKey: Uint8Array, scriptConfig: DilithiumScriptConfig): Promise<WalletState>;
export declare function waitForBalance(client: CkbRpcClient, publicKey: Uint8Array, scriptConfig: DilithiumScriptConfig, options?: WaitForBalanceOptions): Promise<WaitForBalanceResult>;
export declare function waitForTransactionConfirmation(client: CkbRpcClient, options: WaitForTransactionConfirmationOptions): Promise<WaitForTransactionConfirmationResult>;
export declare function validateTransferRequest(options: BuildTransferOptions, recipientNetwork?: Network): TransferPreflight;
export declare function buildTransferTransaction(options: BuildTransferOptions): UnsignedTransferTransaction;
export declare function sealTransaction(options: SealTransactionOptions): Promise<SignedTransaction>;
export declare function buildSignedTransfer(options: BuildSignedTransferOptions): Promise<SignedTransferTransaction>;
export declare function computeTransactionHash(rawTransaction: RawTransaction): Promise<Uint8Array>;
export declare function minimumCellCapacity(lock: LockScript, dataHex?: string, type?: LockScript | null): bigint;
