import test from "node:test";
import assert from "node:assert/strict";
import { LOCK_ARGS_LEN, PUBLIC_KEY_LEN, SECRET_KEY_LEN, SIGNATURE_LEN, buildWitnessLock, computeLockArgs, generateKeypair, parseWitnessLock, signTxHash, verifySignature, } from "../src/index.js";
const txHash = new Uint8Array(Array.from({ length: 32 }, (_, index) => index + 1));
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
