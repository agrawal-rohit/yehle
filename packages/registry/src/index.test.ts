import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Registry } from "@tuckshop/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockBuildRegistry, actualBuildRegistry } = vi.hoisted(() => ({
	mockBuildRegistry: vi.fn(),
	actualBuildRegistry: vi.fn(),
}));

vi.mock("@tuckshop/core", async () => {
	const actual =
		await vi.importActual<typeof import("@tuckshop/core")>("@tuckshop/core");
	actualBuildRegistry.mockImplementation(actual.buildRegistry);
	mockBuildRegistry.mockImplementation(actual.buildRegistry);
	return {
		...actual,
		buildRegistry: mockBuildRegistry,
	};
});

import { startCli } from "./index";

/**
 * Write a JSON file under registry/ (conditions.json, types.json, etc.).
 * @param packageRoot - Absolute temp package root.
 * @param fileName - File name under registry/.
 * @param data - Object written as JSON.
 */
function writeRegistryJson(
	packageRoot: string,
	fileName: string,
	data: Record<string, unknown>,
): void {
	const registryDir = path.join(packageRoot, "registry");
	fs.mkdirSync(registryDir, { recursive: true });
	fs.writeFileSync(
		path.join(registryDir, fileName),
		`${JSON.stringify(data, null, 2)}\n`,
		"utf8",
	);
}

/**
 * Write a registry item fixture under a temp package root.
 * @param packageRoot - Absolute temp package root.
 * @param relativeDir - Item folder relative to registry/.
 * @param manifest - Manifest object written as registry-item.json.
 * @param files - Source files to create relative to the item folder.
 */
function writeItem(
	packageRoot: string,
	relativeDir: string,
	manifest: Record<string, unknown>,
	files: Record<string, string> = {},
): void {
	const itemDir = path.join(packageRoot, "registry", relativeDir);
	fs.mkdirSync(itemDir, { recursive: true });
	fs.writeFileSync(
		path.join(itemDir, "registry-item.json"),
		`${JSON.stringify(manifest, null, 2)}\n`,
		"utf8",
	);
	for (const [relativePath, content] of Object.entries(files)) {
		const absolutePath = path.join(itemDir, relativePath);
		fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
		fs.writeFileSync(absolutePath, content, "utf8");
	}
}

describe("registry startCli", () => {
	let tempDir: string;
	let consoleLogSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "registry-cli-"));
		writeRegistryJson(tempDir, "types.json", {
			component: { label: "Components" },
		});
		consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		mockBuildRegistry.mockReset();
		mockBuildRegistry.mockImplementation(actualBuildRegistry);
	});

	afterEach(() => {
		consoleLogSpy.mockRestore();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("no-ops when this module is not the process entry", async () => {
		await expect(startCli(false, tempDir)).resolves.toBeUndefined();
		expect(fs.existsSync(path.join(tempDir, "registry.json"))).toBe(false);
	});

	it("prints an empty-registry success message", async () => {
		await startCli(true, tempDir);

		expect(consoleLogSpy).toHaveBeenCalledWith(
			expect.stringContaining("Built empty registry at"),
		);
		expect(fs.existsSync(path.join(tempDir, "registry.json"))).toBe(true);
	});

	it("builds the registry without stamping absolute file sources", async () => {
		writeItem(
			tempDir,
			"component/button",
			{
				id: "button",
				title: "Button",
				description: "A button",
				type: "component",
				variants: [
					{
						id: "default",
						title: "Default",
						description: "Default",
						files: [{ source: "a.txt", target: "a.txt" }],
					},
				],
			},
			{ "a.txt": "a\n" },
		);

		await startCli(true, tempDir);

		const written = JSON.parse(
			fs.readFileSync(path.join(tempDir, "registry.json"), "utf8"),
		) as Registry;
		expect(written.items.button.variants[0].files[0].source).toBe("a.txt");
		expect(written.items.button.variants[0].payload).toBe(
			"r/button/default.json",
		);
		expect(
			fs.existsSync(path.join(tempDir, "r", "button", "default.json")),
		).toBe(true);
		expect(consoleLogSpy).toHaveBeenCalledWith(
			expect.stringContaining("Built 1 registry items at"),
		);
	});

	it("prints Error messages and exits with code 1", async () => {
		const exitSpy = vi
			.spyOn(process, "exit")
			.mockImplementation((() => undefined) as never);
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await startCli(true, path.join(tempDir, "does-not-exist"));

		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringMatching(/^build-registry failed: /),
		);
		expect(exitSpy).toHaveBeenCalledWith(1);
		exitSpy.mockRestore();
		errorSpy.mockRestore();
	});

	it("stringifies non-Error build failures", async () => {
		mockBuildRegistry.mockRejectedValueOnce("raw failure");
		const exitSpy = vi
			.spyOn(process, "exit")
			.mockImplementation((() => undefined) as never);
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await startCli(true, tempDir);

		expect(errorSpy).toHaveBeenCalledWith("build-registry failed: raw failure");
		expect(exitSpy).toHaveBeenCalledWith(1);
		exitSpy.mockRestore();
		errorSpy.mockRestore();
	});

	it("defaults package root when packageRoot is null", async () => {
		mockBuildRegistry.mockResolvedValueOnce({ types: {}, items: {} });

		await startCli(true, null as unknown as string);

		expect(mockBuildRegistry).toHaveBeenCalledWith({
			sourceDir: path.join(path.resolve(__dirname, ".."), "registry"),
			outDir: path.resolve(__dirname, ".."),
		});
		expect(consoleLogSpy).toHaveBeenCalledWith(
			expect.stringContaining("Built empty registry at"),
		);
	});

	it("bootstraps when executed as the process entry with a package-root argv", async () => {
		consoleLogSpy.mockRestore();

		const entry = path.join(__dirname, "index.ts");
		const tsxCli = require.resolve("tsx/cli");

		const { code, stdout, stderr } = await new Promise<{
			code: number | null;
			stdout: string;
			stderr: string;
		}>((resolve, reject) => {
			const child = spawn(process.execPath, [tsxCli, entry, tempDir], {
				env: process.env,
			});
			let stdout = "";
			let stderr = "";
			child.stdout.on("data", (chunk: Buffer) => {
				stdout += chunk.toString("utf8");
			});
			child.stderr.on("data", (chunk: Buffer) => {
				stderr += chunk.toString("utf8");
			});
			child.on("error", reject);
			child.on("close", (code) => resolve({ code, stdout, stderr }));
		});

		expect(stderr, `cli stderr: ${stderr}`).toBe("");
		expect(code, `cli stdout: ${stdout}`).toBe(0);
		expect(stdout).toContain("Built empty registry at registry.json.");
		const written = JSON.parse(
			fs.readFileSync(path.join(tempDir, "registry.json"), "utf8"),
		) as Registry;
		expect(written.items).toEqual({});
	});
});
