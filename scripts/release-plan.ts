import type { ReleaseConfig, ReleasePackageConfig } from "./release-config";

export type ReleaseBump = "major" | "minor" | "patch";

export interface ReleaseCommit {
	/**
	 * Commit hash included in the release.
	 */
	hash: string;
	/**
	 * Conventional commit subject line.
	 */
	subject: string;
	/**
	 * Full commit message body used for breaking-change detection.
	 */
	body: string;
	/**
	 * Repo-relative changed files.
	 */
	files: string[];
	/**
	 * Release impact inferred from the commit.
	 */
	bump: ReleaseBump;
}

export interface PackageReleasePlan {
	/**
	 * Package id from release.config.json.
	 */
	id: string;
	/**
	 * Human-readable package name from tagName or id.
	 */
	displayName: string;
	/**
	 * Matching package config.
	 */
	package: ReleasePackageConfig;
	/**
	 * Ref used as the lower bound for git history.
	 */
	baselineRef: string;
	/**
	 * Previous release tag when it exists.
	 */
	previousTag: string | null;
	/**
	 * Current version from the package manifest.
	 */
	currentVersion: string;
	/**
	 * Semver bump chosen for this release.
	 */
	bump: ReleaseBump;
	/**
	 * Computed next version.
	 */
	nextVersion: string;
	/**
	 * Tag that will be created for the release.
	 */
	tag: string;
	/**
	 * Commits included in the release.
	 */
	commits: ReleaseCommit[];
	/**
	 * Package ids versioned in lockstep with this release.
	 */
	linkedPackageIds: string[];
}

export interface ReleasePlan {
	/**
	 * Schema version for forwards-compatible plan parsing.
	 */
	schemaVersion: 1;
	/**
	 * Loaded repo release configuration.
	 */
	config: ReleaseConfig;
	/**
	 * Releases that should be applied.
	 */
	releases: PackageReleasePlan[];
}
