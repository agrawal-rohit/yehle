import type { Dirent } from "node:fs";
import path from "node:path";
import {
	isFileAsync,
	readDirectoryAsync,
	readFileAsync,
	removeAsync,
	writeFileAsync,
} from "./fs";
import { mergeRegistryPackages } from "./packages";
import { parseRegistryDocument, parseWithSchema } from "./parse";
import {
	type AuthoredRegistryItem,
	type AuthoredRegistryVariant,
	type Registry,
	type RegistryFile,
	type RegistryPayload,
	type RegistryPayloadFile,
	registryItemSchema,
} from "./schema";

export interface BuildRegistryOptions {
	/** Absolute path to the authoring tree: item folders, `types.json`, and optional `conditions.json`. */
	sourceDir: string;
	/** Absolute path where compiled artefacts are written: `registry.json` and `r/{itemId}.json` or `r/{itemId}/{variantId}.json`. */
	outDir: string;
}

/** Authored item paired with its source folder. */
interface AuthoredItemEntry {
	itemDir: string;
	item: AuthoredRegistryItem;
}

/** Planned payload write location for one item or variant. */
interface PlannedPayload {
	itemDir: string;
	item: AuthoredRegistryItem;
	variant?: AuthoredRegistryVariant;
	absoluteFile: string;
}

/**
 * Recursively collect the folder of every registry-item.json under a source tree.
 * @param dir - Directory to walk.
 * @returns Absolute paths to item folders (each containing a registry-item.json).
 */
async function collectItemDirs(dir: string): Promise<string[]> {
	const results: string[] = [];
	let entries: Dirent[] = [];

	try {
		entries = await readDirectoryAsync(dir);
	} catch {
		return results;
	}

	for (const entry of entries) {
		// Item folders are identified by a colocated registry-item.json
		if (entry.isFile() && entry.name === "registry-item.json")
			results.push(dir);
		// Otherwise, look for item folders in subdirectories
		else if (entry.isDirectory())
			results.push(...(await collectItemDirs(path.join(dir, entry.name))));
	}

	return results;
}

/**
 * Read local file contents for payload inlining.
 * @param itemDir - Absolute item folder.
 * @param itemId - Item id for errors.
 * @param sourceDir - Absolute authoring root (for relative error paths).
 * @param files - Authoring file entries.
 * @returns Payload file entries with inlined content.
 * @throws Error when a source is missing on disk.
 */
async function materializePayloadFiles(
	itemDir: string,
	itemId: string,
	sourceDir: string,
	files: RegistryFile[] = [],
): Promise<RegistryPayloadFile[]> {
	return Promise.all(
		files.map(async (file) => {
			const absolutePath = path.join(itemDir, file.source);
			if (await isFileAsync(absolutePath)) {
				const content = await readFileAsync(absolutePath);
				return { target: file.target, content };
			}

			throw new Error(
				`Registry item "${itemId}" references missing file: ${path.relative(sourceDir, absolutePath)}`,
			);
		}),
	);
}

/**
 * Load and validate every authored registry item under the source tree.
 * @param sourceDir - Absolute authoring root.
 * @returns Authored items with their folders.
 * @throws Error when an item is invalid or an id is duplicated.
 */
async function loadAuthoredItems(
	sourceDir: string,
): Promise<AuthoredItemEntry[]> {
	const authoredItems: AuthoredItemEntry[] = [];
	const seenItemIds = new Set<string>();
	for (const itemDir of await collectItemDirs(sourceDir)) {
		const manifestPath = path.join(itemDir, "registry-item.json");
		const raw = JSON.parse(await readFileAsync(manifestPath));

		// Validate the registry item
		const item = parseWithSchema(registryItemSchema, raw, "Registry item");

		// Check for duplicate item ids
		if (seenItemIds.has(item.id))
			throw new Error(`Duplicate registry item id: "${item.id}".`);

		seenItemIds.add(item.id);
		authoredItems.push({ itemDir, item });
	}

	return authoredItems;
}

/**
 * Plan payload output paths: one per variant, or a single item-level payload.
 * @param authoredItems - Loaded authored items.
 * @param outDir - Absolute compiled output root.
 * @returns Planned payload writes.
 */
function planPayloadWrites(
	authoredItems: AuthoredItemEntry[],
	outDir: string,
): PlannedPayload[] {
	const planned: PlannedPayload[] = [];

	for (const { itemDir, item } of authoredItems) {
		if (item.variants?.length) {
			for (const variant of item.variants) {
				const relativeFile = `r/${item.id}/${variant.id}.json`;
				planned.push({
					itemDir,
					item,
					variant,
					absoluteFile: path.join(outDir, relativeFile),
				});
			}
			continue;
		}

		planned.push({
			itemDir,
			item,
			absoluteFile: path.join(outDir, `r/${item.id}.json`),
		});
	}

	return planned;
}

/**
 * Materialize and write every planned payload under `r/`.
 * @param plannedPayloads - Planned payload writes.
 * @param sourceDir - Absolute authoring root.
 * @param payloadsDir - Absolute `r/` directory to wipe and rebuild.
 */
async function writePlannedPayloads(
	plannedPayloads: PlannedPayload[],
	sourceDir: string,
	payloadsDir: string,
): Promise<void> {
	await removeAsync(payloadsDir);

	// Write one payload per variant, or a single item-level payload.
	for (const { itemDir, item, variant, absoluteFile } of plannedPayloads) {
		const packages = mergeRegistryPackages(item.packages, variant?.packages);
		const payload: RegistryPayload = {
			files: [
				...(await materializePayloadFiles(
					itemDir,
					item.id,
					sourceDir,
					item.files,
				)),
				...(await materializePayloadFiles(
					itemDir,
					item.id,
					sourceDir,
					variant?.files,
				)),
			],
			...(packages ? { packages } : {}),
		};

		await writeFileAsync(absoluteFile, `${JSON.stringify(payload)}\n`);
	}
}

/**
 * Build the catalog index entry for one authored item.
 * @param item - Authored registry item.
 * @returns Catalog item shape (variant list or item-level source).
 */
function catalogEntryForItem(item: AuthoredRegistryItem): unknown {
	const shared = {
		title: item.title,
		description: item.description,
		type: item.type,
		...(item.when ? { when: item.when } : {}),
		...(item.registryDependencies
			? { registryDependencies: item.registryDependencies }
			: {}),
	};

	if (item.variants?.length) {
		return {
			...shared,
			variants: item.variants.map((variant) => ({
				id: variant.id,
				title: variant.title,
				source: `r/${item.id}/${variant.id}.json`,
				...(variant.when ? { when: variant.when } : {}),
				...(variant.registryDependencies
					? { registryDependencies: variant.registryDependencies }
					: {}),
			})),
		};
	}

	return {
		...shared,
		source: `r/${item.id}.json`,
	};
}

/**
 * Index authored items by id with payload URIs on the item or each variant.
 * @param authoredItems - Loaded authored items.
 * @returns Catalog items sorted by id.
 */
function buildCatalogItems(
	authoredItems: AuthoredItemEntry[],
): Record<string, unknown> {
	const catalogItems: Record<string, unknown> = {};
	for (const { item } of authoredItems)
		catalogItems[item.id] = catalogEntryForItem(item);

	return Object.fromEntries(
		Object.entries(catalogItems).sort(([a], [b]) => a.localeCompare(b)),
	);
}

/**
 * Read optional conditions and required types sidecars from the authoring root.
 * @param sourceDir - Absolute authoring root.
 * @returns Raw JSON values for document assembly.
 * @throws Error when `types.json` is missing.
 */
async function readRegistrySidecars(
	sourceDir: string,
): Promise<{ rawConditions: unknown; rawTypes: unknown }> {
	const conditionsPath = path.join(sourceDir, "conditions.json");
	let rawConditions: unknown;
	if (await isFileAsync(conditionsPath))
		rawConditions = JSON.parse(await readFileAsync(conditionsPath));

	const typesPath = path.join(sourceDir, "types.json");
	if (!(await isFileAsync(typesPath)))
		throw new Error(
			`Registry types not found at ${path.relative(sourceDir, typesPath) || "types.json"}.`,
		);

	return {
		rawConditions,
		rawTypes: JSON.parse(await readFileAsync(typesPath)),
	};
}

/**
 * Compile a registry authoring tree into `registry.json` and install payloads under `r/`.
 * @param options - Absolute `sourceDir` (authoring) and `outDir` (compiled artefacts).
 * @returns The compiled registry document that was written to disk.
 * @throws Error when an item is invalid, a source is missing, or types are absent.
 */
export async function buildRegistry(
	options: BuildRegistryOptions,
): Promise<Registry> {
	const sourceDir = path.resolve(options.sourceDir);
	const outDir = path.resolve(options.outDir);
	const registryPath = path.join(outDir, "registry.json");

	const authoredItems = await loadAuthoredItems(sourceDir);
	await writePlannedPayloads(
		planPayloadWrites(authoredItems, outDir),
		sourceDir,
		path.join(outDir, "r"),
	);

	const { rawConditions, rawTypes } = await readRegistrySidecars(sourceDir);
	const document = parseRegistryDocument({
		conditions: rawConditions,
		types: rawTypes,
		items: buildCatalogItems(authoredItems),
	});

	// Write the compiled registry document to disk
	await writeFileAsync(registryPath, `${JSON.stringify(document)}\n`);
	return document;
}
