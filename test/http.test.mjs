import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { request, createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { connect } from 'node:net';
import { startHttpServer } from '../skills/ai-content-labels/scripts/lib/mcp-http.mjs';

let sharp = null;
try {
  sharp = createRequire(import.meta.url)('sharp');
} catch {}
const noSharp = !sharp && 'sharp not installed';
const server = fileURLToPath(new URL('../skills/ai-content-labels/scripts/mcp-server.mjs', import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'ai-labels-http-'));
const running = [];
after(() => running.forEach((p) => p.kill()));

// Starts the server in HTTP mode on a free port and resolves to its MCP endpoint URL.
function start(...args) {
  const proc = spawn(process.execPath, [server, '--http', '--port', '0', ...args]);
  running.push(proc);
  return new Promise((resolve, reject) => {
    let err = '';
    proc.stderr.on('data', (chunk) => {
      err += chunk;
      const m = /on (http:\/\/\S+\/mcp)/.exec(err);
      if (m) resolve(m[1]);
    });
    proc.on('exit', (code) => reject(new Error(`server exited ${code}: ${err}`)));
  });
}

// One HTTP request without the extras fetch adds; resolves to { status, headers, body, json }.
function send(url, { method = 'POST', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const text = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
    const req = request(url, { method, headers: { ...(text && { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }), ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let json;
        try {
          json = raw ? JSON.parse(raw) : undefined;
        } catch {}
        resolve({ status: res.statusCode, headers: res.headers, body: raw, json });
      });
    });
    req.on('error', reject);
    if (text) req.write(text);
    req.end();
  });
}

const rpc = (id, method, params) => ({ jsonrpc: '2.0', id, method, ...(params && { params }) });
const META = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {} };
const modernHeaders = (method, name) => ({ 'mcp-protocol-version': '2026-07-28', 'mcp-method': method, ...(name && { 'mcp-name': name }) });
const png = (background = '#445566') => sharp({ create: { width: 900, height: 600, channels: 3, background } }).png().toBuffer();

test('HTTP mode: legacy initialize, tools/list, a notification gets 202, GET and DELETE get 405', async () => {
  const url = await start();
  assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
  const init = await send(url, { body: rpc(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } }) });
  assert.equal(init.status, 200);
  assert.match(init.headers['content-type'], /application\/json/);
  assert.equal(init.json.result.serverInfo.name, 'ai-content-labels');
  assert.equal(init.headers['mcp-session-id'], undefined);
  const note = await send(url, { body: { jsonrpc: '2.0', method: 'notifications/initialized' } });
  assert.equal(note.status, 202);
  assert.equal(note.body, '');
  const list = await send(url, { body: rpc(2, 'tools/list') });
  assert.equal(list.json.result.tools.length, 6);
  const decide = await send(url, { body: rpc(3, 'tools/call', { name: 'decide_label', arguments: { media: 'image', origin: 'generated', realistic: true } }) });
  assert.equal(decide.json.result.structuredContent.required, true);
  assert.equal((await send(url, { method: 'GET' })).status, 405);
  const del = await send(url, { method: 'DELETE' });
  assert.equal(del.status, 405);
  assert.equal(del.headers.allow, 'POST');
  assert.equal((await send(url.replace('/mcp', '/other'), { body: rpc(4, 'tools/list') })).status, 404);
  assert.equal((await send(url, { body: '{oops' })).status, 400);
  assert.equal((await send(url, { body: [rpc(5, 'tools/list')] })).status, 400);
});

test('HTTP mode: modern requests with matching headers, header mismatch, unknown version and method', async () => {
  const url = await start();
  const discover = await send(url, { body: rpc(1, 'server/discover', { _meta: META }), headers: modernHeaders('server/discover') });
  assert.equal(discover.status, 200);
  assert.equal(discover.json.result.resultType, 'complete');
  assert.ok(discover.json.result.supportedVersions.includes('2026-07-28'));
  const callBody = rpc(2, 'tools/call', { name: 'decide_label', arguments: { media: 'image', origin: 'generated', realistic: false }, _meta: META });
  const ok = await send(url, { body: callBody, headers: modernHeaders('tools/call', 'decide_label') });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.result.resultType, 'complete');
  assert.equal(ok.json.result._meta['io.modelcontextprotocol/serverInfo'].name, 'ai-content-labels');
  const encoded = await send(url, { body: callBody, headers: modernHeaders('tools/call', `=?base64?${Buffer.from('decide_label').toString('base64')}?=`) });
  assert.equal(encoded.status, 200);
  const wrongName = await send(url, { body: callBody, headers: modernHeaders('tools/call', 'eu_icon') });
  assert.equal(wrongName.status, 400);
  assert.equal(wrongName.json.error.code, -32020);
  const noHeaders = await send(url, { body: callBody });
  assert.equal(noHeaders.status, 400);
  assert.equal(noHeaders.json.error.code, -32020);
  const old = { ...META, 'io.modelcontextprotocol/protocolVersion': '1900-01-01' };
  const version = await send(url, { body: rpc(3, 'tools/list', { _meta: old }), headers: { ...modernHeaders('tools/list'), 'mcp-protocol-version': '1900-01-01' } });
  assert.equal(version.status, 400);
  assert.equal(version.json.error.code, -32022);
  assert.ok(version.json.error.data.supported.includes('2026-07-28'));
  const missing = await send(url, { body: rpc(4, 'no/such', { _meta: META }), headers: modernHeaders('no/such') });
  assert.equal(missing.status, 404);
  assert.equal(missing.json.error.code, -32601);
});

test('HTTP mode: Origin must be allowed; the Host header must be local', async () => {
  const url = await start('--allow-origin', 'https://app.example');
  const evil = await send(url, { body: rpc(1, 'tools/list'), headers: { origin: 'https://evil.example' } });
  assert.equal(evil.status, 403);
  assert.equal(evil.json.error.code, -32600);
  const good = await send(url, { body: rpc(2, 'tools/list'), headers: { origin: 'https://app.example' } });
  assert.equal(good.status, 200);
  assert.equal(good.headers['access-control-allow-origin'], 'https://app.example');
  const rebound = await send(url, { body: rpc(3, 'tools/list'), headers: { host: 'attacker.example:80' } });
  assert.equal(rebound.status, 403);
});

test('HTTP mode: a token is required off localhost and checked when set', async () => {
  const refused = spawnSync(process.execPath, [server, '--http', '--host', '0.0.0.0', '--port', '0'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /pass --token/);
  assert.equal(spawnSync(process.execPath, [server, '--token', 'x'], { encoding: 'utf8' }).status, 2);

  const url = await start('--token', 's3cret');
  const none = await send(url, { body: rpc(1, 'tools/list') });
  assert.equal(none.status, 401);
  assert.equal(none.headers['www-authenticate'], 'Bearer');
  assert.equal((await send(url, { body: rpc(2, 'tools/list'), headers: { authorization: 'Bearer wrong!' } })).status, 401);
  assert.equal((await send(url, { body: rpc(3, 'tools/list'), headers: { authorization: 'Bearer s3cret' } })).status, 200);
});

test('HTTP mode: file paths are off unless --allow-files; base64 in, image content out', { skip: noSharp }, async () => {
  const input = join(tmp, 'h.png');
  writeFileSync(input, await png());
  const url = await start();
  const call = (id, name, args) => send(url, { body: rpc(id, 'tools/call', { name, arguments: args }) });

  const path = await call(1, 'label_image', { input, realistic: true });
  assert.equal(path.json.result.isError, true);
  assert.match(path.json.result.content[0].text, /file paths are turned off/);
  const out = await call(2, 'stamp_image', { input_base64: (await png()).toString('base64'), kind: 'generated', out: join(tmp, 'nope.png') });
  assert.match(out.json.result.content[0].text, /file paths are turned off/);
  assert.equal(existsSync(join(tmp, 'nope.png')), false);
  const render = await call(3, 'render_label', { kind: 'generated', out: join(tmp, 'nope.svg') });
  assert.match(render.json.result.content[0].text, /file paths are turned off/);

  const b64 = await call(4, 'label_image', { input_base64: (await png('#eeeeee')).toString('base64'), realistic: true, description: 'A blank page' });
  const result = b64.json.result;
  assert.notEqual(result.isError, true, result.content[0].text);
  assert.equal(result.structuredContent.output, null);
  assert.equal(result.structuredContent.alt, 'A blank page. Generated with AI: image.');
  const image = result.content.find((c) => c.type === 'image');
  assert.equal(image.mimeType, 'image/png');
  assert.ok((await sharp(Buffer.from(image.data, 'base64')).metadata()).xmp.toString().includes('VisibleLabel'));

  const files = await start('--allow-files');
  const allowed = await send(files, { body: rpc(5, 'tools/call', { name: 'label_image', arguments: { input, realistic: false, out: join(tmp, 'h-out.png') } }) });
  assert.equal(allowed.json.result.structuredContent.output, join(tmp, 'h-out.png'));
  assert.ok(existsSync(join(tmp, 'h-out.png')));
});

test('HTTP mode: plain http and URLs to loopback or private addresses are refused', { skip: noSharp }, async () => {
  const body = await png();
  const site = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'image/png' });
    res.end(body);
  });
  await new Promise((r) => site.listen(0, '127.0.0.1', r));
  after(() => site.close());
  const port = site.address().port;
  const url = await start();
  const cases = [
    [`http://127.0.0.1:${port}/a.png`, /only https URLs/],
    [`http://example.com/a.png`, /only https URLs/],
    [`https://127.0.0.1:${port}/a.png`, /private or loopback/],
    [`https://localhost:${port}/a.png`, /private or loopback/],
    [`https://[::1]:${port}/a.png`, /private or loopback/],
  ];
  for (const [i, [input, expected]] of cases.entries()) {
    const r = await send(url, { body: rpc(i + 1, 'tools/call', { name: 'stamp_image', arguments: { input, kind: 'generated' } }) });
    assert.equal(r.json.result.isError, true, input);
    assert.match(r.json.result.content[0].text, expected, input);
  }
});

// Writes raw bytes to the server and resolves to whatever comes back before it closes the socket.
function raw(url, text) {
  const { hostname, port } = new URL(url);
  return new Promise((resolve) => {
    const socket = connect(Number(port), hostname, () => socket.end(text));
    let data = '';
    socket.on('data', (c) => (data += c));
    socket.on('close', () => resolve(data));
    socket.on('error', () => resolve(data));
  });
}

test('HTTP mode: a malformed request line gets an error and the server keeps running', async () => {
  const url = await start();
  for (const line of ['GET http://[ HTTP/1.1', 'POST http://[ HTTP/1.1', 'GET /mcp?x=%zz HTTP/1.1', 'NONSENSE']) {
    const answer = await raw(url, `${line}\r\nHost: localhost\r\nContent-Length: 0\r\n\r\n`);
    assert.match(answer, /^HTTP\/1\.1 4\d\d /, line);
  }
  const after = await send(url, { body: rpc(1, 'tools/list') });
  assert.equal(after.status, 200);
  assert.equal(after.json.result.tools.length, 6);
});

test('HTTP mode: parse and shape errors carry id null; a modern request with a legacy version gets -32022', async () => {
  const url = await start();
  const parse = await send(url, { body: '{oops' });
  assert.equal(parse.status, 400);
  assert.ok('id' in parse.json && parse.json.id === null);
  assert.equal(parse.json.error.code, -32700);
  const batch = await send(url, { body: [rpc(1, 'tools/list')] });
  assert.equal(batch.json.id, null);
  const noMethod = await send(url, { body: { jsonrpc: '2.0', id: 7 } });
  assert.equal(noMethod.json.id, 7);
  assert.equal(noMethod.json.error.code, -32600);

  const legacy = { 'io.modelcontextprotocol/protocolVersion': '2025-06-18', 'io.modelcontextprotocol/clientCapabilities': {} };
  const r = await send(url, { body: rpc(2, 'tools/list', { _meta: legacy }), headers: { 'mcp-protocol-version': '2025-06-18', 'mcp-method': 'tools/list' } });
  assert.equal(r.status, 400);
  assert.equal(r.json.error.code, -32022);
  assert.equal(r.json.error.data.requested, '2025-06-18');
});

test('HTTP mode: tool calls beyond the job limit get 503 with Retry-After', async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const dispatch = async (msg) => {
    if (msg.method === 'tools/call') await gate;
    return { status: 200, reply: { jsonrpc: '2.0', id: msg.id, result: { content: [] } } };
  };
  const server = await startHttpServer({ port: 0, maxJobs: 1, dispatch });
  after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/mcp`;
  const call = (id) => send(url, { body: rpc(id, 'tools/call', { name: 'decide_label', arguments: {} }) });
  const first = call(1);
  await new Promise((r) => setTimeout(r, 100));
  const busy = await call(2);
  assert.equal(busy.status, 503);
  assert.equal(busy.headers['retry-after'], '1');
  assert.equal(busy.json.id, 2);
  assert.equal((await send(url, { body: rpc(3, 'tools/list') })).status, 200);
  release();
  assert.equal((await first).status, 200);
  assert.equal((await call(4)).status, 200);
});
