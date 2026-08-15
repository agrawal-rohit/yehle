#!/usr/bin/env node
import path from "node:path";
import { buildRegistry, primaryText } from "@tuckshop/core";

/**
 * Builds the default registry from the package contents at the given root.
 * @param isMain - Whether this module is the process entry (injectable for tests).
 * @param packageRoot - Absolute package root containing `package.json` and `registry/`.
 *   Defaults to `process.argv[2]`, then this package.
 */
export async function startCli(
	isMain: boolean = require.main === module,
	packageRoot: string | undefined = process.argv[2],
): Promise<void> {
	if (!isMain) return;

	try {
		const root = path.resolve(packageRoot ?? path.resolve(__dirname, ".."));
		const document = await buildRegistry({
			sourceDir: path.join(root, "registry"),
			outDir: root,
		});
		const itemCount = Object.keys(document.items).length;
		const outputPath = path.relative(root, path.join(root, "registry.json"));
		console.log(
			itemCount === 0
				? `Built empty registry at ${primaryText(outputPath)}.`
				: `Built ${itemCount} registry items at ${primaryText(outputPath)}.`,
		);
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`build-registry failed: ${message}`);
		process.exit(1);
	}
}

void startCli();
