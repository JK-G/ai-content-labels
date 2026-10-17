import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
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
  const j = JSON.parse(cli('decide', '--media', 'text', '--origin', 'generated', '--no-public-interest', '--json').stdout);
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
  assert.equal(result.label.height, 48); // 6% of the shorter side
  assert.equal(result.disclosure, 'Generated with AI: image.');
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
  assert.equal(JSON.parse(byId[3].result.content[0].text).officialIcon, 'modified');
  assert.equal(byId[4].result.isError, true);
  assert.equal(byId[5].error.code, -32601);
});

test('mistyped options are refused instead of ignored', () => {
  const typo = cli('decide', '--media', 'image', '--origin', 'generated', '--realstic', '--json');
  assert.equal(typo.status, 2);
  assert.match(typo.stderr, /unknown option for decide: --realstic/);
  assert.equal(cli('stamp', 'x.jpg', '--positon', 'bottom-right').status, 2);
  assert.match(cli('render', '--kind', '--media').stderr, /--kind needs a value/);
});

test('boolean options accept =false', () => {
  assert.equal(cli('render', '--short=false').stdout, cli('render').stdout);
  assert.notEqual(cli('render', '--short=true').stdout, cli('render').stdout);
  assert.equal(cli('render', '--short=maybe').status, 2);
});

test('alt works for text the font cannot draw', () => {
  assert.equal(cli('alt', '--kind', 'basic', '--text', 'Згенеровано ШІ ґ').stdout, 'Згенеровано ШІ ґ.\n');
});

test('stamp keeps EXIF and XMP, fixes the orientation and adds the tag', { skip: !sharp && 'sharp not installed' }, async () => {
  const input = join(tmp, 'meta.jpg');
  const rights =
    '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
    '<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:rights><rdf:Alt><rdf:li xml:lang="x-default">(c) Test</rdf:li></rdf:Alt></dc:rights></rdf:Description>' +
    '</rdf:RDF></x:xmpmeta><?xpacket end="w"?>';
  await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#cfd8dc' } })
    .withExif({ IFD0: { Artist: 'Test Artist' } })
    .withMetadata({ orientation: 6 })
    .withXmp(rights)
    .jpeg()
    .toFile(input);
  const r = JSON.parse(cli('stamp', input, '--media', 'image', '--json').stdout);
  const meta = await sharp(r.output).metadata();
  assert.equal(`${meta.width}x${meta.height}`, '800x1200');
  assert.ok(!meta.orientation || meta.orientation === 1);
  assert.match(meta.exif.toString('latin1'), /Test Artist/);
  const xmp = meta.xmp.toString();
  assert.match(xmp, /\(c\) Test/);
  assert.match(xmp, /trainedAlgorithmicMedia/);

  const human = join(tmp, 'meta-human.jpg');
  cli('stamp', input, '--kind', 'human', '--media', 'image', '--out', human);
  const hx = (await sharp(human).metadata()).xmp.toString();
  assert.match(hx, /\(c\) Test/);
  assert.doesNotMatch(hx, /DigitalSourceType/);
});

test('stamp refuses an explicit height below 24 px for a label with text', { skip: !sharp && 'sharp not installed' }, async () => {
  const input = join(tmp, 'small-label.png');
  await sharp({ create: { width: 800, height: 600, channels: 3, background: '#fff' } }).png().toFile(input);
  const r = cli('stamp', input, '--height', '16');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /at least 24 px/);
});

test('MCP server survives a message that is not an object', async () => {
  const server = spawn(process.execPath, [join(scripts, 'mcp-server.mjs')]);
  const replies = [];
  server.stdout.on('data', (chunk) => replies.push(...String(chunk).trim().split('\n').map((l) => JSON.parse(l))));
  server.stdin.write('null\n[]\n42\n');
  server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'ping' }) + '\n');
  const deadline = Date.now() + 5000;
  while (replies.length < 4 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
  server.kill();
  assert.equal(replies.filter((r) => r.error?.code === -32600).length, 3);
  assert.deepEqual(replies.find((r) => r.id === 9)?.result, {});
});

test('decide asks instead of guessing, and exits with 2', () => {
  const unknown = cli('decide', '--media', 'image', '--origin', 'generated');
  assert.equal(unknown.status, 2);
  assert.match(unknown.stdout, /^UNKNOWN: /m);
  assert.doesNotMatch(unknown.stdout, /Not required/i);
  const bare = cli('decide');
  assert.equal(bare.status, 2);
  assert.match(bare.stderr, /needs --media and --origin/);
  assert.match(cli('decide', '--media', 'image', '--origin', 'generated', '--no-realistic').stdout, /^NOT REQUIRED: /);
  assert.match(cli('decide', '--media', 'image', '--origin', 'generated', '--realistic').stdout, /^REQUIRED: /);
  assert.match(cli('decide', '--media', 'image', '--origin', 'generated', '--realistic', '--lang', 'pl').stdout, /^Label: .*--lang pl/m);
  const text = cli('decide', '--media', 'text', '--origin', 'generated');
  assert.equal(text.status, 2);
  assert.match(text.stdout, /^UNKNOWN: /);
  assert.match(cli('decide', '--media', 'text', '--origin', 'generated', '--no-public-interest').stdout, /^NOT REQUIRED: /);
  const json = JSON.parse(cli('decide', '--media', 'image', '--origin', 'generated', '--realistic', '--json').stdout);
  assert.ok(json.sources.guidelines);
  assert.ok(json.notes.some((n) => n.startsWith('The duty falls on the deployer')));
});

test('alt composes the description and the label sentence', () => {
  assert.equal(cli('alt', '--kind', 'basic', '--text', 'Made with AI.').stdout, 'Made with AI.\n');
  assert.equal(
    cli('alt', '--kind', 'generated', '--media', 'image', '--description', 'Grey wolf head, digital painting.').stdout,
    'Grey wolf head, digital painting. Generated with AI: image.\n'
  );
  assert.equal(JSON.parse(cli('eu', 'generated', '--json').stdout).alt, 'Generated with AI.');
});

test('render validates text, scale and format, and reports the pixel size', { skip: !sharp && 'sharp not installed' }, () => {
  const blank = cli('render', '--text', '   ');
  assert.equal(blank.status, 2);
  assert.match(blank.stderr, /--text is empty/);
  assert.equal(cli('render', '--scale', '0').status, 2);
  assert.equal(cli('render', '--scale', 'abc').status, 2);
  const png = cli('render', '--media', 'image', '--out', join(tmp, 'scaled.png'), '--scale', '3');
  assert.equal(png.status, 0, png.stderr);
  assert.match(png.stdout, /\(573×96 px, displays at 191×32\)/);
  assert.match(png.stdout, /^disclosure: Generated with AI: image\.$/m);
  assert.equal(cli('render', '--format', 'html', '--out', join(tmp, 'x.png')).status, 2);
  const tooSmall = cli('render', '--height', '20');
  assert.equal(tooSmall.status, 2);
  assert.match(tooSmall.stderr, /--minimal/);
  assert.equal(cli('render', '--minimal', '--height', '20').status, 0);
});

test('stamp takes one image; its JSON has an absolute path and the composed alt', { skip: !sharp && 'sharp not installed' }, async () => {
  const many = cli('stamp', 'a.png', 'b.png');
  assert.equal(many.status, 2);
  assert.match(many.stderr, /takes one image/);
  const input = join(tmp, 'wolf.png');
  await sharp({ create: { width: 900, height: 900, channels: 3, background: '#1b2330' } }).png().toFile(input);
  const r = JSON.parse(cli('stamp', input, '--media', 'image', '--description', 'Grey wolf head', '--json').stdout);
  assert.equal(r.alt, 'Grey wolf head. Generated with AI: image.');
  assert.equal(r.disclosure, 'Generated with AI: image.');
  assert.equal(r.label.theme, 'light');
  assert.ok(isAbsolute(r.output));
  const again = cli('stamp', r.output, '--media', 'image');
  assert.equal(again.status, 2);
  assert.match(again.stderr, /already labelled/);
  const overlap = cli('stamp', input, '--media', 'image,text', '--human', 'text', '--out', join(tmp, 'o.png'));
  assert.equal(overlap.status, 2);
  assert.match(overlap.stderr, /text is in both/);
});
