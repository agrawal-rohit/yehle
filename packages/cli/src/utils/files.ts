import {
	joinRelativePathUnderRoot,
	PathKind,
	pathKindAsync,
	type RegistryPayload,
	writeFileAsync,
} from "@tuckshop/core";
import { primaryText } from "../cli/labels";
import { confirmInput } from "../cli/prompts";

/** One payload file target with its absolute destination. */
interface ResolvedPayloadTarget {
	/** Relative target path from the payload. */
	target: string;
	/** Absolute destination under the project root. */
	destination: string;
}

/**
 * Build an absolute path for a payload target under the project root.
 * @param projectDir - Absolute project root.
 * @param target - Destination path from the payload.
 * @returns Absolute destination path.
 * @throws Error when the target escapes the project directory.
 */
export function absoluteProjectTarget(
	projectDir: string,
	target: string,
): string {
	return joinRelativePathUnderRoot(
		projectDir,
		target,
		"Payload file target",
		"project directory",
	);
}

/**
 * Assert a destination has not already been claimed, then record it.
 * @param destination - Absolute destination path.
 * @param target - Relative target for error messages.
 * @param seenTargets - Destinations already claimed in this pass.
 * @throws Error when the destination was already claimed.
 */
function claimDestination(
	destination: string,
	target: string,
	seenTargets: Set<string>,
): void {
	if (seenTargets.has(destination))
		throw new Error(
			`Multiple registry payloads write to the same target "${primaryText(target)}".`,
		);
	seenTargets.add(destination);
}

/**
 * Collect payload file targets, rejecting duplicate destinations.
 * @param projectDir - Absolute project root.
 * @param payloads - Parsed install payloads.
 * @returns Ordered list of unique targets.
 * @throws Error when two payloads share a destination.
 */
function collectPayloadTargets(
	projectDir: string,
	payloads: RegistryPayload[],
): ResolvedPayloadTarget[] {
	const seenTargets = new Set<string>();
	const targets: ResolvedPayloadTarget[] = [];

	for (const payload of payloads) {
		for (const file of payload.files ?? []) {
			const destination = absoluteProjectTarget(projectDir, file.target);
			claimDestination(destination, file.target, seenTargets);
			targets.push({ target: file.target, destination });
		}
	}

	return targets;
}

/**
 * Return the relative target when the destination is an existing file.
 * @param target - Relative payload target (for error messages).
 * @param destination - Absolute path under the project root.
 * @returns The relative target when a file exists; undefined when missing.
 * @throws Error when the destination exists as a directory, or on unexpected fs errors.
 */
async function existingFileTarget(
	target: string,
	destination: string,
): Promise<string | undefined> {
	const kind = await pathKindAsync(destination);
	switch (kind) {
		case PathKind.DIRECTORY:
			throw new Error(
				`Payload file target "${primaryText(target)}" exists and is a directory.`,
			);
		case PathKind.FILE:
			return target;
		case PathKind.ABSENT:
			return undefined;
		/* v8 ignore start */
		// Stryker disable all: unreachable exhaustive default
		default: {
			const _exhaustive: never = kind;
			throw new Error(`Unhandled path kind: ${String(_exhaustive)}`);
		}
		// Stryker restore all
		/* v8 ignore stop */
	}
}

/**
 * Prompt the user to confirm overwriting each existing file target.
 * @param existingTargets - Relative targets that already exist as files.
 * @throws Error when the user declines any overwrite.
 */
async function promptOverwriteConfirmations(
	existingTargets: string[],
): Promise<void> {
	console.log();
	for (const target of existingTargets) {
		const shouldOverwrite = await confirmInput(
			`Overwrite existing file ${primaryText(target)}?`,
			{},
			false,
		);
		if (!shouldOverwrite)
			throw new Error(
				`Installation canceled before overwriting ${primaryText(target)}.`,
			);
	}
	console.log();
}

/**
 * Prompt before overwriting payload targets that already exist on disk.
 * @param projectDir - Absolute project root.
 * @param payloads - Parsed install payloads whose files may collide with existing paths.
 * @param overwrite - Skip overwrite prompts when true.
 * @throws Error when a target is a directory, the user declines an overwrite, or two payloads share a target.
 */
export async function confirmFileOverwrites(
	projectDir: string,
	payloads: RegistryPayload[],
	overwrite: boolean,
): Promise<void> {
	const targets = collectPayloadTargets(projectDir, payloads);
	const existingTargets: string[] = [];

	for (const { target, destination } of targets) {
		const existing = await existingFileTarget(target, destination);
		if (existing) existingTargets.push(existing);
	}

	if (overwrite || existingTargets.length === 0) return;

	await promptOverwriteConfirmations(existingTargets);
}

/**
 * Write payload files to disk. Callers must confirm overwrite conflicts first.
 * @param projectDir - Absolute project root.
 * @param payload - Parsed install payload.
 * @param writtenTargets - Absolute destinations already written during this install.
 * @throws Error when two payloads in this run share a destination.
 */
export async function writePayloadFiles(
	projectDir: string,
	payload: RegistryPayload,
	writtenTargets: Set<string>,
): Promise<void> {
	for (const file of payload.files ?? []) {
		const destination = absoluteProjectTarget(projectDir, file.target);
		claimDestination(destination, file.target, writtenTargets);
		await writeFileAsync(destination, file.content);
	}
}
