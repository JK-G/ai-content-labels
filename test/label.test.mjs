import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { agentInstructions, writeInstructions, START, END } from '../skills/ai-content-labels/scripts/lib/init.mjs';

const scripts = fileURLToPath(new URL('../skills/ai-content-labels/scripts/', import.meta.url));
const cli = (args, opts = {}) => spawnSync(process.execPath, [join(scripts, 'ai-labels.mjs'), ...args], { encoding: 'utf8', ...opts });

let sharp = null;
try {
  sharp = createRequire(import.meta.url)('sharp');
} catch {}
const noSharp = !sharp && 'sharp not installed';
const tmp = mkdtempSync(join(tmpdir(), 'ai-labels-label-'));
const image = async (name, background = '#8899aa', format = 'png') => {
  const file = join(tmp, name);
  await sharp({ create: { width: 1200, height: 800, channels: 3, background } })[format]().toFile(file);
  return file;
};

test('label without the realism answer asks the same question as decide and exits 2', { skip: noSharp }, async () => {
  const input = await image('ask.png');
  const r = cli(['label', input]);
  assert.equal(r.status, 2);
  const d = cli(['decide', '--media', 'image', '--origin', 'generated']);
  assert.equal(r.stdout, d.stdout.split('\n')[0] + '\n');
  assert.match(r.stdout, /^UNKNOWN: Would the people who will see it take it for a genuine photo/);
  assert.equal(existsSync(join(tmp, 'ask.ai-label.png')), false);
  const j = JSON.parse(cli(['label', input, '--json']).stdout);
  assert.equal(j.required, 'unknown');
  assert.equal(j.missing, 'realistic');
});

test('label decides and stamps in one call: realistic, generated', { skip: noSharp }, async () => {
  const input = await image('real.png');
  const r = cli(['label', input, '--realistic', '--description', 'A grey test card']);
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.split('\n');
  assert.equal(lines[0], 'REQUIRED: realistic AI image, a deep fake under Article 50(4)');
  assert.equal(lines[1], join(tmp, 'real.ai-label.png'));
  assert.match(r.stdout, /\nalt: A grey test card\. Generated with AI: image\.\n/);
  const meta = await sharp(join(tmp, 'real.ai-label.png')).metadata();
  assert.match(meta.xmp.toString(), /trainedAlgorithmicMedia/);
  assert.match(meta.xmp.toString(), /<aicl:VisibleLabel>generated</);
});

test('label --modified picks the modified label; --json has the verdict and the stamp', { skip: noSharp }, async () => {
  const input = await image('mod.jpg', '#334455', 'jpeg');
  const r = cli(['label', input, '--realistic', '--modified', '--lang', 'pl', '--out', join(tmp, 'mod-out.webp'), '--json']);
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.equal(j.required, true);
  assert.equal(j.stamped, true);
  assert.equal(j.officialIcon, 'modified');
  assert.match(j.verdict, /AI-modified image/);
  assert.equal(j.output, join(tmp, 'mod-out.webp'));
  assert.equal(j.mimeType, 'image/webp');
  assert.equal(j.disclosure, 'Zmodyfikowane przez AI: obraz.');
  assert.equal(j.buffer, undefined);
  const meta = await sharp(j.output).metadata();
  assert.match(meta.xmp.toString(), /compositeWithTrainedAlgorithmicMedia/);
});

test('label stamps a voluntary label by default and skips it with --only-if-required', { skip: noSharp }, async () => {
  const input = await image('toon.png');
  const voluntary = cli(['label', input, '--no-realistic']);
  assert.equal(voluntary.status, 0, voluntary.stderr);
  assert.match(voluntary.stdout, /^NOT REQUIRED: .*stamped anyway/);
  assert.ok(existsSync(join(tmp, 'toon.ai-label.png')));

  const input2 = await image('toon2.png');
  const skipped = cli(['label', input2, '--no-realistic', '--only-if-required']);
  assert.equal(skipped.status, 0, skipped.stderr);
  assert.match(skipped.stdout, /Not stamped: the label is voluntary here/);
  assert.equal(existsSync(join(tmp, 'toon2.ai-label.png')), false);
  const required = JSON.parse(cli(['label', input2, '--realistic', '--only-if-required', '--json']).stdout);
  assert.equal(required.stamped, true);
});

test('label refuses stray arguments, unknown options and a URL without --out', () => {
  assert.equal(cli(['label', 'a.png', 'b.png', '--realistic']).status, 2);
  assert.match(cli(['label', 'a.png', '--realistic', '--kind', 'human']).stderr, /unknown option for label: --kind/);
  assert.match(cli(['label', 'https://example.com/a.png', '--realistic']).stderr, /needs --out/);
  assert.match(cli(['label']).stderr, /label needs an image/);
});

test('labelImage works on a Buffer and returns the labelled image without writing files', { skip: noSharp }, async () => {
  const { labelImage, NeedsAnswer } = await import('../skills/ai-content-labels/scripts/lib/index.mjs');
  const input = await sharp({ create: { width: 900, height: 600, channels: 3, background: '#ddeeff' } })
    .jpeg()
    .toBuffer();
  const before = readdirSync(tmp).length;
  const r = await labelImage(input, { realistic: true, description: 'A pale blue sky' });
  assert.equal(readdirSync(tmp).length, before);
  assert.equal(r.output, null);
  assert.equal(r.required, true);
  assert.equal(r.mimeType, 'image/jpeg');
  assert.equal(r.alt, 'A pale blue sky. Generated with AI: image.');
  assert.ok(Buffer.isBuffer(r.buffer));
  assert.equal((await sharp(r.buffer).metadata()).format, 'jpeg');
  await assert.rejects(labelImage(input, {}), (e) => e instanceof NeedsAnswer && e.missing === 'realistic');
});

test('stampBuffer keeps the input format and the marker stops a second stamp', { skip: noSharp }, async () => {
  const { stampBuffer } = await import('../skills/ai-content-labels/scripts/lib/index.mjs');
  const png = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#222' } })
    .png()
    .toBuffer();
  const once = await stampBuffer(png, { kind: 'generated', media: ['image'] });
  assert.equal(once.mimeType, 'image/png');
  // The icon on a dark image: the white disc (theme dark, as in the dark pill).
  assert.equal(once.label.form, 'icon');
  assert.equal(once.label.disc, 'white');
  assert.equal((await stampBuffer(png, { kind: 'generated', media: ['image'], short: true })).label.theme, 'light');
  await assert.rejects(stampBuffer(once.buffer, { kind: 'generated' }), /already labelled as generated/);
  const webp = await stampBuffer(png, { kind: 'generated', format: 'webp' });
  assert.equal((await sharp(webp.buffer).metadata()).format, 'webp');
});

test('the package exports the library functions by name', async () => {
  const lib = await import('ai-content-labels');
  for (const name of ['decide', 'renderLabel', 'renderHtml', 'stampImage', 'stampBuffer', 'labelImage', 'officialIcon', 'VERSION']) {
    assert.ok(lib[name] !== undefined, name);
  }
  assert.equal(lib.decide({ media: 'image', origin: 'generated', realistic: true }).required, true);
  assert.match(lib.renderLabel({ kind: 'generated', media: ['image'] }).svg, /^<svg/);
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(lib.VERSION, pkg.version);
});

test('init prints a block for AGENTS.md between markers', () => {
  const r = cli(['init']);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, agentInstructions());
  assert.ok(r.stdout.startsWith(START) && r.stdout.trimEnd().endsWith(END));
  assert.match(r.stdout, /ai-labels label <image>/);
  assert.match(r.stdout, /label_image/);
  assert.match(r.stdout, /Never put a human-made label/);
  assert.doesNotMatch(r.stdout, /—/);
  assert.match(cli(['init', '--file', 'x.md']).stderr, /--file goes with --write/);
});

test('init --write is idempotent, keeps the rest of the file and updates an old block', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ai-labels-init-'));
  const first = cli(['init', '--write'], { cwd: dir });
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /AGENTS\.md: created/);
  const once = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
  assert.match(cli(['init', '--write'], { cwd: dir }).stdout, /already up to date/);
  assert.equal(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), once);

  const file = join(dir, 'GEMINI.md');
  writeFileSync(file, '# Project\n\nUse tabs.\n');
  assert.equal(writeInstructions(file).status, 'added');
  assert.equal(writeInstructions(file).status, 'unchanged');
  const added = readFileSync(file, 'utf8');
  assert.ok(added.startsWith('# Project\n\nUse tabs.\n\n' + START));
  writeFileSync(file, added.replace(/## Labelling AI images[\s\S]*?(?=<!-- ai-content-labels:end)/, 'old text\n') + '\nMore rules.\n');
  assert.equal(writeInstructions(file).status, 'updated');
  const updated = readFileSync(file, 'utf8');
  assert.equal(updated.split(START).length, 2);
  assert.match(updated, /## Labelling AI images/);
  assert.match(updated, /More rules\.\n$/);
});

test('init --write keeps CRLF files CRLF and finds its block again on the next run', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ai-labels-init-crlf-'));
  const file = join(dir, 'AGENTS.md');
  writeFileSync(file, '# Rules\r\n\r\nUse tabs.\r\n');
  assert.equal(writeInstructions(file).status, 'added');
  const once = readFileSync(file, 'utf8');
  assert.ok(once.startsWith('# Rules\r\n\r\nUse tabs.\r\n\r\n' + START + '\r\n'));
  assert.equal(once.replace(/\r\n/g, '').includes('\n'), false, 'no bare LF line endings');
  assert.equal(writeInstructions(file).status, 'unchanged');
  assert.equal(readFileSync(file, 'utf8'), once);
  writeFileSync(file, once.replace('## Labelling AI images', '## Old heading') + 'Footer.\r\n');
  assert.equal(writeInstructions(file).status, 'updated');
  const updated = readFileSync(file, 'utf8');
  assert.equal(updated, once + 'Footer.\r\n');
  assert.equal(writeInstructions(file).status, 'unchanged');
});
