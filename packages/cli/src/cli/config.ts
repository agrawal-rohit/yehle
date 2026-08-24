import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isErrnoCode } from "./errors";

/** Persisted tuckshop CLI settings (`registry` = default URL or local path). */
export type TuckshopConfig = {
	registry?: string;
};

/**
 * Return the absolute path to the global tuckshop config file.
 * @param env - Environment used for `XDG_CONFIG_HOME`. Defaults to `process.env`.
 * @returns Absolute config file path.
 */
export function configPath(env: NodeJS.ProcessEnv = process.env): string {
	const xdg = env.XDG_CONFIG_HOME?.trim();

	// Honour XDG_CONFIG_HOME when set, otherwise use the home directory.
	const base = xdg ? path.resolve(xdg) : path.join(os.homedir(), ".config");
	return path.join(base, "tuckshop", "config.json");
}

/**
 * Read the global tuckshop config.
 * @param env - Environment used for config path resolution. Defaults to `process.env`.
 * @returns Parsed config object.
 * @throws Error when the config file exists but cannot be parsed as JSON.
 */
export async function readConfig(
	env?: NodeJS.ProcessEnv,
): Promise<TuckshopConfig> {
	const filePath = configPath(env);

	let raw: string;
	try {
		raw = await fs.promises.readFile(filePath, "utf8");
	} catch (error) {
		if (isErrnoCode(error, "ENOENT")) return {};
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

		if (typeof registry === "string")
			return { ...(parsed as TuckshopConfig), registry: registry.trim() };

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
 * @param env - Environment used for config path resolution. Defaults to `process.env`.
 */
export async function writeConfig(
	config: TuckshopConfig,
	env?: NodeJS.ProcessEnv,
): Promise<void> {
	// Create the parent directories if they don't exist.
	const filePath = configPath(env);
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
 * @param env - Environment used for config path resolution. Defaults to `process.env`.
 * @returns True when a previously saved registry was cleared.
 */
export async function unsetRegistryConfig(
	env?: NodeJS.ProcessEnv,
): Promise<boolean> {
	const config = await readConfig(env);
	if (config.registry === undefined) return false;

	// Leave no empty config file on disk when registry was the only key.
	const { registry: _removed, ...rest } = config;
	if (Object.keys(rest).length === 0) {
		await fs.promises.rm(configPath(env), { force: true });
		return true;
	}

	await writeConfig(rest, env);
	return true;
}
