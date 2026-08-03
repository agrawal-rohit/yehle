/** Schema version supported by this build of `@tuckshop/core`. */
export const SCHEMA_VERSION = 1;

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

/** Display metadata for a registry item type. */
export type RegistryItemTypeDefinition = {
	label: string;
	description?: string;
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
	/** Item type display metadata keyed by type value. */
	types: Record<string, RegistryItemTypeDefinition>;
	/** Registry items keyed by id. */
	items: Record<string, RegistryItem>;
};

/** Registry item metadata from registry.json. */
export type RegistryItem = {
	id: string;
	title: string;
	description: string;
	type: string;
	files?: RegistryFile[];
	dependencies?: string[];
	devDependencies?: string[];
	variants: RegistryVariant[];
	registryDependencies?: Array<string | { name: string }>;
};
