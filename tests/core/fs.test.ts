import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
	copyDirSafeAsync,
	copyFileSafeAsync,
	ensureDirAsync,
	isDirAsync,
	removeFilesByBasename,
	removeMatchingFilesRecursively,
	renderMustacheTemplates,
	writeFileAsync,
} from "../../src/core/fs";

function makeTempDir(prefix = "fs-test-"): string {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	return tmp;
}

function writeFileSync(filePath: string, contents: string) {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, contents, "utf8");
}

describe("core/fs", () => {
	describe("isDirAsync", () => {
		it("returns true for existing directory", async () => {
			const dir = makeTempDir();
			const result = await isDirAsync(dir);
			expect(result).toBe(true);
		});

		it("returns false for non-existing path", async () => {
			const dir = path.join(makeTempDir(), "does-not-exist");
			const result = await isDirAsync(dir);
			expect(result).toBe(false);
		});

		it("returns false for existing file", async () => {
			const dir = makeTempDir();
			const file = path.join(dir, "file.txt");
			fs.writeFileSync(file, "hello", "utf8");

			const result = await isDirAsync(file);
			expect(result).toBe(false);
		});
	});

	describe("ensureDirAsync", () => {
		it("creates directory when it does not exist (mkdir -p semantics)", async () => {
			const root = makeTempDir();
			const nested = path.join(root, "a", "b", "c");

			await ensureDirAsync(nested);

			const st = fs.statSync(nested);
			expect(st.isDirectory()).toBe(true);
		});

		it("does not throw when directory already exists", async () => {
			const dir = makeTempDir();
			await ensureDirAsync(dir);
			await expect(ensureDirAsync(dir)).resolves.toBeUndefined();
		});
	});

	describe("writeFileAsync", () => {
		it("writes file contents and creates parent directories", async () => {
			const root = makeTempDir();
			const file = path.join(root, "nested", "dir", "file.txt");

			await writeFileAsync(file, "hello world");

			const data = fs.readFileSync(file, "utf8");
			expect(data).toBe("hello world");
		});

		it("overwrites existing file contents", async () => {
			const root = makeTempDir();
			const file = path.join(root, "file.txt");

			fs.writeFileSync(file, "old", "utf8");
			await writeFileAsync(file, "new");

			const data = fs.readFileSync(file, "utf8");
			expect(data).toBe("new");
		});
	});

	describe("copyFileSafeAsync", () => {
		it("copies file when source exists", async () => {
			const root = makeTempDir();
			const src = path.join(root, "src.txt");
			const dest = path.join(root, "nested", "dest.txt");
			fs.writeFileSync(src, "content", "utf8");

			await copyFileSafeAsync(src, dest);

			const data = fs.readFileSync(dest, "utf8");
			expect(data).toBe("content");
		});

		it("creates destination directory when copying", async () => {
			const root = makeTempDir();
			const src = path.join(root, "src.txt");
			const destDir = path.join(root, "a", "b");
			const dest = path.join(destDir, "dest.txt");
			fs.writeFileSync(src, "content", "utf8");

			await copyFileSafeAsync(src, dest);

			expect(fs.existsSync(destDir)).toBe(true);
			expect(fs.readFileSync(dest, "utf8")).toBe("content");
		});

		it("no-ops when source does not exist", async () => {
			const root = makeTempDir();
			const src = path.join(root, "missing.txt");
			const dest = path.join(root, "dest.txt");

			await copyFileSafeAsync(src, dest);

			expect(fs.existsSync(dest)).toBe(false);
		});

		it("no-ops when source is not a regular file (directory)", async () => {
			const root = makeTempDir();
			const srcDir = path.join(root, "srcDir");
			const dest = path.join(root, "dest.txt");
			fs.mkdirSync(srcDir);

			await copyFileSafeAsync(srcDir, dest);

			expect(fs.existsSync(dest)).toBe(false);
		});
	});

	describe("copyDirSafeAsync", () => {
		it("copies directory tree recursively", async () => {
			const srcRoot = makeTempDir();
			const destRoot = makeTempDir();

			// Directory structure:
			// srcRoot/
			//   file1.txt
			//   sub/
			//     file2.txt
			const file1 = path.join(srcRoot, "file1.txt");
			const subDir = path.join(srcRoot, "sub");
			const file2 = path.join(subDir, "file2.txt");
			writeFileSync(file1, "one");
			writeFileSync(file2, "two");

			const destDir = path.join(destRoot, "copied");
			await copyDirSafeAsync(srcRoot, destDir);

			expect(fs.readFileSync(path.join(destDir, "file1.txt"), "utf8")).toBe(
				"one",
			);
			expect(
				fs.readFileSync(path.join(destDir, "sub", "file2.txt"), "utf8"),
			).toBe("two");
		});

		it("no-ops when source directory does not exist", async () => {
			const src = path.join(makeTempDir(), "missing");
			const dest = path.join(makeTempDir(), "dest");

			await copyDirSafeAsync(src, dest);

			// dest directory may or may not exist depending on implementation; the key
			// behavior is that it does not throw and does not create copies.
			expect(() => fs.readdirSync(dest)).toThrow();
		});

		it("no-ops when source path is not a directory", async () => {
			const root = makeTempDir();
			const srcFile = path.join(root, "file.txt");
			const dest = path.join(root, "dest");
			fs.writeFileSync(srcFile, "content", "utf8");

			await copyDirSafeAsync(srcFile, dest);

			expect(fs.existsSync(dest)).toBe(false);
		});
	});

	describe("removeMatchingFilesRecursively", () => {
		it("removes files that match predicate while preserving others", async () => {
			const root = makeTempDir();

			const keepFile = path.join(root, "keep.txt");
			const removeFile = path.join(root, "remove.log");
			const subDir = path.join(root, "sub");
			const nestedRemove = path.join(subDir, "temp.log");
			writeFileSync(keepFile, "keep");
			writeFileSync(removeFile, "remove");
			writeFileSync(nestedRemove, "remove2");

			await removeMatchingFilesRecursively(root, (basename) =>
				basename.endsWith(".log"),
			);

			expect(fs.existsSync(keepFile)).toBe(true);
			expect(fs.existsSync(removeFile)).toBe(false);
			expect(fs.existsSync(nestedRemove)).toBe(false);
		});

		it("removes directories that match predicate", async () => {
			const root = makeTempDir();

			const keepDir = path.join(root, "keep");
			const removeDir = path.join(root, "remove-me");
			const nestedFile = path.join(removeDir, "file.txt");
			writeFileSync(path.join(keepDir, "file.txt"), "keep");
			writeFileSync(nestedFile, "remove");

			await removeMatchingFilesRecursively(
				root,
				(basename) => basename === "remove-me",
			);

			expect(fs.existsSync(keepDir)).toBe(true);
			expect(fs.existsSync(removeDir)).toBe(false);
		});

		it("no-ops when root directory does not exist", async () => {
			const root = path.join(makeTempDir(), "missing");

			await expect(
				removeMatchingFilesRecursively(root, () => true),
			).resolves.toBeUndefined();
		});
	});

	describe("removeFilesByBasename", () => {
		it("removes files and directories whose basenames are in the list", async () => {
			const root = makeTempDir();

			const keepFile = path.join(root, "keep.txt");
			const removeFile = path.join(root, "remove.txt");
			const nestedDir = path.join(root, "nested");
			const nestedRemoveDir = path.join(nestedDir, "remove-me");
			writeFileSync(keepFile, "keep");
			writeFileSync(removeFile, "remove");
			writeFileSync(path.join(nestedDir, "keep.txt"), "keep");
			writeFileSync(path.join(nestedRemoveDir, "file.txt"), "remove");

			await removeFilesByBasename(root, ["remove.txt", "remove-me"]);

			expect(fs.existsSync(keepFile)).toBe(true);
			expect(fs.existsSync(removeFile)).toBe(false);
			expect(fs.existsSync(path.join(nestedDir, "keep.txt"))).toBe(true);
			expect(fs.existsSync(nestedRemoveDir)).toBe(false);
		});

		it("no-ops when root directory does not exist", async () => {
			const root = path.join(makeTempDir(), "missing");

			await expect(removeFilesByBasename(root, ["a", "b"])).resolves.toBe(
				undefined,
			);
		});
	});

	describe("renderMustacheTemplates", () => {
		it("renders *.mustache.* files and writes output with .mustache. removed", async () => {
			const root = makeTempDir();
			const templatePath = path.join(root, "config.mustache.json");
			const templateContent = `{
  "name": "{{name}}",
  "env": "{{env}}"
}`;

			writeFileSync(templatePath, templateContent);

			await renderMustacheTemplates(root, { name: "app", env: "prod" });

			const renderedPath = path.join(root, "config.json");
			expect(fs.existsSync(templatePath)).toBe(false);
			expect(fs.existsSync(renderedPath)).toBe(true);

			const rendered = fs.readFileSync(renderedPath, "utf8");
			expect(rendered).toContain(`"name": "app"`);
			expect(rendered).toContain(`"env": "prod"`);
		});

		it("recursively processes templates in subdirectories", async () => {
			const root = makeTempDir();
			const subDir = path.join(root, "sub");
			const templatePath = path.join(subDir, "values.mustache.yaml");
			writeFileSync(templatePath, "value: {{val}}");

			await renderMustacheTemplates(root, { val: "42" });

			const renderedPath = path.join(subDir, "values.yaml");
			expect(fs.existsSync(templatePath)).toBe(false);
			expect(fs.existsSync(renderedPath)).toBe(true);
			expect(fs.readFileSync(renderedPath, "utf8")).toBe("value: 42");
		});

		it("leaves non-mustache files untouched", async () => {
			const root = makeTempDir();
			const filePath = path.join(root, "plain.txt");
			writeFileSync(filePath, "hello");

			await renderMustacheTemplates(root, { name: "ignored" });

			expect(fs.existsSync(filePath)).toBe(true);
			expect(fs.readFileSync(filePath, "utf8")).toBe("hello");
		});

		it("preserves GitHub Actions expressions like ${{ secrets.X }}", async () => {
			const root = makeTempDir();
			const templatePath = path.join(root, "workflow.mustache.yml");
			const content =
				"name: CI\n" +
				"env:\n" +
				'  APP_NAME: "{{appName}}"\n' +
				"  SECRET_VAL: ${{ secrets.MY_SECRET }}\n";

			writeFileSync(templatePath, content);

			await renderMustacheTemplates(root, { appName: "my-app" });

			const renderedPath = path.join(root, "workflow.yml");
			const rendered = fs.readFileSync(renderedPath, "utf8");

			expect(rendered).toContain('APP_NAME: "my-app"');
			expect(rendered).toContain("${{ secrets.MY_SECRET }}");
		});

		it("no-ops when target directory does not exist", async () => {
			const root = path.join(makeTempDir(), "missing");

			await expect(
				renderMustacheTemplates(root, { foo: "bar" }),
			).resolves.toBeUndefined();
		});
	});
});
