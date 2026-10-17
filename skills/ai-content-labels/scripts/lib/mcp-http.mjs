// Streamable HTTP transport for the MCP server, on node:http. One endpoint, POST /mcp, one JSON-RPC
// message per request, JSON responses (no SSE), 202 for notifications, 405 for GET and DELETE.
// Safe by default: bound to 127.0.0.1, Origin checked, a bearer token required off localhost, no
// file paths unless --allow-files, and URLs that point at private addresses refused.
import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { createDispatcher, isModern, META, ERRORS } from './mcp.mjs';
import { MAX_BYTES } from './source.mjs';

export const LOOPBACK = ['127.0.0.1', 'localhost', '::1'];
// Tool calls decode and encode images; this many run at once, and more get 503 with Retry-After.
export const MAX_JOBS = 3;
// An application error code for "busy", outside the range JSON-RPC and MCP reserve.
export const BUSY = -31001;
// A base64 image of MAX_BYTES is about 4/3 of it, plus the JSON around it.
const MAX_BODY = Math.ceil((MAX_BYTES * 4) / 3) + 1024 * 1024;

export const isLoopback = (host) => LOOPBACK.includes(String(host).replace(/^\[|\]$/g, ''));

// "localhost:8787" -> "localhost", "[::1]:8787" -> "::1".
const hostName = (header) => {
  const h = String(header ?? '');
  const v6 = /^\[([^\]]+)\]/.exec(h);
  return v6 ? v6[1] : h.replace(/:\d+$/, '');
};

// Mcp-Name and Mcp-Param-* may be sent as =?base64?...?= when the value is not plain ASCII.
const decodeHeader = (v) => {
  const m = /^=\?base64\?(.*)\?=$/.exec(v ?? '');
  return m ? Buffer.from(m[1], 'base64').toString('utf8') : v;
};

const sameSecret = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

// options: { port, host, token, allowFiles, allowOrigins, maxJobs }. Resolves to the listening
// http.Server. options.dispatch replaces the tool dispatcher (for tests).
export function startHttpServer({ port = 8787, host = '127.0.0.1', token = null, allowFiles = false, allowOrigins = [], maxJobs = MAX_JOBS, dispatch: custom } = {}) {
  if (!isLoopback(host) && !token) {
    return Promise.reject(new Error(`binding to ${host} makes the server reachable from the network; pass --token <secret> (clients then send Authorization: Bearer <secret>)`));
  }
  // URLs to loopback or private addresses are refused in HTTP mode, whatever the bind address:
  // the server must not fetch from the machine or network it runs in on a caller's behalf.
  // Plain http is refused too: the image must come from a public host over https.
  const dispatch = custom ?? createDispatcher({ allowFiles, allowPrivate: false, httpsOnly: true });
  const loopbackOnly = isLoopback(host);
  let jobs = 0;

  // One bad request must never take the server down: every error ends in a response (or a closed
  // socket), never in an exception or a rejected promise.
  const server = createServer((req, res) => {
    handle(req, res).catch(() => {
      try {
        if (!res.headersSent) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'bad request' } }));
        } else res.destroy();
      } catch {
        res.destroy();
      }
    });
  });
  // Malformed HTTP (not even a request line) is answered by Node; make sure it cannot throw either.
  server.on('clientError', (err, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nconnection: close\r\n\r\n');
    else socket.destroy();
  });

  async function handle(req, res) {
    const origin = req.headers.origin;
    const cors = origin && allowOrigins.includes(origin) ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {};
    const send = (status, body, headers = {}) => {
      const text = body === undefined ? '' : JSON.stringify(body);
      res.writeHead(status, { ...cors, ...(body !== undefined && { 'content-type': 'application/json' }), ...headers });
      res.end(text);
    };
    // Transport errors (403, 401, 404) carry no id; errors about a body that has none carry id null.
    const fail = (status, code, message, id) => send(status, { jsonrpc: '2.0', ...(id !== undefined && { id }), error: { code, message } });

    if ((req.url ?? '').split('?')[0] !== '/mcp') return fail(404, -32600, 'not found; the MCP endpoint is /mcp');
    // DNS rebinding: a page on another site must not reach a server bound to localhost.
    if (origin && !allowOrigins.includes(origin)) return fail(403, -32600, `Origin ${origin} is not allowed; start the server with --allow-origin ${origin} to allow it`);
    if (loopbackOnly && !isLoopback(hostName(req.headers.host))) return fail(403, -32600, 'Host header must be localhost or 127.0.0.1');
    if (req.method === 'OPTIONS' && origin) {
      res.writeHead(204, {
        ...cors,
        'access-control-allow-methods': 'POST',
        'access-control-allow-headers': 'content-type, authorization, mcp-protocol-version, mcp-method, mcp-name, mcp-session-id',
        'access-control-max-age': '600',
      });
      return res.end();
    }
    if (token && !sameSecret(req.headers.authorization ?? '', `Bearer ${token}`)) {
      res.setHeader('www-authenticate', 'Bearer');
      return fail(401, -32600, 'missing or wrong bearer token');
    }
    if (req.method !== 'POST') return send(405, undefined, { allow: 'POST' });

    let size = 0;
    const chunks = [];
    try {
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY) return fail(413, -32600, `request body over ${Math.round(MAX_BODY / 1048576)} MB`);
        chunks.push(chunk);
      }
    } catch {
      return;
    }
    let msg;
    try {
      msg = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      return fail(400, -32700, 'parse error', null);
    }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return fail(400, -32600, 'send one JSON-RPC request or notification per POST (no batches)', null);
    const id = typeof msg.id === 'string' || typeof msg.id === 'number' ? msg.id : null;
    if (typeof msg.method !== 'string') return fail(400, -32600, 'invalid request: no method', id);

    // Modern requests mirror the version, method and tool name in headers; they must match the body.
    if (isModern(msg) && msg.id !== undefined) {
      const version = msg.params?._meta?.[META.protocolVersion];
      const mismatch = (what) => fail(400, ERRORS.headerMismatch, `Header mismatch: ${what}`, msg.id);
      if (req.headers['mcp-protocol-version'] !== version) return mismatch(`MCP-Protocol-Version header must be "${version}", the version in _meta`);
      if (req.headers['mcp-method'] !== msg.method) return mismatch(`Mcp-Method header must be "${msg.method}"`);
      if (msg.method === 'tools/call' && decodeHeader(req.headers['mcp-name']) !== msg.params?.name) return mismatch(`Mcp-Name header must be "${msg.params?.name}"`);
    }

    const heavy = msg.method === 'tools/call' && msg.id !== undefined;
    if (heavy && jobs >= maxJobs) {
      res.setHeader('retry-after', '1');
      return fail(503, BUSY, `server busy: ${maxJobs} tool calls are running; retry in a moment`, msg.id);
    }
    if (heavy) jobs++;
    let answer;
    try {
      answer = await dispatch(msg);
    } finally {
      if (heavy) jobs--;
    }
    if (answer.reply === undefined) return send(202);
    send(answer.status, answer.reply);
  }

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve(server);
    });
  });
}
