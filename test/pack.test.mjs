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
