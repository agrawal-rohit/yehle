import fs from "node:fs";
import path from "node:path";
import mustache from "mustache";

/**
 * Check whether a path exists and is a directory.
 * @param dirPath - Directory path to check.
 * @returns True if the path exists and is a directory, false otherwise.
 */
export async function isDirAsync(dirPath: string): Promise<boolean> {
	try {
		const st = await fs.promises.stat(dirPath);
		return st.isDirectory();
	} catch {
		return false;
	}
}

/**
 * Ensure a directory exists (mkdir -p). Creates parent directories as needed.
 * @param dirPath - Directory to create if missing.
 * @returns Promise that resolves when the directory exists.
 */
export async function ensureDirAsync(dirPath: string): Promise<void> {
	await fs.promises.mkdir(dirPath, { recursive: true });
}

/**
 * Write data to a file, ensuring parent directories exist.
 * @param filePath - Absolute or relative path to the file.
 * @param data - File contents.
 * @returns Promise that resolves when the file has been written.
 */
export async function writeFileAsync(
	filePath: string,
	data: string,
): Promise<void> {
	const dir = path.dirname(filePath);
	await ensureDirAsync(dir);
	await fs.promises.writeFile(filePath, data, "utf8");
}

/**
 * Copy a file if it exists, ensuring destination directory exists.
 * No-ops when source is missing or is not a regular file.
 * @param src - Source file path.
 * @param dest - Destination file path.
 * @returns Promise that resolves when the copy is done or when the source is missing.
 */
export async function copyFileSafeAsync(
	src: string,
	dest: string,
): Promise<void> {
	try {
		const stat = await fs.promises.stat(src);
		if (!stat.isFile()) return;
	} catch {
		return;
	}

	await ensureDirAsync(path.dirname(dest));
	await fs.promises.copyFile(src, dest);
}

/**
 * Recursively copy a directory tree. If the source directory does not exist, it no-ops.
 * @param srcDir - Source directory path.
 * @param destDir - Destination directory path.
 * @returns Promise that resolves when the copy is done or when the source is missing.
 */
export async function copyDirSafeAsync(
	srcDir: string,
	destDir: string,
): Promise<void> {
	try {
		const st = await fs.promises.stat(srcDir);
		if (!st.isDirectory()) return;
	} catch {
		return;
	}

	await ensureDirAsync(destDir);
	const entries = await fs.promises.readdir(srcDir, { withFileTypes: true });

	for (const entry of entries) {
		const srcPath = path.join(srcDir, entry.name);
		const destPath = path.join(destDir, entry.name);

		if (entry.isDirectory()) await copyDirSafeAsync(srcPath, destPath);
		else if (entry.isFile()) await copyFileSafeAsync(srcPath, destPath);
	}
}

/**
 * Recursively remove files or directories in a directory tree that match a predicate.
 * The predicate is called with: (basename, fullPath, dirent).
 * Directories that match are deleted (recursively); non-matching directories are traversed.
 * @param rootDir - Root directory to traverse.
 * @param predicate - Function returning true when the entry should be removed.
 * @returns Promise that resolves when the removal pass is complete.
 */
export async function removeMatchingFilesRecursively(
	rootDir: string,
	predicate: (basename: string, fullPath: string, entry: fs.Dirent) => boolean,
): Promise<void> {
	let entries: fs.Dirent[] = [];
	try {
		entries = await fs.promises.readdir(rootDir, { withFileTypes: true });
	} catch {
		return;
	}

	for (const entry of entries) {
		const full = path.join(rootDir, entry.name);

		// If the directory itself matches, remove it entirely; otherwise traverse it.
		if (entry.isDirectory()) {
			if (predicate(entry.name, full, entry)) {
				await fs.promises.rm(full, { recursive: true, force: true });
				continue;
			}
			await removeMatchingFilesRecursively(full, predicate);
		}

		// If the file matches, remove the file
		else if (entry.isFile()) {
			if (predicate(entry.name, full, entry)) {
				await fs.promises.rm(full, { force: true });
			}
		}
	}
}

/**
 * Convenience wrapper to remove any files or directories whose basename is in the provided list,
 * regardless of which subfolder they are in.
 * @param rootDir - Root directory to traverse.
 * @param fileNames - Iterable of basenames to remove.
 * @returns Promise that resolves when the removal pass is complete.
 */
export async function removeFilesByBasename(
	rootDir: string,
	fileNames: Iterable<string>,
): Promise<void> {
	const set = new Set(fileNames);
	await removeMatchingFilesRecursively(rootDir, (name) => set.has(name));
}

/**
 * Read a JSON file, remove a key from the root object if present, and write it back.
 * No-op when the file does not exist or is invalid JSON.
 * @param filePath - Absolute path to the JSON file.
 * @param key - Key to remove from the root object.
 * @returns Promise that resolves when the file has been updated, or when the file is missing/invalid.
 */
export async function stripKeyFromJSONFile(
	filePath: string,
	key: string,
): Promise<void> {
	try {
		await fs.promises.access(filePath);
		const content = await fs.promises.readFile(filePath, "utf8");
		const config = JSON.parse(content) as Record<string, unknown>;
		delete config[key];
		await fs.promises.writeFile(
			filePath,
			`${JSON.stringify(config, null, "\t")}\n`,
		);
	} catch {
		// File missing or invalid JSON; ignore
	}
}

/**
 * Recursively find all *.mustache.* files in targetDir, render them using the provided data,
 * write the rendered content to the same path with ".mustache." removed, and remove the original.
 * Example: package.mustache.json -> package.json, config.mustache.ts -> config.ts
 * @param targetDir - Root directory to search.
 * @param data - Key/value pairs used for mustache interpolation.
 * @returns Promise that resolves when all mustache files have been rendered and replaced.
 */
export async function renderMustacheTemplates(
	targetDir: string,
	data: Record<string, unknown>,
): Promise<void> {
	let entries: fs.Dirent[] = [];
	try {
		entries = await fs.promises.readdir(targetDir, { withFileTypes: true });
	} catch {
		return;
	}

	for (const entry of entries) {
		const full = path.join(targetDir, entry.name);
		if (entry.isDirectory()) {
			await renderMustacheTemplates(full, data);
		} else if (entry.isFile() && /\.mustache\./i.test(entry.name)) {
			const raw = await fs.promises.readFile(full, "utf8");

			// Preserve GitHub Actions expressions like ${{ secrets.X }} by masking them before rendering.
			const ghExprPattern = /\$\{\{[\s\S]*?\}\}/g;
			const ghExprs: string[] = [];
			const masked = raw.replaceAll(ghExprPattern, (m) => {
				const token = `__GH_EXPR_${ghExprs.length}__`;
				ghExprs.push(m);
				return token;
			});

			const previousEscape = mustache.escape;
			try {
				// Disable HTML escaping to preserve literal "/" and other characters during render
				// This is safe because the rendered content is written to files, not directly to HTML output
				mustache.escape = (s: string) => s;

				let rendered = mustache.render(masked, data);

				// Restore masked GitHub Actions expressions
				ghExprs.forEach((expr, i) => {
					const token = `__GH_EXPR_${i}__`;
					rendered = rendered.split(token).join(expr);
				});

				const dest = path.join(
					path.dirname(full),
					entry.name.replace(/\.mustache\./i, "."),
				);
				await fs.promises.writeFile(dest, rendered, "utf8");
				await fs.promises.rm(full, { force: true });
			} finally {
				// Restore original Mustache escape behavior
				mustache.escape = previousEscape;
			}
		}
	}
}
