#!/usr/bin/env node
import { buildRegistry } from "../src/registry/builder";

async function main(): Promise<void> {
	await buildRegistry();
}

main().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`build-registry failed: ${message}`);
	process.exit(1);
});
