import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../registry/loader", () => ({
	loadRegistryIndex: vi.fn(),
}));

vi.mock("../cli/prompts", () => ({
	default: { multiselectInput: vi.fn() },
}));

import prompts from "../cli/prompts";
import { loadRegistryIndex } from "../registry/loader";
import { listCommand } from "./list";

describe("commands/list", () => {
	const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(loadRegistryIndex).mockResolvedValue(
			new Map([
				[
					"typescript-react-app",
					{
						id: "typescript-react-app",
						title: "TypeScript React App",
						description: "React app scaffold",
						type: "template",
						projectSpec: "app",
						variants: [
							{
								id: "default",
								targets: { language: "typescript", framework: "react" },
								files: [],
							},
						],
					},
				],
				[
					"button",
					{
						id: "button",
						title: "Button",
						description: "Button component",
						type: "component",
						tags: ["ui"],
						variants: [
							{
								id: "vue",
								targets: { language: "typescript", framework: "vue" },
								files: [],
							},
							{
								id: "react",
								targets: { language: "typescript", framework: "react" },
								files: [],
							},
						],
					},
				],
				[
					"workflow",
					{
						id: "workflow",
						title: "Workflow",
						description: "Agent workflow rules",
						type: "agent-instruction",
						instructionName: "workflow",
						variants: [{ id: "default", files: [] }],
					},
				],
			]) as unknown as Awaited<ReturnType<typeof loadRegistryIndex>>,
		);
	});

	it("lists items matching facet filters, grouped by type", async () => {
		await listCommand({ type: "component", framework: "vue" });

		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("Components");
		expect(output).toContain("Button");
		expect(output).toContain("button");
		expect(output).toContain("1 item(s)");
	});

	it("lists all types when --all is set", async () => {
		await listCommand({ all: true });

		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("Components");
		expect(output).toContain("Agent Instructions");
		expect(output).toContain("Templates");
		expect(output).toContain("3 item(s)");
		expect(prompts.multiselectInput).not.toHaveBeenCalled();
	});

	it("lists all types when --type all is set", async () => {
		await listCommand({ type: "all" });

		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("3 item(s)");
		expect(prompts.multiselectInput).not.toHaveBeenCalled();
	});

	it("prints facet values in --values mode", async () => {
		await listCommand({ values: true });

		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("type");
		expect(output).toContain("framework");
		expect(output).toContain("react");
	});
});
