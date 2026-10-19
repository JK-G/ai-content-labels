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
  assert.match(r.stdout, /^REQUIRED: realistic AI image, a deep fake under Article 50\(4\)\n/);
  const j = JSON.parse(cli('decide', '--media', 'text', '--origin', 'generated', '--no-public-interest', '--json').stdout);
  assert.equal(j.required, false);
});

test('alt without a description prints the sentence and asks for the description', () => {
  const r = cli('alt', '--media', 'image', '--human', 'text');
  assert.equal(r.status, 0);
  assert.equal(r.stdout, 'disclosure: Generated with AI: image. Made by a human: text.\nalt: add --description "what the image shows" to get the full alt text\n');
  const j = JSON.parse(cli('alt', '--media', 'image', '--json').stdout);
  assert.equal(j.alt, null);
  assert.match(j.altMissing, /pass description/);
  assert.equal(j.disclosure, 'Generated with AI: image.');
  assert.equal(cli('alt', '--media', 'image', '--description', 'Is this wolf real?').stdout, 'Is this wolf real? Generated with AI: image.\n');
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
  const r = cli('stamp', input, '--kind', 'generated', '--media', 'image', '--json');
  assert.equal(r.status, 0, r.stderr);
  const result = JSON.parse(r.stdout);
  assert.ok(existsSync(result.output));
  assert.equal(result.alt, null);
  // The default for an AI label: the EU icon alone, black on this light image.
  assert.equal(result.label.form, 'icon');
  assert.equal(result.label.theme, 'light');
  assert.equal(result.label.disc, 'black');
  assert.equal(result.label.height, 56); // legible on a phone: 18 px as shown 390 px wide
  assert.equal(result.label.width, 56);
  assert.equal(result.label.position, 'bottom-right');
  assert.equal(result.disclosure, 'Generated with AI: image.');
  const meta = await sharp(result.output).metadata();
  assert.match(meta.xmp.toString(), /trainedAlgorithmicMedia/);
  // Inside the ring, left of the letters, the disc is black on this light image.
  const disc = await sharp(result.output).extract({ left: result.label.left + Math.round(result.label.height * 0.17), top: Math.round(result.label.top + result.label.height / 2) - 1, width: 2, height: 2 }).raw().toBuffer();
  assert.ok(disc[0] < 60, 'black disc pixels');
});

test('stamp without --kind refuses and points to decide, writing nothing', { skip: !sharp && 'sharp not installed' }, async () => {
  const input = join(tmp, 'no-kind.png');
  await sharp({ create: { width: 800, height: 600, channels: 3, background: '#abc' } }).png().toFile(input);
  const r = cli('stamp', input, '--media', 'image');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /stamp needs --kind generated, modified, basic or human\. Not sure which\? Run: ai-labels decide/);
  assert.ok(!existsSync(join(tmp, 'no-kind.ai-label.png')));
  // render keeps its default: it writes nothing into the user's content.
  assert.equal(cli('render', '--media', 'image').status, 0);
});

test('the printed command name is installed: ai-labels and ai-content-labels point to the same CLI', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.bin['ai-labels'], 'skills/ai-content-labels/scripts/ai-labels.mjs');
  // npx runs the bin named after the package.
  assert.equal(pkg.bin['ai-content-labels'], pkg.bin['ai-labels']);
  assert.match(cli('help').stdout, /^ai-labels <command>/);
  const next = cli('decide', '--media', 'image', '--origin', 'generated', '--realistic').stdout.split('\n')[1];
  assert.ok(next.startsWith('Next: ai-labels '));
  const json = JSON.parse(cli('decide', '--media', 'text', '--origin', 'generated', '--no-public-interest', '--voluntary', '--json').stdout);
  assert.equal(json.next.tool, 'render_label');
  assert.match(json.next.cli, /^ai-labels render --format html/);
});

test('text and audio labels get no hint to describe an image', () => {
  const text = JSON.parse(cli('render', '--format', 'html', '--media', 'text', '--json').stdout);
  assert.equal(text.alt, null);
  assert.equal(text.altMissing, undefined);
  assert.equal(cli('alt', '--media', 'audio').stdout, 'disclosure: Generated with AI: audio.\n');
  assert.match(JSON.parse(cli('alt', '--media', 'text', '--human', 'image', '--json').stdout).altMissing, /pass description/);
});

test('stamp refuses images too small for a legible label', { skip: !sharp && 'sharp not installed' }, async () => {
  const input = join(tmp, 'tiny.png');
  await sharp({ create: { width: 60, height: 30, channels: 3, background: '#fff' } }).png().toFile(input);
  const r = cli('stamp', input, '--kind', 'generated');
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
  assert.deepEqual(byId[2].result.tools.map((t) => t.name), ['label_image', 'decide_label', 'render_label', 'stamp_image', 'place_label', 'eu_icon']);
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
  // The short wording is the default; --short=false is the full one, like --full.
  assert.equal(cli('render', '--short=true').stdout, cli('render').stdout);
  assert.notEqual(cli('render', '--short=false').stdout, cli('render').stdout);
  assert.equal(cli('render', '--short=false').stdout, cli('render', '--full').stdout);
  assert.equal(cli('render', '--short=maybe').status, 2);
});

test('alt works for text the font cannot draw', () => {
  assert.equal(JSON.parse(cli('alt', '--kind', 'basic', '--text', 'Згенеровано ШІ ґ', '--json').stdout).disclosure, 'Згенеровано ШІ ґ.');
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
  const r = JSON.parse(cli('stamp', input, '--kind', 'generated', '--media', 'image', '--json').stdout);
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

test('stamp refuses an explicit height below 18 px, for the icon and for a label with text', { skip: !sharp && 'sharp not installed' }, async () => {
  const input = join(tmp, 'small-label.png');
  await sharp({ create: { width: 800, height: 600, channels: 3, background: '#fff' } }).png().toFile(input);
  const r = cli('stamp', input, '--kind', 'generated', '--height', '16');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /at least 18 px/);
  const word = cli('stamp', input, '--kind', 'generated', '--short', '--height', '17');
  assert.equal(word.status, 2);
  assert.match(word.stderr, /at least 18 px/);
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
  // A spelled-out answer after the flag is the answer, not a stray argument.
  assert.match(cli('decide', '--media', 'image', '--origin', 'generated', '--realistic', 'false').stdout, /^NOT REQUIRED: /);
  assert.match(cli('decide', '--media', 'image', '--origin', 'generated', '--realistic', 'yes').stdout, /^REQUIRED: /);
  const text = cli('decide', '--media', 'text', '--origin', 'generated');
  assert.equal(text.status, 2);
  assert.match(text.stdout, /^UNKNOWN: /);
  assert.match(cli('decide', '--media', 'text', '--origin', 'generated', '--no-public-interest').stdout, /^NOT REQUIRED: /);
  const json = JSON.parse(cli('decide', '--media', 'image', '--origin', 'generated', '--realistic', '--json').stdout);
  assert.ok(json.sources.guidelines);
  assert.ok(json.notes.some((n) => n.startsWith('The duty falls on the deployer')));
});

test('alt composes the description and the label sentence', () => {
  assert.match(cli('alt', '--kind', 'basic', '--text', 'Made with AI.').stdout, /^disclosure: Made with AI\.\n/);
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
  const png = cli('render', '--media', 'image', '--full', '--out', join(tmp, 'scaled.png'), '--scale', '3');
  assert.equal(png.status, 0, png.stderr);
  assert.match(png.stdout, /\(573×96 px, displays at 191×32\)/);
  assert.match(png.stdout, /^text contrast: 14\.78:1$/m);
  assert.match(png.stdout, /^embed: <img src="scaled\.png" alt="Generated with AI: image\." width="191" height="32"> \(use alt="" if a caption already carries this sentence\)$/m);
  assert.doesNotMatch(png.stdout, /--description/);
  const json = JSON.parse(cli('render', '--media', 'image', '--out', join(tmp, 'l.svg'), '--json').stdout);
  assert.equal(json.alt, null);
  assert.equal(json.labelAlt, 'Generated with AI: image.');
  assert.equal(json.wcag, true);
  const html = JSON.parse(cli('render', '--format', 'html', '--kind', 'generated', '--media', 'image', '--description', 'Wilk', '--lang', 'pl', '--json').stdout);
  assert.equal(html.alt, 'Wilk. Wygenerowane przez AI: obraz.');
  assert.equal(cli('render', '--format', 'html', '--out', join(tmp, 'x.png')).status, 2);
  const tooSmall = cli('render', '--height', '17');
  assert.equal(tooSmall.status, 2);
  assert.match(tooSmall.stderr, /at least 18 px/);
  assert.equal(cli('render', '--height', '18').status, 0);
  assert.equal(cli('render', '--minimal', '--height', '19').status, 2);
  assert.equal(cli('render', '--minimal', '--height', '20').status, 0);
  assert.equal(cli('render', '--form', 'icon', '--height', '18').status, 0);
  assert.match(cli('render', '--form', 'round').stderr, /unknown form "round"; use one of: icon, minimal, short, full/);
  assert.match(cli('render', '--icon', '--short').stderr, /--short and --icon contradict/);
});

test('stamp takes one image; its JSON has an absolute path and the composed alt', { skip: !sharp && 'sharp not installed' }, async () => {
  const many = cli('stamp', 'a.png', 'b.png');
  assert.equal(many.status, 2);
  assert.match(many.stderr, /takes one image/);
  const input = join(tmp, 'wolf.png');
  await sharp({ create: { width: 900, height: 900, channels: 3, background: '#1b2330' } }).png().toFile(input);
  const r = JSON.parse(cli('stamp', input, '--kind', 'generated', '--media', 'image', '--description', 'Grey wolf head', '--json').stdout);
  assert.equal(r.alt, 'Grey wolf head. Generated with AI: image.');
  assert.equal(r.wcag, true);
  assert.equal(r.disclosure, 'Generated with AI: image.');
  // The icon on a dark image: the white disc.
  assert.equal(r.label.theme, 'dark');
  assert.equal(r.label.disc, 'white');
  assert.ok(isAbsolute(r.output));
  const again = cli('stamp', r.output, '--kind', 'generated', '--media', 'image');
  assert.equal(again.status, 2);
  assert.match(again.stderr, /already labelled/);
  const overlap = cli('stamp', input, '--kind', 'generated', '--media', 'image,text', '--human', 'text', '--out', join(tmp, 'o.png'));
  assert.equal(overlap.status, 2);
  assert.match(overlap.stderr, /text is in both/);
});

test('stray words, fractional heights and unknown languages are refused', () => {
  const stray = cli('alt', '--kind', 'basic', '--text', 'Voice', 'generated', 'with', 'AI', '--media', 'voice');
  assert.equal(stray.status, 2);
  assert.match(stray.stderr, /unexpected argument "generated"; put text with spaces in quotes: --text "Voice generated with AI"/);
  for (const command of ['render', 'decide']) assert.equal(cli(command, 'oops').status, 2);
  assert.equal(cli('eu', 'generated', 'extra').status, 2);
  const half = cli('render', '--height', '32.5');
  assert.equal(half.status, 2);
  assert.match(half.stderr, /whole number of px/);
  const abc = cli('render', '--height', 'abc');
  assert.equal(abc.status, 2);
  assert.match(abc.stderr, /must be a number of px/);
  assert.equal(cli('render', '--height', '32', '--media', 'image').status, 0);
  assert.equal(cli('eu', 'generated', '--out', join(tmp, 'eu-ok.svg')).status, 0);
  assert.equal(cli('render', '--lang', 'xx').status, 2);
});

test('other EU languages: own text, tagged with its language', () => {
  const de = cli('render', '--lang', 'de', '--text', 'Mit KI generiert', '--media', 'image');
  assert.equal(de.status, 0, de.stderr);
  assert.match(de.stdout, /^<svg [^>]*lang="de"[^>]*aria-label="Mit KI generiert\."/);
  const fr = cli('render', '--format', 'html', '--lang', 'fr', '--text', 'Généré par IA');
  assert.match(fr.stdout, /lang="fr"/);
  assert.doesNotMatch(fr.stdout, /image|Generated/);
  const missing = cli('render', '--lang', 'de', '--media', 'image');
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /pass --text in that language/);
});

test('decide is short by default, names the next command, and explains on request', () => {
  const r = cli('decide', '--media', 'image', '--origin', 'generated', '--realistic');
  const lines = r.stdout.trimEnd().split('\n');
  assert.ok(lines.length <= 7, r.stdout);
  assert.ok(lines[0].length < 90);
  assert.match(lines[1], /^Next: ai-labels stamp <image> --kind generated --media image --description "what it shows"$/);
  assert.match(r.stdout, /WCAG 2\.2\.2/);
  assert.match(r.stdout, /rerun with --explain/);
  assert.doesNotMatch(r.stdout, /Guidelines paras 113-115/);
  const full = cli('decide', '--media', 'image', '--origin', 'generated', '--realistic', '--explain');
  assert.match(full.stdout, /Guidelines paras 113-115/);
  assert.match(full.stdout, /^Source: /m);
  const video = cli('decide', '--media', 'video', '--origin', 'generated', '--realistic').stdout;
  assert.match(video, /Sub-measure 1\.2\.2\(b\)/);
  assert.match(video, /WCAG 1\.2\.5/);
  assert.match(cli('decide', '--media', 'audio', '--origin', 'modified', '--realistic', '--lang', 'pl').stdout, /To nagranie zawiera głos wygenerowany przez AI/);
  const human = cli('decide', '--media', 'image', '--origin', 'human').stdout;
  assert.match(human, /Made by a human/);
  assert.doesNotMatch(human, /Generated with AI/);
  const json = JSON.parse(cli('decide', '--media', 'image', '--origin', 'generated', '--realistic', '--json').stdout);
  assert.equal(json.disclosure, 'Generated with AI: image.');
  assert.equal(json.altText, undefined);
  assert.match(json.verdict, /^REQUIRED/);
});

test('decide asks about editorial review for public-interest text', () => {
  const ask = cli('decide', '--media', 'text', '--origin', 'generated', '--public-interest');
  assert.equal(ask.status, 2);
  assert.match(ask.stdout, /^UNKNOWN: .*editorial responsibility\? Rerun with --editorial-review or --no-editorial-review; if nobody can tell, with --editorial-review unsure, and the label is added as a precaution\./);
  assert.match(cli('decide', '--media', 'text', '--origin', 'generated', '--public-interest', '--editorial-review').stdout, /^NOT REQUIRED/);
  assert.match(cli('decide', '--media', 'text', '--origin', 'generated', '--public-interest', '--no-editorial-review').stdout, /^REQUIRED/);
  const json = JSON.parse(cli('decide', '--json', '--media', 'text', '--origin', 'generated', '--public-interest').stdout);
  assert.equal(json.required, 'unknown');
  assert.equal(json.missing, 'editorial_review');
});

test('stamp summary: pill colour, mark contrast for minimal, a WCAG warning below 4.5:1', { skip: !sharp && 'sharp not installed' }, async () => {
  const input = join(tmp, 'summary.png');
  await sharp({ create: { width: 900, height: 600, channels: 3, background: '#30343a' } }).png().toFile(input);
  const minimal = cli('stamp', input, '--kind', 'generated', '--media', 'image', '--minimal', '--out', join(tmp, 'summary-min.png'));
  assert.equal(minimal.status, 0, minimal.stderr);
  assert.match(minimal.stdout, /minimal, light pill, bottom-right \(auto: bottom-right is free\), mark contrast 14\.78:1/);
  assert.doesNotMatch(minimal.stdout, /text contrast/);
  const low = cli('stamp', input, '--kind', 'generated', '--media', 'image', '--short', '--background-opacity', '0.3', '--allow-low-contrast', '--out', join(tmp, 'summary-low.png'));
  assert.match(low.stdout, /\(below WCAG 1\.4\.3, 4\.5:1\)/);
  const lowJson = JSON.parse(cli('stamp', input, '--kind', 'generated', '--media', 'image', '--short', '--background-opacity', '0.3', '--allow-low-contrast', '--out', join(tmp, 'summary-low2.png'), '--json').stdout);
  assert.equal(lowJson.wcag, false);
});

test('stamp reports how big the label looks where the image is shown', { skip: !sharp && 'sharp not installed' }, async () => {
  const input = join(tmp, 'story.png');
  await sharp({ create: { width: 720, height: 1280, channels: 3, background: '#223' } }).png().toFile(input);
  const plain = cli('stamp', input, '--kind', 'human', '--media', 'image');
  assert.equal(plain.status, 0, plain.stderr);
  assert.match(plain.stdout, /^display: 18\.4 px tall when the image is shown 390 px wide \(full width on a phone; --display-width for other sizes\)$/m);
  const desktop = cli('stamp', input, '--kind', 'human', '--media', 'image', '--display-width', '720', '--out', join(tmp, 'story-desktop.png'));
  assert.equal(desktop.status, 0, desktop.stderr);
  assert.match(desktop.stdout, /^display: 18 px tall when the image is shown 720 px wide$/m);
  assert.match(cli('help').stdout, /--display-width <px>/);
});
