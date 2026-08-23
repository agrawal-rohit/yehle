import type { Dirent } from "node:fs";
import path from "node:path";
import * as esbuild from "esbuild";
import {
	isFileAsync,
	isMissingPathError,
	readDirectoryAsync,
	readFileAsync,
	readJsonFileAsync,
	removeAsync,
	writeFileAsync,
} from "./fs";
import { mergeEcosystemDependencies } from "./packages";
import {
	parseKeyedRecord,
	parseRegistryDocument,
	parseWithSchema,
} from "./parse";
import {
	type AuthoredRegistryItem,
	type AuthoredRegistryVariant,
	type CatalogItem,
	InstallPhase,
	type Registry,
	type RegistryCondition,
	type RegistryFile,
	type RegistryItemTypeDefinition,
	type RegistryPayloadFile,
	registryConditionSchema,
	registryItemSchema,
	registryItemTypeSchema,
	registryPayloadSchema,
} from "./schema";
import { joinRelativePathUnderRoot } from "./urls";

export interface BuildRegistryOptions {
	/** Absolute path to the authoring tree: item folders, `types.json`, and optional `conditions/conditions.json`. */
	sourceDir: string;
	/** Absolute path where compiled artefacts are written: `registry.json` and `r/{itemId}.json` or `r/{itemId}/{variantId}.json`. */
	outDir: string;
}

/** Authored item paired with its source folder. */
interface AuthoredItemEntry {
	itemDir: string;
	item: AuthoredRegistryItem;
}

/**
 * Catalog-relative payload URI for an item or variant.
 * @param itemId - Registry item id.
 * @param variantId - Variant id when the payload is per-variant.
 * @returns URI under `r/`.
 */
function payloadUri(itemId: string, variantId?: string): string {
	return variantId === undefined
		? `r/${itemId}.json`
		: `r/${itemId}/${variantId}.json`;
}

/**
 * Catalog-relative URI for a compiled install-phase script.
 * @param itemId - Registry item id.
 * @param phase - Install phase name.
 * @param index - Script index within the phase list.
 * @param variantId - Variant id when the script belongs to a variant slice.
 * @returns URI under `r/`.
 */
function installScriptUri(
	itemId: string,
	phase: InstallPhase,
	index: number,
	variantId?: string,
): string {
	if (variantId === undefined) return `r/${itemId}.${phase}.${index}.js`;
	return `r/${itemId}/${variantId}.${phase}.${index}.js`;
}

/**
 * Compile one install-phase list into catalog-relative bundled script URIs.
 * @param itemDir - Absolute item folder.
 * @param itemId - Registry item id.
 * @param phase - Install phase being compiled.
 * @param entries - Authoring phase entries.
 * @param outDir - Absolute compiled output root.
 * @param variantId - Variant id when compiling a variant slice.
 * @returns Compiled script URI list, or undefined when absent.
 */
async function compileInstallPhaseList(
	itemDir: string,
	itemId: string,
	phase: InstallPhase,
	entries: string[] | undefined,
	outDir: string,
	variantId?: string,
): Promise<string[] | undefined> {
	if (!entries?.length) return undefined;

	const compiled: string[] = [];
	let scriptIndex = 0;
	for (const entry of entries) {
		const entryPath = joinRelativePathUnderRoot(
			itemDir,
			entry,
			`Registry item "${itemId}" ${phase} script`,
			"item folder",
		);
		const uri = installScriptUri(itemId, phase, scriptIndex, variantId);
		await bundleScript(
			entryPath,
			path.join(outDir, uri),
			`Registry item "${itemId}" ${phase}`,
		);
		compiled.push(uri);
		scriptIndex++;
	}

	return compiled;
}

/**
 * Recursively collect the folder of every registry-item.json under a source tree.
 * @param dir - Directory to walk.
 * @returns Absolute paths to item folders (each containing a registry-item.json).
 * @throws Error on filesystem failures other than a missing directory.
 */
async function collectItemDirs(dir: string): Promise<string[]> {
	const results: string[] = [];
	let entries: Dirent[];

	try {
		entries = await readDirectoryAsync(dir);
	} catch (error) {
		// Missing authoring root is treated as an empty item tree; other errors fail fast.
		if (isMissingPathError(error)) return results;
		throw error;
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
 * @throws Error when a source escapes the item folder or is missing on disk.
 */
async function materializePayloadFiles(
	itemDir: string,
	itemId: string,
	sourceDir: string,
	files: RegistryFile[],
): Promise<RegistryPayloadFile[]> {
	return Promise.all(
		files.map(async (file) => {
			const absolutePath = joinRelativePathUnderRoot(
				itemDir,
				file.source,
				`Registry item "${itemId}" file source`,
				"item folder",
			);
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
		const raw = await readJsonFileAsync(
			manifestPath,
			`Registry item at ${path.relative(sourceDir, manifestPath)}`,
		);

		const item = parseWithSchema(registryItemSchema, raw, "Registry item");

		if (seenItemIds.has(item.id))
			throw new Error(`Duplicate registry item id: "${item.id}".`);

		seenItemIds.add(item.id);
		authoredItems.push({ itemDir, item });
	}

	return authoredItems;
}

/**
 * Whether a variant-less item needs a compiled payload (static files and/or packages).
 * @param item - Authored registry item without variants.
 * @returns True when a payload document should be written.
 */
function variantLessNeedsPayload(item: AuthoredRegistryItem): boolean {
	return (item.files?.length ?? 0) > 0 || item.dependencies !== undefined;
}

/**
 * Human-readable subject for payload validation errors.
 * @param itemId - Registry item id.
 * @param variant - Variant being compiled, if any.
 * @returns Label naming the item and optional variant.
 */
function payloadSubject(
	itemId: string,
	variant: AuthoredRegistryVariant | undefined,
): string {
	if (variant === undefined) return `Registry item "${itemId}"`;
	return `Registry item "${itemId}" variant "${variant.id}"`;
}

/**
 * Fail when two payload files share the same install target path.
 * @param subject - Error label naming the item/variant.
 * @param files - Materialized payload files.
 * @throws Error when a target path appears more than once.
 */
function assertUniquePayloadTargets(
	subject: string,
	files: RegistryPayloadFile[],
): void {
	const seenTargets = new Set<string>();
	for (const file of files) {
		if (seenTargets.has(file.target))
			throw new Error(
				`${subject} declares duplicate file target "${file.target}".`,
			);
		seenTargets.add(file.target);
	}
}

/**
 * Write one install payload under `r/`.
 * @param entry - Authored item with its source folder.
 * @param variant - Variant being compiled; omit for an item-level payload.
 * @param sourceDir - Absolute authoring root.
 * @param outDir - Absolute compiled output root.
 * @throws Error when a file source is missing, escapes the item folder, or two files share a target.
 */
async function writePayload(
	entry: AuthoredItemEntry,
	variant: AuthoredRegistryVariant | undefined,
	sourceDir: string,
	outDir: string,
): Promise<void> {
	const { itemDir, item } = entry;
	const subject = payloadSubject(item.id, variant);
	const files = await materializePayloadFiles(itemDir, item.id, sourceDir, [
		...(item.files ?? []),
		...(variant?.files ?? []),
	]);

	// Item-level and variant files share one destination namespace
	assertUniquePayloadTargets(subject, files);

	const dependencies = mergeEcosystemDependencies(
		item.dependencies,
		variant?.dependencies,
	);
	const payload = parseWithSchema(
		registryPayloadSchema,
		{ files, ...(dependencies ? { dependencies } : {}) },
		`Registry payload for "${item.id}"`,
	);

	await writeFileAsync(
		path.join(outDir, payloadUri(item.id, variant?.id)),
		`${JSON.stringify(payload)}\n`,
	);
}

/**
 * Wipe `r/` and write every item/variant payload from the authored tree.
 * @param authoredItems - Loaded authored items.
 * @param sourceDir - Absolute authoring root.
 * @param outDir - Absolute compiled output root.
 */
async function writeItemPayloads(
	authoredItems: AuthoredItemEntry[],
	sourceDir: string,
	outDir: string,
): Promise<void> {
	await removeAsync(path.join(outDir, "r"));

	const writes: Promise<void>[] = [];
	for (const entry of authoredItems) {
		const { item } = entry;
		if (item.variants?.length)
			for (const variant of item.variants)
				writes.push(writePayload(entry, variant, sourceDir, outDir));
		else if (variantLessNeedsPayload(item))
			writes.push(writePayload(entry, undefined, sourceDir, outDir));
	}

	await Promise.all(writes);
}

/**
 * Bundle a TypeScript/JavaScript install script into a self-contained CommonJS module.
 * Marks `@tuckshop/core` as external and fails if the bundle still requires it.
 * @param entryPath - Absolute path to the authored script module.
 * @param outfile - Absolute path for the compiled script.
 * @param label - Error context label.
 * @throws Error when bundling fails or the script runtime-imports `@tuckshop/core`.
 */
async function bundleScript(
	entryPath: string,
	outfile: string,
	label: string,
): Promise<void> {
	if (!(await isFileAsync(entryPath)))
		throw new Error(`${label} references missing script: ${entryPath}`);

	try {
		await esbuild.build({
			entryPoints: [entryPath],
			bundle: true,
			platform: "node",
			format: "cjs",
			target: "node18",
			outfile,
			write: true,
			external: ["@tuckshop/core"],
			logLevel: "silent",
		});
	} catch (error) {
		throw new Error(`Failed to bundle ${label}: ${String(error)}`);
	}

	// Reject scripts that runtime-require @tuckshop/core (type-only imports are erased).
	const output = await readFileAsync(outfile);
	if (/require\(["']@tuckshop\/core["']\)/.test(output))
		throw new Error(`${label} must not runtime-import @tuckshop/core.`);
}

/**
 * Bundle condition handlers and rewrite authored paths to catalog URIs.
 * @param sourceDir - Absolute authoring root.
 * @param outDir - Absolute compiled output root.
 * @param conditions - Parsed shared conditions (handlers still authoring-relative).
 * @returns Conditions with compiled handler URIs, or undefined when absent.
 */
async function compileConditionHandlers(
	sourceDir: string,
	outDir: string,
	conditions: Record<string, RegistryCondition> | undefined,
): Promise<Record<string, RegistryCondition> | undefined> {
	if (!conditions) return undefined;

	const compiled: Record<string, RegistryCondition> = {};
	const writes: Promise<void>[] = [];

	for (const [key, condition] of Object.entries(conditions)) {
		if (!condition.handler) {
			compiled[key] = condition;
			continue;
		}

		const uri = `r/_handlers/${key}.handler.js`;
		const entryPath = joinRelativePathUnderRoot(
			sourceDir,
			condition.handler,
			`Registry condition "${key}" handler`,
			"authoring root",
		);
		writes.push(
			bundleScript(
				entryPath,
				path.join(outDir, uri),
				`Registry condition "${key}"`,
			),
		);
		compiled[key] = { ...condition, handler: uri };
	}

	await Promise.all(writes);
	return compiled;
}

/**
 * Build the catalog index entry for one authored item.
 * @param itemDir - Absolute item folder.
 * @param item - Authored registry item.
 * @param outDir - Absolute compiled output root.
 * @returns Catalog item shape (variant list, item-level source, and/or lifecycle scripts).
 */
async function catalogEntryForItem(
	itemDir: string,
	item: AuthoredRegistryItem,
	outDir: string,
): Promise<CatalogItem> {
	// Compile `beforeInstall` and `afterInstall` scripts
	const beforeInstall = await compileInstallPhaseList(
		itemDir,
		item.id,
		InstallPhase.BeforeInstall,
		item.beforeInstall,
		outDir,
	);
	const afterInstall = await compileInstallPhaseList(
		itemDir,
		item.id,
		InstallPhase.AfterInstall,
		item.afterInstall,
		outDir,
	);

	const shared = {
		title: item.title,
		description: item.description,
		type: item.type,
		...(item.uses ? { uses: item.uses } : {}),
		...(item.registryDependencies
			? { registryDependencies: item.registryDependencies }
			: {}),
		...(beforeInstall ? { beforeInstall } : {}),
		...(afterInstall ? { afterInstall } : {}),
	};

	// If the item has variants, compile the `beforeInstall` and `afterInstall` scripts for each variant
	if (item.variants?.length)
		return {
			...shared,
			variants: await Promise.all(
				item.variants.map(async (variant) => {
					const variantBeforeInstall = await compileInstallPhaseList(
						itemDir,
						item.id,
						InstallPhase.BeforeInstall,
						variant.beforeInstall,
						outDir,
						variant.id,
					);
					const variantAfterInstall = await compileInstallPhaseList(
						itemDir,
						item.id,
						InstallPhase.AfterInstall,
						variant.afterInstall,
						outDir,
						variant.id,
					);
					return {
						id: variant.id,
						title: variant.title,
						source: payloadUri(item.id, variant.id),
						...(variant.when ? { when: variant.when } : {}),
						...(variant.registryDependencies
							? { registryDependencies: variant.registryDependencies }
							: {}),
						...(variantBeforeInstall
							? { beforeInstall: variantBeforeInstall }
							: {}),
						...(variantAfterInstall
							? { afterInstall: variantAfterInstall }
							: {}),
					};
				}),
			),
		};

	return {
		...shared,
		...(variantLessNeedsPayload(item) ? { source: payloadUri(item.id) } : {}),
	};
}

/**
 * Index authored items by id with payload URIs on the item or each variant.
 * @param authoredItems - Loaded authored items.
 * @param outDir - Absolute compiled output root.
 * @returns Catalog items sorted by id.
 */
async function buildCatalogItems(
	authoredItems: AuthoredItemEntry[],
	outDir: string,
): Promise<Record<string, CatalogItem>> {
	const catalogItems: Record<string, CatalogItem> = {};
	for (const { itemDir, item } of authoredItems)
		catalogItems[item.id] = await catalogEntryForItem(itemDir, item, outDir);

	return Object.fromEntries(
		Object.entries(catalogItems).sort(([a], [b]) => a.localeCompare(b)),
	);
}

/**
 * Read optional conditions and required types from the authoring root.
 * @param sourceDir - Absolute authoring root.
 * @returns Parsed conditions (optional) and types (required).
 * @throws Error when `types.json` is missing or either file is invalid.
 */
async function readTypesAndConditions(sourceDir: string): Promise<{
	conditions: Record<string, RegistryCondition> | undefined;
	types: Record<string, RegistryItemTypeDefinition>;
}> {
	const conditionsPath = path.join(sourceDir, "conditions/conditions.json");
	const rawConditions = (await isFileAsync(conditionsPath))
		? await readJsonFileAsync(conditionsPath, "Registry conditions")
		: undefined;

	const typesPath = path.join(sourceDir, "types.json");
	if (!(await isFileAsync(typesPath)))
		throw new Error("Registry types not found at types.json.");

	const types = parseKeyedRecord(
		registryItemTypeSchema,
		await readJsonFileAsync(typesPath, "Registry types"),
		"Registry types",
		(key) => `Registry type "${key}"`,
		{
			absent: "Registry types must be declared.",
			empty: "Registry types must declare at least one type.",
		},
	) as Record<string, RegistryItemTypeDefinition>;

	return {
		conditions: parseKeyedRecord(
			registryConditionSchema,
			rawConditions,
			"Registry conditions",
			(key) => `Registry condition "${key}"`,
		),
		types,
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

	// Validate authoring inputs before mutating the output tree.
	const authoredItems = await loadAuthoredItems(sourceDir);
	const { conditions, types } = await readTypesAndConditions(sourceDir);

	await writeItemPayloads(authoredItems, sourceDir, outDir);

	const compiledConditions = await compileConditionHandlers(
		sourceDir,
		outDir,
		conditions,
	);
	const document = parseRegistryDocument({
		...(compiledConditions ? { conditions: compiledConditions } : {}),
		types,
		items: await buildCatalogItems(authoredItems, outDir),
	});

	await writeFileAsync(registryPath, `${JSON.stringify(document)}\n`);
	return document;
}
