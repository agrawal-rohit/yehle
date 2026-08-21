import { createRequire } from "node:module";
import path from "node:path";
import type { ConditionHandler, ItemHandler } from "./handlers";
import { isAbsoluteHttpUrl, joinRelativePathUnderRoot } from "./urls";

const requireHandler = createRequire(__filename);

/**
 * Resolve a catalog-relative handler URI to an absolute local file path.
 * Rejects remote catalogs, absolute paths, URLs, and parent-directory escapes.
 * @param catalogLocation - Absolute path or HTTPS URL of registry.json.
 * @param handlerUri - Catalog handler URI such as `r/item.handler.js`.
 * @returns Absolute path to the handler module.
 * @throws Error when the catalog is remote or the URI is unsafe.
 */
export function resolveLocalHandlerPath(
	catalogLocation: string,
	handlerUri: string,
): string {
	if (isAbsoluteHttpUrl(catalogLocation))
		throw new Error(
			"Registry handlers require a local catalog. Remote HTTPS registries cannot execute custom handlers.",
		);

	const catalogDir = path.dirname(path.resolve(catalogLocation));
	const trimmed = handlerUri.trim();
	if (!trimmed || isAbsoluteHttpUrl(trimmed))
		throw new Error(
			`Handler URI "${handlerUri}" must be a relative path under the catalog directory.`,
		);

	return joinRelativePathUnderRoot(
		catalogDir,
		trimmed,
		"Handler URI",
		"catalog directory",
	);
}

/**
 * Load a CommonJS handler module from disk.
 * @param absolutePath - Absolute path to the compiled handler.
 * @returns Module exports object.
 */
function requireHandlerModule(absolutePath: string): Record<string, unknown> {
	// Clear the require cache so rebuilt handlers are picked up in long-lived processes.
	Reflect.deleteProperty(requireHandler.cache, absolutePath);
	return requireHandler(absolutePath) as Record<string, unknown>;
}

/**
 * Dynamically import a local handler module and validate its export shape.
 * @param catalogLocation - Absolute path to registry.json (must be local).
 * @param handlerUri - Catalog handler URI.
 * @param isValid - Predicate that accepts a usable handler export.
 * @param errorMessage - Error when the export shape is invalid.
 * @returns Loaded handler (default export or module itself).
 * @throws Error when the module cannot be loaded or has no usable export.
 */
async function loadHandlerModule<T>(
	catalogLocation: string,
	handlerUri: string,
	isValid: (value: unknown) => value is T,
	errorMessage: string,
): Promise<T> {
	const absolutePath = resolveLocalHandlerPath(catalogLocation, handlerUri);
	const imported = requireHandlerModule(absolutePath);
	const handler =
		imported !== null &&
		typeof imported === "object" &&
		"default" in imported &&
		imported.default !== undefined
			? imported.default
			: imported;
	if (!isValid(handler)) throw new Error(errorMessage);
	return handler;
}

/**
 * Dynamically import a local item handler module.
 * @param catalogLocation - Absolute path to registry.json (must be local).
 * @param handlerUri - Catalog handler URI.
 * @returns Loaded item handler (default export or module itself).
 * @throws Error when the module cannot be loaded or has no usable export.
 */
export async function loadItemHandler(
	catalogLocation: string,
	handlerUri: string,
): Promise<ItemHandler> {
	return loadHandlerModule(
		catalogLocation,
		handlerUri,
		(handler): handler is ItemHandler =>
			typeof handler === "object" &&
			handler !== null &&
			(typeof (handler as ItemHandler).prompts === "function" ||
				typeof (handler as ItemHandler).files === "function" ||
				typeof (handler as ItemHandler).transform === "function"),
		`Handler at "${handlerUri}" must export an item handler with prompts, files, and/or transform.`,
	);
}

/**
 * Dynamically import a local condition handler module.
 * @param catalogLocation - Absolute path to registry.json (must be local).
 * @param handlerUri - Catalog handler URI.
 * @returns Loaded condition handler with a required `infer` hook.
 * @throws Error when the module cannot be loaded or has no usable export.
 */
export async function loadConditionHandler(
	catalogLocation: string,
	handlerUri: string,
): Promise<
	ConditionHandler & { infer: NonNullable<ConditionHandler["infer"]> }
> {
	return loadHandlerModule(
		catalogLocation,
		handlerUri,
		(
			handler,
		): handler is ConditionHandler & {
			infer: NonNullable<ConditionHandler["infer"]>;
		} =>
			typeof handler === "object" &&
			handler !== null &&
			typeof (handler as ConditionHandler).infer === "function",
		`Handler at "${handlerUri}" must export a condition handler with an infer hook.`,
	);
}
