import { describe, expect, it, vi } from "vitest";
import { SideView } from "../src/view.ts";

describe("side view commands", () => {
	it.each([
		["copy", "", "handleCopyCommand", []],
		["export", '"my side.jsonl"', "handleExportCommand", ['/export "my side.jsonl"']],
		["model", "provider/model", "handleModelCommand", ["provider/model"]],
		["thinking", "high", "handleThinkingCommand", ["high"]],
		["scoped-models", "", "showModelsSelector", []],
		["models", "", "showModelsSelector", []],
	] as const)("dispatches /%s after syncing the side", async (command, args, method, expected) => {
		const renderer = { [method]: vi.fn() };
		const view = Object.assign(Object.create(SideView.prototype), {
			drawing: Promise.resolve(), disposed: false, renderer, sync: vi.fn(async () => {}),
		});
		await view.runCommand(command, args);
		expect(view.sync).toHaveBeenCalledOnce();
		expect(renderer[method]).toHaveBeenCalledWith(...expected);
	});

	it("completes /models even when Pi does not list the alias", async () => {
		const view = Object.assign(Object.create(SideView.prototype), { commandNames: new Set(["models"]) });
		const base = { getSuggestions: vi.fn(async () => null), applyCompletion: vi.fn() };
		const result = await view.autocomplete(base).getSuggestions(["/models"], 0, 7);
		expect(result.prefix).toBe("/models");
		expect(result.items[0].value).toBe("models");
	});

	it("does not dispatch after disposal", async () => {
		const view = Object.assign(Object.create(SideView.prototype), {
			drawing: Promise.resolve(), disposed: true, sync: vi.fn(),
		});
		await view.runCommand("copy", "");
		expect(view.sync).not.toHaveBeenCalled();
	});
});
