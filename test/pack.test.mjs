import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { variants, svgOf, PACK_DIR, PNG_HEIGHTS } from '../tools/make-human-pack.mjs';

test('the "Made by a human" pack matches the renderer (run node tools/make-human-pack.mjs after label changes)', () => {
  for (const v of variants()) {
    const file = join(PACK_DIR, v.dir, `${v.name}.svg`);
    assert.ok(existsSync(file), `missing ${v.dir}/${v.name}.svg`);
    assert.equal(readFileSync(file, 'utf8'), svgOf(v), `${v.dir}/${v.name}.svg is out of date`);
    for (const h of PNG_HEIGHTS) assert.ok(existsSync(join(PACK_DIR, v.dir, `${v.name}-${h}.png`)), `missing ${v.dir}/${v.name}-${h}.png`);
  }
});

test('the pack holds only human-made labels, in both languages and themes', () => {
  const list = variants();
  assert.ok(list.every((v) => v.opts.kind === 'human'));
  for (const dir of ['en/light', 'en/dark', 'pl/light', 'pl/dark']) {
    assert.ok(readdirSync(join(PACK_DIR, dir)).some((f) => f === 'human-made.svg'), dir);
  }
  assert.match(readFileSync(join(PACK_DIR, 'en', 'light', 'human-made.svg'), 'utf8'), /aria-label="Made by a human\."/);
  assert.match(readFileSync(join(PACK_DIR, 'pl', 'dark', 'human-made-image.svg'), 'utf8'), /aria-label="Stworzone przez człowieka: obraz\."/);
});

test('the AI pack matches the renderer (run node tools/make-ai-pack.mjs after label changes)', async () => {
  const ai = await import('../tools/make-ai-pack.mjs');
  for (const v of ai.variants()) {
    const file = join(ai.PACK_DIR, v.dir, `${v.name}.svg`);
    assert.ok(existsSync(file), `missing ${v.dir}/${v.name}.svg`);
    assert.equal(readFileSync(file, 'utf8'), ai.svgOf(v), `${v.dir}/${v.name}.svg is out of date`);
    for (const h of ai.PNG_HEIGHTS) assert.ok(existsSync(join(ai.PACK_DIR, v.dir, `${v.name}-${h}.png`)), `missing ${v.dir}/${v.name}-${h}.png`);
  }
  // Nothing in the folders that the generator does not make.
  for (const dir of ['en/light', 'en/dark', 'pl/light', 'pl/dark']) {
    const made = new Set(ai.variants().filter((v) => v.dir === join(...dir.split('/'))).flatMap((v) => [`${v.name}.svg`, ...ai.PNG_HEIGHTS.map((h) => `${v.name}-${h}.png`)]));
    assert.deepEqual(readdirSync(join(ai.PACK_DIR, dir)).filter((f) => !made.has(f)), [], dir);
  }
  assert.ok(existsSync(join(ai.PACK_DIR, 'preview.png')) && existsSync(join(ai.PACK_DIR, 'README.md')));
});

test('the AI pack holds only AI labels: the EU icon, minimal, short and full, per kind, in both languages and themes', async () => {
  const ai = await import('../tools/make-ai-pack.mjs');
  const list = ai.variants();
  assert.ok(list.every((v) => ['generated', 'modified', 'basic'].includes(v.opts.kind)));
  assert.equal(list.length, 120);
  const en = (name) => readFileSync(join(ai.PACK_DIR, 'en', 'light', `${name}.svg`), 'utf8');
  assert.match(en('ai-generated'), /aria-label="Generated with AI\."/);
  assert.match(en('ai-modified-short'), /aria-label="Modified with AI\."/);
  assert.match(en('ai-icon'), /aria-label="Made with AI\."/);
  assert.match(en('ai-mark-video'), /aria-label="Made with AI: video\."/);
  assert.match(readFileSync(join(ai.PACK_DIR, 'pl', 'dark', 'ai-generated-image.svg'), 'utf8'), /aria-label="Wygenerowane przez AI: obraz\."/);
  assert.equal(existsSync(join(ai.PACK_DIR, 'en', 'light', 'ai-basic-short.svg')), false);
});
