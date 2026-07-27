/** Registry item types */
export enum RegistryItemType {
	TEMPLATE = "template",
	COMPONENT = "component",
	THEME = "theme",
	CONVENTION = "convention",
	AGENT_INSTRUCTION = "agent-instruction",
	AGENT_SKILL = "agent-skill",
	SUBAGENT = "subagent",
}

/** Schema version supported by this build of `@tuckshop/core`. */
export const SCHEMA_VERSION = 1;

/** Registry items may use built-in types or custom author-defined strings. */
export type RegistryItemTypeValue = RegistryItemType | (string & {});

/** Supported condition inference modes. */
export enum RegistryConditionInference {
	FILES = "files",
}

/** Built registry file metadata (content fetched at install time). */
export type RegistryFile = {
	source: string;
	target: string;
};

/** A labelled value for a shared condition. */
export type RegistryConditionValue = {
	value: string;
	label: string;
	files?: string[];
};

/** Shared condition definition in the registry. */
export type RegistryCondition = {
	label: string;
	description?: string;
	inference?: RegistryConditionInference;
	values: RegistryConditionValue[];
};

/** Built registry variant (installable slice). */
export type RegistryVariant = {
	id: string;
	title: string;
	description: string;
	files: RegistryFile[];
	when?: Record<string, string>;
	dependencies?: string[];
	devDependencies?: string[];
	registryDependencies?: Array<string | { name: string }>;
};

/** The built registry document written to registry.json. */
export type Registry = {
	/** Version of the registry content package that produced this document. */
	version: string;
	/** Schema version used to validate and interpret the document. */
	schemaVersion: number;
	/** Base URL for fetching file content (`${contentBaseUrl}/${source}`). */
	contentBaseUrl: string;
	/** Shared condition definitions keyed by condition key. */
	conditions?: Record<string, RegistryCondition>;
	/** Registry items keyed by id. */
	items: Record<string, RegistryItem>;
};

/** Registry item metadata from registry.json. */
export type RegistryItem = {
	id: string;
	title: string;
	description: string;
	type: RegistryItemTypeValue;
	files?: RegistryFile[];
	dependencies?: string[];
	devDependencies?: string[];
	variants: RegistryVariant[];
	registryDependencies?: Array<string | { name: string }>;
};

/**
 * Collect the unique item types declared across a registry.
 * @param registry - Loaded registry document.
 * @returns Sorted unique type values.
 */
export function getRegistryItemTypes(registry: Registry): string[] {
	const types = new Set<string>();
	for (const item of Object.values(registry.items)) types.add(item.type);
	return Array.from(types).sort((a, b) => a.localeCompare(b));
}
