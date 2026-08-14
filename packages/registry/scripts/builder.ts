import fs from "node:fs";
import path from "node:path";
import {
	parseRegistryDocument,
	parseWithSchema,
	type Registry,
	type RegistryFile,
	type RegistryItem,
	type RegistryVariant,
	registryFileSchema,
	registryItemSchema,
} from "@tuckshop/core";
import { z } from "zod";

/** Optional string array used when compiling item/variant dependency lists. */
const optionalStringArraySchema = z
	.array(z.string().min(1))
	.transform((value) => (value.length > 0 ? value : undefined));

/** Optional `when` matcher object used when compiling variants. */
const whenRecordSchema = z
	.record(z.string(), z.string().min(1))
	.transform((value) => {
		if (Object.keys(value).length === 0) return undefined;
		return value;
	});

export interface BuildRegistryOptions {
	/**
	 * Absolute path to the registry content package root (directory that
	 * contains `registry/` and `package.json`).
	 */
	repoRoot?: string;
	/**
	 * Base URL for file sources (`${contentBaseUrl}/${source}`). Overridden by
	 * `TUCKSHOP_REGISTRY_BASE_URL` when that env var is set.
	 */
	contentBaseUrl: string;
}

/**
 * Parse an optional string array.
 * @param raw - Raw array value.
 * @param label - Error context.
 * @returns Normalized string array, or undefined when empty/absent.
 * @throws Error when the array is malformed.
 */
function parseStringArray(raw: unknown, label: string): string[] | undefined {
	if (raw === undefined || raw === null) return undefined;
	if (!Array.isArray(raw)) throw new Error(`${label} must be an array.`);

	return parseWithSchema(optionalStringArraySchema, raw, label);
}

/**
 * Parse an optional `when` matcher object.
 * @param raw - Raw matcher value.
 * @param label - Error context.
 * @returns Normalized matcher map, or undefined when absent/empty.
 * @throws Error when the matcher is malformed.
 */
function parseWhen(
	raw: unknown,
	label: string,
): Record<string, string> | undefined {
	if (raw === undefined || raw === null) return undefined;

	return parseWithSchema(whenRecordSchema, raw, `${label} when`);
}

/**
 * Recursively collect the folder of every registry-item.json under registry/.
 * @param dir - Directory to walk.
 * @returns Absolute paths to item folders (each containing a registry-item.json).
 */
function collectItemDirs(dir: string): string[] {
	const results: string[] = [];
	let entries: fs.Dirent[] = [];

	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return results;
	}

	// If the directory contains a registry-item.json, add it to the results
	if (entries.some((e) => e.isFile() && e.name === "registry-item.json"))
		results.push(dir);

	// If the directory contains a subdirectory, recursively collect the item folders
	for (const entry of entries)
		if (entry.isDirectory())
			results.push(...collectItemDirs(path.join(dir, entry.name)));

	return results;
}

/**
 * Build lean file metadata with repo-relative sources.
 * @param itemDir - Absolute item folder.
 * @param itemId - Item id for errors.
 * @param repoRoot - Absolute repo root for relative source paths.
 * @param files - Raw file entries from the variant or item manifest.
 * @returns Built registry files.
 * @throws Error when a file entry is invalid or the source path is missing.
 */
function buildRegistryFiles(
	itemDir: string,
	itemId: string,
	repoRoot: string,
	files: unknown[],
): RegistryFile[] {
	return files.map((rawFile, index) => {
		const file = parseWithSchema(
			registryFileSchema,
			rawFile,
			`Registry item "${itemId}" file[${index}]`,
		);

		// Check if the file exists
		const absolutePath = path.join(itemDir, file.source);
		if (!fs.existsSync(absolutePath))
			throw new Error(
				`Registry item "${itemId}" references missing file: ${path.relative(repoRoot, absolutePath)}`,
			);

		// Convert the file path to a relative path
		const source = path
			.relative(repoRoot, absolutePath)
			.split(path.sep)
			.join("/");

		return { source, target: file.target };
	});
}

/**
 * Parse and validate a single registry item manifest into lean metadata.
 * @param itemDir - Absolute path to the item folder.
 * @param repoRoot - Absolute repo root for relative source paths.
 * @returns Built registry item (no inlined content).
 * @throws Error when the manifest is invalid or references missing files.
 */
function buildRegistryItem(itemDir: string, repoRoot: string): RegistryItem {
	const manifestPath = path.join(itemDir, "registry-item.json");
	const raw = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as unknown;

	// Check if the manifest is valid
	if (!raw || typeof raw !== "object" || Array.isArray(raw))
		throw new Error(
			`Registry item manifest at "${path.relative(repoRoot, manifestPath)}" must be an object.`,
		);

	const manifest = raw as Record<string, unknown>;

	// Check if the variants are valid
	if (!Array.isArray(manifest.variants) || manifest.variants.length === 0)
		throw new Error(
			`Registry item "${String(manifest.id)}" must declare at least one variant.`,
		);

	const variants: RegistryVariant[] = [];
	for (const [variantIndex, rawVariant] of manifest.variants.entries()) {
		if (
			!rawVariant ||
			typeof rawVariant !== "object" ||
			Array.isArray(rawVariant)
		)
			throw new Error(
				`Registry item "${String(manifest.id)}" variant at index ${variantIndex} must be an object.`,
			);

		const variantManifest = rawVariant as Record<string, unknown>;

		if (
			!Array.isArray(variantManifest.files) ||
			variantManifest.files.length === 0
		)
			throw new Error(
				`Registry item "${String(manifest.id)}" variant "${String(variantManifest.id)}" has no files.`,
			);

		const files = buildRegistryFiles(
			itemDir,
			String(manifest.id),
			repoRoot,
			variantManifest.files,
		);

		const when = parseWhen(
			variantManifest.when,
			`Registry item "${String(manifest.id)}" variant "${String(variantManifest.id)}"`,
		);

		const variant: RegistryVariant = {
			id: String(variantManifest.id),
			title: String(variantManifest.title),
			description: String(variantManifest.description),
			...(when ? { when } : {}),
			files,
		};

		// Parse the dependencies
		if (Array.isArray(variantManifest.dependencies)) {
			const deps = parseStringArray(
				variantManifest.dependencies,
				`Registry item "${String(manifest.id)}" variant "${String(variantManifest.id)}" dependencies`,
			);
			if (deps) variant.dependencies = deps;
		}

		// Parse the dev dependencies
		if (Array.isArray(variantManifest.devDependencies)) {
			const deps = parseStringArray(
				variantManifest.devDependencies,
				`Registry item "${String(manifest.id)}" variant "${String(variantManifest.id)}" devDependencies`,
			);
			if (deps) variant.devDependencies = deps;
		}

		const registryDependencies = parseStringArray(
			variantManifest.registryDependencies,
			`Registry item "${String(manifest.id)}" variant "${String(variantManifest.id)}" registryDependencies`,
		);
		if (registryDependencies)
			variant.registryDependencies = registryDependencies;

		variants.push(variant);
	}

	const sharedFiles =
		Array.isArray(manifest.files) && manifest.files.length > 0
			? buildRegistryFiles(
					itemDir,
					String(manifest.id),
					repoRoot,
					manifest.files,
				)
			: undefined;
	const dependencies = parseStringArray(
		manifest.dependencies,
		`Registry item "${String(manifest.id)}" dependencies`,
	);
	const devDependencies = parseStringArray(
		manifest.devDependencies,
		`Registry item "${String(manifest.id)}" devDependencies`,
	);

	const registryDependencies = parseStringArray(
		manifest.registryDependencies,
		`Registry item "${String(manifest.id)}" registryDependencies`,
	);

	const item: RegistryItem = {
		id: String(manifest.id),
		title: String(manifest.title),
		description: String(manifest.description),
		type: String(manifest.type),
		...(sharedFiles ? { files: sharedFiles } : {}),
		...(dependencies ? { dependencies } : {}),
		...(devDependencies ? { devDependencies } : {}),
		variants,
		...(registryDependencies ? { registryDependencies } : {}),
	};

	return parseWithSchema(
		registryItemSchema,
		item,
		`Registry item "${String(manifest.id)}"`,
	);
}

/**
 * Resolve the content base URL from env override or required options.
 * @param options - Build options that must include contentBaseUrl when env is unset.
 * @returns Content base URL with trailing slashes stripped.
 * @throws Error when neither the env override nor options provide a URL.
 */
function resolveContentBaseUrl(options: BuildRegistryOptions): string {
	const override = process.env.TUCKSHOP_REGISTRY_BASE_URL;
	let contentBaseUrl =
		override && override.length > 0 ? override : options.contentBaseUrl;
	if (!contentBaseUrl)
		throw new Error(
			"contentBaseUrl is required (or set TUCKSHOP_REGISTRY_BASE_URL).",
		);
	while (contentBaseUrl.endsWith("/"))
		contentBaseUrl = contentBaseUrl.slice(0, -1);
	return contentBaseUrl;
}

/**
 * Compile all registry items into registry.json at the repo root.
 * @param options - Build options controlling the source root and content base URL.
 * @returns The built registry document that was written to disk.
 * @throws Error when no items are found, an item is invalid, or a duplicate id exists.
 */
export async function buildRegistry(
	options: BuildRegistryOptions,
): Promise<Registry> {
	const repoRoot = options.repoRoot ?? process.cwd();
	const registryDir = path.join(repoRoot, "registry");
	const outputPath = path.join(repoRoot, "registry.json");

	const itemFolderPaths = collectItemDirs(registryDir);

	// Build the registry items
	const items: Record<string, RegistryItem> = {};
	for (const itemDir of itemFolderPaths) {
		const item = buildRegistryItem(itemDir, repoRoot);
		if (items[item.id])
			throw new Error(`Duplicate registry item id: "${item.id}".`);
		items[item.id] = item;
	}

	// Sort the items by id
	const sortedItems = Object.fromEntries(
		Object.entries(items).sort(([a], [b]) => a.localeCompare(b)),
	);

	// Read the conditions file if it exists
	const conditionsPath = path.join(registryDir, "conditions.json");
	let rawConditions: unknown;
	if (fs.existsSync(conditionsPath))
		rawConditions = JSON.parse(
			fs.readFileSync(conditionsPath, "utf8"),
		) as unknown;

	// Types are a required part of every registry
	const typesPath = path.join(registryDir, "types.json");
	if (!fs.existsSync(typesPath))
		throw new Error(
			`Registry types not found at ${path.relative(repoRoot, typesPath)}.`,
		);
	const rawTypes = JSON.parse(fs.readFileSync(typesPath, "utf8")) as unknown;

	const document = parseRegistryDocument({
		contentBaseUrl: resolveContentBaseUrl(options),
		...(rawConditions !== undefined ? { conditions: rawConditions } : {}),
		types: rawTypes,
		items: sortedItems,
	});

	await fs.promises.writeFile(
		outputPath,
		`${JSON.stringify(document, null, 2)}\n`,
	);
	const itemCount = Object.keys(sortedItems).length;
	console.log(
		itemCount === 0
			? `Built empty registry at ${path.relative(repoRoot, outputPath)}.`
			: `Built ${itemCount} registry items at ${path.relative(repoRoot, outputPath)}.`,
	);

	return document;
}
