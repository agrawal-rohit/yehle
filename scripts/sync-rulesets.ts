#!/usr/bin/env tsx
import fs from "node:fs";
import path from "node:path";

const RULESETS_DIR = ".github/rulesets";
const API_VERSION = "2022-11-28";

const SERVER_OWNED_FIELDS = [
	"id",
	"node_id",
	"source",
	"source_type",
	"created_at",
	"updated_at",
	"_links",
	"links",
	"current_user_can_bypass",
] as const;

type RulesetRecord = Record<string, unknown>;

interface RulesetSummary {
	id: number;
	name: string;
}

interface SyncOptions {
	/**
	 * When true, report planned changes without mutating GitHub rulesets.
	 */
	dryRun: boolean;
}

/**
 * Parse CLI flags for ruleset synchronization.
 *
 * @param args raw process args after the script name
 * @returns parsed options
 */
function parseArgs(args: string[]): SyncOptions {
	return { dryRun: args.includes("--dry-run") };
}

/**
 * Resolve the GitHub token used for ruleset API calls.
 *
 * @returns bearer token from the environment
 * @throws when no token is configured
 */
function resolveToken(): string {
	const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
	if (!token) {
		throw new Error(
			"GH_TOKEN or GITHUB_TOKEN is required. Create a fine-grained PAT with Administration: write for this repository.",
		);
	}
	return token;
}

/**
 * Resolve the owner/repo slug for API calls.
 *
 * @returns repository slug in owner/repo form
 * @throws when GITHUB_REPOSITORY is unset
 */
function resolveRepository(): string {
	const repository = process.env.GITHUB_REPOSITORY;
	if (!repository) {
		throw new Error("GITHUB_REPOSITORY is required.");
	}
	return repository;
}

/**
 * Remove server-owned metadata before comparing or uploading rulesets.
 *
 * @param ruleset ruleset payload from disk or the GitHub API
 * @returns a clone without server-owned fields
 */
function stripServerFields(ruleset: RulesetRecord): RulesetRecord {
	const copy = structuredClone(ruleset);
	for (const field of SERVER_OWNED_FIELDS) {
		delete copy[field];
	}
	return copy;
}

/**
 * Produce a stable JSON string for equality checks.
 *
 * @param value JSON-compatible value
 * @returns deterministic JSON text
 */
function stableStringify(value: unknown): string {
	if (value === null || typeof value !== "object") {
		return JSON.stringify(value);
	}

	if (Array.isArray(value)) {
		return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
	}

	const record = value as RulesetRecord;
	const keys = Object.keys(record).sort((left, right) =>
		left.localeCompare(right),
	);
	return `{${keys
		.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
		.join(",")}}`;
}

/**
 * Compare committed and live ruleset payloads after stripping server metadata.
 *
 * @param desired ruleset JSON from the repository
 * @param live ruleset JSON from the GitHub API
 * @returns whether the payloads are equivalent
 */
function rulesetsMatch(
	desired: RulesetRecord,
	live: RulesetRecord,
): boolean {
	return (
		stableStringify(stripServerFields(desired)) ===
		stableStringify(stripServerFields(live))
	);
}

/**
 * Read the ruleset name from a committed payload.
 *
 * @param payload ruleset JSON from disk
 * @returns ruleset name
 * @throws when the payload is missing a string name
 */
function readRulesetName(payload: RulesetRecord): string {
	if (typeof payload.name !== "string" || payload.name.length === 0) {
		throw new Error("Each ruleset JSON file must define a non-empty string name.");
	}
	return payload.name;
}

/**
 * Load every committed ruleset JSON file.
 *
 * @param workspaceRoot absolute workspace path
 * @returns parsed ruleset payloads keyed by file name
 * @throws when the rulesets directory is missing or empty
 */
function loadCommittedRulesets(
	workspaceRoot: string,
): Array<{ fileName: string; payload: RulesetRecord }> {
	const rulesetsDirectory = path.join(workspaceRoot, RULESETS_DIR);
	if (!fs.existsSync(rulesetsDirectory)) {
		throw new Error(`Rulesets directory not found: ${RULESETS_DIR}`);
	}

	const fileNames = fs
		.readdirSync(rulesetsDirectory)
		.filter((fileName) => fileName.endsWith(".json"))
		.sort();

	if (fileNames.length === 0) {
		throw new Error(`No ruleset JSON files found in ${RULESETS_DIR}.`);
	}

	return fileNames.map((fileName) => {
		const filePath = path.join(rulesetsDirectory, fileName);
		const payload = JSON.parse(
			fs.readFileSync(filePath, "utf8"),
		) as RulesetRecord;
		return { fileName, payload };
	});
}

/**
 * Call the GitHub REST API for repository rulesets.
 *
 * @param method HTTP method
 * @param endpoint API path relative to /repos/{owner}/{repo}
 * @param body optional JSON request body
 * @returns parsed JSON response, or undefined for empty responses
 * @throws when authentication fails or the API returns an error
 */
async function githubApi(
	method: string,
	endpoint: string,
	body?: RulesetRecord,
): Promise<unknown> {
	const token = resolveToken();
	const repository = resolveRepository();
	const [owner, repo] = repository.split("/");
	const response = await fetch(
		`https://api.github.com/repos/${owner}/${repo}${endpoint}`,
		{
			method,
			headers: {
				Accept: "application/vnd.github+json",
				Authorization: `Bearer ${token}`,
				"X-GitHub-Api-Version": API_VERSION,
				...(body ? { "Content-Type": "application/json" } : {}),
			},
			body: body ? JSON.stringify(body) : undefined,
		},
	);

	if (response.status === 403) {
		throw new Error(
			"GitHub API returned 403. The token needs Administration: write on this repository.",
		);
	}

	if (!response.ok) {
		const details = await response.text();
		throw new Error(
			`GitHub API ${method} ${endpoint} failed (${response.status}): ${details}`,
		);
	}

	if (response.status === 204) {
		return undefined;
	}

	return response.json();
}

/**
 * Synchronize committed rulesets with the live repository configuration.
 *
 * @param workspaceRoot absolute workspace path
 * @param options sync options
 * @returns process exit code
 * @throws when unmanaged live rulesets exist or the API rejects a mutation
 */
async function syncRulesets(
	workspaceRoot: string,
	options: SyncOptions,
): Promise<number> {
	const committed = loadCommittedRulesets(workspaceRoot);
	const liveSummaries = (await githubApi(
		"GET",
		"/rulesets",
	)) as RulesetSummary[];

	const managedNames = new Set(
		committed.map(({ payload }) => readRulesetName(payload)),
	);
	const unmanaged = liveSummaries.filter(
		(summary) => !managedNames.has(summary.name),
	);

	if (unmanaged.length > 0) {
		const names = unmanaged.map((summary) => summary.name).join(", ");
		throw new Error(
			`Live rulesets without committed JSON: ${names}. Add JSON files or remove the live rulesets manually.`,
		);
	}

	for (const { fileName, payload } of committed) {
		const rulesetName = readRulesetName(payload);
		const existing = liveSummaries.find(
			(summary) => summary.name === rulesetName,
		);

		if (existing) {
			const livePayload = (await githubApi(
				"GET",
				`/rulesets/${existing.id}`,
			)) as RulesetRecord;

			if (rulesetsMatch(payload, livePayload)) {
				console.log(`[skip] ${rulesetName} (${fileName}) already matches`);
				continue;
			}

			if (options.dryRun) {
				console.log(
					`[plan] Would update ruleset "${rulesetName}" from ${fileName}`,
				);
				continue;
			}

			await githubApi("PUT", `/rulesets/${existing.id}`, payload);
			console.log(`[apply] Updated ruleset "${rulesetName}" from ${fileName}`);
			continue;
		}

		if (options.dryRun) {
			console.log(
				`[plan] Would create ruleset "${rulesetName}" from ${fileName}`,
			);
			continue;
		}

		await githubApi("POST", "/rulesets", payload);
		console.log(`[apply] Created ruleset "${rulesetName}" from ${fileName}`);
	}

	return 0;
}

/**
 * Entry point for ruleset synchronization.
 *
 * @returns process exit code
 */
async function main(): Promise<number> {
	const options = parseArgs(process.argv.slice(2));
	return syncRulesets(process.cwd(), options);
}

main().catch((error: unknown) => {
	let message = "Unknown error";
	if (error instanceof Error) {
		message = error.message;
	} else if (typeof error === "string") {
		message = error;
	}
	console.error(message);
	process.exit(1);
});
