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
import {
	mergeCommandSet,
	mergeDependencySet,
	mergeEcosystemMaps,
	mergeSecretNames,
} from "./packages";
import {
	parseKeyedRecord,
	parseRegistryDocument,
	parseWithSchema,
} from "./parse";
import {
	assertConditionMapBindingKeys,
	type CompiledItemFile,
	compiledItemSchema,
	type IndexItem,
	type IndexPack,
	InstallPhase,
	type RawRegistryItem,
	type RawRegistryPack,
	type Registry,
	type RegistryCondition,
	type RegistryEcosystemCommands,
	type RegistryEcosystemDependencies,
	type RegistryFile,
	type RegistryItemTypeDefinition,
	registryConditionSchema,
	registryItemSchema,
	registryItemTypeSchema,
} from "./schema";
import { joinRelativePathUnderRoot } from "./urls";

export interface BuildRegistryOptions {
	/** Absolute path to the registry source tree: item folders, types file, and optional shared conditions file. */
	sourceDir: string;
	/** Absolute path where compiled output is written: the index JSON and compiled items/scripts. */
	outDir: string;
	/** Basename of the index file written under `outDir`. Defaults to `"registry.json"`. */
	registryFileName?: string;
	/** Basename of each item manifest under an item folder. Defaults to `"registry-item.json"`. */
	itemManifestFileName?: string;
	/** Path under `sourceDir` for the types document. Defaults to `"types.json"`. */
	typesFileName?: string;
	/** Path under `sourceDir` for shared conditions. Defaults to `"conditions/conditions.json"`. */
	conditionsFileName?: string;
	/** Index-relative directory for compiled items, install scripts, and condition handlers. */
	compiledDirName?: string;
	/** Extra packages marked external for install/handler bundles */
	bundleExternalPackages?: string[];
}

/** Build inputs after defaults and validation. */
interface BuildConfig {
	sourceDir: string;
	outDir: string;
	registryFileName: string;
	itemManifestFileName: string;
	typesFileName: string;
	conditionsFileName: string;
	compiledDirName: string;
	bundleExternalPackages: readonly string[];
}

/** Raw item paired with its source folder. */
interface RawItemEntry {
	itemDir: string;
	item: RawRegistryItem;
}

/**
 * Escape a string for safe use inside a RegExp pattern.
 * @param value - Literal string to escape.
 * @returns Escaped pattern fragment.
 */
function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

/**
 * Fail when a basename option is empty, `.`, `..`, or contains a path separator.
 * @param optionName - Options field name for the error message.
 * @param value - Candidate basename.
 * @throws Error when the value is not a single path segment.
 */
function assertSinglePathSegment(optionName: string, value: string): void {
	if (
		!value ||
		value === "." ||
		value === ".." ||
		value.includes("/") ||
		value.includes("\\")
	)
		throw new Error(
			String.raw`${optionName} must be a single path segment (no "/", "\", or "..").`,
		);
}

/**
 * Fail when a basename is not a single `.json` path segment.
 * @param optionName - Options field name for the error message.
 * @param value - Candidate basename.
 * @throws Error when the value is invalid or does not end with `.json`.
 */
function assertJsonFileName(optionName: string, value: string): void {
	assertSinglePathSegment(optionName, value);
	if (!value.endsWith(".json"))
		throw new Error(`${optionName} must end with ".json".`);
}

/**
 * Always include `@tuckshop/core`, then fold in caller extras (deduping core).
 * @param extras - Optional additional external package names.
 * @returns External package list for install/handler bundles.
 * @throws Error when an entry is empty or whitespace-only.
 */
function normalizeBundleExternalPackages(
	extras: string[] | undefined,
): readonly string[] {
	const extraExternals = extras ?? [];
	for (const pkg of extraExternals) {
		if (!pkg.trim())
			throw new Error("bundleExternalPackages entries must be non-empty.");
	}
	return [
		"@tuckshop/core",
		...extraExternals.filter((pkg) => pkg !== "@tuckshop/core"),
	];
}

/**
 * Apply defaults and validate {@link BuildRegistryOptions} into concrete build inputs.
 * @param options - Caller-supplied build options.
 * @returns Absolute paths and layout names with defaults applied.
 * @throws Error when a file-name option is invalid.
 */
function createBuildConfig(options: BuildRegistryOptions): BuildConfig {
	const sourceDir = path.resolve(options.sourceDir);
	const outDir = path.resolve(options.outDir);
	const registryFileName = (options.registryFileName ?? "registry.json").trim();
	const itemManifestFileName = (
		options.itemManifestFileName ?? "registry-item.json"
	).trim();
	const typesFileName = (options.typesFileName ?? "types.json").trim();
	const conditionsFileName = (
		options.conditionsFileName ?? "conditions/conditions.json"
	).trim();
	const compiledDirName = (options.compiledDirName ?? "r").trim();
	const bundleExternalPackages = normalizeBundleExternalPackages(
		options.bundleExternalPackages,
	);

	assertJsonFileName("registryFileName", registryFileName);
	assertJsonFileName("itemManifestFileName", itemManifestFileName);
	assertSinglePathSegment("compiledDirName", compiledDirName);

	// types/conditions may be nested under sourceDir; reject escapes and absolute paths.
	joinRelativePathUnderRoot(
		sourceDir,
		typesFileName,
		"typesFileName",
		"registry source",
	);
	joinRelativePathUnderRoot(
		sourceDir,
		conditionsFileName,
		"conditionsFileName",
		"registry source",
	);

	return {
		sourceDir,
		outDir,
		registryFileName,
		itemManifestFileName,
		typesFileName,
		conditionsFileName,
		compiledDirName,
		bundleExternalPackages,
	};
}

/**
 * Index-relative compiled item URI for an item or pack.
 * @param compiledDirName - Index-relative compiled output directory.
 * @param itemId - Registry item id.
 * @param packId - Pack id when the payload is per-pack.
 * @returns URI under the compiled output directory.
 */
function compiledItemUri(
	compiledDirName: string,
	itemId: string,
	packId?: string,
): string {
	return packId === undefined
		? `${compiledDirName}/${itemId}.json`
		: `${compiledDirName}/${itemId}/${packId}.json`;
}

/**
 * Compile one install-phase list into index-relative bundled script URIs.
 * @param itemDir - Absolute item folder.
 * @param itemId - Registry item id.
 * @param phase - Install phase being compiled.
 * @param entries - Authoring phase entries.
 * @param config - Build config.
 * @param packId - Pack id when compiling a pack slice.
 * @returns Compiled script URI list, or undefined when absent.
 */
async function compileInstallPhaseList(
	itemDir: string,
	itemId: string,
	phase: InstallPhase,
	entries: string[] | undefined,
	config: BuildConfig,
	packId?: string,
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
		const uri =
			packId === undefined
				? `${config.compiledDirName}/${itemId}.${phase}.${scriptIndex}.js`
				: `${config.compiledDirName}/${itemId}/${packId}.${phase}.${scriptIndex}.js`;
		await bundleScript(
			entryPath,
			path.join(config.outDir, uri),
			`Registry item "${itemId}" ${phase}`,
			config.bundleExternalPackages,
		);
		compiled.push(uri);
		scriptIndex++;
	}

	return compiled;
}

/**
 * Recursively collect every item folder that contains the configured manifest basename.
 * @param dir - Directory to walk.
 * @param itemManifestFileName - Basename that identifies an item folder.
 * @returns Absolute paths to item folders.
 * @throws Error on filesystem failures other than a missing directory.
 */
async function collectItemDirs(
	dir: string,
	itemManifestFileName: string,
): Promise<string[]> {
	const results: string[] = [];
	let entries: Dirent[];

	try {
		entries = await readDirectoryAsync(dir);
	} catch (error) {
		// Missing registry source is treated as an empty item tree; other errors fail fast.
		if (isMissingPathError(error)) return results;
		throw error;
	}

	for (const entry of entries) {
		// Item folders are identified by a colocated manifest file
		if (entry.isFile() && entry.name === itemManifestFileName)
			results.push(dir);
		// Otherwise, look for item folders in subdirectories
		else if (entry.isDirectory())
			results.push(
				...(await collectItemDirs(
					path.join(dir, entry.name),
					itemManifestFileName,
				)),
			);
	}

	return results;
}

/**
 * Read local file contents for payload inlining.
 * @param itemDir - Absolute item folder.
 * @param itemId - Item id for errors.
 * @param sourceDir - Absolute registry source (for relative error paths).
 * @param files - Source file entries.
 * @returns Compiled item file entries with inlined content.
 * @throws Error when a source escapes the item folder or is missing on disk.
 */
async function materializeCompiledItemFiles(
	itemDir: string,
	itemId: string,
	sourceDir: string,
	files: RegistryFile[],
): Promise<CompiledItemFile[]> {
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
 * Fetch and validate every raw registry item under the source tree.
 * @param config - Build config.
 * @returns Raw items with their folders.
 * @throws Error when an item is invalid or an id is duplicated.
 */
async function fetchRawItems(config: BuildConfig): Promise<RawItemEntry[]> {
	const { sourceDir, itemManifestFileName } = config;
	const rawItems: RawItemEntry[] = [];
	const seenItemIds = new Set<string>();
	for (const itemDir of await collectItemDirs(
		sourceDir,
		itemManifestFileName,
	)) {
		const manifestPath = path.join(itemDir, itemManifestFileName);
		const raw = await readJsonFileAsync(
			manifestPath,
			`Registry item at ${path.relative(sourceDir, manifestPath)}`,
		);

		const item = parseWithSchema(registryItemSchema, raw, "Registry item");

		if (seenItemIds.has(item.id))
			throw new Error(`Duplicate registry item id: "${item.id}".`);

		seenItemIds.add(item.id);
		rawItems.push({ itemDir, item });
	}

	return rawItems;
}

/**
 * Whether an item's base layer needs a compiled payload.
 * @param item - Authored registry item.
 * @returns True when a payload document should be written.
 */
function itemNeedsBaseCompiledItem(item: RawRegistryItem): boolean {
	return (
		(item.files?.length ?? 0) > 0 ||
		item.dependencies !== undefined ||
		item.commands !== undefined ||
		(item.secrets?.length ?? 0) > 0
	);
}

/**
 * Fail when two compiled item files share the same install target path.
 * @param subject - Error label naming the item/pack.
 * @param files - Materialized compiled item files.
 * @throws Error when a target path appears more than once.
 */
function assertUniqueCompiledItemTargets(
	subject: string,
	files: CompiledItemFile[],
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
 * Write one compiled item under the compiled output directory.
 * @param entry - Raw item with its source folder.
 * @param pack - Pack being compiled; omit for an item-level payload.
 * @param config - Build config.
 * @throws Error when a file source is missing, escapes the item folder, or two files share a target.
 */
async function writeCompiledItem(
	entry: RawItemEntry,
	pack: RawRegistryPack | undefined,
	config: BuildConfig,
): Promise<void> {
	const { itemDir, item } = entry;
	const subject =
		pack === undefined
			? `Registry item "${item.id}"`
			: `Registry item "${item.id}" pack "${pack.id}"`;
	const files = await materializeCompiledItemFiles(
		itemDir,
		item.id,
		config.sourceDir,
		[...(item.files ?? []), ...(pack?.files ?? [])],
	);

	// Item-level and pack files share one destination namespace
	assertUniqueCompiledItemTargets(subject, files);

	const dependencies = mergeEcosystemMaps(
		mergeDependencySet,
		item.dependencies,
		pack?.dependencies,
	) as RegistryEcosystemDependencies | undefined;
	const commands = mergeEcosystemMaps(
		mergeCommandSet,
		item.commands,
		pack?.commands,
	) as RegistryEcosystemCommands | undefined;
	const secrets = mergeSecretNames(item.secrets, pack?.secrets);

	const payload = parseWithSchema(
		compiledItemSchema,
		{
			files,
			dependencies,
			commands,
			secrets,
		},
		`Compiled item for "${item.id}"`,
	);

	await writeFileAsync(
		path.join(
			config.outDir,
			compiledItemUri(config.compiledDirName, item.id, pack?.id),
		),
		`${JSON.stringify(payload)}\n`,
	);
}

/**
 * Wipe the compiled output directory and write every item/base and item/pack compiled item.
 * @param rawItems - Loaded raw items.
 * @param config - Build config.
 */
async function writeCompiledItems(
	rawItems: RawItemEntry[],
	config: BuildConfig,
): Promise<void> {
	await removeAsync(path.join(config.outDir, config.compiledDirName));

	const writes: Promise<void>[] = [];
	for (const entry of rawItems) {
		const { item } = entry;
		if (itemNeedsBaseCompiledItem(item))
			writes.push(writeCompiledItem(entry, undefined, config));
		for (const pack of item.packs ?? [])
			writes.push(writeCompiledItem(entry, pack, config));
	}

	// Wait for every write to finish so a rejection does not leave siblings racing cleanup.
	const results = await Promise.allSettled(writes);
	const failure = results.find((result) => result.status === "rejected");
	if (failure?.status === "rejected") throw failure.reason;
}

/**
 * Bundle a TypeScript/JavaScript install script into a self-contained CommonJS module.
 * Marks configured packages as external and fails if the bundle still requires them.
 * @param entryPath - Absolute path to the source script module.
 * @param outfile - Absolute path for the compiled script.
 * @param label - Error context label.
 * @param bundleExternalPackages - Packages treated as external and banned at runtime.
 * @throws Error when bundling fails or the script runtime-imports a banned package.
 */
async function bundleScript(
	entryPath: string,
	outfile: string,
	label: string,
	bundleExternalPackages: readonly string[],
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
			external: [...bundleExternalPackages],
			logLevel: "silent",
		});
	} catch (error) {
		throw new Error(`Failed to bundle ${label}: ${String(error)}`);
	}

	// Reject scripts that runtime-require an external package (type-only imports are erased).
	const output = await readFileAsync(outfile);
	for (const pkg of bundleExternalPackages) {
		const pattern = new RegExp(
			String.raw`require\(["']` + escapeRegExp(pkg) + String.raw`["']\)`,
		);
		if (pattern.test(output))
			throw new Error(`${label} must not runtime-import ${pkg}.`);
	}
}

/**
 * Bundle condition handlers and rewrite source paths to index URIs.
 * @param rootDir - Absolute folder containing handler source files.
 * @param conditions - Condition map (handlers still root-relative).
 * @param config - Build config.
 * @param options - URI and label builders for bundled handlers.
 * @returns Conditions with compiled handler URIs, or undefined when absent.
 */
async function compileConditionHandlers(
	rootDir: string,
	conditions: Record<string, RegistryCondition> | undefined,
	config: BuildConfig,
	options: {
		handlerUri: (key: string) => string;
		entryLabel: (key: string) => string;
		bundleLabel: (key: string) => string;
		rootLabel: string;
	},
): Promise<Record<string, RegistryCondition> | undefined> {
	if (!conditions || Object.keys(conditions).length === 0) return undefined;

	const compiled: Record<string, RegistryCondition> = {};
	const writes: Promise<void>[] = [];

	for (const [key, condition] of Object.entries(conditions)) {
		if (!condition.handler) {
			compiled[key] = condition;
			continue;
		}

		const uri = options.handlerUri(key);
		const entryPath = joinRelativePathUnderRoot(
			rootDir,
			condition.handler,
			options.entryLabel(key),
			options.rootLabel,
		);
		writes.push(
			bundleScript(
				entryPath,
				path.join(config.outDir, uri),
				options.bundleLabel(key),
				config.bundleExternalPackages,
			),
		);
		compiled[key] = { ...condition, handler: uri };
	}

	await Promise.all(writes);
	return compiled;
}

/**
 * Build one compiled index pack entry for an raw item pack.
 * @param itemDir - Absolute item folder.
 * @param itemId - Registry item id.
 * @param pack - Raw pack definition.
 * @param config - Build config.
 * @returns Index pack shape with compiled install scripts.
 */
async function indexPackEntry(
	itemDir: string,
	itemId: string,
	pack: RawRegistryPack,
	config: BuildConfig,
): Promise<IndexPack> {
	const packBeforeInstall = await compileInstallPhaseList(
		itemDir,
		itemId,
		InstallPhase.BeforeInstall,
		pack.beforeInstall,
		config,
		pack.id,
	);
	const packAfterInstall = await compileInstallPhaseList(
		itemDir,
		itemId,
		InstallPhase.AfterInstall,
		pack.afterInstall,
		config,
		pack.id,
	);

	return {
		id: pack.id,
		title: pack.title,
		source: compiledItemUri(config.compiledDirName, itemId, pack.id),
		...(pack.when ? { when: pack.when } : {}),
		...(pack.dependsOn ? { dependsOn: pack.dependsOn } : {}),
		...(packBeforeInstall ? { beforeInstall: packBeforeInstall } : {}),
		...(packAfterInstall ? { afterInstall: packAfterInstall } : {}),
	};
}

/**
 * Compile item-level install scripts and condition handlers for the index.
 * @param itemDir - Absolute item folder.
 * @param item - Authored registry item.
 * @param config - Build config.
 * @returns Compiled install scripts and rewritten condition handlers.
 */
async function compileItemIndexArtifacts(
	itemDir: string,
	item: RawRegistryItem,
	config: BuildConfig,
): Promise<{
	beforeInstall: string[] | undefined;
	afterInstall: string[] | undefined;
	itemConditions: Record<string, RegistryCondition> | undefined;
}> {
	const [beforeInstall, afterInstall, itemConditions] = await Promise.all([
		compileInstallPhaseList(
			itemDir,
			item.id,
			InstallPhase.BeforeInstall,
			item.beforeInstall,
			config,
		),
		compileInstallPhaseList(
			itemDir,
			item.id,
			InstallPhase.AfterInstall,
			item.afterInstall,
			config,
		),
		compileConditionHandlers(itemDir, item.conditions, config, {
			handlerUri: (key) =>
				`${config.compiledDirName}/_handlers/items/${item.id}/${key}.handler.js`,
			entryLabel: (key) =>
				`Registry item "${item.id}" condition "${key}" handler`,
			bundleLabel: (key) => `Registry item "${item.id}" condition "${key}"`,
			rootLabel: "item folder",
		}),
	]);

	return { beforeInstall, afterInstall, itemConditions };
}

/**
 * Shared index fields copied from a raw item and its compiled artifacts.
 * @param item - Authored registry item.
 * @param artifacts - Compiled install scripts and condition handlers.
 * @returns Index fields shared by item-level and pack-based entries.
 */
function sharedIndexItemFields(
	item: RawRegistryItem,
	artifacts: Awaited<ReturnType<typeof compileItemIndexArtifacts>>,
): Pick<
	IndexItem,
	| "title"
	| "description"
	| "type"
	| "requires"
	| "conditions"
	| "dependsOn"
	| "beforeInstall"
	| "afterInstall"
> {
	const { beforeInstall, afterInstall, itemConditions } = artifacts;
	return {
		title: item.title,
		description: item.description,
		type: item.type,
		...(item.requires ? { requires: item.requires } : {}),
		...(itemConditions ? { conditions: itemConditions } : {}),
		...(item.dependsOn ? { dependsOn: item.dependsOn } : {}),
		...(beforeInstall ? { beforeInstall } : {}),
		...(afterInstall ? { afterInstall } : {}),
	};
}

/**
 * Build the index entry for one raw item.
 * @param itemDir - Absolute item folder.
 * @param item - Authored registry item.
 * @param config - Build config.
 * @returns Index item shape (pack list, item-level source, and/or lifecycle scripts).
 */
async function indexEntryForItem(
	itemDir: string,
	item: RawRegistryItem,
	config: BuildConfig,
): Promise<IndexItem> {
	const artifacts = await compileItemIndexArtifacts(itemDir, item, config);
	const entry: IndexItem = {
		...sharedIndexItemFields(item, artifacts),
		...(itemNeedsBaseCompiledItem(item)
			? { source: compiledItemUri(config.compiledDirName, item.id) }
			: {}),
	};

	if (!item.packs?.length) return entry;

	return {
		...entry,
		packs: await Promise.all(
			item.packs.map((pack) => indexPackEntry(itemDir, item.id, pack, config)),
		),
	};
}

/**
 * Index raw items by id with compiled item URIs on the item or each variant.
 * @param rawItems - Loaded raw items.
 * @param config - Build config.
 * @returns Index items sorted by id.
 */
async function buildIndexItems(
	rawItems: RawItemEntry[],
	config: BuildConfig,
): Promise<Record<string, IndexItem>> {
	const indexItems: Record<string, IndexItem> = {};
	for (const { itemDir, item } of rawItems)
		indexItems[item.id] = await indexEntryForItem(itemDir, item, config);

	return Object.fromEntries(
		Object.entries(indexItems).sort(([a], [b]) => a.localeCompare(b)),
	);
}

/**
 * Fetch optional conditions and required types from the registry source.
 * @param config - Build config.
 * @returns Parsed conditions (optional) and types (required).
 * @throws Error when the types file is missing or either file is invalid.
 */
async function fetchTypesAndConditions(config: BuildConfig): Promise<{
	conditions: Record<string, RegistryCondition> | undefined;
	types: Record<string, RegistryItemTypeDefinition>;
}> {
	const { sourceDir, typesFileName, conditionsFileName } = config;
	const conditionsPath = path.join(sourceDir, conditionsFileName);
	const rawConditions = (await isFileAsync(conditionsPath))
		? await readJsonFileAsync(conditionsPath, "Registry conditions")
		: undefined;

	const typesPath = path.join(sourceDir, typesFileName);
	if (!(await isFileAsync(typesPath)))
		throw new Error(`Registry types not found at ${typesFileName}.`);

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

	const conditions = parseKeyedRecord(
		registryConditionSchema,
		rawConditions,
		"Registry conditions",
		(key) => `Registry condition "${key}"`,
	);
	assertConditionMapBindingKeys(conditions);

	return {
		conditions,
		types,
	};
}

/**
 * Compile a registry registry source tree into a index JSON file and compiled items under the compiled output directory.
 * @param options - Absolute `sourceDir` / `outDir`, plus optional layout and bundling overrides (see {@link BuildRegistryOptions}).
 * @returns The compiled registry document that was written to disk.
 * @throws Error when a file-name option is invalid, an item is invalid, a source is missing, or types are absent.
 */
export async function buildRegistry(
	options: BuildRegistryOptions,
): Promise<Registry> {
	const config = createBuildConfig(options);
	const registryPath = path.join(config.outDir, config.registryFileName);

	const rawItems = await fetchRawItems(config);
	const { conditions, types } = await fetchTypesAndConditions(config);

	await writeCompiledItems(rawItems, config);

	const compiledConditions = await compileConditionHandlers(
		config.sourceDir,
		conditions,
		config,
		{
			handlerUri: (key) =>
				`${config.compiledDirName}/_handlers/${key}.handler.js`,
			entryLabel: (key) => `Registry condition "${key}" handler`,
			bundleLabel: (key) => `Registry condition "${key}"`,
			rootLabel: "registry source",
		},
	);
	const document = parseRegistryDocument({
		...(compiledConditions ? { conditions: compiledConditions } : {}),
		types,
		items: await buildIndexItems(rawItems, config),
	});

	await writeFileAsync(registryPath, `${JSON.stringify(document)}\n`);
	return document;
}
