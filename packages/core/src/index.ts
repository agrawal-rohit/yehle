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
	buildPackageInstallCommands,
	detectPackageManagerFromLockfile,
	ecosystemManagers,
	mergeEcosystemDependencies,
	NpmPackageManager,
	type PackageManagerSpec,
	type RegistryPackageManager,
} from "./packages";
export { parseRegistryDocument, parseWithSchema } from "./parse";
export {
	assumeContextFromSelectedItems,
	buildInstallPlan,
	type CatalogEntry,
	collectRegistryDependencies,
	collectRequiredConditions,
	type InstallNode,
	type RequiredCondition,
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
	RegistryDependencyKind,
	type RegistryDependencySet,
	RegistryEcosystem,
	type RegistryEcosystemDependencies,
	type RegistryFile,
	type RegistryItemTypeDefinition,
	type RegistryPayload,
	type RegistryPayloadFile,
	registryConditionSchema,
	registryConditionValueSchema,
	registryDependencySetSchema,
	registryDocumentFieldsSchema,
	registryEcosystemDependenciesSchema,
	registryFileSchema,
	registryItemSchema,
	registryItemTypeSchema,
	registryPayloadFileSchema,
	registryPayloadSchema,
	registryVariantSchema,
} from "./schema";
export { type RunOptions, runAsync } from "./shell";
export {
	assertSafeRemoteUrl,
	isAbsoluteHttpUrl,
	joinCatalogSource,
	joinRelativePathUnderRoot,
	publishedRegistryUrl,
} from "./urls";
