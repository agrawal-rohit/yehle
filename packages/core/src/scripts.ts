import { type ChildProcess, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { unwrapModuleExport } from "./cjs-export";
import type { IndexItem, Registry } from "./schema";
import { isAbsoluteHttpUrl } from "./urls";

/** How much the CLI trusts a registry index location for script execution. */
export enum RegistryTrust {
	/** Packaged default registry shipped with the CLI. */
	Bundled = "bundled",
	/** Local filesystem registry that is not the bundled default. */
	Local = "local",
	/** Remote HTTPS registry (scripts never execute). */
	Remote = "remote",
}

/** Prefix used for Subresource Integrity-style sha256 digests. */
export const INTEGRITY_PREFIX = "sha256-";

/**
 * Compute an SRI-style sha256 digest for raw bytes.
 * @param bytes - Content to hash.
 * @returns Digest as `sha256-<base64>`.
 */
export function sha256Integrity(bytes: Buffer | string): string {
	const digest = createHash("sha256")
		.update(typeof bytes === "string" ? Buffer.from(bytes) : bytes)
		.digest("base64");
	return `${INTEGRITY_PREFIX}${digest}`;
}

/**
 * Verify bytes against an expected integrity digest.
 * @param bytes - Content that was read.
 * @param expected - Expected `sha256-<base64>` value.
 * @param label - Noun used in error messages (e.g. script URI).
 * @throws Error when the digest is missing, malformed, or does not match.
 */
export function assertIntegrityMatch(
	bytes: Buffer | string,
	expected: string | undefined,
	label: string,
): void {
	if (expected === undefined || expected.trim() === "")
		throw new Error(
			`Missing integrity digest for ${label}. Rebuild the registry or refuse untrusted content.`,
		);
	if (!expected.startsWith(INTEGRITY_PREFIX))
		throw new Error(
			`Invalid integrity digest for ${label}: expected ${INTEGRITY_PREFIX}<base64>.`,
		);
	const actual = sha256Integrity(bytes);
	if (actual !== expected)
		throw new Error(
			`Integrity check failed for ${label}: content does not match the registry digest.`,
		);
}

/**
 * Classify how much the CLI should trust a registry index location.
 * @param indexLocation - Absolute path or HTTPS URL of registry.json.
 * @param bundledRegistryPath - Absolute path to the CLI-packaged registry.json.
 * @returns Trust classification for script policy decisions.
 */
export function classifyRegistryTrust(
	indexLocation: string,
	bundledRegistryPath: string,
): RegistryTrust {
	if (isAbsoluteHttpUrl(indexLocation)) return RegistryTrust.Remote;

	const resolvedIndex = path.resolve(indexLocation);
	const resolvedBundled = path.resolve(bundledRegistryPath);
	if (resolvedIndex === resolvedBundled) return RegistryTrust.Bundled;
	return RegistryTrust.Local;
}

/**
 * Decide whether scripts may run for this registry.
 * Bundled registries run without prompting; other local registries require confirmation;
 * remote HTTPS registries never execute scripts.
 * @param trust - Registry trust classification.
 * @param scriptUris - Script URIs that would run for this install.
 * @param confirm - Prompt used for non-bundled local registries.
 * @returns True when scripts may run; false when none are declared.
 * @throws Error when scripts are required from a remote registry, or the user declines.
 */
export async function assertScriptsAllowed(
	trust: RegistryTrust,
	scriptUris: readonly string[],
	confirm?: (message: string) => Promise<boolean>,
): Promise<boolean> {
	if (scriptUris.length === 0) return false;

	switch (trust) {
		case RegistryTrust.Remote:
			throw new Error(
				"Registry scripts require a local registry. Remote HTTPS registries cannot execute custom scripts.",
			);
		case RegistryTrust.Bundled:
			return true;
		case RegistryTrust.Local: {
			const unique = [...new Set(scriptUris)].sort((a, b) =>
				a.localeCompare(b),
			);
			const listing = unique.map((uri) => `  - ${uri}`).join("\n");
			const message = `This local registry wants to run ${unique.length} script(s):\n${listing}\nAllow script execution?`;
			if (!confirm)
				throw new Error(
					`${message}\nConfirmation is required before running scripts from a non-bundled local registry.`,
				);
			const allowed = await confirm(message);
			if (!allowed)
				throw new Error(
					"Script execution was declined. Confirm when prompted, or omit items that declare scripts.",
				);
			return true;
		}
		default: {
			const _exhaustive: never = trust;
			throw new Error(`Unhandled registry trust: ${_exhaustive}`);
		}
	}
}

/**
 * Look up and verify a script integrity digest from the registry index map.
 * @param integrityMap - Optional `scriptIntegrity` map from the registry document.
 * @param scriptUri - Catalog script URI.
 * @param bytes - Script file bytes.
 * @throws Error when the digest is missing or mismatched.
 */
export function verifyScriptIntegrity(
	integrityMap: Record<string, string> | undefined,
	scriptUri: string,
	bytes: Buffer | string,
): void {
	assertIntegrityMatch(bytes, integrityMap?.[scriptUri], `script ${scriptUri}`);
}

/**
 * Look up and verify a compiled item integrity digest from the registry index map.
 * @param integrityMap - Optional `itemIntegrity` map from the registry document.
 * @param sourceUri - Catalog item `source` URI.
 * @param bytes - Compiled item JSON bytes.
 * @throws Error when the digest is missing or mismatched.
 */
export function verifyItemIntegrity(
	integrityMap: Record<string, string> | undefined,
	sourceUri: string,
	bytes: Buffer | string,
): void {
	assertIntegrityMatch(bytes, integrityMap?.[sourceUri], `item ${sourceUri}`);
}

/** Loads and invokes a compiled registry script module. */
export interface ScriptExecutor {
	/**
	 * Load a script module export and validate its shape.
	 * @param indexLocation - Absolute path to registry.json (must be local).
	 * @param scriptUri - Catalog script URI.
	 * @param isValid - Predicate that accepts a usable export.
	 * @param errorMessage - Error when the export shape is invalid.
	 * @returns Loaded export (default export or module itself).
	 */
	loadModule: <T>(
		indexLocation: string,
		scriptUri: string,
		isValid: (value: unknown) => value is T,
		errorMessage: string,
	) => Promise<T>;
}

/** Options for constructing a script executor. */
export interface CreateScriptExecutorOptions {
	/**
	 * Resolve a catalog script URI to an absolute local path.
	 * @param indexLocation - Absolute path to registry.json.
	 * @param scriptUri - Catalog script URI.
	 */
	resolveScriptPath: (indexLocation: string, scriptUri: string) => string;
	/** Optional integrity map from the registry document. */
	scriptIntegrity?: Record<string, string>;
	/**
	 * Execution backend. Defaults to in-process `require` until the sandboxed
	 * child executor is selected by callers.
	 */
	mode?: "in-process" | "sandbox";
	/** Absolute path to the project receiving the install (sandbox mode). */
	projectDir?: string;
	/** Absolute path to the sandbox runner entry (sandbox mode). */
	runnerPath?: string;
}

/**
 * Create a script executor that optionally verifies integrity before load.
 * @param options - Path resolver, integrity map, and execution mode.
 * @returns Script executor.
 * @throws Error when sandbox mode is requested without required paths.
 */
export function createScriptExecutor(
	options: CreateScriptExecutorOptions,
): ScriptExecutor {
	const mode = options.mode ?? "in-process";
	if (mode === "sandbox") {
		if (!options.projectDir || !options.runnerPath)
			throw new Error(
				"Sandbox script execution requires projectDir and runnerPath.",
			);
		return createSandboxedScriptExecutor(options);
	}
	return createInProcessScriptExecutor(options);
}

/**
 * In-process `require` executor (used for tests and as the pre-sandbox path).
 * @param options - Path resolver and optional integrity map.
 * @returns Script executor.
 */
function createInProcessScriptExecutor(
	options: CreateScriptExecutorOptions,
): ScriptExecutor {
	const requireScript = createRequire(__filename);
	return {
		async loadModule<T>(
			indexLocation: string,
			scriptUri: string,
			isValid: (value: unknown) => value is T,
			errorMessage: string,
		): Promise<T> {
			const absolutePath = options.resolveScriptPath(indexLocation, scriptUri);
			if (options.scriptIntegrity) {
				const { readFileSync } = await import("node:fs");
				verifyScriptIntegrity(
					options.scriptIntegrity,
					scriptUri,
					readFileSync(absolutePath),
				);
			}
			Reflect.deleteProperty(requireScript.cache, absolutePath);
			const script = unwrapModuleExport(requireScript(absolutePath));
			if (!isValid(script)) throw new Error(errorMessage);
			return script;
		},
	};
}

/**
 * Sandboxed executor placeholder wired in step 4.
 * @param options - Sandbox executor options.
 * @returns Script executor that loads modules in a permissioned child process.
 */
function createSandboxedScriptExecutor(
	options: CreateScriptExecutorOptions,
): ScriptExecutor {
	const projectDir = options.projectDir as string;
	const runnerPath = options.runnerPath as string;
	return {
		async loadModule<T>(
			indexLocation: string,
			scriptUri: string,
			isValid: (value: unknown) => value is T,
			errorMessage: string,
		): Promise<T> {
			const absolutePath = options.resolveScriptPath(indexLocation, scriptUri);
			if (options.scriptIntegrity) {
				const { readFileSync } = await import("node:fs");
				verifyScriptIntegrity(
					options.scriptIntegrity,
					scriptUri,
					readFileSync(absolutePath),
				);
			}
			const script = await loadSandboxedModule(
				absolutePath,
				projectDir,
				runnerPath,
			);
			if (!isValid(script)) throw new Error(errorMessage);
			return script;
		},
	};
}

/**
 * Collect catalog script URIs declared on an index item (local handlers + install hooks).
 * @param item - Compiled index item.
 * @returns Script URIs in declaration order (may contain duplicates).
 */
function collectItemScriptUris(item: IndexItem): string[] {
	return [
		...(item.prepare ?? []),
		...(item.finalize ?? []),
		...Object.values(item.conditions ?? {})
			.map((condition) => condition.handler)
			.filter((uri): uri is string => uri !== undefined),
		...(item.packs ?? []).flatMap((pack) => [
			...(pack.prepare ?? []),
			...(pack.finalize ?? []),
		]),
	];
}

/**
 * Collect catalog script URIs declared by selected items (shared conditions + install hooks).
 * @param registry - Loaded registry document.
 * @param itemIds - Selected item ids (`id` or `id@pack` prefixes are stripped to `id`).
 * @returns Deduplicated script URIs.
 */
export function collectDeclaredScriptUris(
	registry: Registry,
	itemIds: readonly string[],
): string[] {
	const uris = new Set<string>();
	const selectedIds = [
		...new Set(itemIds.map((item) => item.split("@")[0] ?? item)),
	];

	for (const itemId of selectedIds) {
		const item = registry.items[itemId];
		if (!item) continue;

		for (const key of item.requires ?? []) {
			const handler = registry.conditions?.[key]?.handler;
			if (handler) uris.add(handler);
		}
		for (const uri of collectItemScriptUris(item)) uris.add(uri);
	}

	return [...uris].sort((a, b) => a.localeCompare(b));
}

/**
 * Collect compiled item `source` URIs for an index item and its packs.
 * @param item - Compiled index item.
 * @returns Item payload URIs in declaration order.
 */
function collectItemSourceUris(item: IndexItem): string[] {
	const uris: string[] = [];
	if (item.source) uris.push(item.source);
	for (const pack of item.packs ?? []) {
		if (pack.source) uris.push(pack.source);
	}
	return uris;
}

/**
 * Collect every compiled script and item URI from a registry index.
 * @param registry - Parsed registry document.
 * @returns Deduplicated, sorted catalog URIs.
 */
export function collectRegistryArtifactUris(registry: Registry): {
	scriptUris: string[];
	itemUris: string[];
} {
	const scriptUris = new Set<string>();
	const itemUris = new Set<string>();

	for (const handler of Object.values(registry.conditions ?? {})
		.map((condition) => condition.handler)
		.filter((uri): uri is string => uri !== undefined)) {
		scriptUris.add(handler);
	}

	for (const item of Object.values(registry.items)) {
		for (const uri of collectItemScriptUris(item)) scriptUris.add(uri);
		for (const uri of collectItemSourceUris(item)) itemUris.add(uri);
	}

	const byUri = (left: string, right: string) => left.localeCompare(right);
	return {
		scriptUris: [...scriptUris].sort(byUri),
		itemUris: [...itemUris].sort(byUri),
	};
}

/** Maximum time a sandboxed script may run before the child is killed. */
const SCRIPT_TIMEOUT_MS = 60_000;

/** IPC request from the sandboxed child to the parent. */
type ChildRequest =
	| {
			type: "probe-result";
			shape: "function" | "condition-handler" | "unknown";
	  }
	| {
			type: "host";
			id: number;
			method: "isFile" | "readFile" | "run";
			args: string[];
	  }
	| {
			type: "result";
			ok: true;
			value: unknown;
	  }
	| {
			type: "result";
			ok: false;
			error: string;
	  };

/** IPC command from the parent to the sandboxed child. */
type ParentCommand =
	| { type: "probe"; scriptPath: string }
	| {
			type: "call";
			scriptPath: string;
			exportPath: string[];
			context: SerializedHandlerContext;
	  }
	| {
			type: "host-result";
			id: number;
			ok: true;
			value: unknown;
	  }
	| {
			type: "host-result";
			id: number;
			ok: false;
			error: string;
	  };

/** JSON-serializable install/condition context (functions restored via IPC). */
interface SerializedHandlerContext {
	projectDir: string;
	[key: string]: unknown;
}

/**
 * Environment variables safe to expose to `ctx.run` in the parent.
 * Omits cloud tokens and generic `*KEY*` / `*TOKEN*` / `*SECRET*` secrets.
 */
function sanitizedRunEnv(): NodeJS.ProcessEnv {
	const allow = new Set([
		"PATH",
		"HOME",
		"USER",
		"LOGNAME",
		"LANG",
		"LC_ALL",
		"LC_CTYPE",
		"TERM",
		"TMPDIR",
		"TMP",
		"TEMP",
		"SHELL",
		"GIT_AUTHOR_NAME",
		"GIT_AUTHOR_EMAIL",
		"GIT_COMMITTER_NAME",
		"GIT_COMMITTER_EMAIL",
		"GIT_TERMINAL_PROMPT",
	]);
	const env: NodeJS.ProcessEnv = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (value === undefined) continue;
		if (allow.has(key) || key.startsWith("GIT_CONFIG_")) env[key] = value;
	}
	return env;
}

/**
 * Resolve a path for Node's permission allow-list.
 * Uses realpath so macOS `/var` → `/private/var` symlinks do not break reads.
 * @param absolutePath - Absolute filesystem path.
 * @returns Canonical absolute path when available.
 */
function permissionPath(absolutePath: string): string {
	try {
		return fs.realpathSync(absolutePath);
	} catch {
		return path.resolve(absolutePath);
	}
}

/**
 * Build Node permission flags for the sandboxed child.
 * @param scriptPath - Absolute path to the script file to execute.
 * @param runnerPath - Absolute path to this runner module.
 * @param projectDir - Absolute project root (read-only for the child).
 * @returns CLI args enabling the permission model with minimal read access.
 */
function permissionArgs(
	scriptPath: string,
	runnerPath: string,
	projectDir: string,
): string[] {
	const major = Number(process.versions.node.split(".")[0] ?? "0");
	const permissionFlag =
		major >= 22 ? "--permission" : "--experimental-permission";
	const allowed = new Set([
		permissionPath(runnerPath),
		permissionPath(path.dirname(runnerPath)),
		permissionPath(scriptPath),
		permissionPath(path.dirname(scriptPath)),
		permissionPath(projectDir),
	]);
	const args = [
		permissionFlag,
		...[...allowed].map((entry) => `--allow-fs-read=${entry}`),
	];
	// Node 20 cannot deny network via the permission model; stripped env still
	// reduces credential exfiltration. Node 22+ omits --allow-net by default.
	return args;
}

/**
 * Serialize a handler context by dropping function fields.
 * @param ctx - Live handler context.
 * @returns JSON-safe context payload.
 */
function serializeContext(
	ctx: Record<string, unknown>,
): SerializedHandlerContext {
	const serialized: SerializedHandlerContext = {
		projectDir: String(ctx.projectDir),
	};
	for (const [key, value] of Object.entries(ctx)) {
		if (typeof value === "function") continue;
		if (key === "projectDir") continue;
		serialized[key] = value;
	}
	return serialized;
}

/**
 * Load a registry script inside a permissioned child process and return a
 * callable proxy matching the export shape (`function` or `{ infer }`).
 * @param scriptPath - Absolute path to the compiled script.
 * @param projectDir - Absolute project root for confined host helpers.
 * @param runnerPath - Absolute path to the sandbox runner entry module.
 * @returns Proxy export that forwards invocations to the child over IPC.
 */
export async function loadSandboxedModule(
	scriptPath: string,
	projectDir: string,
	runnerPath: string,
): Promise<unknown> {
	const resolvedScriptPath = permissionPath(scriptPath);
	const resolvedProjectDir = permissionPath(projectDir);
	const resolvedRunnerPath = permissionPath(runnerPath);

	const shape = await withSandboxChild(
		resolvedScriptPath,
		resolvedProjectDir,
		resolvedRunnerPath,
		async (send, waitFor) => {
			send({ type: "probe", scriptPath: resolvedScriptPath });
			const message = await waitFor(
				(
					msg,
				): msg is
					| Extract<ChildRequest, { type: "probe-result" }>
					| Extract<ChildRequest, { type: "result"; ok: false }> =>
					msg.type === "probe-result" ||
					(msg.type === "result" && msg.ok === false),
			);
			if (message.type === "result") throw new Error(message.error);
			return message.shape;
		},
	);

	const callExport = async (
		exportPath: string[],
		ctx: Record<string, unknown>,
	): Promise<unknown> =>
		withSandboxChild(
			resolvedScriptPath,
			resolvedProjectDir,
			resolvedRunnerPath,
			async (send, waitFor) => {
				send({
					type: "call",
					scriptPath: resolvedScriptPath,
					exportPath,
					context: serializeContext({
						...ctx,
						projectDir: resolvedProjectDir,
					}),
				});

				for (;;) {
					const message = await waitFor(
						(msg: ChildRequest): msg is ChildRequest => true,
					);
					if (message.type === "host") {
						try {
							const value = await invokeHostMethod(
								resolvedProjectDir,
								message.method,
								message.args,
							);
							send({ type: "host-result", id: message.id, ok: true, value });
						} catch (error) {
							send({
								type: "host-result",
								id: message.id,
								ok: false,
								error: error instanceof Error ? error.message : String(error),
							});
						}
						continue;
					}
					if (message.type === "result") {
						if (!message.ok) throw new Error(message.error);
						return message.value;
					}
				}
			},
		);

	if (shape === "condition-handler") {
		return {
			infer: async (ctx: Record<string, unknown>) => callExport(["infer"], ctx),
		};
	}

	if (shape === "function") {
		return async (ctx: Record<string, unknown>) => callExport([], ctx);
	}

	throw new Error(
		`Sandboxed script "${scriptPath}" must export a function or a condition handler with infer.`,
	);
}

/**
 * Invoke a parent-mediated host helper for the sandboxed script.
 * @param projectDir - Absolute project root.
 * @param method - Host method name.
 * @param args - Positional string arguments.
 * @returns Host method result.
 */
async function invokeHostMethod(
	projectDir: string,
	method: "isFile" | "readFile" | "run",
	args: string[],
): Promise<unknown> {
	const { createHandlerRuntime } = await import("./handlers");
	const { isFileAsync, readFileAsync } = await import("./fs");
	const { runAsync } = await import("./shell");

	const runtime = createHandlerRuntime(projectDir, {
		isFile: isFileAsync,
		readFile: readFileAsync,
		run: (command) =>
			runAsync(command, {
				cwd: projectDir,
				stdio: "pipe",
				env: sanitizedRunEnv(),
			}),
	});

	switch (method) {
		case "isFile":
			return runtime.isFile(String(args[0] ?? ""));
		case "readFile":
			return runtime.readFile(String(args[0] ?? ""));
		case "run": {
			const command = String(args[0] ?? "");
			console.error(`[tuckshop:script] run: ${command}`);
			return runtime.run(command);
		}
		default: {
			const _exhaustive: never = method;
			throw new Error(`Unhandled host method: ${_exhaustive}`);
		}
	}
}

/**
 * Spawn a permissioned child, run an IPC session, then tear the child down.
 * @param scriptPath - Absolute script path (for permission allow-lists).
 * @param projectDir - Absolute project root.
 * @param runnerPath - Absolute runner module path.
 * @param session - IPC session callback.
 * @returns Session result.
 */
async function withSandboxChild<T>(
	scriptPath: string,
	projectDir: string,
	runnerPath: string,
	session: (
		send: (message: ParentCommand) => void,
		waitFor: <M extends ChildRequest>(
			predicate: (message: ChildRequest) => message is M,
		) => Promise<M>,
	) => Promise<T>,
): Promise<T> {
	const child = spawn(
		process.execPath,
		[
			...permissionArgs(scriptPath, runnerPath, projectDir),
			runnerPath,
			"--child",
		],
		{
			stdio: ["ignore", "inherit", "inherit", "ipc"],
			env: {
				PATH: process.env.PATH,
				HOME: process.env.HOME,
				LANG: process.env.LANG,
				TMPDIR: process.env.TMPDIR,
			},
		},
	);

	const queue: ChildRequest[] = [];
	const waiters: Array<{
		predicate: (message: ChildRequest) => boolean;
		resolve: (message: ChildRequest) => void;
		reject: (error: Error) => void;
	}> = [];

	const onMessage = (message: unknown) => {
		const typed = message as ChildRequest;
		const waiterIndex = waiters.findIndex((waiter) => waiter.predicate(typed));
		if (waiterIndex >= 0) {
			const [waiter] = waiters.splice(waiterIndex, 1);
			waiter.resolve(typed);
			return;
		}
		queue.push(typed);
	};

	child.on("message", onMessage);

	const timeout = setTimeout(() => {
		child.kill("SIGKILL");
	}, SCRIPT_TIMEOUT_MS);

	try {
		const send = (message: ParentCommand) => {
			if (!child.connected)
				throw new Error("Sandboxed script child is not connected.");
			child.send(message);
		};

		const waitFor = <M extends ChildRequest>(
			predicate: (message: ChildRequest) => message is M,
		): Promise<M> => {
			const queuedIndex = queue.findIndex((message) => predicate(message));
			if (queuedIndex >= 0) {
				const [message] = queue.splice(queuedIndex, 1);
				return Promise.resolve(message as M);
			}
			return new Promise<M>((resolve, reject) => {
				waiters.push({
					predicate: predicate as (message: ChildRequest) => boolean,
					resolve: (message) => resolve(message as M),
					reject,
				});
			});
		};

		return await session(send, waitFor);
	} finally {
		clearTimeout(timeout);
		child.off("message", onMessage);
		await closeChild(child);
	}
}

/**
 * Kill and wait for a child process to exit.
 * @param child - Child process to close.
 */
async function closeChild(child: ChildProcess): Promise<void> {
	if (!child.killed) child.kill("SIGTERM");
	await new Promise<void>((resolve) => {
		if (child.exitCode !== null) {
			resolve();
			return;
		}
		child.once("exit", () => resolve());
	});
}

/**
 * Wire parent IPC so the child can wait for commands and call host helpers.
 * @param send - Send a message to the parent.
 * @returns Command waiter and a context factory with IPC-backed helpers.
 */
function installChildIpc(send: (message: ChildRequest) => void): {
	waitForCommand: () => Promise<ParentCommand>;
	buildContext: (
		serialized: SerializedHandlerContext,
	) => SerializedHandlerContext & {
		isFile: (filePath: string) => Promise<boolean>;
		readFile: (filePath: string) => Promise<string>;
		run: (command: string) => Promise<string>;
	};
} {
	let nextHostId = 1;
	const pendingHost = new Map<
		number,
		{ resolve: (value: unknown) => void; reject: (error: Error) => void }
	>();
	const pendingCommands: ParentCommand[] = [];
	const commandWaiters: Array<(command: ParentCommand) => void> = [];

	// Permanent listener: host-result must still arrive after the call command is received.
	process.on("message", (message: unknown) => {
		const typed = message as ParentCommand | ChildRequest;
		if (
			typed &&
			typeof typed === "object" &&
			"type" in typed &&
			typed.type === "host-result"
		) {
			const pending = pendingHost.get(typed.id);
			if (!pending) return;
			pendingHost.delete(typed.id);
			if (typed.ok) pending.resolve(typed.value);
			else pending.reject(new Error(typed.error));
			return;
		}

		const command = message as ParentCommand;
		const waiter = commandWaiters.shift();
		if (waiter) waiter(command);
		else pendingCommands.push(command);
	});

	const hostCall = async (
		method: "isFile" | "readFile" | "run",
		args: string[],
	): Promise<unknown> => {
		const id = nextHostId++;
		const result = new Promise<unknown>((resolve, reject) => {
			pendingHost.set(id, { resolve, reject });
		});
		send({ type: "host", id, method, args });
		return result;
	};

	return {
		waitForCommand: () => {
			const queued = pendingCommands.shift();
			if (queued) return Promise.resolve(queued);
			return new Promise((resolve) => {
				commandWaiters.push(resolve);
			});
		},
		buildContext: (serialized) => ({
			...serialized,
			isFile: async (filePath: string) =>
				Boolean(await hostCall("isFile", [filePath])),
			readFile: async (filePath: string) =>
				String(await hostCall("readFile", [filePath])),
			run: async (command: string) => String(await hostCall("run", [command])),
		}),
	};
}

/**
 * Classify a loaded script export for the parent probe handshake.
 * @param loaded - Unwrapped module export.
 * @returns Probe shape sent to the parent.
 */
function probeExportShape(
	loaded: unknown,
): "function" | "condition-handler" | "unknown" {
	if (typeof loaded === "function") return "function";
	if (
		typeof loaded === "object" &&
		loaded !== null &&
		typeof (loaded as { infer?: unknown }).infer === "function"
	)
		return "condition-handler";
	return "unknown";
}

/**
 * Resolve and invoke a sandboxed export path with the restored context.
 * @param loaded - Unwrapped module export.
 * @param exportPath - Property path from the module root (`[]` = default function).
 * @param context - Context object passed to the export.
 * @returns Export return value.
 */
async function invokeSandboxedExport(
	loaded: unknown,
	exportPath: string[],
	context: Record<string, unknown>,
): Promise<unknown> {
	let target: unknown = loaded;
	for (const segment of exportPath) {
		if (typeof target !== "object" || target === null)
			throw new Error(`Cannot resolve export path "${segment}".`);
		target = (target as Record<string, unknown>)[segment];
	}
	if (typeof target !== "function")
		throw new Error("Sandboxed export path did not resolve to a function.");
	return target(context);
}

/**
 * Child-process entry: probe or invoke a script with IPC-backed `ctx` helpers.
 * Invoked when this module is executed with `--child`.
 */
async function runChild(): Promise<void> {
	const { createRequire } = await import("node:module");
	const requireScript = createRequire(__filename);

	const send = (message: ChildRequest) => {
		if (!process.send) throw new Error("IPC channel is unavailable.");
		process.send(message);
	};
	const { waitForCommand, buildContext } = installChildIpc(send);
	const loadExport = (scriptPath: string): unknown => {
		Reflect.deleteProperty(requireScript.cache, scriptPath);
		return unwrapModuleExport(requireScript(scriptPath));
	};

	const command = await waitForCommand();
	try {
		if (command.type === "probe") {
			send({
				type: "probe-result",
				shape: probeExportShape(loadExport(command.scriptPath)),
			});
			return;
		}

		if (command.type === "call") {
			const value = await invokeSandboxedExport(
				loadExport(command.scriptPath),
				command.exportPath,
				buildContext(command.context),
			);
			send({ type: "result", ok: true, value });
		}
	} catch (error) {
		send({
			type: "result",
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

if (process.argv.includes("--child")) {
	runChild().catch((error: unknown) => {
		if (process.send)
			process.send({
				type: "result",
				ok: false,
				error: error instanceof Error ? error.message : String(error),
			} satisfies ChildRequest);
		process.exitCode = 1;
	});
}

/**
 * Resolve the on-disk path to this sandbox runner for child spawns.
 * @returns Absolute path to the compiled or source runner entry.
 */
export function resolveSandboxRunnerPath(): string {
	// Prefer the compiled JS next to this module; fall back to this file under tsx/vitest.
	const compiled = path.join(__dirname, "scripts.js");
	if (fs.existsSync(compiled)) return permissionPath(compiled);
	return permissionPath(__filename);
}
