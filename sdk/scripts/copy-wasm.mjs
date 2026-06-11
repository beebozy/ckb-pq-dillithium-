import { mkdir, access, copyFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const source = resolve(repoRoot, "target/wasm32-unknown-unknown/release/dillithium_wasm.wasm");
const destinationDir = resolve(repoRoot, "sdk/dist/wasm");
const destination = resolve(destinationDir, "dillithium_wasm.wasm");

try {
  await access(source); 
} catch {
  throw new Error(`Missing wasm artifact at ${source}. Run \`npm run build:wasm\` from the repository root first.`);
}

await mkdir(destinationDir, { recursive: true });
await copyFile(source, destination);
