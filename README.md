# pi-side-chat

Codex's `/side` conversations for [Pi](https://pi.dev).

This fork of [YanzuoLu/pi-side-chat](https://github.com/YanzuoLu/pi-side-chat)
adds configurable shortcuts while preserving the original default bindings.

`/side` forks the current conversation into a side conversation, so you can ask a quick question without disturbing the main thread, even while it is working.

## Usage

The table below shows the default shortcuts. They can be changed in [Shortcut settings](#shortcut-settings).

| Input | Effect |
|---|---|
| `/side` or `/btw` | Open a new side conversation and wait for your question |
| `/side <question>` | Open a new side conversation and ask the question |
| `ctrl + /` (or `ctrl + 7`) | Switch between the main thread and the side conversation shown last, without closing either |
| `shift + ←` / `shift + →` | Go through the main thread and every open side conversation in order |
| `ctrl + s` | Hand off: close the side conversation shown after it writes a handoff, which is steered into the main thread |
| `ctrl + c` on an empty editor | Close the side conversation shown and return to the main thread |
| `ctrl + d` | Confirm deletion of the side conversation shown, then return to the main thread |
| `esc` | Stop the side conversation's current turn, putting its queued messages back in the editor as Pi does |

Each `/side` opens another side conversation forked from the main thread, also when typed in a side conversation. Each runs as its own Pi process, so many open ones take memory. Once you ask something in it, it is saved as a session of its own next to the main thread's, and the line above the editor ends with its session id. Closing it shows the id again, and `pi --session <id>` resumes it in any window. A side conversation where you asked nothing is not kept.

Saved side conversations that are still open when you leave the main session, by quitting, `/reload`, `/new` or switching sessions, come back with it: they open again in the background, with their transcript, the next time the main session starts, and `shift + ←/→` or `ctrl + /` switches to them.

## Delete a side conversation

Press `ctrl + d` while a side conversation is shown to open a confirmation dialog.
Cancel keeps its process, history and draft. Confirm returns to the main thread,
stops the side process, then permanently deletes its session file and removes it
from the parent's open-side list. This works even with text in the editor.
No handoff is sent, and the main session and other sides are not deleted.
Files the side conversation edited in the workspace are not reverted or deleted.
If stopping fails, history is kept; if file removal fails, the stopped view closes
but its history is retained for resuming. Deletion is cancelled if the parent
session or shown target changes before it can safely proceed.

`ctrl + c` and `ctrl + s` still close without deleting saved history. In the main
view, `ctrl + d` keeps Pi's normal behavior; it never deletes a background side.
The new `delete` action is configurable like every other side shortcut, including
multiple alternatives and `[]` to disable it. Hints show its first configured key.

## Handoff

`ctrl + s` brings what happened in the side conversation back to the main thread. The main thread shows right away while the side conversation writes a handoff: a checkpoint of the side conversation in the format [proper-compact](https://github.com/sharaf-nassar/proper-pi-extensions) gives its compaction summaries, from goal to artifacts and evidence, with proper-compact's checkpoint contract adapted to a side conversation. The side conversation is told how it relates to the main thread and which message it began with, so it finds its start even after a compaction. The handoff is steered into the main thread, so a working main thread sees it before its next model request and an idle one starts a turn with it. As soon as it is sent, a notice in the main thread's transcript, which the model does not see, says so and gives the side conversation's id to resume it with. If writing the handoff fails, the side conversation stays open. A side conversation where you have not asked anything just closes.

By default the side conversation's own model and thinking level write the handoff, which reuses its prompt cache. `~/.pi/agent/pi-side-chat.json` can choose others:

```json
{ "handoff": { "model": "anthropic/claude-opus-5-5", "thinking": "low" } }
```

`model` is `provider/model-id`. `null` or a missing setting keeps the side conversation's own.

## Shortcut settings

Configure shortcuts in `<Pi agent directory>/pi-side-chat.json`, normally
`~/.pi/agent/pi-side-chat.json`. This is the same file as the optional `handoff`
settings; both sections can coexist.

For example, replace Shift+arrows with Ctrl+comma/period:

```json
{
  "shortcuts": {
    "previous": "ctrl+,",
    "next": "ctrl+."
  }
}
```

Each action accepts a key string or a list of alternatives, such as
`"previous": ["ctrl+,", "alt+h"]`. Every alternative works, but hints display
**only the first key of each action**. The navigation hint combines the first
previous/next keys compactly. An empty list (`[]`) disables an action and hides
its hint; omitted or `null` settings preserve its default. Overrides replace,
rather than extend, the defaults, so include the original key in the list if
you want to keep it.

| Action | Default |
|---|---|
| `toggle` | `["ctrl+/", "ctrl+7"]` |
| `previous` | `["shift+left"]` |
| `next` | `["shift+right"]` |
| `handoff` | `["ctrl+s"]` |
| `close` | `["ctrl+c"]` — only closes with an empty editor |
| `delete` | `["ctrl+d"]` — confirm permanent deletion and return to main |
| `interrupt` | `["escape"]` — stops the side turn or shell command |
| `cycleThinking` | Inherits Pi's `app.thinking.cycle` |
| `nextModel` | Inherits Pi's `app.model.cycleForward` |
| `previousModel` | Inherits Pi's `app.model.cycleBackward` |
| `selectModel` | Inherits Pi's `app.model.select` |
| `dequeue` | Inherits Pi's `app.message.dequeue` |

The last five actions can also be overridden here. Without an override, they
continue to follow Pi's `keybindings.json`, including changes to those bindings.
Other native Pi editor shortcuts remain under Pi's own configuration.

Keys use Pi's syntax (`ctrl`, `alt`, `shift`, `super`, letters, digits, symbols,
arrows, and function keys). Modifier order and capitalization are normalized.
Unknown actions, malformed keys, or the same normalized key assigned to multiple
side actions reject the shortcut section: the extension reports an error and
uses all defaults rather than applying a partial configuration. This cannot
detect every terminal-level alias or conflict with another extension, tmux, or
Pi's inherited keys; choose bindings that your terminal actually reports.

Shortcuts are read at session start. Run `/reload` after editing this file.
Changing shortcuts does not change permissions or side-conversation behavior.

## Behavior

- The side conversation starts from the main thread's history so far, with the same model, thinking level, tools and extensions. Its requests share the main thread's prompt cache: for OpenAI models it uses the main thread's session id as its cache key, also when resumed later.
- Codex's side-conversation instructions and boundary prompt follow the inherited history as one hidden message, verbatim. They tell the model to answer questions and avoid continuing or changing the main thread's work. If the main thread is in the middle of a turn, Codex's interrupted-turn marker comes first.
- Extension state recorded in the main session is not inherited, so extensions in the side conversation start fresh instead of resuming the main thread's loops or plans. Neither is the main session's name, so the side conversation starts unnamed, like a new session.
- The side conversation runs in its own Pi process. Its extensions cannot interfere with the main thread's, and closing it ends anything it started.
- Like switching threads in Codex, switching swaps everything that belongs to a conversation: the transcript, the working and compaction indicators, the footer and the editor's draft. Pi draws all of it, so the side conversation looks the same as the main thread.
- Extension dialogs, notifications and footer status entries from the side conversation show up in Pi. Its widgets are dropped.
- `/copy` copies the side's last assistant response. `/export [path]` exports the side session as HTML (default) or JSONL (`.jsonl` path), with Pi's normal quoted-path support.
- `/model [provider/model]` and `/thinking [level]` select the side's own model and thinking level; omitting the argument opens Pi's selector. The main session is unchanged unless you explicitly save a global default.
- `/scoped-models` and its side alias `/models` open the same model-scope selector. Scope changes apply to this side's picker and cycling keys, independently of the main session and other sides, for the lifetime of the view. Explicitly saving defaults updates shared settings as in Pi.
- Other built-in interactive slash commands remain unavailable. Extension commands, templates and skills loaded by the side are still forwarded to its process.
- Pi's keys and input for the conversation shown act on the side conversation while it is shown: `!command` and `!!command` run in its shell, `shift + tab` cycles its thinking level, the model cycling keys and `ctrl + l` change its model, `esc` and `option + up` handle its queued messages, and the editor's border shows its thinking level.

`ctrl + /` needs a terminal that reports it, such as one with the kitty keyboard protocol.

## Install

```sh
pi install git:github.com/flymin/pi-side-chat
```

## Compatibility

Pi has no extension API for a second conversation view, so `src/view.ts` uses Pi's interactive mode internals. It checks them when a side conversation opens and reports an error if a Pi release changes them.

## License

MIT
