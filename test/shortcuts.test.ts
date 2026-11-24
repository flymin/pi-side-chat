import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	cancelBashHint, defaultShortcuts, matchesShortcut, parseShortcuts,
	readShortcuts, returnToMainHint, shortcutLabel, switchLabel,
} from "../src/shortcuts.ts";

const directories: string[] = [];
function config(contents: string): string {
	const directory = mkdtempSync(join(tmpdir(), "side-shortcuts-"));
	directories.push(directory);
	const path = join(directory, "pi-side-chat.json");
	writeFileSync(path, contents);
	return path;
}
afterEach(() => {
	for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("shortcut configuration", () => {
	it("preserves all original defaults, without fixing Pi's configurable bindings", () => {
		expect(parseShortcuts(undefined)).toEqual({
			toggle: ["ctrl+/", "ctrl+7"], previous: ["shift+left"], next: ["shift+right"],
			handoff: ["ctrl+s"], close: ["ctrl+c"], delete: ["ctrl+d"], interrupt: ["escape"],
		});
		expect(readShortcuts("/nonexistent/pi-side-shortcuts.json")).toEqual(defaultShortcuts());
		expect(readShortcuts(config('{"handoff":{"thinking":"low"}}'))).toEqual(defaultShortcuts());
	});

	it("accepts strings, lists, and partial overrides without modifying defaults", () => {
		const bindings = parseShortcuts({ previous: "ctrl+,", next: ["ctrl+.", "alt+l"] });
		expect(bindings.previous).toEqual(["ctrl+,"]);
		expect(bindings.next).toEqual(["ctrl+.", "alt+l"]);
		expect(bindings.toggle).toEqual(["ctrl+/", "ctrl+7"]);
		expect(defaultShortcuts().previous).toEqual(["shift+left"]);
	});

	it("normalizes modifiers, aliases, and duplicate bindings within one action", () => {
		expect(parseShortcuts({ toggle: [" Shift+CTRL+P ", "ctrl+shift+p"] }).toggle).toEqual(["ctrl+shift+p"]);
		expect(parseShortcuts({ interrupt: ["esc", "escape"] }).interrupt).toEqual(["escape"]);
		expect(parseShortcuts({ previous: "alt+pageup" }).previous).toEqual(["alt+pageUp"]);
	});

	it("supports explicit disabling and null to preserve defaults", () => {
		expect(parseShortcuts({ close: [], interrupt: null }).close).toEqual([]);
		expect(parseShortcuts({ interrupt: null }).interrupt).toEqual(["escape"]);
	});

	it.each([
		{ previous: 1 }, { previous: ["ctrl+,", 1] }, { previous: "ctrl+notakey" },
		{ previous: "hyper+x" }, { previous: "ctrl+ctrl+x" }, { previous: "" }, { typo: "ctrl+x" },
	])("rejects invalid or misspelled settings: %j", (setting) => {
		expect(() => parseShortcuts(setting)).toThrow();
	});

	it("rejects duplicate bindings across actions, including unmodified defaults", () => {
		expect(() => parseShortcuts({ previous: "ctrl+.", next: "ctrl+." })).toThrow(/both/);
		expect(() => parseShortcuts({ previous: "ctrl+s" })).toThrow(/both/);
		expect(() => parseShortcuts({ selectModel: "ctrl+s" })).toThrow(/both/);
		expect(() => parseShortcuts({ close: "esc" })).toThrow(/both/);
	});

	it("rejects malformed JSON and non-object roots instead of partially applying settings", () => {
		expect(() => readShortcuts(config("{"))).toThrow();
		expect(() => readShortcuts(config("[]"))).toThrow(/JSON object/);
		expect(() => parseShortcuts([])).toThrow(/object/);
	});
});

describe("shortcut matching", () => {
	it("matches every configured alternative and retires the replaced binding", () => {
		const bindings = parseShortcuts({ previous: ["ctrl+,", "alt+h"], next: "ctrl+." });
		expect(matchesShortcut("\x1b[44;5u", bindings, "previous")).toBe(true);
		expect(matchesShortcut("\x1bh", bindings, "previous")).toBe(true);
		expect(matchesShortcut("\x1b[46;5u", bindings, "next")).toBe(true);
		expect(matchesShortcut("\x1b[1;2D", bindings, "previous")).toBe(false);
		expect(matchesShortcut("\x1b[1;2C", bindings, "next")).toBe(false);
	});

	it("makes all plugin-owned controls configurable, not just navigation", () => {
		const bindings = parseShortcuts({ toggle: "f1", handoff: "f2", close: "f3", interrupt: "f4" });
		for (const [action, data] of [["toggle", "\x1bOP"], ["handoff", "\x1bOQ"], ["close", "\x1bOR"], ["interrupt", "\x1bOS"]] as const) {
			expect(matchesShortcut(data, bindings, action)).toBe(true);
		}
		expect(matchesShortcut("\x1b", parseShortcuts({ interrupt: [] }), "interrupt")).toBe(false);
	});

	it("inherits Pi action bindings only when the override is omitted", () => {
		const fallback = (action: string) => action === "app.model.select";
		expect(matchesShortcut("anything", defaultShortcuts(), "selectModel", fallback)).toBe(true);
		expect(matchesShortcut("anything", parseShortcuts({ selectModel: [] }), "selectModel", fallback)).toBe(false);
		expect(matchesShortcut("\x1bOP", parseShortcuts({ selectModel: "f1" }), "selectModel", fallback)).toBe(true);
		expect(matchesShortcut("anything", parseShortcuts({ selectModel: "f1" }), "selectModel", fallback)).toBe(false);
	});
});

describe("shortcut hints", () => {
	it("supports default and multiple delete bindings, with only the first hint", () => {
		expect(matchesShortcut("\x04", defaultShortcuts(), "delete")).toBe(true);
		const bindings = parseShortcuts({ delete: ["f5", "ctrl+d"] });
		expect(matchesShortcut("\x1b[15~", bindings, "delete")).toBe(true);
		expect(matchesShortcut("\x04", bindings, "delete")).toBe(true);
		expect(shortcutLabel(bindings, "delete")).toBe("f5");
		expect(matchesShortcut("\x04", parseShortcuts({ delete: [] }), "delete")).toBe(false);
		expect(shortcutLabel(parseShortcuts({ delete: [] }), "delete")).toBeUndefined();
	});
	it("preserves the default compact navigation hint", () => {
		expect(switchLabel(defaultShortcuts())).toBe("shift+←/→");
		expect(shortcutLabel(defaultShortcuts(), "toggle")).toBe("ctrl+/");
	});

	it("shows only the first binding of each action", () => {
		const bindings = parseShortcuts({ previous: ["ctrl+,", "alt+h"], next: ["ctrl+.", "alt+l"], close: ["f3", "alt+c"], interrupt: ["f4", "alt+x"] });
		expect(switchLabel(bindings)).toBe("ctrl+,/.");
		expect(shortcutLabel(bindings, "close")).toBe("f3");
		expect(returnToMainHint(bindings)).toBe("Press f3 to return to the main thread first.");
		expect(cancelBashHint(bindings)).toBe("Press f4 to cancel it first.");
	});

	it("omits disabled bindings and never advertises an unavailable control", () => {
		const bindings = parseShortcuts({ previous: [], next: [], toggle: [], close: [], handoff: [], interrupt: [] });
		expect(switchLabel(bindings)).toBeUndefined();
		expect(shortcutLabel(bindings, "close")).toBeUndefined();
		expect(returnToMainHint(bindings)).toBe("Return to the main thread first.");
		expect(cancelBashHint(bindings)).toBe("Cancel it first.");
	});
});
