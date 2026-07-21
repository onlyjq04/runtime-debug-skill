---
name: runtime-debug
description: Cursor-style runtime debugging — instrument suspect code with log statements that stream to a local log-sink server, have the user reproduce the bug, then read the collected logs to diagnose. Use when a bug can't be diagnosed by reading code alone, when behavior differs between runs, when the user says "add logging to debug this", or when runtime state (variable values, call order, timing) is needed to find a root cause.
---

# Runtime Debug

Diagnose bugs from **actual runtime state** instead of guessing from code.
Flow: start log sink → instrument → reproduce → read logs → fix → clean up.

## 1. Start the log sink

```sh
curl -s http://127.0.0.1:7331/health || node <skill-dir>/scripts/debug-server.mjs
```

- Run the server in the background (Bash `run_in_background: true`) **from the project root**.
- Logs land in `<project>/.debug-session/logs.ndjson`. Server adds `seq` + `ts` per entry.
- If `.gitignore` exists and doesn't cover it, add `.debug-session/`.
- Server auto-exits after 30 min idle — never leave manual cleanup as a requirement.

## 2. Form hypotheses, then instrument

Read the failing code path first. Write down 1–3 hypotheses. Instrument **only**
the code that discriminates between them — entry/exit of suspect functions,
branch decisions, and the variables the hypotheses depend on. 5–15 log points,
not 50.

Copy snippets from [SNIPPETS.md](SNIPPETS.md). Rules:

- Every inserted line/block carries a `DEBUG-SKILL` marker comment.
- Fire-and-forget only: never block, never throw, never change behavior.
- Use `tag` per subsystem, `loc` as `file:line`, put discriminating variables in `data`.

## 3. Reproduce (checkpoint)

- If the app can be run/exercised directly (tests, CLI, curl against dev server): do it yourself.
- Otherwise this is a **user checkpoint**: tell the user exactly what to do, then
  use AskUserQuestion — "Did you reproduce the bug?" with options:
  - **Reproduced** → go to step 4
  - **Couldn't trigger it** → ask what they tried; adjust repro steps or instrumentation
  - **Behaved correctly this time** → intermittent bug; keep instrumentation, ask them to
    continue using the app and report when it happens; check `/health` count on return

Never analyze logs before confirming a reproduction actually happened — an empty
or stale log proves nothing.

## 4. Read and analyze

```sh
curl -s http://127.0.0.1:7331/health          # entry count
```

Then Read `.debug-session/logs.ndjson` directly (preferred), or filter:
`curl -s 'http://127.0.0.1:7331/logs?tag=auth&since=42'`.

Compare logs against hypotheses: which branch actually ran, what values actually
were, what order things actually happened in. If inconclusive, narrow: clear logs
(`curl -X DELETE http://127.0.0.1:7331/logs`), move instrumentation deeper, repeat
from step 3. Say which hypothesis the logs killed.

## 5. Fix and verify (checkpoint)

Apply the fix. Clear logs (`curl -X DELETE http://127.0.0.1:7331/logs`), then verify:

- Self-reproducible: run it again yourself, confirm logs show correct behavior —
  not just "no error".
- User-driven: AskUserQuestion — "Is the bug fixed?" with options:
  - **Fixed** → step 6
  - **Still broken** → read the fresh logs, return to step 2 with new hypotheses
  - **Different behavior now** → treat as new evidence, re-diagnose

Do NOT clean up instrumentation until the user (or your own run) confirms the fix —
you may need the same log points for the next iteration.

## 6. Clean up (mandatory)

```sh
grep -rn "DEBUG-SKILL" --include='*' <instrumented dirs>
```

Remove every hit. Re-run grep — must return nothing. Then remove
`.debug-session/` and stop the background server (or note it will idle-exit).
Never finish the task with instrumentation left in the code.
