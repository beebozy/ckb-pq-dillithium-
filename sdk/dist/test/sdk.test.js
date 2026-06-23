import test from "node:test";
import assert from "node:assert/strict";
import { CkbRpcClient, DEFAULT_FEE_RATE, LOCK_ARGS_LEN, PUBLIC_KEY_LEN, SECRET_KEY_LEN, SHANNONS_PER_CKB, SIGNATURE_LEN, WITNESS_LOCK_BYTES, WalletError, buildTransferTransaction, buildWitnessLock, computeLockArgs, decodeCkbAddress, encodeCkbAddress, generateKeypair, getBalanceSourceInspection, getWalletState, inspectOutPoint, minimumCellCapacity, parseWitnessLock, sealTransaction, signTxHash, validateTransferRequest, verifySignature, waitForBalance, waitForTransactionConfirmation, } from "../index.js";
const txHash = new Uint8Array(Array.from({ length: 32 }, (_, index) => index + 1));
const sampleLock = {
    codeHash: `0x${"11".repeat(32)}`,
    hashType: "data2",
    args: `0x${"22".repeat(32)}`,
};
const sampleCellDep = {
    outPoint: {
        txHash: `0x${"33".repeat(32)}`,
        index: "0x0",
    },
    depType: "code",
};
function makeLiveCell(capacity, suffix) {
    return {
        blockNumber: "0x1",
        outPoint: {
            txHash: `0x${suffix.repeat(64)}`.slice(0, 66),
            index: "0x0",
        },
        output: {
            capacity: `0x${capacity.toString(16)}`,
            lock: sampleLock,
        },
        outputData: "0x",
        txIndex: "0x0",
    };
}
function transferOptions(cells) {
    return {
        cells,
        fromLock: sampleLock,
        toLock: sampleLock,
        amount: 80n * SHANNONS_PER_CKB,
        scriptConfig: {
            codeHash: sampleLock.codeHash,
            hashType: sampleLock.hashType,
            cellDep: sampleCellDep,
            network: "testnet",
        },
        feeRate: DEFAULT_FEE_RATE,
    };
}
const sampleOutPoint = {
    txHash: `0x${"55".repeat(32)}`,
    index: "0x0",
};
test("generateKeypair returns correctly sized keys", async () => {
    const keypair = await generateKeypair();
    assert.equal(keypair.publicKey.length, PUBLIC_KEY_LEN);
    assert.equal(keypair.secretKey.length, SECRET_KEY_LEN);
});
test("computeLockArgs is deterministic for the same public key", async () => {
    const keypair = await generateKeypair();
    const first = await computeLockArgs(keypair.publicKey);
    const second = await computeLockArgs(keypair.publicKey);
    assert.equal(first.length, LOCK_ARGS_LEN);
    assert.deepEqual(first, second);
});
test("buildWitnessLock round-trips through parseWitnessLock", async () => {
    const keypair = await generateKeypair();
    const signature = await signTxHash(keypair.secretKey, txHash);
    const witness = buildWitnessLock(keypair.publicKey, signature);
    const parsed = parseWitnessLock(witness);
    assert.deepEqual(parsed.publicKey, keypair.publicKey);
    assert.deepEqual(parsed.signature, signature);
});
test("signTxHash and verifySignature agree", async () => {
    const keypair = await generateKeypair();
    const signature = await signTxHash(keypair.secretKey, txHash);
    assert.equal(signature.length, SIGNATURE_LEN);
    assert.equal(await verifySignature(keypair.publicKey, txHash, signature), true);
    const tampered = txHash.slice();
    tampered[0] ^= 0xff;
    assert.equal(await verifySignature(keypair.publicKey, tampered, signature), false);
});
test("buildWitnessLock rejects malformed lengths", async () => {
    await assert.rejects(async () => buildWitnessLock(new Uint8Array(PUBLIC_KEY_LEN - 1), new Uint8Array(SIGNATURE_LEN)), /public key must be/);
    await assert.rejects(async () => buildWitnessLock(new Uint8Array(PUBLIC_KEY_LEN), new Uint8Array(SIGNATURE_LEN - 1)), /signature must be/);
});
test("encodeCkbAddress round-trips custom full-format addresses", () => {
    const address = encodeCkbAddress(sampleLock, "testnet");
    const decoded = decodeCkbAddress(address);
    assert.equal(decoded.network, "testnet");
    assert.deepEqual(decoded.script, sampleLock);
});
test("minimumCellCapacity accounts for 32-byte Dilithium lock args", () => {
    assert.equal(minimumCellCapacity(sampleLock), 73n * SHANNONS_PER_CKB);
});
test("buildTransferTransaction creates change output and placeholder witness", () => {
    const tx = buildTransferTransaction(transferOptions([
        makeLiveCell(90n * SHANNONS_PER_CKB, "aa"),
        makeLiveCell(100n * SHANNONS_PER_CKB, "bb"),
    ]));
    assert.equal(tx.selectedCells.length, 2);
    assert.equal(tx.rawTransaction.outputs.length, 2);
    assert.equal(tx.placeholderTransaction.witnesses.length, 2);
    const firstWitness = tx.placeholderTransaction.witnesses[0];
    assert.ok(firstWitness.startsWith("0x"));
    assert.ok(firstWitness.length > WITNESS_LOCK_BYTES * 2);
    assert.ok(tx.changeCapacity > 0n);
});
test("sealTransaction signs the raw transaction hash and fills witnesses", async () => {
    const keypair = await generateKeypair();
    const unsigned = buildTransferTransaction(transferOptions([
        makeLiveCell(90n * SHANNONS_PER_CKB, "cc"),
        makeLiveCell(100n * SHANNONS_PER_CKB, "dd"),
    ]));
    const signed = await sealTransaction({
        rawTransaction: unsigned.rawTransaction,
        publicKey: keypair.publicKey,
        secretKey: keypair.secretKey,
        witnessCount: unsigned.selectedCells.length,
    });
    assert.equal(signed.transaction.witnesses.length, unsigned.selectedCells.length);
    const parsed = parseWitnessLock(Uint8Array.from(Buffer.from(signed.witnessLock.slice(2), "hex")));
    assert.deepEqual(parsed.publicKey, keypair.publicKey);
    assert.equal(signed.txHash.length, 66);
});
test("getCells omits the initial cursor and paginates with the returned cursor", async () => {
    const requests = [];
    const responses = [
        {
            jsonrpc: "2.0",
            id: 1,
            result: {
                last_cursor: "cursor-1",
                objects: [
                    {
                        block_number: "0x1",
                        out_point: {
                            tx_hash: `0x${"77".repeat(32)}`,
                            index: "0x0",
                        },
                        output: {
                            capacity: `0x${(80n * SHANNONS_PER_CKB).toString(16)}`,
                            lock: {
                                code_hash: sampleLock.codeHash,
                                hash_type: sampleLock.hashType,
                                args: sampleLock.args,
                            },
                            type: null,
                        },
                        output_data: "0x",
                        tx_index: "0x0",
                    },
                ],
            },
        },
        {
            jsonrpc: "2.0",
            id: 2,
            result: {
                last_cursor: "cursor-1",
                objects: [
                    {
                        block_number: "0x2",
                        out_point: {
                            tx_hash: `0x${"88".repeat(32)}`,
                            index: "0x1",
                        },
                        output: {
                            capacity: `0x${(90n * SHANNONS_PER_CKB).toString(16)}`,
                            lock: {
                                code_hash: sampleLock.codeHash,
                                hash_type: sampleLock.hashType,
                                args: sampleLock.args,
                            },
                            type: null,
                        },
                        output_data: "0x",
                        tx_index: "0x0",
                    },
                ],
            },
        },
    ];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_input, init) => {
        const body = JSON.parse(String(init?.body));
        requests.push(body);
        const next = responses.shift();
        assert.ok(next);
        return new Response(JSON.stringify(next), {
            status: 200,
            headers: { "content-type": "application/json" },
        });
    };
    try {
        const client = new CkbRpcClient({
            rpcUrl: "https://rpc.invalid",
            indexerUrl: "https://indexer.invalid",
        });
        const cells = await client.getCells(sampleLock);
        assert.equal(cells.length, 2);
        assert.equal(requests.length, 2);
        assert.equal(requests[0]?.method, "get_cells");
        assert.equal(requests[0]?.params.length, 3);
        assert.deepEqual(requests[1]?.params.at(-1), "cursor-1");
    }
    finally {
        globalThis.fetch = originalFetch;
    }
});
test("getWalletState reports funded status and minimum capacity", async () => {
    const keypair = await generateKeypair();
    const fundedCell = makeLiveCell(80n * SHANNONS_PER_CKB, "ee");
    const client = {
        async getCells() {
            return [fundedCell];
        },
    };
    const state = await getWalletState(client, keypair.publicKey, {
        codeHash: sampleLock.codeHash,
        hashType: sampleLock.hashType,
        cellDep: sampleCellDep,
        network: "testnet",
    });
    assert.equal(state.funded, true);
    assert.equal(state.liveCells, 1);
    assert.equal(state.minimumCellCapacity, 73n * SHANNONS_PER_CKB);
    assert.ok(state.address.startsWith("ckt1"));
});
test("inspectOutPoint reports a live matching cell", async () => {
    const client = {
        async getLiveCell() {
            return {
                status: "live",
                cell: {
                    output: {
                        capacity: `0x${(80n * SHANNONS_PER_CKB).toString(16)}`,
                        lock: sampleLock,
                    },
                    outputData: "0x",
                },
            };
        },
    };
    const inspection = await inspectOutPoint(client, sampleOutPoint, sampleLock);
    assert.equal(inspection.status, "live");
    assert.equal(inspection.lockMatchesExpected, true);
    assert.deepEqual(inspection.outPoint, sampleOutPoint);
});
test("inspectOutPoint reports a live mismatched cell", async () => {
    const client = {
        async getLiveCell() {
            return {
                status: "live",
                cell: {
                    output: {
                        capacity: `0x${(80n * SHANNONS_PER_CKB).toString(16)}`,
                        lock: {
                            ...sampleLock,
                            args: `0x${"66".repeat(32)}`,
                        },
                    },
                    outputData: "0x",
                },
            };
        },
    };
    const inspection = await inspectOutPoint(client, sampleOutPoint, sampleLock);
    assert.equal(inspection.status, "live");
    assert.equal(inspection.lockMatchesExpected, false);
});
test("inspectOutPoint reports dead and unknown outpoints without cell data", async () => {
    const deadClient = {
        async getLiveCell() {
            return {
                status: "dead",
            };
        },
    };
    const unknownClient = {
        async getLiveCell() {
            return {
                status: "unknown",
            };
        },
    };
    const dead = await inspectOutPoint(deadClient, sampleOutPoint, sampleLock);
    const unknown = await inspectOutPoint(unknownClient, sampleOutPoint, sampleLock);
    assert.equal(dead.status, "dead");
    assert.equal(dead.cell, undefined);
    assert.equal(unknown.status, "unknown");
    assert.equal(unknown.cell, undefined);
});
test("getIndexerTip parses snake_case indexer responses", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_input, init) => {
        const body = JSON.parse(String(init?.body));
        const result = body.method === "get_tip_header"
            ? {
                hash: `0x${"99".repeat(32)}`,
                number: "0x10",
            }
            : {
                block_hash: `0x${"aa".repeat(32)}`,
                block_number: "0x0c",
            };
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), {
            status: 200,
            headers: { "content-type": "application/json" },
        });
    };
    try {
        const client = new CkbRpcClient({
            rpcUrl: "https://rpc.invalid",
            indexerUrl: "https://indexer.invalid",
        });
        const tip = await client.getIndexerTip();
        const inspection = await getBalanceSourceInspection(client);
        assert.equal(tip.blockNumber, "0x0c");
        assert.equal(inspection.indexerReachable, true);
        assert.equal(inspection.indexerTip?.blockNumber, "0x0c");
        assert.equal(inspection.indexerLag, 4n);
    }
    finally {
        globalThis.fetch = originalFetch;
    }
});
test("getBalanceSourceInspection reports indexer lag or unavailability", async () => {
    const laggedClient = {
        async getTipHeader() {
            return { blockNumber: "0x10" };
        },
        async getIndexerTip() {
            return { blockNumber: "0x0c" };
        },
    };
    const unavailableClient = {
        async getTipHeader() {
            return { blockNumber: "0x10" };
        },
        async getIndexerTip() {
            throw new WalletError("indexer_unavailable", "indexer down");
        },
    };
    const alignedClient = {
        async getTipHeader() {
            return { blockNumber: "0x10" };
        },
        async getIndexerTip() {
            return { blockNumber: "0x10" };
        },
    };
    const lagged = await getBalanceSourceInspection(laggedClient);
    const unavailable = await getBalanceSourceInspection(unavailableClient);
    const aligned = await getBalanceSourceInspection(alignedClient);
    assert.equal(lagged.indexerReachable, true);
    assert.equal(lagged.indexerLag, 4n);
    assert.equal(unavailable.indexerReachable, false);
    assert.match(unavailable.indexerError ?? "", /indexer down/);
    assert.equal(aligned.indexerReachable, true);
    assert.equal(aligned.indexerLag, 0n);
});
test("waitForBalance resolves after funding appears", async () => {
    const keypair = await generateKeypair();
    let calls = 0;
    const client = {
        async getCells() {
            calls += 1;
            return calls === 1 ? [] : [makeLiveCell(80n * SHANNONS_PER_CKB, "ff")];
        },
    };
    const result = await waitForBalance(client, keypair.publicKey, {
        codeHash: sampleLock.codeHash,
        hashType: sampleLock.hashType,
        cellDep: sampleCellDep,
        network: "testnet",
    }, {
        timeoutMs: 50,
        intervalMs: 0,
    });
    assert.equal(result.state.funded, true);
    assert.equal(result.attempts, 2);
});
test("waitForBalance times out with a wallet error", async () => {
    const keypair = await generateKeypair();
    const client = {
        async getCells() {
            return [];
        },
    };
    await assert.rejects(async () => waitForBalance(client, keypair.publicKey, {
        codeHash: sampleLock.codeHash,
        hashType: sampleLock.hashType,
        cellDep: sampleCellDep,
        network: "testnet",
    }, {
        timeoutMs: 0,
        intervalMs: 0,
    }), (error) => error instanceof WalletError && error.code === "balance_wait_timeout");
});
test("waitForTransactionConfirmation resolves when a committed status appears", async () => {
    let calls = 0;
    const client = {
        async getTransaction() {
            calls += 1;
            return calls === 1
                ? { tx_status: { status: "pending" } }
                : { tx_status: { status: "committed" }, transaction: { hash: "0xabc" } };
        },
    };
    const result = await waitForTransactionConfirmation(client, {
        txHash: "0xabc",
        timeoutMs: 50,
        intervalMs: 0,
        acceptedStatuses: ["committed"],
    });
    assert.equal(result.status, "committed");
    assert.equal(result.attempts, 2);
});
test("waitForTransactionConfirmation times out with a wallet error", async () => {
    const client = {
        async getTransaction() {
            return { tx_status: { status: "pending" } };
        },
    };
    await assert.rejects(async () => waitForTransactionConfirmation(client, {
        txHash: "0xdead",
        timeoutMs: 0,
        intervalMs: 0,
        acceptedStatuses: ["committed"],
    }), (error) => error instanceof WalletError && error.code === "transaction_confirmation_timeout");
});
test("validateTransferRequest rejects recipient network mismatch", () => {
    assert.throws(() => validateTransferRequest(transferOptions([makeLiveCell(100n * SHANNONS_PER_CKB, "11")]), "mainnet"), (error) => error instanceof WalletError && error.code === "invalid_recipient_network");
});
test("validateTransferRequest rejects amounts below minimum capacity", () => {
    assert.throws(() => validateTransferRequest({
        ...transferOptions([makeLiveCell(100n * SHANNONS_PER_CKB, "22")]),
        amount: 72n * SHANNONS_PER_CKB,
    }, "testnet"), (error) => error instanceof WalletError && error.code === "amount_below_minimum_capacity");
});
test("validateTransferRequest rejects insufficient total capacity", () => {
    assert.throws(() => validateTransferRequest({
        ...transferOptions([makeLiveCell(79n * SHANNONS_PER_CKB, "33")]),
        amount: 80n * SHANNONS_PER_CKB,
    }, "testnet"), (error) => error instanceof WalletError && error.code === "insufficient_total_capacity");
});
test("validateTransferRequest rejects transfers that cannot cover fee or valid change", () => {
    assert.throws(() => validateTransferRequest({
        ...transferOptions([makeLiveCell(80n * SHANNONS_PER_CKB, "44")]),
        amount: 79n * SHANNONS_PER_CKB,
    }, "testnet"), (error) => error instanceof WalletError && error.code === "insufficient_capacity_for_fee");
});
