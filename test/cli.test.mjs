import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const scripts = fileURLToPath(new URL('../skills/ai-content-labels/scripts/', import.meta.url));
const cli = (...args) => spawnSync(process.execPath, [join(scripts, 'ai-labels.mjs'), ...args], { encoding: 'utf8' });

let sharp = null;
try {
  sharp = createRequire(import.meta.url)('sharp');
} catch {}
const tmp = mkdtempSync(join(tmpdir(), 'ai-labels-'));

test('help and unknown commands', () => {
  const help = cli('help');
  assert.equal(help.status, 0);
  assert.match(help.stdout, /ai-labels <command>/);
  const bad = cli('frobnicate');
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /unknown command/);
});

test('render prints an SVG, writes files, and reports bad options', () => {
  const r = cli('render', '--kind', 'modified', '--media', 'image,voice', '--lang', 'pl');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^<svg[^>]+aria-label="Zmodyfikowane przez AI: obraz i głos\."/);
  const out = join(tmp, 'label.svg');
  assert.equal(cli('render', '--out', out).status, 0);
  assert.ok(readFileSync(out, 'utf8').startsWith('<svg'));
  assert.equal(cli('render', '--media', 'smell').status, 2);
  assert.equal(cli('render', '--height').status, 2);
});

test('decide prints a verdict and JSON', () => {
  const r = cli('decide', '--media', 'image', '--origin', 'generated', '--realistic');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^REQUIRED: Article 50\(4\)/);
  const j = JSON.parse(cli('decide', '--media', 'text', '--origin', 'generated', '--json').stdout);
  assert.equal(j.required, false);
});

test('alt prints the sentence', () => {
  assert.equal(cli('alt', '--media', 'image', '--human', 'text').stdout, 'Generated with AI: image. Made by a human: text.\n');
});

test('eu copies the official file unchanged', () => {
  const out = join(tmp, 'eu.svg');
  assert.equal(cli('eu', 'modified', '--variant', 'white', '--out', out).status, 0);
  const original = readFileSync(join(scripts, '..', 'assets', 'eu', 'ai-modified-white.svg'), 'utf8');
  assert.equal(readFileSync(out, 'utf8'), original);
});

test('stamp burns the label in, tags the file and returns alt text', { skip: !sharp && 'sharp not installed' }, async () => {
  const input = join(tmp, 'photo.jpg');
  await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#d8e2ea' } }).jpeg().toFile(input);
  const r = cli('stamp', input, '--media', 'image', '--json');
  assert.equal(r.status, 0, r.stderr);
  const result = JSON.parse(r.stdout);
  assert.ok(existsSync(result.output));
  assert.equal(result.alt, 'Generated with AI: image.');
  assert.equal(result.label.theme, 'dark'); // light image, dark label
  assert.equal(result.label.height, Math.round(800 * 0.045));
  const meta = await sharp(result.output).metadata();
  assert.match(meta.xmp.toString(), /trainedAlgorithmicMedia/);
  // The label background (left of the EU disc) is dark on this light image.
  const corner = await sharp(result.output).extract({ left: result.label.left + 2, top: Math.round(result.label.top + result.label.height / 2) - 1, width: 2, height: 2 }).raw().toBuffer();
  assert.ok(corner[0] < 120, 'dark label pixels in the corner');
});

test('stamp refuses images too small for a legible label', { skip: !sharp && 'sharp not installed' }, async () => {
  const input = join(tmp, 'tiny.png');
  await sharp({ create: { width: 60, height: 30, channels: 3, background: '#fff' } }).png().toFile(input);
  const r = cli('stamp', input);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /too small/);
});

test('MCP server: initialize, list tools, call one', async () => {
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
  const send = (m) => server.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
  send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } });
  send({ method: 'notifications/initialized' });
  send({ id: 2, method: 'tools/list' });
  send({ id: 3, method: 'tools/call', params: { name: 'decide_label', arguments: { media: 'image', origin: 'modified', realistic: true } } });
  send({ id: 4, method: 'tools/call', params: { name: 'render_label', arguments: { kind: 'robot' } } });
  send({ id: 5, method: 'no/such/method' });
  const deadline = Date.now() + 5000;
  while (replies.length < 5 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
  server.kill();
  const byId = Object.fromEntries(replies.map((r) => [r.id, r]));
  assert.equal(byId[1].result.serverInfo.name, 'ai-content-labels');
  assert.deepEqual(byId[2].result.tools.map((t) => t.name), ['decide_label', 'render_label', 'stamp_image', 'eu_icon']);
  assert.equal(JSON.parse(byId[3].result.content[0].text).euIcon, 'modified');
  assert.equal(byId[4].result.isError, true);
  assert.equal(byId[5].error.code, -32601);
});
