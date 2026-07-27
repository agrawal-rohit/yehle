import fs from "node:fs";
import path from "node:path";

export interface ReleasePackageConfig {
	/**
	 * Stable identifier used by CLI flags and linked bump references.
	 */
	id: string;
	/**
	 * Repository-relative directory for this package.
	 */
	path: string;
	/**
	 * Tag prefix for this package, e.g. `tuckshop`.
	 */
	tagName?: string;
	/**
	 * Whether this package is published externally.
	 */
	publish: boolean;
	/**
	 * Globs that indicate this package changed.
	 */
	paths: string[];
	/**
	 * Package ids that must be versioned in lockstep with this package.
	 */
	linkedBumps?: string[];
	/**
	 * Files relative to `path` that should be staged after version bumps.
	 */
	manifestFiles: string[];
	/**
	 * Command template used to bump the package version.
	 */
	bumpCommand: string;
	/**
	 * Command template used to publish the package.
	 */
	publishCommand?: string;
	/**
	 * Commands that must run after the version bump and before commit.
	 */
	preVersionHooks?: string[];
	/**
	 * Repo-relative files or globs to stage after hooks run.
	 */
	stagePaths?: string[];
	/**
	 * Changelog path relative to `path`.
	 */
	changelogFile?: string;
}

export interface ReleaseConfig {
	/**
	 * Tag separator placed between tagName and version.
	 */
	tagSeparator: string;
	/**
	 * Branch that receives release commits.
	 */
	baseBranch?: string;
	/**
	 * Git ref used before the first matching package tag exists.
	 */
	bootstrapRef?: string;
	/**
	 * Globs that map otherwise-unclaimed commits to the first package.
	 */
	commitPathFallback?: string[];
	/**
	 * Commit message template with `{tags}` placeholder.
	 */
	releaseCommitMessage?: string;
	/**
	 * Packages participating in release automation.
	 */
	packages: ReleasePackageConfig[];
}

/**
 * Load and validate the repository release configuration.
 *
 * @param workspaceRoot absolute workspace path
 * @returns parsed release configuration
 * @throws when the file is missing or malformed
 */
export function loadReleaseConfig(workspaceRoot: string): ReleaseConfig {
	const configPath = path.join(workspaceRoot, "release.config.json");
	const rawConfig = fs.readFileSync(configPath, "utf8");
	const parsed = JSON.parse(rawConfig) as unknown;

	return validateReleaseConfig(parsed, configPath);
}

/**
 * Validate the JSON config and normalize optional fields.
 *
 * @param source unknown JSON payload
 * @param configPath path used in validation errors
 * @returns normalized config object
 * @throws when required fields are missing or inconsistent
 */
export function validateReleaseConfig(
	source: unknown,
	configPath: string,
): ReleaseConfig {
	if (!source || typeof source !== "object" || Array.isArray(source)) {
		throw new Error(`${configPath} must contain a JSON object.`);
	}

	const config = source as Partial<ReleaseConfig>;
	assertNonEmptyString(config.tagSeparator, `${configPath} tagSeparator`);

	if (config.baseBranch !== undefined) {
		assertNonEmptyString(config.baseBranch, `${configPath} baseBranch`);
	}

	if (config.bootstrapRef !== undefined) {
		assertNonEmptyString(config.bootstrapRef, `${configPath} bootstrapRef`);
	}

	if (config.releaseCommitMessage !== undefined) {
		assertNonEmptyString(
			config.releaseCommitMessage,
			`${configPath} releaseCommitMessage`,
		);
	}

	const commitPathFallback = assertOptionalStringArray(
		config.commitPathFallback,
		`${configPath} commitPathFallback`,
	);

	if (!Array.isArray(config.packages) || config.packages.length === 0) {
		throw new Error(`${configPath} packages must be a non-empty array.`);
	}

	const packages = config.packages.map((pkg, index) =>
		validateReleasePackage(pkg, `${configPath} packages[${index}]`),
	);

	const packageIds = new Set<string>();
	for (const pkg of packages) {
		if (packageIds.has(pkg.id)) {
			throw new Error(`${configPath} package id "${pkg.id}" is duplicated.`);
		}

		packageIds.add(pkg.id);
	}

	for (const pkg of packages) {
		for (const linkedId of pkg.linkedBumps ?? []) {
			if (!packageIds.has(linkedId)) {
				throw new Error(
					`${configPath} package "${pkg.id}" links unknown package "${linkedId}".`,
				);
			}
		}

		if (pkg.publish && !pkg.tagName) {
			throw new Error(
				`${configPath} package "${pkg.id}" must define tagName when publish is true.`,
			);
		}

		if (pkg.publish && !pkg.publishCommand) {
			throw new Error(
				`${configPath} package "${pkg.id}" must define publishCommand when publish is true.`,
			);
		}
	}

	return {
		tagSeparator: config.tagSeparator,
		baseBranch: config.baseBranch ?? "main",
		bootstrapRef: config.bootstrapRef,
		commitPathFallback,
		releaseCommitMessage:
			config.releaseCommitMessage ?? "chore(release): {tags} [skip ci]",
		packages,
	};
}

/**
 * Build a git tag for a released package version.
 *
 * @param config repo release configuration
 * @param pkg package config
 * @param version next package version
 * @returns formatted tag name
 */
export function buildReleaseTag(
	config: ReleaseConfig,
	pkg: ReleasePackageConfig,
	version: string,
): string {
	if (!pkg.tagName) {
		throw new Error(
			`Cannot build a tag for package "${pkg.id}" because tagName is missing.`,
		);
	}

	return `${pkg.tagName}${config.tagSeparator}${version}`;
}

/**
 * Resolve a package config by id.
 *
 * @param config repo release configuration
 * @param packageId package id to look up
 * @returns matching package config
 * @throws when the package id does not exist
 */
export function getPackageById(
	config: ReleaseConfig,
	packageId: string,
): ReleasePackageConfig {
	const pkg = config.packages.find((candidate) => candidate.id === packageId);

	if (!pkg) {
		throw new Error(`Unknown release package "${packageId}".`);
	}

	return pkg;
}

/**
 * Convert repo-relative stage paths into absolute paths.
 *
 * @param workspaceRoot absolute workspace path
 * @param pkg package config
 * @returns list of stageable repo-relative paths for this package
 */
export function getStagePathsForPackage(
	workspaceRoot: string,
	pkg: ReleasePackageConfig,
): string[] {
	const manifestPaths = pkg.manifestFiles.map((filePath) =>
		path
			.relative(workspaceRoot, path.join(workspaceRoot, pkg.path, filePath))
			.replaceAll(path.sep, "/"),
	);

	return [...manifestPaths, ...(pkg.stagePaths ?? [])];
}

/**
 * Validate one package entry.
 *
 * @param source unknown package payload
 * @param label error label
 * @returns normalized package config
 * @throws when required fields are missing
 */
function validateReleasePackage(
	source: unknown,
	label: string,
): ReleasePackageConfig {
	if (!source || typeof source !== "object" || Array.isArray(source)) {
		throw new Error(`${label} must be a JSON object.`);
	}

	const pkg = source as Partial<ReleasePackageConfig>;
	assertNonEmptyString(pkg.id, `${label} id`);
	assertNonEmptyString(pkg.path, `${label} path`);
	assertStringArray(pkg.paths, `${label} paths`);
	assertStringArray(pkg.manifestFiles, `${label} manifestFiles`);
	assertNonEmptyString(pkg.bumpCommand, `${label} bumpCommand`);

	if (pkg.tagName !== undefined) {
		assertNonEmptyString(pkg.tagName, `${label} tagName`);
	}

	if (typeof pkg.publish !== "boolean") {
		throw new Error(`${label} publish must be a boolean.`);
	}

	if (pkg.publishCommand !== undefined) {
		assertNonEmptyString(pkg.publishCommand, `${label} publishCommand`);
	}

	const linkedBumps = assertOptionalStringArray(
		pkg.linkedBumps,
		`${label} linkedBumps`,
	);
	const preVersionHooks = assertOptionalStringArray(
		pkg.preVersionHooks,
		`${label} preVersionHooks`,
	);
	const stagePaths = assertOptionalStringArray(
		pkg.stagePaths,
		`${label} stagePaths`,
	);

	if (pkg.changelogFile !== undefined) {
		assertNonEmptyString(pkg.changelogFile, `${label} changelogFile`);
	}

	return {
		id: pkg.id,
		path: pkg.path,
		tagName: pkg.tagName,
		publish: pkg.publish,
		paths: pkg.paths,
		linkedBumps,
		manifestFiles: pkg.manifestFiles,
		bumpCommand: pkg.bumpCommand,
		publishCommand: pkg.publishCommand,
		preVersionHooks,
		stagePaths,
		changelogFile: pkg.changelogFile ?? "CHANGELOG.md",
	};
}

/**
 * Assert a field is a non-empty string.
 *
 * @param value unknown field value
 * @param label error label
 * @throws when the field is missing or blank
 */
function assertNonEmptyString(value: unknown, label: string): asserts value is string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`${label} must be a non-empty string.`);
	}
}

/**
 * Assert a field is an array of non-empty strings.
 *
 * @param value unknown field value
 * @param label error label
 * @throws when the field is not a string array
 */
function assertStringArray(value: unknown, label: string): asserts value is string[] {
	if (!Array.isArray(value) || value.length === 0) {
		throw new Error(`${label} must be a non-empty array of strings.`);
	}

	for (const item of value) {
		assertNonEmptyString(item, `${label} entry`);
	}
}

/**
 * Assert an optional field is an array of non-empty strings.
 *
 * @param value unknown field value
 * @param label error label
 * @returns normalized array
 * @throws when the field is present but invalid
 */
function assertOptionalStringArray(value: unknown, label: string): string[] {
	if (value === undefined) {
		return [];
	}

	assertStringArray(value, label);
	return value;
}
