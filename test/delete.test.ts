import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ views: [] as any[], processes: [] as any[], failRemoval: "", timeline: [] as string[] }));
vi.mock("node:fs", async (original) => {
	const fs = await original<typeof import("node:fs")>();
	return { ...fs, rmSync: vi.fn((path: Parameters<typeof fs.rmSync>[0], options?: Parameters<typeof fs.rmSync>[1]) => {
		if (String(path) === state.failRemoval) throw new Error("simulated removal failure");
		state.timeline.push(`remove:${String(path)}`);
		return fs.rmSync(path, options);
	}) };
});
vi.mock("../src/child.ts", () => ({
	SideProcess: { start: vi.fn(async () => {
		const process = { commands: vi.fn(async () => []), close: vi.fn(async () => {}), prompt: vi.fn(), abort: vi.fn(), clearQueue: vi.fn() };
		state.processes.push(process);
		return process;
	}) },
}));
vi.mock("../src/view.ts", () => ({
	findInteractiveMode: vi.fn(() => ({})),
	SideView: class {
		visible = false;
		editorFocused = true;
		runningBash = false;
		constructor(..._args: unknown[]) { state.views.push(this); }
		show = vi.fn((submit?: (text: string) => void) => { this.submit = submit; for (const view of state.views) view.visible = false; this.visible = true; });
		submit?: (text: string) => void;
		runCommand = vi.fn(async () => {});
		hide = vi.fn(() => { this.visible = false; });
		dispose = vi.fn(() => { this.visible = false; });
		attach = vi.fn();
		replay = vi.fn();
		notify = vi.fn();
		matches = vi.fn(() => false);
		draw = vi.fn();
	},
}));
import sideChat from "../src/index.ts";

let root: string;
let previousAgentDir: string | undefined;
beforeEach(() => {
	state.views = []; state.processes = []; state.failRemoval = ""; state.timeline = [];
	root = mkdtempSync(join(tmpdir(), "pi-side-delete-"));
	previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = root;
});
afterEach(() => {
	state.failRemoval = "";
	rmSync(root, { recursive: true, force: true });
	if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
});

async function harness(confirm: () => Promise<boolean> = async () => true, config?: unknown) {
	const main = join(root, "main.jsonl");
	const files = [join(root, "side-a.jsonl"), join(root, "side-b.jsonl")];
	writeFileSync(main, "main fixture\n");
	for (const [index, file] of files.entries()) writeFileSync(file, JSON.stringify({ type: "session", version: 3, id: `side-${index}`, timestamp: new Date().toISOString(), cwd: root, parentSession: main }) + "\n");
	if (config) writeFileSync(join(root, "pi-side-chat.json"), JSON.stringify(config));
	const entries: any[] = [{ type: "custom", customType: "side-chat-open", data: { sessionFiles: files } }];
	const events: Record<string, any> = {};
	let terminal: (data: string) => unknown = () => undefined;
	const ui = {
		theme: { fg: (_color: string, text: string) => text },
		confirm: vi.fn(confirm), notify: vi.fn(), setWidget: vi.fn(),
		getEditorText: vi.fn(() => "unsent draft"), setEditorText: vi.fn(),
		onTerminalInput: vi.fn((handler: typeof terminal) => { terminal = handler; return vi.fn(); }),
	};
	const pi = {
		on: vi.fn((name: string, handler: unknown) => { events[name] = handler; }),
		registerCommand: vi.fn(), getThinkingLevel: vi.fn(() => "medium"), sendMessage: vi.fn(),
		appendEntry: vi.fn((customType: string, data: unknown) => { entries.push({ type: "custom", customType, data }); }),
	};
	const ctx = {
		mode: "tui", cwd: root, model: { provider: "test", id: "fixture" }, ui,
		sessionManager: { getEntries: () => entries, getBranch: () => entries },
	};
	sideChat(pi as unknown as ExtensionAPI);
	events.session_start({}, ctx as unknown as ExtensionContext);
	await vi.waitFor(() => expect(state.views.every((view) => view.attach.mock.calls.length === 1) && state.views.length === 2).toBe(true));
	return {
		main, files, events, ui, pi, entries, key: (data: string) => terminal(data),
		show: () => terminal("\x1b[47;5u"),
		roster: () => entries.filter((entry) => entry.customType === "side-chat-open").at(-1).data.sessionFiles,
	};
}

function deferred() {
	let resolve!: (value: boolean) => void;
	const promise = new Promise<boolean>((done) => { resolve = done; });
	return { promise, resolve };
}

describe("side built-in command routing", () => {
	it.each(["copy", "export", "model", "thinking", "scoped-models", "models"])("routes /%s locally, not to the model", async (command) => {
		const h = await harness(); h.show();
		state.views[1].submit(`/${command} argument`);
		expect(state.views[1].runCommand).toHaveBeenCalledWith(command, "argument");
		expect(state.processes[1].prompt).not.toHaveBeenCalled();
		expect(state.views[0].runCommand).not.toHaveBeenCalled();
		expect(state.views[1].attach.mock.calls[0][1]).toContain(command);
	});
});

describe("confirmed side deletion", () => {
	it("stops before deleting only the shown side, returns to main, and updates the roster", async () => {
		const h = await harness(); h.show();
		// close() is called again for UI cleanup: real SideProcess.close is idempotent.
		state.processes[1].close.mockImplementationOnce(async () => { expect(existsSync(h.files[1]!)).toBe(true); state.timeline.push("stopped"); });
		state.processes[1].close.mockImplementation(async () => { state.timeline.push("stopped"); });
		h.key("\x04");
		await vi.waitFor(() => expect(h.ui.notify).toHaveBeenCalledWith("Side conversation deleted: side-1", "info"));
		expect(existsSync(h.files[1]!)).toBe(false);
		expect(existsSync(h.files[0]!)).toBe(true); expect(existsSync(h.main)).toBe(true);
		expect(state.views.every((view) => !view.visible)).toBe(true);
		expect(h.roster()).toEqual([h.files[0]]);
		expect(state.timeline.indexOf("stopped")).toBeLessThan(state.timeline.indexOf(`remove:${h.files[1]}`));
		expect(h.pi.sendMessage).not.toHaveBeenCalled();
	});

	it("cancel leaves process, history, draft view, and roster untouched", async () => {
		const h = await harness(async () => false); h.show(); h.key("\x04");
		await vi.waitFor(() => expect(h.ui.confirm).toHaveBeenCalledOnce());
		await Promise.resolve();
		expect(state.processes[1].close).not.toHaveBeenCalled();
		expect(existsSync(h.files[1]!)).toBe(true); expect(state.views[1].visible).toBe(true);
		expect(h.pi.appendEntry).not.toHaveBeenCalled();
	});

	it("does not intercept Ctrl+D in the main view or on key release", async () => {
		const h = await harness(); expect(h.key("\x04")).toBeUndefined();
		h.show(); expect(h.key("\x1b[100;5:3u")).toBeUndefined();
		expect(h.ui.confirm).not.toHaveBeenCalled();
	});

	it("opens one confirmation and cancels if the target view changes", async () => {
		const answer = deferred(); const h = await harness(() => answer.promise); h.show();
		h.key("\x04"); h.key("\x04"); expect(h.ui.confirm).toHaveBeenCalledOnce();
		h.key("\x1b[47;5u"); answer.resolve(true);
		await Promise.resolve(); await Promise.resolve();
		expect(existsSync(h.files[1]!)).toBe(true); expect(state.processes[1].close).not.toHaveBeenCalled();
	});

	it("does not delete after the parent session shuts down during confirmation", async () => {
		const answer = deferred(); const h = await harness(() => answer.promise); h.show(); h.key("\x04");
		await h.events.session_shutdown(); answer.resolve(true);
		await Promise.resolve(); await Promise.resolve();
		expect(h.files.every(existsSync)).toBe(true); expect(existsSync(h.main)).toBe(true);
	});

	it("keeps history if the parent shuts down while the confirmed stop is pending", async () => {
		const stop = deferred(); const h = await harness(); h.show();
		state.processes[1].close.mockImplementation(() => stop.promise);
		h.key("\x04");
		await vi.waitFor(() => expect(state.processes[1].close).toHaveBeenCalled());
		const shutdown = h.events.session_shutdown(); stop.resolve(true); await shutdown;
		await Promise.resolve();
		expect(h.files.every(existsSync)).toBe(true); expect(existsSync(h.main)).toBe(true);
		expect(h.ui.notify.mock.calls.some((call) => String(call[0]).startsWith("Side conversation deleted:"))).toBe(false);
	});

	it("preserves history if stopping fails", async () => {
		const h = await harness(); h.show(); state.processes[1].close.mockRejectedValueOnce(new Error("stop failed")); h.key("\x04");
		await vi.waitFor(() => expect(h.ui.notify).toHaveBeenCalledWith(expect.stringContaining("stop failed"), "error"));
		expect(existsSync(h.files[1]!)).toBe(true); expect(h.roster()).toEqual(h.files);
	});

	it("forgets a stopped view but keeps resumable history if file removal fails", async () => {
		const h = await harness(); h.show(); state.failRemoval = h.files[1]!; h.key("\x04");
		await vi.waitFor(() => expect(h.ui.notify).toHaveBeenCalledWith(expect.stringContaining("simulated removal failure"), "error"));
		expect(existsSync(h.files[1]!)).toBe(true); expect(h.roster()).toEqual([h.files[0]]);
		expect(state.views.every((view) => !view.visible)).toBe(true);
	});

	it("uses configured delete keys and only their first key in the hint", async () => {
		const h = await harness(async () => true, { shortcuts: { delete: ["f6", "ctrl+d"] } }); h.show();
		const labels = h.ui.setWidget.mock.calls.flatMap((call) => call[1] ?? []).join("\n");
		expect(labels).toContain("f6 to delete"); expect(labels).not.toContain("ctrl+d to delete");
		h.key("\x1b[17~");
		await vi.waitFor(() => expect(existsSync(h.files[1]!)).toBe(false));
	});
});
