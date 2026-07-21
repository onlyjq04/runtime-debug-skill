#!/usr/bin/env node
// Zero-dependency local log sink for the runtime-debug skill.
// Instrumented app code POSTs JSON log entries here; the agent reads the
// NDJSON log file (or GET /logs) to diagnose runtime behavior.
//
// Endpoints:
//   POST   /ingest   body: JSON object or array (plain text also accepted)
//   GET    /logs     ?since=<seq> ?tag=<tag>   → NDJSON
//   GET    /health   → { ok, count, logFile, port }
//   DELETE /logs     truncate log file
//
// Env: DEBUG_SINK_PORT (7331), DEBUG_SINK_DIR (.debug-session),
//      DEBUG_SINK_IDLE_MS (30 min — auto-exit when idle)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.DEBUG_SINK_PORT || 7331);
const DIR = path.resolve(process.env.DEBUG_SINK_DIR || '.debug-session');
const LOG = path.join(DIR, 'logs.ndjson');
const IDLE_MS = Number(process.env.DEBUG_SINK_IDLE_MS || 30 * 60 * 1000);

fs.mkdirSync(DIR, { recursive: true });
if (!fs.existsSync(LOG)) fs.writeFileSync(LOG, '');

let seq = fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean).length;
let lastActivity = Date.now();

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type, ...CORS });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  lastActivity = Date.now();
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  if (req.method === 'OPTIONS') return send(res, 204, '');

  if (req.method === 'GET' && url.pathname === '/health') {
    return send(res, 200, { ok: true, count: seq, logFile: LOG, port: PORT });
  }

  if (req.method === 'GET' && url.pathname === '/logs') {
    const since = Number(url.searchParams.get('since') || 0);
    const tag = url.searchParams.get('tag');
    let lines = fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean);
    if (since || tag) {
      lines = lines.filter((l) => {
        try {
          const e = JSON.parse(l);
          return (!since || e.seq > since) && (!tag || e.tag === tag);
        } catch {
          return false;
        }
      });
    }
    return send(res, 200, lines.join('\n') + (lines.length ? '\n' : ''), 'application/x-ndjson');
  }

  if (req.method === 'DELETE' && url.pathname === '/logs') {
    fs.writeFileSync(LOG, '');
    seq = 0;
    return send(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url.pathname === '/ingest') {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 1_000_000) req.destroy();
    });
    req.on('end', () => {
      let entries;
      try {
        const parsed = JSON.parse(body);
        entries = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        entries = [{ msg: body }];
      }
      const now = new Date().toISOString();
      const out = entries.map((e) =>
        JSON.stringify({ ...(e && typeof e === 'object' ? e : { msg: String(e) }), seq: ++seq, ts: now })
      );
      fs.appendFileSync(LOG, out.join('\n') + '\n');
      send(res, 200, { ok: true, seq });
    });
    return;
  }

  send(res, 404, { ok: false, error: 'not found' });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[debug-sink] port ${PORT} already in use — server likely already running (check GET /health)`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[debug-sink] listening on http://127.0.0.1:${PORT}`);
  console.log(`[debug-sink] log file: ${LOG}`);
});

setInterval(() => {
  if (Date.now() - lastActivity > IDLE_MS) {
    console.log('[debug-sink] idle timeout, exiting');
    process.exit(0);
  }
}, 60_000).unref();
