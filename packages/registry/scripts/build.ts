#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { buildRegistry } from "@tuckshop/core";

const packageRoot = path.resolve(__dirname, "..");

/**
 * Build the default registry document with a content base URL that matches
 * GitHub paths under packages/registry and the release workflow tag format.
 */
async function main(): Promise<void> {
	const pkg = JSON.parse(
		fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"),
	) as { version: string };

	// Sources are relative to this package (`registry/...`). The release workflow
	// tags the published CLI as `tuckshop@<version>`, so raw URLs use that ref.
	await buildRegistry({
		repoRoot: packageRoot,
		contentBaseUrl: `https://raw.githubusercontent.com/agrawal-rohit/tuckshop/tuckshop@${pkg.version}/packages/registry`,
	});
}

main().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`build-registry failed: ${message}`);
	process.exit(1);
});
