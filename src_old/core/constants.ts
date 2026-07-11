/** Supported programming languages for the package. */
export enum Language {
	TYPESCRIPT = "typescript",
}

/**
 * Base URL for the raw registry source files on GitHub. The build appends the
 * version tag (e.g. `/v0.2.1`) to form the registry's content base URL, from
 * which the CLI fetches file content at install time.
 */
export const REGISTRY_REPO_RAW_BASE =
	"https://raw.githubusercontent.com/agrawal-rohit/tuckshop";

/**
 * Environment variable that overrides the registry content base URL at build
 * (and runtime), e.g. to point at a fork or a local mirror.
 */
export const REGISTRY_BASE_URL_ENV = "TUCKSHOP_REGISTRY_BASE_URL";
