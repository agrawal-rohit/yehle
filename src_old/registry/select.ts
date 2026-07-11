import prompts from "../cli/prompts";
import { Language } from "../core/constants";
import { readGitConfig } from "../../src/core/git";
import { IDE_FORMATS } from "../core/ide-formats";
import { validatePackageName } from "../core/pkg-manager";
import { toSlug } from "../../src/core/utils";
import { loadRegistryIndex } from "./loader";
import { listRegistryItems } from "./resolver";
import {
	type RegistryInput,
	RegistryInputOptionsFrom,
	RegistryInputType,
	type RegistryInstallContext,
	type RegistryItem,
	RegistryItemType,
} from "./schema";

/**
 * Resolve a registry template item from CLI flags or prompt the user.
 * @param template - Optional registry template id.
 * @returns Resolved template item id and metadata.
 * @throws Error when the item is missing or not a template.
 */
export async function resolveRegistryTemplateItem(
	template?: string,
): Promise<{ itemName: string; item: RegistryItem }> {
	const index = await loadRegistryIndex();
	const candidates = listRegistryItems(index, {
		type: RegistryItemType.TEMPLATE,
	});

	if (candidates.length === 0)
		throw new Error("No template items found in the registry.");

	let itemName = template;
	if (!itemName) {
		if (candidates.length === 1) {
			itemName = candidates[0];
			console.log(`(Only one template is available, using "${itemName}".)`);
		} else {
			itemName = await prompts.selectInput<string>(
				"Which registry template would you like to use?",
				{
					options: candidates.map((id) => {
						const item = index.get(id);
						return {
							label: item ? `${item.title} (${id})` : id,
							value: id,
						};
					}),
				},
				candidates[0],
			);
		}
	}

	const item = index.get(itemName);
	if (!item) throw new Error(`Registry template not found: "${itemName}".`);
	if (item.type !== RegistryItemType.TEMPLATE)
		throw new Error(
			`Registry item "${itemName}" is not a template (type: ${item.type}).`,
		);
	if (!candidates.includes(itemName))
		throw new Error(
			`Unsupported template: ${itemName} (valid: ${candidates.join(", ")}).`,
		);

	return { itemName, item };
}

/**
 * Resolve one or more addable registry item ids from CLI args or prompt the user.
 * Template items are excluded because they are installed via `tuckshop create`.
 * @param items - Optional registry item ids from CLI args.
 * @returns Selected registry item ids.
 * @throws Error when no addable items exist or a selection is invalid.
 */
export async function resolveRegistryAddItems(
	items: string[] = [],
): Promise<string[]> {
	const index = await loadRegistryIndex();
	const addable = listRegistryItems(index).filter((id) => {
		const item = index.get(id);
		return item?.type !== RegistryItemType.TEMPLATE;
	});

	if (addable.length === 0) throw new Error("No addable registry items found.");

	const selected = items.filter(Boolean);
	if (selected.length > 0) {
		for (const itemName of selected) {
			const id = itemName.includes("@") ? itemName.split("@")[0] : itemName;
			if (!index.has(id))
				throw new Error(`Registry item not found: "${itemName}".`);
			const item = index.get(id);
			if (item?.type === RegistryItemType.TEMPLATE)
				throw new Error(
					`Registry item "${id}" is a template. Use \`tuckshop create ${id}\` instead.`,
				);
		}
		return selected;
	}

	if (addable.length === 1) {
		console.log(`(Using registry item "${addable[0]}".)`);
		return [addable[0]];
	}

	const chosen = await prompts.multiselectInput(
		"Which registry items would you like to add?",
		{
			options: addable.map((id) => {
				const item = index.get(id);
				return {
					label: item ? `${item.title} (${id})` : id,
					value: id,
				};
			}),
		},
	);

	return chosen;
}

/**
 * Suggest a default value for a well-known string input, deriving author-related
 * fields from the local Git config when the manifest declares no static default.
 * @param input - The declared string input.
 * @returns Suggested initial value, or undefined.
 */
async function suggestStringInputDefault(
	input: RegistryInput,
): Promise<string | undefined> {
	if (typeof input.default === "string") return input.default;

	switch (input.name) {
		case "authorName":
			return (await readGitConfig("user.name")) ?? undefined;
		case "authorGitEmail":
			return (await readGitConfig("user.email")) ?? undefined;
		case "authorGitUsername": {
			const gitName = await readGitConfig("user.name");
			return gitName ? gitName.toLowerCase().replaceAll(/\s+/g, "") : undefined;
		}
		default:
			return undefined;
	}
}

/**
 * Resolve select options for a registry input.
 * @param input - Declared registry input.
 * @returns Select options for prompting.
 */
function resolveRegistryInputOptions(
	input: RegistryInput,
): { label: string; value: string }[] {
	if (input.optionsFrom === RegistryInputOptionsFrom.IDE_FORMATS)
		return [...IDE_FORMATS];
	return input.options ?? [];
}

/**
 * Apply post-prompt normalization and validation for well-known inputs.
 * @param input - Declared registry input.
 * @param value - User-provided value.
 * @param context - Install context (for language-aware validation).
 * @returns Normalized value.
 * @throws Error when validation fails.
 */
function finalizeRegistryInputValue(
	input: RegistryInput,
	value: string | boolean,
	context: RegistryInstallContext,
): string | boolean {
	if (input.name === "authorGitUsername" && typeof value === "string")
		return toSlug(value);

	if (
		input.name === "name" &&
		typeof value === "string" &&
		typeof context.lang === "string" &&
		Object.values(Language).includes(context.lang as Language)
	) {
		validatePackageName(value, context.lang as Language);
	}

	return value;
}

/**
 * Prompt for a declared registry input based on its type. Used as the
 * `resolveInput` callback so `tuckshop add`/`create` can gather mustache variables and
 * conditional values declared by registry items.
 * @param input - The declared input to resolve.
 * @param context - Install context used for validation and defaults.
 * @returns The value entered by the user (string or boolean).
 */
export async function promptRegistryInput(
	input: RegistryInput,
	context: RegistryInstallContext,
): Promise<string | boolean> {
	let value: string | boolean;

	switch (input.type) {
		case RegistryInputType.BOOLEAN:
			value = await prompts.confirmInput(
				input.prompt,
				undefined,
				typeof input.default === "boolean" ? input.default : false,
			);
			break;
		case RegistryInputType.SELECT: {
			const options = resolveRegistryInputOptions(input);
			if (options.length === 0)
				throw new Error(
					`Registry input "${input.name}" requires select options.`,
				);
			value = await prompts.selectInput<string>(
				input.prompt,
				{ options },
				typeof input.default === "string" ? input.default : options[0]?.value,
			);
			break;
		}
		case RegistryInputType.STRING: {
			const initial = await suggestStringInputDefault(input);
			value = await prompts.textInput(
				input.prompt,
				{ required: input.required },
				initial,
			);
			break;
		}
		default: {
			const _exhaustive: never = input.type;
			throw new Error(
				`Unsupported registry input type: ${String(_exhaustive)}`,
			);
		}
	}

	return finalizeRegistryInputValue(input, value, context);
}
