export { type BuildRegistryOptions, buildRegistry } from "./build";
export {
	type ConditionKindPolicy,
	policyForConditionKind,
	RegistryConditionKind,
	type RegistryContext,
	type RegistryContextValue,
	type RegistryWhenValue,
} from "./condition-kind";
export {
	InvalidJsonError,
	isFileAsync,
	PathKind,
	pathKindAsync,
	readFileAsync,
	readJsonFileAsync,
	writeFileAsync,
} from "./fs";
export type {
	AfterInstallHook,
	BeforeInstallHook,
	BeforeInstallHookResult,
	ConditionHandler,
	ConditionHandlerContext,
	HandlerRuntime,
	HandlerSelectOption,
	InstallHookContext,
	PromptHost,
	RunInstallHookOptions,
} from "./handlers";
export {
	createHandlerRuntime,
	inferConditionDefault,
	runAfterInstallHook,
	runBeforeInstallHook,
} from "./handlers";
export {
	buildInterpolationContext,
	type InterpolationView,
	interpolatePayload,
} from "./interpolate";
export {
	buildPackageInstallCommands,
	detectPackageManagerFromLockfile,
	ecosystemManagers,
	mergeCommandSet,
	mergeDependencySet,
	mergeEcosystemMaps,
	mergeSecretNames,
	NpmPackageManager,
	type PackageManagerSpec,
	type RegistryPackageManager,
} from "./packages";
export { parseRegistryDocument, parseWithSchema } from "./parse";
export {
	assumeContextFromSelectedItems,
	buildInstallPlan,
	type CatalogEntry,
	collectItemLocalConditions,
	collectRegistryDependencies,
	collectRequiredConditions,
	type InstallNode,
	type RequiredCondition,
} from "./plan";
export {
	type AuthoredRegistryItem,
	type AuthoredRegistryPack,
	assertConditionMapBindingKeys,
	type CatalogItem,
	type CatalogPack,
	catalogItemSchema,
	catalogPackSchema,
	type Registry,
	type RegistryCommandSet,
	type RegistryCondition,
	type RegistryConditionValue,
	RegistryDependencyKind,
	type RegistryDependencySet,
	RegistryEcosystem,
	type RegistryEcosystemCommands,
	type RegistryEcosystemDependencies,
	type RegistryFile,
	type RegistryItemTypeDefinition,
	type RegistryPayload,
	type RegistryPayloadFile,
	type RegistryWhen,
	registryConditionSchema,
	registryConditionValueSchema,
	registryDependencySetSchema,
	registryDocumentFieldsSchema,
	registryEcosystemDependenciesSchema,
	registryFileSchema,
	registryItemSchema,
	registryItemTypeSchema,
	registryPackSchema,
	registryPayloadFileSchema,
	registryPayloadSchema,
	registryWhenSchema,
	registryWhenValueSchema,
} from "./schema";
export { type RunOptions, runAsync } from "./shell";
export {
	assertSafeRemoteUrl,
	isAbsoluteHttpUrl,
	joinCatalogSource,
	joinRelativePathUnderRoot,
	publishedRegistryUrl,
} from "./urls";
