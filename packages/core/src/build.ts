import type { Dirent } from "node:fs";
import path from "node:path";
import {
	isFileAsync,
	readDirectoryAsync,
	readFileAsync,
	removeAsync,
	writeFileAsync,
} from "./fs";
import { parseRegistryDocument, parseWithSchema } from "./parse";
import {
	type Registry,
	type RegistryFile,
	type RegistryItem,
	type RegistryPayload,
	type RegistryPayloadFile,
	type RegistryVariant,
	registryItemSchema,
} from "./schema";

export interface BuildRegistryOptions {
	/** Absolute path to the authoring tree: item folders, `types.json`, and optional `conditions.json`. */
	sourceDir: string;
	/** Absolute path where compiled artefacts are written: `registry.json` and `r/{itemId}.json` or `r/{itemId}/{variantId}.json`. */
	outDir: string;
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
	const payloadsDir = path.join(outDir, "r");

	// Collect authored registry items
	const authoredItems: Array<{
		itemDir: string;
		item: RegistryItem;
	}> = [];
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

	// Plan the output payloads: one per variant, or a single item-level payload.
	const plannedPayloads: Array<{
		itemDir: string;
		item: RegistryItem;
		variant?: RegistryVariant;
		relativeFile: string;
		absoluteFile: string;
	}> = [];
	for (const { itemDir, item } of authoredItems) {
		if (item.variants?.length) {
			for (const variant of item.variants) {
				const relativeFile = `r/${item.id}/${variant.id}.json`;
				plannedPayloads.push({
					itemDir,
					item,
					variant,
					relativeFile,
					absoluteFile: path.join(outDir, relativeFile),
				});
			}
			continue;
		}

		const relativeFile = `r/${item.id}.json`;
		plannedPayloads.push({
			itemDir,
			item,
			relativeFile,
			absoluteFile: path.join(outDir, relativeFile),
		});
	}

	// Remove the existing payloads directory
	await removeAsync(payloadsDir);

	// Build the output registry catalog items
	const catalogItems: Record<string, unknown> = {};
	for (const { itemDir, item, variant, absoluteFile } of plannedPayloads) {
		const payload: RegistryPayload = {
			id: item.id,
			variantId: variant?.id,
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
		};

		await writeFileAsync(
			absoluteFile,
			`${JSON.stringify(payload, null, "\t")}\n`,
		);
	}

	for (const { item } of authoredItems) {
		if (item.variants?.length) {
			const { files: itemFiles, ...itemRest } = item;
			catalogItems[item.id] = {
				...itemRest,
				variants: plannedPayloads
					.filter((entry) => entry.item.id === item.id)
					.map((entry) => ({
						...entry.variant,
						files: [...(itemFiles ?? []), ...(entry.variant?.files ?? [])].map(
							({ target }) => ({
								source: entry.relativeFile,
								target,
							}),
						),
					})),
			};
			continue;
		}

		const itemPayload = plannedPayloads.find(
			(entry) => entry.item.id === item.id,
		);
		catalogItems[item.id] = {
			...item,
			files: (item.files ?? []).map(({ target }) => ({
				source: itemPayload?.relativeFile ?? `r/${item.id}.json`,
				target,
			})),
		};
	}

	// Sort items by id for stable catalog output.
	const sortedItems = Object.fromEntries(
		Object.entries(catalogItems).sort(([a], [b]) => a.localeCompare(b)),
	);

	// Read the conditions file
	const conditionsPath = path.join(sourceDir, "conditions.json");
	let rawConditions: unknown;
	if (await isFileAsync(conditionsPath))
		rawConditions = JSON.parse(await readFileAsync(conditionsPath));

	// Read the types file
	const typesPath = path.join(sourceDir, "types.json");
	if (!(await isFileAsync(typesPath)))
		throw new Error(
			`Registry types not found at ${path.relative(sourceDir, typesPath) || "types.json"}.`,
		);
	const rawTypes: unknown = JSON.parse(await readFileAsync(typesPath));

	// Validate the compiled registry document
	const document = parseRegistryDocument({
		conditions: rawConditions,
		types: rawTypes,
		items: sortedItems,
	});

	// Write the compiled registry document to disk
	await writeFileAsync(
		registryPath,
		`${JSON.stringify(document, null, "\t")}\n`,
	);

	return document;
}
