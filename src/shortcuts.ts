import { existsSync, readFileSync } from "node:fs";
import { Key, type KeyId, matchesKey } from "@earendil-works/pi-tui";

/** Plugin-owned bindings. Missing settings preserve the original shortcuts. */
export const DEFAULT_SHORTCUTS = {
	toggle: ["ctrl+/", "ctrl+7"],
	previous: ["shift+left"],
	next: ["shift+right"],
	handoff: ["ctrl+s"],
	close: ["ctrl+c"],
	delete: ["ctrl+d"],
	interrupt: ["escape"],
} satisfies Record<string, readonly KeyId[]>;

/** Omitted overrides continue to use Pi's current, configurable application bindings. */
export const INHERITED_SHORTCUT_ACTIONS = {
	cycleThinking: "app.thinking.cycle",
	nextModel: "app.model.cycleForward",
	previousModel: "app.model.cycleBackward",
	selectModel: "app.model.select",
	dequeue: "app.message.dequeue",
} as const;

export type OwnShortcutAction = keyof typeof DEFAULT_SHORTCUTS;
export type InheritedShortcutAction = keyof typeof INHERITED_SHORTCUT_ACTIONS;
export type ShortcutAction = OwnShortcutAction | InheritedShortcutAction;
export type Shortcuts = Record<OwnShortcutAction, readonly KeyId[]> &
	Partial<Record<InheritedShortcutAction, readonly KeyId[]>>;

const modifiers = ["ctrl", "alt", "shift", "super"];
const baseKeys = new Set(Object.values(Key).flatMap((key) => typeof key === "string" ? [key.toLowerCase()] : []));
for (const key of "abcdefghijklmnopqrstuvwxyz0123456789") baseKeys.add(key);
const aliases: Record<string, string> = { esc: "escape", return: "enter" };
const actions = new Set<string>([...Object.keys(DEFAULT_SHORTCUTS), ...Object.keys(INHERITED_SHORTCUT_ACTIONS)]);

export function defaultShortcuts(): Shortcuts {
	const result = {} as Shortcuts;
	for (const action of Object.keys(DEFAULT_SHORTCUTS) as OwnShortcutAction[]) {
		result[action] = [...DEFAULT_SHORTCUTS[action]];
	}
	return result;
}

function normalizeKey(value: unknown, location: string): KeyId {
	if (typeof value !== "string") throw new Error(`${location} must contain key strings`);
	const parts = value.trim().toLowerCase().split("+");
	const rawKey = parts.pop() ?? "";
	const key = aliases[rawKey] ?? rawKey;
	if (!baseKeys.has(key) || parts.some((part) => !modifiers.includes(part)) || new Set(parts).size !== parts.length) {
		throw new Error(`${location}: invalid key ${JSON.stringify(value)}`);
	}
	const prefix = modifiers.filter((modifier) => parts.includes(modifier));
	return [...prefix, key === "pageup" ? "pageUp" : key === "pagedown" ? "pageDown" : key].join("+") as KeyId;
}

/** Parse atomically: an invalid override never leaves a partially configured key map. */
export function parseShortcuts(value: unknown, location = "shortcuts"): Shortcuts {
	const result = defaultShortcuts();
	if (value === undefined || value === null) return result;
	if (typeof value !== "object" || Array.isArray(value)) throw new Error(`${location} must be an object`);
	for (const [action, setting] of Object.entries(value)) {
		if (!actions.has(action)) throw new Error(`${location}: unknown action ${JSON.stringify(action)}`);
		if (setting === undefined || setting === null) continue;
		if (typeof setting !== "string" && !Array.isArray(setting)) {
			throw new Error(`${location}.${action} must be a key string or an array of key strings`);
		}
		const values = typeof setting === "string" ? [setting] : setting;
		result[action as ShortcutAction] = [...new Set(values.map((key) => normalizeKey(key, `${location}.${action}`)))];
	}
	const owners = new Map<KeyId, string>();
	for (const [action, keys] of Object.entries(result)) {
		for (const key of keys) {
			const previous = owners.get(key);
			if (previous) throw new Error(`${location}: ${key} is assigned to both ${previous} and ${action}`);
			owners.set(key, action);
		}
	}
	return result;
}

/** Read at session start/reload; handoff and unrelated settings are preserved and ignored here. */
export function readShortcuts(path: string): Shortcuts {
	if (!existsSync(path)) return defaultShortcuts();
	const settings: unknown = JSON.parse(readFileSync(path, "utf8"));
	if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
		throw new Error(`${path} must contain a JSON object`);
	}
	return parseShortcuts((settings as { shortcuts?: unknown }).shortcuts, `${path}: shortcuts`);
}

export function matchesShortcut(
	data: string,
	shortcuts: Shortcuts,
	action: ShortcutAction,
	inheritedMatch?: (action: string) => boolean,
): boolean {
	const keys = shortcuts[action];
	if (keys !== undefined) return keys.some((key) => matchesKey(data, key));
	return inheritedMatch?.(INHERITED_SHORTCUT_ACTIONS[action as InheritedShortcutAction]) ?? false;
}

function keyLabel(key: KeyId): string {
	return key.toLowerCase().replace(/(^|\+)(left|right|up|down|escape)$/,
		(_match, prefix: string, base: string) => `${prefix}${({ left: "←", right: "→", up: "↑", down: "↓", escape: "esc" } as Record<string, string>)[base]}`);
}

/** Never display secondary bindings; disabled actions have no key hint. */
export function shortcutLabel(shortcuts: Shortcuts, action: ShortcutAction): string | undefined {
	const first = shortcuts[action]?.[0];
	return first === undefined ? undefined : keyLabel(first);
}

/** Keep the original compact shift+←/→ hint with default settings. */
export function switchLabel(shortcuts: Shortcuts): string | undefined {
	const previous = shortcutLabel(shortcuts, "previous");
	const next = shortcutLabel(shortcuts, "next");
	if (!previous) return next;
	if (!next) return previous;
	const split = previous.lastIndexOf("+") + 1;
	const prefix = previous.slice(0, split);
	return prefix === next.slice(0, next.lastIndexOf("+") + 1)
		? `${previous}/${next.slice(split)}`
		: `${previous} / ${next}`;
}

export function returnToMainHint(shortcuts: Shortcuts): string {
	const key = shortcutLabel(shortcuts, "close") ?? shortcutLabel(shortcuts, "toggle") ?? switchLabel(shortcuts);
	return key ? `Press ${key} to return to the main thread first.` : "Return to the main thread first.";
}

export function cancelBashHint(shortcuts: Shortcuts): string {
	const key = shortcutLabel(shortcuts, "interrupt");
	return key ? `Press ${key} to cancel it first.` : "Cancel it first.";
}
