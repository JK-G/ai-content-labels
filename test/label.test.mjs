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

test('label: a voluntary label is not stamped by default, and no file is written', { skip: noSharp }, async () => {
  const input = await image('toon.png');
  const r = cli(['label', input, '--no-realistic', '--description', 'Pixel-art mosaic of a city']);
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.split('\n');
  assert.equal(lines[0], 'NOT REQUIRED: not a deep fake (would not be taken for real)');
  assert.match(lines[1], /^Not labelled, and no file written: .*--voluntary/);
  assert.equal(lines[2], 'alt: Pixel-art mosaic of a city.');
  assert.equal(existsSync(join(tmp, 'toon.ai-label.png')), false);

  // --out is not written either.
  const out = join(tmp, 'toon-out.png');
  const j = JSON.parse(cli(['label', input, '--no-realistic', '--out', out, '--json']).stdout);
  assert.equal(j.stamped, false);
  assert.equal(j.required, false);
  assert.equal(j.output, null);
  assert.equal(j.label, null);
  assert.equal(j.disclosure, null);
  assert.equal(j.alt, null);
  assert.match(j.note, /voluntary: true \(CLI: --voluntary\)/);
  assert.equal(existsSync(out), false);
});

test('label --voluntary stamps a voluntary label, in the smallest form', { skip: noSharp }, async () => {
  const input = await image('toon-opt.png');
  const r = cli(['label', input, '--no-realistic', '--voluntary']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^NOT REQUIRED: .*\(labelled because --voluntary is set\)\n/);
  assert.ok(existsSync(join(tmp, 'toon-opt.ai-label.png')));
  const j = JSON.parse(cli(['label', input, '--no-realistic', '--voluntary', '--out', join(tmp, 'toon-opt2.png'), '--json']).stdout);
  assert.equal(j.stamped, true);
  assert.equal(j.required, false);
  assert.equal(j.label.form, 'icon');
  assert.match(j.note, /voluntary is set/);
});

test('label --realistic unsure stamps as a precaution, like a required label', { skip: noSharp }, async () => {
  const input = await image('unsure.png');
  for (const [i, args] of [['--realistic', 'unsure'], ['--realistic=unsure'], ['--realistic', 'UNSURE']].entries()) {
    const out = join(tmp, `unsure-${i}.png`);
    const r = cli(['label', input, ...args, '--description', 'A grey card', '--out', out, '--json']);
    assert.equal(r.status, 0, r.stderr);
    const j = JSON.parse(r.stdout);
    assert.equal(j.required, 'unsure');
    assert.equal(j.precaution, true);
    assert.equal(j.stamped, true);
    assert.match(j.verdict, /^UNSURE, LABEL AS A PRECAUTION: /);
    assert.match(j.note, /^Labelled as a precaution: .*unsure/);
    assert.equal(j.alt, 'A grey card. Generated with AI: image.');
    assert.equal(j.disclosure, 'Generated with AI: image.');
    assert.ok(existsSync(out));
  }
  // The same form a required label gets.
  const required = JSON.parse(cli(['label', input, '--realistic', '--out', join(tmp, 'unsure-req.png'), '--json']).stdout);
  const unsure = JSON.parse(cli(['label', input, '--realistic', 'unsure', '--out', join(tmp, 'unsure-same.png'), '--json']).stdout);
  assert.deepEqual(unsure.label, required.label);
  const text = cli(['label', input, '--realistic', 'unsure', '--out', join(tmp, 'unsure-text.png')]);
  assert.match(text.stdout, /^UNSURE, LABEL AS A PRECAUTION: the AI image may be a deep fake under Article 50\(4\)\n.*unsure-text\.png\n/);
  assert.match(cli(['label', input, '--realistic=maybe']).stderr, /realistic takes true, false or unsure/);
});

test('label: --only-if-required is still accepted, does nothing and says so', { skip: noSharp }, async () => {
  const input = await image('toon2.png');
  const skipped = cli(['label', input, '--no-realistic', '--only-if-required']);
  assert.equal(skipped.status, 0, skipped.stderr);
  assert.match(skipped.stdout, /Not labelled, and no file written/);
  assert.match(skipped.stdout, /--only-if-required is the default since 0\.6\.0/);
  assert.equal(existsSync(join(tmp, 'toon2.ai-label.png')), false);
  const required = JSON.parse(cli(['label', input, '--realistic', '--only-if-required', '--json']).stdout);
  assert.equal(required.stamped, true);
  assert.match(required.note, /only_if_required .* has no effect/);
  const both = cli(['label', input, '--realistic', '--only-if-required', '--voluntary']);
  assert.equal(both.status, 2);
  assert.match(both.stderr, /only_if_required and voluntary contradict/);
});

test('decide: a voluntary verdict has no next command unless --voluntary; unknown offers the precaution', () => {
  const plain = cli(['decide', '--media', 'image', '--origin', 'generated', '--no-realistic']);
  assert.equal(plain.status, 0);
  assert.match(plain.stdout, /^NOT REQUIRED: .*\nNo label needed: .*rerun with --voluntary\.\n/);
  assert.doesNotMatch(plain.stdout, /ai-labels stamp/);
  const json = JSON.parse(cli(['decide', '--media', 'image', '--origin', 'generated', '--no-realistic', '--json']).stdout);
  assert.equal(json.next, null);
  assert.match(json.optIn, /--voluntary/);
  const opted = cli(['decide', '--media', 'image', '--origin', 'generated', '--no-realistic', '--voluntary']);
  assert.match(opted.stdout.split('\n')[1], /^Next \(voluntary\): ai-labels stamp <image>/);
  const ask = cli(['decide', '--media', 'image', '--origin', 'generated', '--json']);
  assert.equal(ask.status, 2);
  assert.equal(JSON.parse(ask.stdout).next.cli, 'ai-labels decide --media image --origin generated --realistic unsure');
  const unsure = cli(['decide', '--media', 'image', '--origin', 'generated', '--realistic', 'unsure']);
  assert.equal(unsure.status, 0);
  assert.match(unsure.stdout, /^UNSURE, LABEL AS A PRECAUTION: .*\nNext \(precaution\): ai-labels stamp <image>/);
  const text = JSON.parse(cli(['decide', '--media', 'text', '--origin', 'generated', '--public-interest', '--editorial-review', 'unsure', '--json']).stdout);
  assert.equal(text.required, 'unsure');
  assert.deepEqual(text.unsure, ['editorial_review']);
  assert.equal(text.next.tool, 'render_label');
});

test('labelImage: the four cases in the library, and only_if_required as a no-op', { skip: noSharp }, async () => {
  const { labelImage } = await import('../skills/ai-content-labels/scripts/lib/index.mjs');
  const input = await sharp({ create: { width: 900, height: 600, channels: 3, background: '#556677' } })
    .png()
    .toBuffer();
  const required = await labelImage(input, { realistic: true, description: 'A slate wall' });
  assert.equal(required.stamped, true);
  assert.equal(required.required, true);
  assert.equal(required.precaution, undefined);
  const unsure = await labelImage(input, { realistic: 'unsure', description: 'A slate wall' });
  assert.equal(unsure.stamped, true);
  assert.equal(unsure.required, 'unsure');
  assert.equal(unsure.precaution, true);
  assert.equal(unsure.alt, required.alt);
  assert.deepEqual(unsure.label, required.label);
  assert.ok(Buffer.isBuffer(unsure.buffer));
  const voluntary = await labelImage(input, { realistic: false, description: 'A slate wall' });
  assert.equal(voluntary.stamped, false);
  assert.equal(voluntary.buffer, undefined);
  assert.equal(voluntary.alt, 'A slate wall.');
  assert.equal(voluntary.disclosure, null);
  const opted = await labelImage(input, { realistic: false, voluntary: true });
  assert.equal(opted.stamped, true);
  assert.equal(opted.label.form, 'icon');
  const legacy = await labelImage(input, { realistic: false, onlyIfRequired: true });
  assert.equal(legacy.stamped, false);
  assert.match(legacy.note, /has no effect/);
  assert.equal((await labelImage(input, { realistic: false, onlyIfRequired: false })).stamped, false);
  await assert.rejects(labelImage(input, { realistic: false, onlyIfRequired: true, voluntary: true }), /contradict/);
  await assert.rejects(labelImage(input, {}), /realistic "unsure"/);
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

test('init states the policy; init --voluntary writes a block that labels voluntary images too', () => {
  const plain = agentInstructions();
  assert.match(plain, /only where the EU AI Act requires one, or where the answer is unsure/);
  assert.match(plain, /--realistic unsure/);
  assert.doesNotMatch(plain, /--voluntary"/);
  const opted = cli(['init', '--voluntary']).stdout;
  assert.equal(opted, agentInstructions({ voluntary: true }));
  assert.match(opted, /--description "what the image shows" --voluntary/);
  assert.match(opted, /`voluntary: true`/);
  assert.doesNotMatch(opted, /\u2014/);
  const dir = mkdtempSync(join(tmpdir(), 'ai-labels-init-v-'));
  assert.equal(writeInstructions(join(dir, 'AGENTS.md'), { voluntary: true }).status, 'created');
  assert.equal(writeInstructions(join(dir, 'AGENTS.md')).status, 'updated');
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
