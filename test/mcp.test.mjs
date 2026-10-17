import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  assert.deepEqual(stampTool.inputSchema.required, ['input', 'kind']);
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
  assert.match(unknown.question, /genuine photo/);
  assert.equal(json(r[2]).required, false);
});
