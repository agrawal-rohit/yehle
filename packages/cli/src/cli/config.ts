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
	/** Environment variables used for XDG_CONFIG_HOME / HOME. */
	env?: NodeJS.ProcessEnv;
	/** Homedir used when XDG_CONFIG_HOME is unset. Defaults to `os.homedir()`. */
	homedir?: string;
}

/**
 * Resolve the absolute path to the global tuckshop config file.
 * Prefers `$XDG_CONFIG_HOME/tuckshop/config.json`, otherwise `~/.config/tuckshop/config.json`.
 * @param options - Optional env/homedir overrides for tests.
 * @returns Absolute config file path.
 */
export function configPath(options: ConfigPathOptions = {}): string {
	const env = options.env ?? process.env;
	const xdg = env.XDG_CONFIG_HOME?.trim();

	// Honour XDG_CONFIG_HOME when set, otherwise use the home directory.
	const base = xdg
		? path.resolve(xdg)
		: path.join(options.homedir ?? os.homedir(), ".config");
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
		// If the file does not exist, return an empty config.
		const code =
			error && typeof error === "object" && "code" in error
				? (error as NodeJS.ErrnoException).code
				: undefined;
		if (code === "ENOENT") return {};
		throw error;
	}

	try {
		// Parse the raw config file as JSON.
		const parsed = JSON.parse(raw) as unknown;
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
			throw new Error("Config root must be a JSON object.");
		return parsed as TuckshopConfig;
	} catch (error) {
		// If the config file is malformed, throw an error.
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(
			`Malformed tuckshop config at ${filePath}: ${message}. Fix or delete the file, then retry.`,
		);
	}
}

/**
 * Write the global tuckshop config, creating parent directories as needed.
 * The file is written with mode `0o600`.
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
	// Read the config file.
	const config = await readConfig(options);
	if (config.registry === undefined) return false;

	// If the config file is empty, delete it and return true.
	const { registry: _removed, ...rest } = config;
	if (Object.keys(rest).length === 0) {
		const filePath = configPath(options);
		try {
			await fs.promises.unlink(filePath);
		} catch (error) {
			const code =
				error && typeof error === "object" && "code" in error
					? (error as NodeJS.ErrnoException).code
					: undefined;
			if (code !== "ENOENT") throw error;
		}
		return true;
	}

	// Write the config file.
	await writeConfig(rest, options);
	return true;
}
