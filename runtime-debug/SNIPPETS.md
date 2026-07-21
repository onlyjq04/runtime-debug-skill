# Instrumentation snippets

All snippets are fire-and-forget: they never block, throw, or change app behavior.
Every inserted line/block MUST carry the `DEBUG-SKILL` marker comment for cleanup.
Entry fields: `tag` (subsystem, e.g. `auth`), `msg` (what happened), `data` (variables), `loc` (`file:line`).
The server adds `seq` and `ts`.

## JavaScript / TypeScript (browser AND Node 18+)

Add helper once per file (or a shared module):

```js
// DEBUG-SKILL: remove after debugging
const dbg = (tag, msg, data) =>
  fetch('http://127.0.0.1:7331/ingest', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tag, msg, data, loc: 'auth.ts:42' }),
  }).catch(() => {});
```

Call sites:

```js
dbg('auth', 'token expiry check', { exp: token.exp, now: Date.now() }); // DEBUG-SKILL
```

Notes: works in browser (CORS enabled on server). For values that may contain
circular refs / class instances, pass primitives or `String(x)`.

## Python

```python
# DEBUG-SKILL: remove after debugging
def _dbg(tag, msg, data=None, loc=None):
    import json, threading, urllib.request
    def _send():
        try:
            req = urllib.request.Request(
                "http://127.0.0.1:7331/ingest",
                json.dumps({"tag": tag, "msg": msg, "data": data, "loc": loc}, default=str).encode(),
                {"Content-Type": "application/json"},
            )
            urllib.request.urlopen(req, timeout=1)
        except Exception:
            pass
    threading.Thread(target=_send, daemon=True).start()
```

Call sites:

```python
_dbg("worker", "queue drained", {"remaining": q.qsize()}, "worker.py:88")  # DEBUG-SKILL
```

## Shell / anything else

```sh
curl -s -X POST http://127.0.0.1:7331/ingest \
  -H 'content-type: application/json' \
  -d '{"tag":"build","msg":"step 3 done","data":{"code":0}}' >/dev/null 2>&1 &  # DEBUG-SKILL
```

## Go

```go
// DEBUG-SKILL: remove after debugging
func dbg(tag, msg string, data map[string]any) {
	go func() {
		b, _ := json.Marshal(map[string]any{"tag": tag, "msg": msg, "data": data})
		http.Post("http://127.0.0.1:7331/ingest", "application/json", bytes.NewReader(b))
	}()
}
```

## Other languages

Any HTTP client works — POST JSON to `http://127.0.0.1:7331/ingest`, swallow
all errors, never block the calling thread. Mark every insertion `DEBUG-SKILL`.
