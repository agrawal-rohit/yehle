export { type BuildRegistryOptions, buildRegistry } from "./build";
export {
	type ConditionKindPolicy,
	policyForConditionKind,
	RegistryConditionKind,
	type RegistryContext,
	type RegistryContextValue,
} from "./condition-kind";
export {
	InvalidJsonError,
	isFileAsync,
	isMissingPathError,
	PathKind,
	pathKindAsync,
	readDirectoryAsync,
	readFileAsync,
	readJsonFileAsync,
	removeAsync,
	writeFileAsync,
} from "./fs";
export type {
	ConditionHandler,
	ConditionHandlerContext,
	HandlerRuntime,
	HandlerSelectOption,
	ItemHandler,
	ItemHandlerContext,
	PromptHost,
} from "./handlers";
export {
	loadConditionHandler,
	loadItemHandler,
	resolveLocalHandlerPath,
} from "./handlers-load";
export {
	createHandlerRuntime,
	inferConditionDefault,
	runItemHandler,
} from "./handlers-run";
export {
	buildPackageInstallCommands,
	detectPackageManagerFromLockfile,
	ecosystemManagers,
	mergeRegistryPackages,
	NpmPackageManager,
	type PackageManagerSpec,
	type RegistryPackageManager,
} from "./packages";
export { parseRegistryDocument, parseWithSchema } from "./parse";
export {
	assumeContextFromSelectedItems,
	type CatalogEntry,
	collectRegistryDependencies,
	collectRequiredConditions,
	type ParsedItemId,
	parseItemId,
	type RegistryItemSelection,
	type RequiredCondition,
	type ResolvedRegistryItem,
	type ResolvedRegistryPlan,
	resolveInstallPlan,
	selectRegistryVariant,
	whenMatchesContext,
} from "./plan";
export {
	type AuthoredRegistryItem,
	type AuthoredRegistryVariant,
	type CatalogItem,
	type CatalogVariant,
	catalogItemSchema,
	catalogVariantSchema,
	type Registry,
	type RegistryCondition,
	type RegistryConditionValue,
	RegistryEcosystem,
	type RegistryFile,
	type RegistryItemTypeDefinition,
	type RegistryPackageSet,
	type RegistryPackages,
	type RegistryPayload,
	type RegistryPayloadFile,
	registryConditionSchema,
	registryConditionValueSchema,
	registryDocumentFieldsSchema,
	registryFileSchema,
	registryItemSchema,
	registryItemTypeSchema,
	registryPackageSetSchema,
	registryPackagesSchema,
	registryPayloadFileSchema,
	registryPayloadSchema,
	registryVariantSchema,
} from "./schema";
export { type RunOptions, runAsync } from "./shell";
export {
	assertSafeRemoteUrl,
	isAbsoluteHttpUrl,
	joinRelativePathUnderRoot,
	publishedRegistryUrl,
	resolveRegistryPayload,
} from "./urls";
