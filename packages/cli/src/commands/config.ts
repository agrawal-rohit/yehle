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

/** Origin of the effective registry source for the current invocation. */
export enum RegistrySourceOrigin {
	Flag = "flag",
	Env = "env",
	Config = "config",
	Default = "default",
}

/** Inputs used to describe where the effective registry source comes from. */
export interface EffectiveRegistryOriginOptions {
	/** Explicit `--registry` flag value. */
	flag?: string;
	/** `TUCKSHOP_REGISTRY` environment value. */
	envRegistry?: string;
	/** Registry source saved via `tuckshop config set`. */
	saved?: string;
}

/**
 * Check whether a registry source string should be treated as a URL.
 * @param value - Candidate registry source.
 * @returns True when the source is an absolute HTTP(S) URL.
 */
function isUrlSource(value: string): boolean {
	return /^https?:\/\//i.test(value);
}

/**
 * Resolve which origin supplies the effective registry source.
 * Precedence matches `resolveRegistrySource`: flag > env > saved config > bundled default.
 * @param options - Candidate sources for this invocation.
 * @returns Origin label for display.
 */
export function resolveEffectiveRegistryOrigin(
	options: EffectiveRegistryOriginOptions,
): RegistrySourceOrigin {
	if (options.flag) return RegistrySourceOrigin.Flag;
	if (options.envRegistry) return RegistrySourceOrigin.Env;
	if (options.saved) return RegistrySourceOrigin.Config;
	return RegistrySourceOrigin.Default;
}

/**
 * Validate a registry source before persisting it.
 * Accepts absolute HTTP(S) URLs, or local paths that resolve to an existing file.
 * @param source - Raw source string from the CLI.
 * @param cwd - Working directory used to resolve relative paths.
 * @returns Trimmed source string ready to save.
 * @throws Error when the source is empty, not a URL, or not an existing file.
 */
export async function validateRegistrySource(
	source: string,
	cwd: string = process.cwd(),
): Promise<string> {
	const trimmed = source.trim();
	if (!trimmed) throw new Error("Registry source must not be empty.");

	if (isUrlSource(trimmed)) return trimmed;

	const resolved = path.resolve(cwd, trimmed);
	try {
		const stat = await fs.promises.stat(resolved);
		if (!stat.isFile())
			throw new Error(
				`Registry path "${trimmed}" resolves to ${resolved}, which is not a file.`,
			);
	} catch (error) {
		if (error instanceof Error && error.message.includes("is not a file"))
			throw error;
		throw new Error(
			`Registry path "${trimmed}" does not exist (resolved to ${resolved}). Pass an HTTPS URL or a path to an existing registry.json.`,
		);
	}

	return trimmed;
}

/**
 * Persist a default registry source to the global config.
 * @param source - Registry URL or local path.
 * @param options - Optional config path overrides for tests.
 * @returns Absolute path of the config file that was written.
 */
export async function configSetCommand(
	source: string,
	options: ConfigPathOptions = {},
): Promise<string> {
	const validated = await validateRegistrySource(source);
	const existing = await readConfig(options);
	await writeConfig({ ...existing, registry: validated }, options);
	const filePath = configPath(options);

	console.log();
	console.log(primaryText("Registry source saved"));
	console.log(defaultText(`  source: ${validated}`));
	console.log(defaultText(`  config: ${filePath}`));
	console.log();

	return filePath;
}

/**
 * Print the saved registry source and the effective origin for this invocation.
 * @param options - Effective-origin inputs plus optional config path overrides.
 */
export async function configGetCommand(
	options: EffectiveRegistryOriginOptions & ConfigPathOptions = {},
): Promise<void> {
	const config = await readConfig(options);
	const saved = config.registry;
	const filePath = configPath(options);
	const origin = resolveEffectiveRegistryOrigin({
		flag: options.flag,
		envRegistry: options.envRegistry,
		saved,
	});

	console.log();
	console.log(primaryText("Registry config"));
	console.log(
		defaultText(saved ? `  saved:     ${saved}` : "  saved:     (not set)"),
	);
	console.log(defaultText(`  config:    ${filePath}`));
	console.log(defaultText(`  origin:    ${origin}`));

	const effective =
		options.flag ?? options.envRegistry ?? saved ?? "(bundled default)";
	console.log(defaultText(`  effective: ${effective}`));
	console.log();
}

/**
 * Clear the saved registry source from the global config.
 * @param options - Optional config path overrides for tests.
 * @returns True when a previously saved registry was cleared.
 */
export async function configUnsetCommand(
	options: ConfigPathOptions = {},
): Promise<boolean> {
	const cleared = await unsetRegistryConfig(options);
	const filePath = configPath(options);

	console.log();
	if (cleared) {
		console.log(primaryText("Registry source cleared"));
		console.log(defaultText(`  config: ${filePath}`));
	} else {
		console.log(defaultText("No saved registry source to clear."));
		console.log(defaultText(`  config: ${filePath}`));
	}
	console.log();

	return cleared;
}
