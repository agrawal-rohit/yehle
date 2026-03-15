/** Supported programming languages for the package. */
export enum Language {
	TYPESCRIPT = "typescript",
}

/** Schema for yehle.yaml. */
export type YehleConfiguration = {
	/** Situational instructions to apply for this template or project-spec. */
	situationalInstructions?: string[];
};

/** Filename for the yehle configuration file in a template or project-spec dir. */
export const YEHLE_CONFIGURATION_FILENAME = "yehle.yaml";

/** When true, use local templates (and instructions under ./templates/instructions/ and ./templates/<lang>/...); otherwise fetch from GitHub. */
export const IS_LOCAL_MODE = process.env.YEHLE_LOCAL_TEMPLATES === "true";

/** Default GitHub owner for remote templates and instructions. */
export const DEFAULT_GITHUB_OWNER = "agrawal-rohit";

/** Default GitHub repository for remote templates and instructions. */
export const DEFAULT_GITHUB_REPO = "yehle";

/** Shared headers for GitHub API requests. */
export const GITHUB_HEADERS = {
	"User-Agent": "yehle-cli",
	Accept: "application/vnd.github.v3+json",
} as const;
