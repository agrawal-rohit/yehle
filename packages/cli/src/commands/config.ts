import fs from "node:fs";
import path from "node:path";
import { defaultText, primaryText } from "@tuckshop/common";
import {
	type ConfigPathOptions,
	configPath,
	readConfig,
	unsetRegistryConfig,
	writeConfig,
} from "../cli/config";

/**
 * Resolve the published default registry URL for the current CLI version.
 * Matches the release-tag raw URL used by `@tuckshop/registry`’s build script.
 * @returns Absolute HTTPS URL to `packages/registry/registry.json`.
 */
async function defaultRegistryUrl(): Promise<string> {
	const pkg = JSON.parse(
		await fs.promises.readFile(
			path.resolve(__dirname, "../../package.json"),
			"utf8",
		),
	) as { version: string };
	return `https://raw.githubusercontent.com/agrawal-rohit/tuckshop/tuckshop@${pkg.version}/packages/registry/registry.json`;
}

/**
 * Persist a default registry source to the global config.
 * Accepts absolute HTTP(S) URLs, or local paths that resolve to an existing file.
 * @param source - Registry URL or local path.
 * @param options - Optional config path overrides for tests.
 * @returns Absolute path of the config file that was written.
 * @throws Error when the source is empty, not a URL, or not an existing file.
 */
export async function configSetCommand(
	source: string,
	options: ConfigPathOptions = {},
): Promise<string> {
	const trimmed = source.trim();
	if (!trimmed) throw new Error("Registry source must not be empty.");

	// If the source is not a URL, resolve it to a local file.
	if (!/^https?:\/\//i.test(trimmed)) {
		const resolved = path.resolve(process.cwd(), trimmed);
		try {
			const stat = await fs.promises.stat(resolved);
			if (!stat.isFile())
				throw new Error(
					`Registry path "${trimmed}" resolves to ${resolved}, which is not a file.`,
				);
		} catch (error) {
			// Throw our own "not a file" error if it's a file system error
			if (error instanceof Error && error.message.includes("is not a file"))
				throw error;
			throw new Error(
				`Registry path "${trimmed}" does not exist (resolved to ${resolved}). Pass an HTTPS URL or a path to an existing registry.json.`,
			);
		}
	}

	const existing = await readConfig(options);
	await writeConfig({ ...existing, registry: trimmed }, options);
	const filePath = configPath(options);

	console.log();
	console.log(primaryText("Configuration"));
	console.log(defaultText(`  registry:    ${trimmed}`));
	console.log(defaultText(`  config file: ${filePath}`));
	console.log();

	return filePath;
}

/**
 * Print the saved registry, or the bundled default registry URL when unset.
 * @param options - Optional config path overrides for tests.
 */
export async function configGetCommand(
	options: ConfigPathOptions = {},
): Promise<void> {
	const config = await readConfig(options);
	const filePath = configPath(options);
	const registry = config.registry ?? (await defaultRegistryUrl());

	console.log();
	console.log(primaryText("Configuration"));
	console.log(defaultText(`  registry:    ${registry}`));
	console.log(defaultText(`  config file: ${filePath}`));
	console.log();
}

/**
 * Clear the saved registry source and fall back to the published default.
 * @param options - Optional config path overrides for tests.
 * @returns True when a previously saved registry was cleared.
 */
export async function configUnsetCommand(
	options: ConfigPathOptions = {},
): Promise<boolean> {
	const cleared = await unsetRegistryConfig(options);
	const filePath = configPath(options);
	const registry = await defaultRegistryUrl();

	console.log();
	console.log(primaryText("Configuration"));
	console.log(defaultText(`  registry:    ${registry}`));
	console.log(defaultText(`  config file: ${filePath}`));
	console.log();

	return cleared;
}
