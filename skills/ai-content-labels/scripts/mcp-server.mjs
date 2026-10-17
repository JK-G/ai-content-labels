#!/usr/bin/env node
// MCP server for ai-content-labels. No dependencies. stdio by default (newline-delimited JSON-RPC 2.0);
// --http serves Streamable HTTP on POST /mcp. Both answer legacy clients (initialize) and
// 2026-07-28 clients (per-request _meta, server/discover).
import { createInterface } from 'node:readline';
import { createDispatcher } from './lib/mcp.mjs';
import { startHttpServer, isLoopback } from './lib/mcp-http.mjs';

const HELP = `ai-content-labels-mcp [--http [options]]

Without options the server speaks MCP over stdio, for clients that start it as a subprocess.

--http                 serve Streamable HTTP on POST /mcp instead (JSON responses)
  --port <n>           default 8787 (0 picks a free port)
  --host <address>     default 127.0.0.1. Any other address needs --token
  --token <secret>     require "Authorization: Bearer <secret>" on every request
                       (or set AI_CONTENT_LABELS_TOKEN)
  --allow-files        let callers pass file paths (input, out). Off by default: images
                       come in as an https URL or input_base64 and go back as image content
  --allow-origin <url> allow browser requests from this Origin (repeat, or comma-separate);
                       requests with any other Origin header get 403

In HTTP mode only https URLs are fetched, and never from loopback or private addresses.
At most 3 tool calls run at once; more get 503 with Retry-After.
`;

function parse(argv) {
  const o = { http: false, port: 8787, host: '127.0.0.1', token: process.env.AI_CONTENT_LABELS_TOKEN || null, allowFiles: false, allowOrigins: [] };
  const value = (i, name) => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new Error(`${name} needs a value`);
    return v;
  };
  const httpOnly = [];
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split(/=(.*)/s);
    const take = (name) => (inline !== undefined ? inline : value(i++, name));
    switch (flag) {
      case '--help':
      case '-h':
        o.help = true;
        break;
      case '--http':
        o.http = true;
        break;
      case '--port': {
        const p = Number(take('--port'));
        if (!Number.isInteger(p) || p < 0 || p > 65535) throw new Error('--port must be a whole number from 0 to 65535');
        o.port = p;
        httpOnly.push(flag);
        break;
      }
      case '--host':
        o.host = take('--host');
        httpOnly.push(flag);
        break;
      case '--token':
        o.token = take('--token');
        httpOnly.push(flag);
        break;
      case '--allow-files':
        o.allowFiles = true;
        httpOnly.push(flag);
        break;
      case '--allow-origin':
        o.allowOrigins.push(...take('--allow-origin').split(',').map((s) => s.trim()).filter(Boolean));
        httpOnly.push(flag);
        break;
      default:
        throw new Error(`unknown option ${argv[i]}; run ai-content-labels-mcp --help`);
    }
  }
  if (httpOnly.length && !o.http) throw new Error(`${httpOnly[0]} goes with --http`);
  return o;
}

function stdio() {
  const dispatch = createDispatcher({ allowFiles: true, allowPrivate: true });
  const send = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');
  createInterface({ input: process.stdin }).on('line', async (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
    }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
      return send({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'invalid request' } });
    }
    const { reply } = await dispatch(msg);
    if (reply) send(reply);
  });
}

let options;
try {
  options = parse(process.argv.slice(2));
} catch (e) {
  process.stderr.write(`ai-content-labels-mcp: ${e.message}\n`);
  process.exit(2);
}
if (options.help) {
  process.stdout.write(HELP);
} else if (!options.http) {
  stdio();
} else {
  // A last guard: a bug hit by one request is logged, and the server keeps serving the others.
  const log = (kind) => (e) => process.stderr.write(`ai-content-labels-mcp: ${kind}: ${e?.stack ?? e}\n`);
  process.on('uncaughtException', log('uncaught exception'));
  process.on('unhandledRejection', log('unhandled rejection'));
  startHttpServer(options).then(
    (server) => {
      const { port } = server.address();
      const host = options.host.includes(':') ? `[${options.host}]` : options.host;
      const notes = [options.allowFiles ? 'file paths on' : 'file paths off', options.token ? 'bearer token required' : isLoopback(options.host) ? 'localhost only' : ''];
      process.stderr.write(`ai-content-labels MCP server on http://${host}:${port}/mcp (${notes.filter(Boolean).join(', ')})\n`);
    },
    (e) => {
      process.stderr.write(`ai-content-labels-mcp: ${e.message}\n`);
      process.exit(2);
    }
  );
}
