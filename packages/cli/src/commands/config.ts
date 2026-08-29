import path from "node:path";
import {
	assertSafeRemoteUrl,
	isAbsoluteHttpUrl,
	PathKind,
	pathKindAsync,
	publishedRegistryUrl,
	readJsonFileAsync,
} from "@tuckshop/core";
import {
	configPath,
	readConfig,
	unsetRegistryConfig,
	writeConfig,
} from "../cli/config";
import { defaultText, primaryText } from "../cli/labels";
import { textInput } from "../cli/prompts";

/**
 * Read the published default registry URL for the current CLI version.
 * @returns Absolute HTTPS URL to `packages/registry/registry.json`.
 */
async function defaultRegistryUrl(): Promise<string> {
	const pkg = (await readJsonFileAsync(
		path.resolve(__dirname, "../../package.json"),
		"CLI package.json",
	)) as { version: string };
	return publishedRegistryUrl(pkg.version);
}

/**
 * Print the active registry source and config file path to stdout.
 * @param registry - Registry URL or local path currently in effect.
 * @param filePath - Absolute path of the config file.
 */
function printConfiguration(registry: string, filePath: string): void {
	console.log();
	console.log(primaryText("Configuration"));
	console.log(defaultText(`  registry:    ${registry}`));
	console.log(defaultText(`  config file: ${filePath}`));
	console.log();
}

/**
 * Validate a registry source and return the value to write to the config file.
 * @param source - Registry URL or local path (already trimmed).
 * @returns HTTPS URL or absolute local file path ready for the config file.
 * @throws Error when the source is empty, an unsafe remote URL, or is not an existing file.
 */
async function toPersistedRegistrySource(source: string): Promise<string> {
	if (!source) throw new Error("Registry source must not be empty.");

	if (isAbsoluteHttpUrl(source)) {
		assertSafeRemoteUrl(new URL(source));
		return source;
	}

	const absolutePath = path.resolve(process.cwd(), source);
	const kind = await pathKindAsync(absolutePath);
	switch (kind) {
		case PathKind.FILE:
			return absolutePath;
		case PathKind.DIRECTORY:
			throw new Error(
				`Registry path "${source}" points to ${absolutePath}, which is not a file.`,
			);
		case PathKind.ABSENT:
			throw new Error(
				`Registry path "${source}" does not exist (looked up as ${absolutePath}). Pass an HTTPS URL or a path to an existing registry.json.`,
			);
		/* v8 ignore start */
		// Stryker disable all: unreachable exhaustive default
		default: {
			const _never: never = kind;
			throw new Error(`Unhandled path kind: ${String(_never)}`);
		}
		// Stryker restore all
		/* v8 ignore stop */
	}
}

/**
 * Persist a default registry source to the global config.
 * @param source - Optional registry URL or local path from the CLI.
 * @param env - Environment used for config path resolution. Defaults to `process.env`.
 * @returns Absolute path of the config file that was written.
 * @throws Error when the source is empty, an unsafe remote URL, or not an existing file.
 */
export async function configSetCommand(
	source?: string,
	env?: NodeJS.ProcessEnv,
): Promise<string> {
	let input = source?.trim() ?? "";
	if (!input)
		input = await textInput("Registry URL or local path", {
			placeholder: "https://example.com/registry.json",
			required: true,
		});

	const toStore = await toPersistedRegistrySource(input);
	const existing = await readConfig(env);
	await writeConfig({ ...existing, registry: toStore }, env);
	const filePath = configPath(env);
	printConfiguration(toStore, filePath);

	return filePath;
}

/**
 * Print the saved registry, or the bundled default registry URL when unset.
 * @param env - Environment used for config path resolution. Defaults to `process.env`.
 */
export async function configGetCommand(env?: NodeJS.ProcessEnv): Promise<void> {
	const config = await readConfig(env);
	const filePath = configPath(env);
	const registry = config.registry ?? (await defaultRegistryUrl());
	printConfiguration(registry, filePath);
}

/**
 * Clear the saved registry source and fall back to the published default.
 * @param env - Environment used for config path resolution. Defaults to `process.env`.
 * @returns True when a previously saved registry was cleared.
 */
export async function configUnsetCommand(
	env?: NodeJS.ProcessEnv,
): Promise<boolean> {
	const cleared = await unsetRegistryConfig(env);
	const filePath = configPath(env);
	const registry = await defaultRegistryUrl();
	printConfiguration(registry, filePath);

	return cleared;
}
