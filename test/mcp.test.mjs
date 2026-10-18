import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

let sharp = null;
try {
  sharp = createRequire(import.meta.url)('sharp');
} catch {}

const scripts = fileURLToPath(new URL('../skills/ai-content-labels/scripts/', import.meta.url));

// Sends the messages to a fresh server and returns its replies by id.
async function session(messages) {
  const server = spawn(process.execPath, [join(scripts, 'mcp-server.mjs')]);
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
  const deadline = Date.now() + 5000;
  while (replies.length < messages.length && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
  server.kill();
  return Object.fromEntries(replies.map((r) => [r.id, r]));
}

const call = (name, args) => ({ method: 'tools/call', params: { name, arguments: args } });
const json = (reply) => JSON.parse(reply.result.content[0].text);

test('string booleans mean what they say, and unknown arguments are refused', async () => {
  const r = await session([
    call('render_label', { kind: 'generated', media: ['image'], short: 'false', inline: true }),
    call('render_label', { kind: 'generated', bogus: 1 }),
    call('render_label', { kind: 'generated', short: 'maybe' }),
  ]);
  assert.equal(json(r[1]).width, 191); // the full form, not the short one
  assert.equal(r[2].result.isError, true);
  assert.match(r[2].result.content[0].text, /unknown argument "bogus"/);
  assert.equal(r[3].result.isError, true);
});

test('stamp_image needs a kind; render_label returns no SVG unless asked', async () => {
  const r = await session([
    call('stamp_image', { input: 'x.png' }),
    call('render_label', { kind: 'generated', media: ['image'] }),
    call('render_label', { kind: 'generated', media: ['image'], format: 'html' }),
  ]);
  assert.equal(r[1].result.isError, true);
  assert.match(r[1].result.content[0].text, /needs kind; call decide_label first/);
  const plain = json(r[2]);
  assert.equal(plain.svg, undefined);
  assert.match(plain.hint, /inline:true/);
  assert.equal(plain.disclosure, 'Generated with AI: image.');
  const html = json(r[3]);
  assert.match(html.html, /role="note"/);
  assert.match(html.css, /\.ai-label/);
});

test('every tool is strict and annotated', async () => {
  const r = await session([{ method: 'tools/list' }]);
  for (const tool of r[1].result.tools) {
    assert.equal(tool.inputSchema.additionalProperties, false, tool.name);
    assert.ok(tool.annotations, tool.name);
  }
  const stampTool = r[1].result.tools.find((t) => t.name === 'stamp_image');
  // input or input_base64: exactly one, checked by the server
  assert.deepEqual(stampTool.inputSchema.required, ['kind']);
  assert.ok(stampTool.inputSchema.properties.description && stampTool.inputSchema.properties.force);
});

test('decide_label returns "unknown" with a question when a deciding fact is missing', async () => {
  const r = await session([
    call('decide_label', { media: 'image', origin: 'generated' }),
    call('decide_label', { media: 'image', origin: 'generated', realistic: 'false' }),
  ]);
  assert.notEqual(r[1].result.isError, true);
  const unknown = json(r[1]);
  assert.equal(unknown.required, 'unknown');
  assert.equal(unknown.missing, 'realistic');
  assert.match(unknown.question, /genuine photo/);
  assert.doesNotMatch(unknown.question, /--/);
  assert.equal(json(r[2]).required, false);
  assert.equal(unknown.next, undefined);
  // A voluntary label: the smallest form.
  // No form: stamp_image uses the EU icon by default.
  assert.deepEqual(json(r[2]).next.arguments, { kind: 'generated', media: ['image'], lang: 'en' });
});

test('decide_label hands over the next call: tool, arguments to pass unchanged, arguments to fill in', async () => {
  const r = await session([call('decide_label', { media: 'image', origin: 'modified', realistic: true }), { method: 'tools/list' }]);
  const { next } = json(r[1]);
  assert.equal(next.tool, 'stamp_image');
  assert.deepEqual(next.arguments, { kind: 'modified', media: ['image'], lang: 'en' });
  assert.deepEqual(next.fill, ['input', 'description']);
  const tools = Object.fromEntries(r[2].result.tools.map((t) => [t.name, t]));
  for (const k of [...Object.keys(next.arguments), ...next.fill]) assert.ok(tools.stamp_image.inputSchema.properties[k], k);
  assert.match(tools.decide_label.description, /`next`/);
});

test('decide_label asks about editorial review for public-interest text, in MCP terms', async () => {
  const r = await session([
    call('decide_label', { media: 'text', origin: 'generated', public_interest: true }),
    call('decide_label', { media: 'text', origin: 'generated', public_interest: true, editorial_review: false }),
    call('decide_label', { media: 'image', origin: 'generated', realistic: true, lang: 'de' }),
  ]);
  const ask = json(r[1]);
  assert.equal(ask.required, 'unknown');
  assert.equal(ask.missing, 'editorial_review');
  assert.doesNotMatch(ask.question, /--/);
  assert.equal(json(r[2]).required, true);
  const de = json(r[3]);
  assert.equal(de.disclosure, null);
  assert.equal(de.altText, undefined);
});

test('schemas: whole-pixel heights, the 24 EU languages', async () => {
  const r = await session([{ method: 'tools/list' }]);
  const tools = Object.fromEntries(r[1].result.tools.map((t) => [t.name, t]));
  assert.equal(tools.render_label.inputSchema.properties.height.type, 'integer');
  assert.equal(tools.eu_icon.inputSchema.properties.height.type, 'integer');
  assert.equal(tools.stamp_image.inputSchema.properties.display_width.type, 'integer');
  assert.equal(tools.render_label.inputSchema.properties.lang.enum.length, 24);
  assert.match(tools.decide_label.description, /editorial_review for public-interest text/);
});

test('stamp_image without a description never hands over the sentence as alt', { skip: !sharp && 'sharp not installed' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ai-labels-mcp-'));
  const input = join(dir, 'in.png');
  await sharp({ create: { width: 800, height: 600, channels: 3, background: '#556' } }).png().toFile(input);
  const r = await session([
    call('stamp_image', { input, kind: 'generated', media: ['image'] }),
    call('render_label', { kind: 'generated', media: ['image'], format: 'html', description: 'A wolf.' }),
    { method: 'initialize', params: { protocolVersion: '2025-06-18' } },
  ]);
  const stamped = json(r[1]);
  assert.equal(stamped.alt, null);
  assert.notEqual(stamped.alt, stamped.disclosure);
  assert.match(stamped.altMissing, /pass description/);
  assert.equal(json(r[2]).alt, 'A wolf. Generated with AI: image.');
  assert.match(r[3].result.instructions, /alt is null until you pass description/);
});
