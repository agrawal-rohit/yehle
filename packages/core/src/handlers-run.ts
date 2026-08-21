import path from "node:path";
import {
	policyForConditionKind,
	type RegistryContext,
	type RegistryContextValue,
} from "./condition-kind";
import type {
	ConditionHandlerContext,
	HandlerRuntime,
	ItemHandler,
	ItemHandlerContext,
	PromptHost,
} from "./handlers";
import { loadConditionHandler, loadItemHandler } from "./handlers-load";
import type { RequiredCondition } from "./plan";
import type { RegistryPayload, RegistryPayloadFile } from "./schema";

/**
 * Build the shared runtime helpers injected into every handler.
 * @param projectDir - Absolute project root.
 * @param prompts - Prompt host implementation.
 * @param helpers - Filesystem and process helpers.
 * @returns Handler runtime object.
 */
export function createHandlerRuntime(
	projectDir: string,
	prompts: PromptHost,
	helpers: {
		isFile: (filePath: string) => Promise<boolean>;
		readFile: (filePath: string) => Promise<string>;
		run: (command: string) => Promise<string>;
	},
): HandlerRuntime {
	return {
		projectDir,
		prompts,
		isFile: (filePath) =>
			helpers.isFile(
				path.isAbsolute(filePath) ? filePath : path.join(projectDir, filePath),
			),
		readFile: (filePath) =>
			helpers.readFile(
				path.isAbsolute(filePath) ? filePath : path.join(projectDir, filePath),
			),
		run: helpers.run,
	};
}

/**
 * Infer a prompt default for one required condition when it declares a handler.
 * @param catalogLocation - Absolute local path to registry.json.
 * @param condition - Required condition from the install plan.
 * @param runtime - Shared handler runtime.
 * @param context - Already-resolved condition context.
 * @returns Suggested default when confident, otherwise undefined.
 */
export async function inferConditionDefault(
	catalogLocation: string,
	condition: RequiredCondition,
	runtime: HandlerRuntime,
	context: RegistryContext,
): Promise<RegistryContextValue | undefined> {
	if (!condition.handler) return undefined;

	const handler = await loadConditionHandler(
		catalogLocation,
		condition.handler,
	);

	const ctx: ConditionHandlerContext = {
		...runtime,
		key: condition.key,
		label: condition.label,
		...(condition.description ? { description: condition.description } : {}),
		...(condition.values.length > 0 ? { values: condition.values } : {}),
		conditions: context,
	};

	const inferred = await handler.infer(ctx);
	if (inferred === undefined || inferred === "") return undefined;

	return policyForConditionKind(condition.kind).normalizeInferred(
		inferred,
		condition.values,
	);
}

/**
 * Run item handler hooks: prompts → files → transform.
 * @param catalogLocation - Absolute local path to registry.json.
 * @param handlerUri - Catalog handler URI.
 * @param runtime - Shared handler runtime.
 * @param options - Item identity, payload, and condition context.
 * @returns Final files and any variables collected from prompts.
 */
export async function runItemHandler(
	catalogLocation: string,
	handlerUri: string,
	runtime: HandlerRuntime,
	options: {
		itemId: string;
		variantId?: string;
		conditions: RegistryContext;
		variables?: Record<string, string>;
		payload: RegistryPayload;
	},
): Promise<{
	files: RegistryPayloadFile[];
	variables: Record<string, string>;
}> {
	const handler: ItemHandler = await loadItemHandler(
		catalogLocation,
		handlerUri,
	);

	const variables: Record<string, string> = { ...(options.variables ?? {}) };
	let files: RegistryPayloadFile[] = [...options.payload.files];

	const baseCtx = (): ItemHandlerContext => ({
		...runtime,
		itemId: options.itemId,
		...(options.variantId ? { variantId: options.variantId } : {}),
		conditions: options.conditions,
		variables,
		payload: options.payload,
		files,
	});

	if (handler.prompts) {
		const prompted = await handler.prompts(baseCtx());
		if (prompted) Object.assign(variables, prompted);
	}

	if (handler.files) {
		const generated = await handler.files(baseCtx());
		if (generated && generated.length > 0) files = [...files, ...generated];
	}

	if (handler.transform) {
		const transformed = await handler.transform(baseCtx());
		if (transformed) files = transformed;
	}

	return { files, variables };
}
