import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);
const sourcePath = path.resolve(packageRoot, "../registry/registry.json");
const destinationPath = path.resolve(packageRoot, "registry.json");

await fs.copyFile(sourcePath, destinationPath);
console.log(`Embedded default registry from ${sourcePath}.`);
