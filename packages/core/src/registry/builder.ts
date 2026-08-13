import fs from "node:fs";
import path from "node:path";
import { readJSONFileAsync, writeFileAsync } from "../core/fs";
import { assertNonEmptyString, parseStringArray, parseWhen } from "./parse";
import type {
	Registry,
	RegistryCondition,
	RegistryFile,
	RegistryItem,
	RegistryVariant,
} from "./schema";
import {
	crossValidateItemTypes,
	crossValidateWhen,
	parseRegistryConditions,
	parseRegistryItemTypes,
	validateRegistryItem,
} from "./validate";

/**
 * Default content base for single-package registries that keep `registry/` at
 * the repository root and publish `v<version>` tags. Monorepo layouts should
 * pass an explicit `contentBaseUrl` instead.
 */
const REGISTRY_REPO_RAW_BASE =
	"https://raw.githubusercontent.com/agrawal-rohit/tuckshop";

export interface BuildRegistryOptions {
	/**
	 * Absolute path to the registry content package root (directory that
	 * contains `registry/` and `package.json`).
	 */
	repoRoot?: string;
	/**
	 * Base URL for file sources (`${contentBaseUrl}/${source}`). When omitted,
	 * defaults to `${REGISTRY_REPO_RAW_BASE}/v${package.json version}`.
	 */
	contentBaseUrl?: string;
}

/**
 * Normalize the supported buildRegistry input shapes.
 * @param options - Repo root string or full options object.
 * @returns Normalized options object.
 */
function normalizeBuildRegistryOptions(
	options: BuildRegistryOptions | string | undefined,
): BuildRegistryOptions {
	if (typeof options === "string") return { repoRoot: options };
	return options ?? {};
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
		// Check if the file object is valid
		if (!rawFile || typeof rawFile !== "object" || Array.isArray(rawFile))
			throw new Error(
				`Registry item "${itemId}" file at index ${index} must be an object.`,
			);

		const file = rawFile as Record<string, unknown>;
		assertNonEmptyString(
			file.source,
			`Registry item "${itemId}" file[${index}].source`,
		);
		assertNonEmptyString(
			file.target,
			`Registry item "${itemId}" file[${index}].target`,
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
	assertNonEmptyString(manifest.id, "Registry item id");
	assertNonEmptyString(manifest.title, `Registry item "${manifest.id}" title`);
	assertNonEmptyString(
		manifest.description,
		`Registry item "${manifest.id}" description`,
	);

	assertNonEmptyString(manifest.type, `Registry item "${manifest.id}" type`);

	// Check if the variants are valid
	if (!Array.isArray(manifest.variants) || manifest.variants.length === 0)
		throw new Error(
			`Registry item "${manifest.id}" must declare at least one variant.`,
		);

	const variants: RegistryVariant[] = [];
	for (const [variantIndex, rawVariant] of manifest.variants.entries()) {
		if (
			!rawVariant ||
			typeof rawVariant !== "object" ||
			Array.isArray(rawVariant)
		)
			throw new Error(
				`Registry item "${manifest.id}" variant at index ${variantIndex} must be an object.`,
			);

		const variantManifest = rawVariant as Record<string, unknown>;
		assertNonEmptyString(
			variantManifest.id,
			`Registry item "${manifest.id}" variant[${variantIndex}].id`,
		);
		assertNonEmptyString(
			variantManifest.title,
			`Registry item "${manifest.id}" variant "${variantManifest.id}" title`,
		);
		assertNonEmptyString(
			variantManifest.description,
			`Registry item "${manifest.id}" variant "${variantManifest.id}" description`,
		);

		if (
			!Array.isArray(variantManifest.files) ||
			variantManifest.files.length === 0
		)
			throw new Error(
				`Registry item "${manifest.id}" variant "${variantManifest.id}" has no files.`,
			);

		const files = buildRegistryFiles(
			itemDir,
			manifest.id,
			repoRoot,
			variantManifest.files,
		);

		const when = parseWhen(
			variantManifest.when,
			`Registry item "${manifest.id}" variant "${variantManifest.id}"`,
		);

		const variant: RegistryVariant = {
			id: variantManifest.id,
			title: variantManifest.title,
			description: variantManifest.description,
			...(when ? { when } : {}),
			files,
		};

		// Parse the dependencies
		if (Array.isArray(variantManifest.dependencies)) {
			const deps = parseStringArray(
				variantManifest.dependencies,
				`Registry item "${manifest.id}" variant "${variantManifest.id}" dependencies`,
			);
			if (deps) variant.dependencies = deps;
		}

		// Parse the dev dependencies
		if (Array.isArray(variantManifest.devDependencies)) {
			const deps = parseStringArray(
				variantManifest.devDependencies,
				`Registry item "${manifest.id}" variant "${variantManifest.id}" devDependencies`,
			);
			if (deps) variant.devDependencies = deps;
		}
		if (Array.isArray(variantManifest.registryDependencies))
			variant.registryDependencies =
				variantManifest.registryDependencies as RegistryVariant["registryDependencies"];

		variants.push(variant);
	}

	const sharedFiles =
		Array.isArray(manifest.files) && manifest.files.length > 0
			? buildRegistryFiles(itemDir, manifest.id, repoRoot, manifest.files)
			: undefined;
	const dependencies = parseStringArray(
		manifest.dependencies,
		`Registry item "${manifest.id}" dependencies`,
	);
	const devDependencies = parseStringArray(
		manifest.devDependencies,
		`Registry item "${manifest.id}" devDependencies`,
	);

	const item: RegistryItem = {
		id: manifest.id,
		title: manifest.title,
		description: manifest.description,
		type: manifest.type,
		...(sharedFiles ? { files: sharedFiles } : {}),
		...(dependencies ? { dependencies } : {}),
		...(devDependencies ? { devDependencies } : {}),
		variants,
	};

	if (Array.isArray(manifest.registryDependencies))
		item.registryDependencies =
			manifest.registryDependencies as RegistryItem["registryDependencies"];

	return validateRegistryItem(item, `Registry item "${manifest.id}"`);
}

/**
 * Compile all registry items into registry.json at the repo root.
 * @param options - Build options controlling the source root and content base URL.
 * @returns The built registry document that was written to disk.
 * @throws Error when no items are found, an item is invalid, or a duplicate id exists.
 */
export async function buildRegistry(
	options: BuildRegistryOptions | string = {},
): Promise<Registry> {
	const normalizedOptions = normalizeBuildRegistryOptions(options);
	const repoRoot = normalizedOptions.repoRoot ?? process.cwd();
	const registryDir = path.join(repoRoot, "registry");
	const outputPath = path.join(repoRoot, "registry.json");

	const itemFolderPaths = collectItemDirs(registryDir);

	const pkg = await readJSONFileAsync<{ version: string }>(
		path.join(repoRoot, "package.json"),
	);

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
	let conditions: Record<string, RegistryCondition> | undefined;
	if (fs.existsSync(conditionsPath)) {
		const rawConditions = JSON.parse(
			fs.readFileSync(conditionsPath, "utf8"),
		) as unknown;
		conditions = parseRegistryConditions(rawConditions);
	}

	// Types are a required part of every registry
	const typesPath = path.join(registryDir, "types.json");
	if (!fs.existsSync(typesPath))
		throw new Error(
			`Registry types not found at ${path.relative(repoRoot, typesPath)}.`,
		);
	const rawTypes = JSON.parse(fs.readFileSync(typesPath, "utf8")) as unknown;
	const types = parseRegistryItemTypes(rawTypes);

	// Validate the when keys and values against the conditions
	crossValidateWhen(sortedItems, conditions);
	crossValidateItemTypes(sortedItems, types);

	// Use the environment variable for the content base URL if it is set
	const override = process.env.TUCKSHOP_REGISTRY_BASE_URL;
	const contentBaseUrl =
		override && override.length > 0
			? override.replace(/\/+$/, "")
			: (
					normalizedOptions.contentBaseUrl ??
					`${REGISTRY_REPO_RAW_BASE}/v${pkg.version}`
				).replace(/\/+$/, "");

	const document: Registry = {
		contentBaseUrl,
		...(conditions ? { conditions } : {}),
		types,
		items: sortedItems,
	};

	await writeFileAsync(outputPath, `${JSON.stringify(document, null, 2)}\n`);
	const itemCount = Object.keys(sortedItems).length;
	console.log(
		itemCount === 0
			? `Built empty registry at ${path.relative(repoRoot, outputPath)}.`
			: `Built ${itemCount} registry items at ${path.relative(repoRoot, outputPath)}.`,
	);

	return document;
}
