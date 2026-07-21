# runtime-debug

Cursor-style runtime debugging for Claude Code: a local log-sink server plus a
skill that teaches the agent to instrument code, collect runtime logs, and
diagnose from actual behavior instead of static reading.

## How it works

```
┌─────────────┐  insert log calls   ┌──────────────┐
│ Claude Code │ ──────────────────► │  your code   │
│  (skill)    │                     └──────┬───────┘
│             │                            │ POST /ingest (fire-and-forget)
│             │                            ▼
│             │   Read tool         ┌──────────────────────┐
│             │ ◄────────────────── │ debug-server.mjs     │
└─────────────┘  logs.ndjson        │ 127.0.0.1:7331       │
                                    │ .debug-session/      │
                                    └──────────────────────┘
```

1. Skill triggers when a bug needs runtime state to diagnose.
2. Agent starts `debug-server.mjs` (zero-dep Node, localhost only, CORS enabled
   so browser code can post too).
3. Agent inserts tagged log calls (`DEBUG-SKILL` marker) at suspect code paths —
   JS/TS, Python, Go, shell snippets in `runtime-debug/SNIPPETS.md`.
4. You (or the agent) reproduce the bug; entries append to
   `.debug-session/logs.ndjson` with `seq` + `ts`.
5. Agent reads the NDJSON, kills/confirms hypotheses, fixes, verifies with a
   second run, then removes all instrumentation (grep for `DEBUG-SKILL`).

## Server API

| Method | Path | Purpose |
|---|---|---|
| POST | `/ingest` | JSON object/array (or plain text) → appended as NDJSON |
| GET | `/logs?since=SEQ&tag=TAG` | read entries |
| GET | `/health` | `{ ok, count, logFile, port }` |
| DELETE | `/logs` | truncate |

Env: `DEBUG_SINK_PORT` (7331), `DEBUG_SINK_DIR` (`.debug-session`),
`DEBUG_SINK_IDLE_MS` (30 min idle → auto-exit, no orphan processes).

## Install

```sh
ln -s "$(pwd)/runtime-debug" ~/.claude/skills/runtime-debug
```

## Design notes

- **No hook.** A hook isn't needed: the skill manages the server lifecycle and
  the server idle-exits on its own. Hooks would only add value for auto-starting
  the server every session, which wastes a process when not debugging.
- **HTTP sink instead of stdout capture** so it works for any language and any
  process the agent didn't spawn (browsers, workers, long-running dev servers).
- **NDJSON on disk** so the agent reads logs with the plain Read tool — no
  client, no parsing service.
