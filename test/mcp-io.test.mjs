import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { isPrivateAddress, fetchImage, decodeBase64 } from '../skills/ai-content-labels/scripts/lib/source.mjs';

let sharp = null;
try {
  sharp = createRequire(import.meta.url)('sharp');
} catch {}
const noSharp = !sharp && 'sharp not installed';
const scripts = fileURLToPath(new URL('../skills/ai-content-labels/scripts/', import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'ai-labels-mcp-io-'));

// Sends the messages to a fresh stdio server and returns its replies by id.
async function session(messages, cwd) {
  const server = spawn(process.execPath, [join(scripts, 'mcp-server.mjs')], { cwd });
  const replies = [];
  let buffer = '';
  server.stdout.on('data', (chunk) => {
    buffer += chunk;
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      replies.push(JSON.parse(buffer.slice(0, i)));
      buffer = buffer.slice(i + 1);
    }
  });
  messages.forEach((m, i) => server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: i + 1, ...m }) + '\n'));
  const deadline = Date.now() + 15000;
  while (replies.length < messages.length && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
  server.kill();
  return Object.fromEntries(replies.map((r) => [r.id, r]));
}

const call = (name, args, meta) => ({ method: 'tools/call', params: { name, arguments: args, ...(meta && { _meta: meta }) } });
const json = (reply) => JSON.parse(reply.result.content[0].text);
const MODERN = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {}, 'io.modelcontextprotocol/clientInfo': { name: 'test', version: '1' } };

const png = (background = '#556677', width = 900, height = 600) => sharp({ create: { width, height, channels: 3, background } }).png().toBuffer();

// A tiny static server on 127.0.0.1 for the URL tests.
let site;
let base;
const files = {};
async function startSite() {
  if (site) return;
  files['/img.png'] = await png('#aabbcc');
  site = createServer((req, res) => {
    const hop = /^\/hop\/(\d+)$/.exec(req.url);
    if (hop) {
      const n = Number(hop[1]);
      res.writeHead(302, { location: n > 0 ? `/hop/${n - 1}` : '/img.png' });
      return res.end();
    }
    const body = files[req.url];
    if (!body) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { 'content-type': 'image/png', 'content-length': body.length });
    res.end(body);
  });
  await new Promise((r) => site.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${site.address().port}`;
}
after(() => site?.close());

test('label_image with a file path writes the labelled file and returns no image unless asked', { skip: noSharp }, async () => {
  const input = join(tmp, 'gen.png');
  writeFileSync(input, await png());
  const r = await session([
    call('label_image', { input, realistic: true, description: 'A slate wall' }),
    call('label_image', { input, realistic: true, out: join(tmp, 'gen-2.jpg'), return_image: true }),
    call('label_image', { input }),
    call('label_image', { realistic: false }),
  ]);
  const first = r[1].result;
  assert.notEqual(first.isError, true, first.content[0].text);
  assert.equal(first.content.length, 1);
  assert.deepEqual(first.structuredContent, json(r[1]));
  assert.equal(first.structuredContent.output, join(tmp, 'gen.ai-label.png'));
  assert.equal(first.structuredContent.required, true);
  assert.equal(first.structuredContent.alt, 'A slate wall. Generated with AI: image.');
  assert.ok(existsSync(join(tmp, 'gen.ai-label.png')));

  const second = r[2].result;
  assert.equal(second.content[1].type, 'image');
  assert.equal(second.content[1].mimeType, 'image/jpeg');
  assert.equal((await sharp(Buffer.from(second.content[1].data, 'base64')).metadata()).format, 'jpeg');

  assert.equal(r[3].result.isError, true);
  assert.match(r[3].result.content[0].text, /needs realistic/);
  assert.equal(r[4].result.isError, true);
  assert.match(r[4].result.content[0].text, /exactly one of input .* and input_base64/);
});

test('label_image with base64 and no out returns the image and writes nothing', { skip: noSharp }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ai-labels-b64-'));
  const data = (await png('#f0f0f0')).toString('base64');
  const out = join(dir, 'written.webp');
  const r = await session(
    [
      call('label_image', { input_base64: data, realistic: false, description: 'A white card' }),
      call('label_image', { input_base64: `data:image/png;base64,${data}`, realistic: true, out }),
      call('label_image', { input_base64: data, realistic: false, only_if_required: true }),
    ],
    dir
  );
  const first = r[1].result;
  assert.notEqual(first.isError, true, first.content[0].text);
  assert.equal(first.structuredContent.output, null);
  assert.equal(first.structuredContent.required, false);
  assert.match(first.structuredContent.note, /voluntary/);
  const image = first.content.find((c) => c.type === 'image');
  assert.equal(image.mimeType, 'image/png');
  const meta = await sharp(Buffer.from(image.data, 'base64')).metadata();
  assert.match(meta.xmp.toString(), /VisibleLabel>generated/);
  assert.equal(first.structuredContent.buffer, undefined);

  const second = r[2].result;
  assert.equal(second.structuredContent.output, out);
  assert.equal(second.content.length, 1);
  assert.deepEqual(readdirSync(dir), ['written.webp']);

  const skipped = r[3].result.structuredContent;
  assert.equal(skipped.stamped, false);
  assert.equal(skipped.output, null);
  assert.equal(r[3].result.content.length, 1);
});

test('stamp_image takes an http(s) URL, follows redirects, and returns the image', { skip: noSharp }, async () => {
  await startSite();
  const r = await session([
    call('stamp_image', { input: `${base}/img.png`, kind: 'generated', media: ['image'] }),
    call('stamp_image', { input: `${base}/hop/4`, kind: 'generated', out: join(tmp, 'from-url.png') }),
    call('stamp_image', { input: `${base}/hop/5`, kind: 'generated' }),
    call('stamp_image', { input: `${base}/missing.png`, kind: 'generated' }),
    call('stamp_image', { input: 'ftp://example.com/a.png', kind: 'generated' }),
    call('stamp_image', { input_base64: 'bm90IGFuIGltYWdl', kind: 'generated' }),
  ]);
  const first = r[1].result;
  assert.notEqual(first.isError, true, first.content[0].text);
  assert.equal(first.structuredContent.output, null);
  assert.equal(first.content[1].type, 'image');
  assert.equal(r[2].result.structuredContent.output, join(tmp, 'from-url.png'));
  assert.ok(existsSync(join(tmp, 'from-url.png')));
  assert.match(r[3].result.content[0].text, /more than 5 redirects/);
  assert.match(r[4].result.content[0].text, /HTTP 404/);
  assert.match(r[5].result.content[0].text, /only http and https/);
  assert.equal(r[6].result.isError, true);
});

test('fetchImage enforces the size cap; base64 input is validated', { skip: noSharp }, async () => {
  await startSite();
  await assert.rejects(fetchImage(`${base}/img.png`, { maxBytes: 100 }), /larger than/);
  await assert.rejects(fetchImage(`${base}/img.png`, { allowPrivate: false }), /private or loopback/);
  assert.throws(() => decodeBase64('***'), /not valid base64/);
  assert.throws(() => decodeBase64('data:image/png,abc'), /base64-encoded/);
  assert.equal(decodeBase64('data:image/webp;base64,AAAA').mime, 'image/webp');
});

test('private and loopback addresses are recognised', () => {
  for (const a of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', '::', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '0:0:0:0:0:ffff:7f00:1', 'not-an-ip']) {
    assert.equal(isPrivateAddress(a), true, a);
  }
  for (const a of ['93.184.216.34', '8.8.8.8', '::ffff:8.8.8.8', '2606:4700:4700::1111']) assert.equal(isPrivateAddress(a), false, a);
});

test('modern era: server/discover and per-request _meta, next to legacy initialize', async () => {
  const r = await session([
    { method: 'server/discover', params: { _meta: MODERN } },
    { method: 'tools/list', params: { _meta: MODERN } },
    call('decide_label', { media: 'image', origin: 'generated', realistic: true }, MODERN),
    { method: 'tools/list', params: { _meta: { ...MODERN, 'io.modelcontextprotocol/protocolVersion': '1900-01-01' } } },
    { method: 'tools/list', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } } },
    { method: 'server/discover' },
    { method: 'no/such', params: { _meta: MODERN } },
    { method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 't', version: '1' } } },
    { method: 'tools/list' },
  ]);
  const discover = r[1].result;
  assert.equal(discover.resultType, 'complete');
  assert.ok(discover.supportedVersions.includes('2026-07-28'));
  assert.ok(discover.supportedVersions.includes('2025-06-18'));
  assert.deepEqual(discover.capabilities, { tools: {} });
  assert.equal(discover._meta['io.modelcontextprotocol/serverInfo'].name, 'ai-content-labels');
  assert.match(discover.instructions, /label_image/);
  assert.equal(r[2].result.resultType, 'complete');
  assert.equal(r[2].result.tools.length, 6);
  assert.equal(r[3].result.resultType, 'complete');
  assert.equal(r[3].result.structuredContent.required, true);
  assert.equal(r[4].error.code, -32022);
  assert.deepEqual(r[4].error.data.requested, '1900-01-01');
  assert.ok(r[4].error.data.supported.includes('2026-07-28'));
  assert.equal(r[5].error.code, -32602);
  assert.match(r[5].error.message, /clientCapabilities/);
  assert.equal(r[6].error.code, -32602);
  assert.equal(r[7].error.code, -32601);
  assert.equal(r[8].result.protocolVersion, '2025-11-25');
  assert.equal(r[8].result.resultType, undefined);
  assert.equal(r[9].result.resultType, undefined);
});

// A small check of a value against the parts of JSON Schema the tools use.
function conforms(schema, value, path = '$') {
  const types = [].concat(schema.type ?? []);
  const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
  const t = typeOf(value);
  if (types.length && !types.some((x) => x === t || (x === 'number' && t === 'integer'))) return `${path}: ${t} is not ${types.join('|')}`;
  if (t === 'object' && schema.properties) {
    for (const k of schema.required ?? []) if (!(k in value)) return `${path}.${k} is missing`;
    for (const [k, v] of Object.entries(value)) {
      if (!schema.properties[k]) return `${path}.${k} is not in the output schema`;
      const problem = conforms(schema.properties[k], v, `${path}.${k}`);
      if (problem) return problem;
    }
  }
  return null;
}

test('every tool has a title and an outputSchema, and every result conforms to it', { skip: noSharp }, async () => {
  const input = join(tmp, 'schema.png');
  writeFileSync(input, await png('#123456'));
  const r = await session([
    { method: 'tools/list' },
    call('label_image', { input, realistic: true, out: join(tmp, 'schema-1.png') }),
    call('label_image', { input, realistic: false, only_if_required: true }),
    call('stamp_image', { input, kind: 'human', media: ['image'], out: join(tmp, 'schema-2.png'), display_width: 390 }),
    call('decide_label', { media: 'image', origin: 'generated' }),
    call('decide_label', { media: 'text', origin: 'generated', public_interest: true, editorial_review: false }),
    call('render_label', { kind: 'generated', media: ['image'], inline: true }),
    call('render_label', { kind: 'generated', format: 'html' }),
    call('eu_icon', { name: 'basic' }),
  ]);
  const tools = Object.fromEntries(r[1].result.tools.map((t) => [t.name, t]));
  for (const t of Object.values(tools)) {
    assert.ok(t.title, t.name);
    assert.equal(t.outputSchema?.type, 'object', t.name);
  }
  assert.match(tools.label_image.description, /^Call this right after you generate or edit an image/);
  assert.deepEqual(tools.label_image.inputSchema.required, ['realistic']);
  const names = ['label_image', 'label_image', 'stamp_image', 'decide_label', 'decide_label', 'render_label', 'render_label', 'eu_icon'];
  names.forEach((name, i) => {
    const res = r[i + 2].result;
    assert.notEqual(res.isError, true, `${name}: ${res.content[0].text}`);
    assert.deepEqual(res.structuredContent, JSON.parse(res.content[0].text), name);
    assert.equal(conforms(tools[name].outputSchema, res.structuredContent), null, name);
  });
});

test('the extra IPv6 ranges that carry an IPv4 address are refused', () => {
  for (const a of ['::7f00:1', '::127.0.0.1', '2002:7f00:1::1', '2002:808:808::1', '64:ff9b:1::a00:1', 'fec0::1', '2001:0:4136:e378:8000:63bf:3fff:fdd2']) {
    assert.equal(isPrivateAddress(a), true, a);
  }
  for (const a of ['2001:4860:4860::8888', '2a00:1450:4001::1']) assert.equal(isPrivateAddress(a), false, a);
});

test('fetchImage: the timeout covers the whole download, and httpsOnly refuses http', async () => {
  // Sends one byte every 200 ms, forever: an idle timeout would never fire.
  const drip = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'image/png' });
    const timer = setInterval(() => res.write('x'), 200);
    res.on('close', () => clearInterval(timer));
  });
  await new Promise((r) => drip.listen(0, '127.0.0.1', r));
  after(() => drip.close());
  const started = Date.now();
  await assert.rejects(fetchImage(`http://127.0.0.1:${drip.address().port}/slow.png`, { timeoutMs: 1000 }), /timed out/);
  assert.ok(Date.now() - started < 2500, `took ${Date.now() - started} ms`);
  await assert.rejects(fetchImage('http://example.com/a.png', { httpsOnly: true }), /only https URLs/);
});

test('fetchImage ignores a proxy from the environment', { skip: noSharp }, async () => {
  await startSite();
  let proxied = 0;
  const proxy = createServer((req, res) => {
    proxied++;
    res.writeHead(502);
    res.end();
  });
  proxy.on('connect', (req, socket) => {
    proxied++;
    socket.destroy();
  });
  await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
  after(() => proxy.close());
  const proxyUrl = `http://127.0.0.1:${proxy.address().port}`;
  const source = new URL('../skills/ai-content-labels/scripts/lib/source.mjs', import.meta.url).href;
  const script = `import { fetchImage } from ${JSON.stringify(source)}; const r = await fetchImage(${JSON.stringify(`${base}/img.png`)}); console.log(r.buffer.length);`;
  const env = { ...process.env, NODE_USE_ENV_PROXY: '1', HTTP_PROXY: proxyUrl, HTTPS_PROXY: proxyUrl, http_proxy: proxyUrl, https_proxy: proxyUrl, NO_PROXY: '', no_proxy: '' };
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { env });
  let out = '';
  let err = '';
  child.stdout.on('data', (c) => (out += c));
  child.stderr.on('data', (c) => (err += c));
  const code = await new Promise((r) => child.on('exit', r));
  assert.equal(code, 0, err);
  assert.equal(Number(out.trim()), files['/img.png'].length);
  assert.equal(proxied, 0);
});

// A PNG made of a header only: it claims width x height without carrying the pixels.
function pngHeader(width, height) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', Buffer.alloc(0)), chunk('IEND', Buffer.alloc(0))]);
}

test('image bombs are refused before decoding: SVG input, and a raster over the pixel limit', { skip: noSharp }, async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="16000" height="16000"><rect width="100%" height="100%"/></svg>').toString('base64');
  const before = process.memoryUsage().rss;
  const r = await session([
    call('stamp_image', { input_base64: svg, kind: 'generated' }),
    call('label_image', { input_base64: pngHeader(20000, 20000).toString('base64'), realistic: true }),
    call('label_image', { input_base64: pngHeader(9000, 6000).toString('base64'), realistic: true }),
  ]);
  assert.equal(r[1].result.isError, true);
  assert.match(r[1].result.content[0].text, /SVG input is not stamped/);
  assert.match(r[2].result.content[0].text, /over the 50 megapixel limit/);
  assert.match(r[3].result.content[0].text, /over the 50 megapixel limit/);
  assert.ok(process.memoryUsage().rss - before < 200 * 1048576);
  const { stampBuffer, MAX_PIXELS } = await import('../skills/ai-content-labels/scripts/lib/stamp.mjs');
  assert.equal(MAX_PIXELS, 50_000_000);
  await assert.rejects(stampBuffer(Buffer.from(svg, 'base64'), { kind: 'generated' }), /SVG input is not stamped/);
});

test('label_image results conform when nothing is stamped in a language without wording; MCP errors name arguments', { skip: noSharp }, async () => {
  const data = (await png('#999999')).toString('base64');
  const r = await session([
    { method: 'tools/list' },
    call('label_image', { input_base64: data, realistic: false, only_if_required: true, lang: 'de' }),
    call('label_image', { input_base64: data, realistic: true, lang: 'de' }),
    call('label_image', { input_base64: data, realistic: true, lang: 'de', text: 'Mit KI generiert' }),
    call('render_label', { kind: 'generated', text: '' }),
  ]);
  const tool = r[1].result.tools.find((t) => t.name === 'label_image');
  const skipped = r[2].result.structuredContent;
  assert.equal(skipped.disclosure, null);
  assert.equal(conforms(tool.outputSchema, skipped), null);
  const missing = r[3].result.content[0].text;
  assert.equal(r[3].result.isError, true);
  assert.match(missing, /pass text \(CLI: --text\) in that language/);
  assert.match(missing, /text: "Mit KI generiert"/);
  assert.doesNotMatch(missing, /pass --text/);
  assert.equal(r[4].result.structuredContent.disclosure, 'Mit KI generiert.');
  assert.equal(conforms(tool.outputSchema, r[4].result.structuredContent), null);
  assert.match(r[5].result.content[0].text, /^text \(CLI: --text\) is empty/);
});

test('stdio: a modern-shaped request with a legacy version gets -32022, and discover still lists legacy versions', async () => {
  const legacy = { ...MODERN, 'io.modelcontextprotocol/protocolVersion': '2025-06-18' };
  const r = await session([{ method: 'tools/list', params: { _meta: legacy } }, { method: 'server/discover', params: { _meta: MODERN } }]);
  assert.equal(r[1].error.code, -32022);
  assert.equal(r[1].error.data.requested, '2025-06-18');
  assert.ok(r[2].result.supportedVersions.includes('2025-06-18'));
});
