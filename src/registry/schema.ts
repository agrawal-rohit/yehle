/** Registry item types */
export enum RegistryItemType {
	TEMPLATE = "template",
	COMPONENT = "component",
	THEME = "theme",
	BLOCK = "block",
	CONVENTION = "convention",
	AGENT_INSTRUCTION = "agent-instruction",
	AGENT_SKILL = "agent-skill",
	SUBAGENT = "subagent",
}

/** Built registry file metadata (content fetched at install time). */
export type RegistryFile = {
	source: string;
	target: string;
};

/** Built registry variant (installable slice). */
export type RegistryVariant = {
	id: string;
	title: string;
	description: string;
	files: RegistryFile[];
	dependencies?: string[];
	devDependencies?: string[];
	registryDependencies?: Array<string | { name: string; when?: string }>;
};

/** The built registry document written to registry.json. */
export type Registry = {
	/** CLI/registry version the metadata was built for. */
	version: string;
	/** Base URL for fetching file content (`${contentBaseUrl}/${source}`). */
	contentBaseUrl: string;
	/** Registry items keyed by id. */
	items: Record<string, RegistryItem>;
};

/** Registry item metadata from registry.json. */
export type RegistryItem = {
	id: string;
	title: string;
	description: string;
	type: RegistryItemType;
	variants: RegistryVariant[];
	registryDependencies?: Array<string | { name: string; when?: string }>;
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
