import { generateKeypair } from "../dist/index.js";

const { publicKey, secretKey } = await generateKeypair();

console.log("Public key:", Buffer.from(publicKey).toString("hex"));
console.log("Secret key length:", secretKey.length);
