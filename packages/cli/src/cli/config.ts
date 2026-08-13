import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Persisted tuckshop CLI settings. */
export interface TuckshopConfig {
	/** Default registry URL or local path. */
	registry?: string;
}

/** Options that control where the config file is resolved. */
export interface ConfigPathOptions {
	/** Environment variables used for XDG_CONFIG_HOME. */
	env?: NodeJS.ProcessEnv;
}

/**
 * Resolve the absolute path to the global tuckshop config file.
 * Prefers `$XDG_CONFIG_HOME/tuckshop/config.json`, otherwise `~/.config/tuckshop/config.json`.
 * @param options - Optional env overrides for tests.
 * @returns Absolute config file path.
 */
export function configPath(options: ConfigPathOptions = {}): string {
	const env = options.env ?? process.env;
	const xdg = env.XDG_CONFIG_HOME?.trim();

	// Honour XDG_CONFIG_HOME when set, otherwise use the home directory.
	const base = xdg ? path.resolve(xdg) : path.join(os.homedir(), ".config");
	return path.join(base, "tuckshop", "config.json");
}

/**
 * Read the global tuckshop config.
 * Missing files resolve to an empty config; malformed JSON fails fast with the file path.
 * @param options - Optional path resolution overrides for tests.
 * @returns Parsed config object.
 * @throws Error when the config file exists but cannot be parsed as JSON.
 */
export async function readConfig(
	options: ConfigPathOptions = {},
): Promise<TuckshopConfig> {
	const filePath = configPath(options);

	let raw: string;
	try {
		raw = await fs.promises.readFile(filePath, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
		throw error;
	}

	try {
		const parsed = JSON.parse(raw) as unknown;
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
			throw new Error("Config root must be a JSON object.");

		const { registry } = parsed as Record<string, unknown>;
		if (
			registry !== undefined &&
			(typeof registry !== "string" || !registry.trim())
		)
			throw new Error(
				'"registry" must be a non-empty string URL or file path.',
			);

		return parsed as TuckshopConfig;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(
			`Malformed tuckshop config at ${filePath}: ${message}. Fix or delete the file, then retry.`,
		);
	}
}

/**
 * Write the global tuckshop config, creating parent directories as needed.
 * @param config - Config object to persist.
 * @param options - Optional path resolution overrides for tests.
 */
export async function writeConfig(
	config: TuckshopConfig,
	options: ConfigPathOptions = {},
): Promise<void> {
	// Create the parent directories if they don't exist.
	const filePath = configPath(options);
	await fs.promises.mkdir(path.dirname(filePath), { recursive: true });

	// Write the config file.
	await fs.promises.writeFile(
		filePath,
		`${JSON.stringify(config, null, "\t")}\n`,
		{ encoding: "utf8", mode: 0o600 },
	);
}

/**
 * Remove the saved registry key from the global config.
 * Deletes the config file entirely when no keys remain; no-ops when unset.
 * @param options - Optional path resolution overrides for tests.
 * @returns True when a previously saved registry was cleared.
 */
export async function unsetRegistryConfig(
	options: ConfigPathOptions = {},
): Promise<boolean> {
	const config = await readConfig(options);
	if (config.registry === undefined) return false;

	// Leave no empty config file on disk when registry was the only key.
	const { registry: _removed, ...rest } = config;
	if (Object.keys(rest).length === 0) {
		await fs.promises.rm(configPath(options), { force: true });
		return true;
	}

	await writeConfig(rest, options);
	return true;
}
