#!/usr/bin/env node
import indexModule from "../dist/index.js";

// Maintain compatibility with both CommonJS and ESM outputs
const run = indexModule?.default ?? indexModule;
const printError = indexModule.printError;

try {
	await run();
} catch (err) {
	printError(err instanceof Error ? err.message : String(err));
	process.exitCode = 1;
}
