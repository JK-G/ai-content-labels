import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderLabel, officialIcon, THEMES } from '../skills/ai-content-labels/scripts/lib/render.mjs';
import { worstCaseContrast, contrastRatio, WCAG } from '../skills/ai-content-labels/scripts/lib/contrast.mjs';
import { KINDS, MEDIA, LANGS } from '../skills/ai-content-labels/scripts/lib/i18n.mjs';
import { compactIcons } from '../skills/ai-content-labels/scripts/lib/assets.mjs';
import { VERSION } from '../skills/ai-content-labels/scripts/lib/version.mjs';

test('every kind renders in every language and theme', () => {
  for (const kind of KINDS) {
    for (const lang of Object.keys(LANGS)) {
      for (const theme of Object.keys(THEMES)) {
        for (const opts of [{}, { short: true }, { uppercase: true }]) {
          const { svg, width, height, alt } = renderLabel({ kind, lang, theme, media: 'image', ...opts });
          assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="\d+" height="32"/);
          assert.match(svg, /role="img" aria-label="[^"]+"><title>/);
          assert.ok(width > height, `${kind}/${lang}/${theme} is wider than tall`);
          assert.ok(alt.endsWith('.'));
        }
      }
    }
  }
});

test('media icons and a human part make the label wider', () => {
  const plain = renderLabel({ kind: 'generated' }).width;
  const one = renderLabel({ kind: 'generated', media: 'image' }).width;
  const two = renderLabel({ kind: 'generated', media: 'image,voice' }).width;
  const both = renderLabel({ kind: 'generated', media: 'image', human: 'text' }).width;
  assert.ok(plain < one && one < two && one < both);
});

test('alt text names the parts in the label language', () => {
  assert.equal(renderLabel({ media: 'image,voice' }).alt, 'Generated with AI: image and voice.');
  assert.equal(
    renderLabel({ media: 'image', human: 'text', lang: 'pl' }).alt,
    'Wygenerowane przez AI: obraz. Stworzone przez człowieka: tekst.'
  );
  assert.equal(renderLabel({ kind: 'basic', text: 'Voice generated with AI' }).alt, 'Voice generated with AI.');
});

test('built-in themes keep WCAG text contrast on any backdrop', () => {
  for (const theme of Object.values(THEMES)) assert.ok(worstCaseContrast(theme) >= WCAG.text);
});

test('a background too transparent for 4.5:1 is refused unless allowed', () => {
  assert.throws(() => renderLabel({ backgroundOpacity: 0.3 }), /contrast/);
  assert.doesNotThrow(() => renderLabel({ backgroundOpacity: 0.3, allowLowContrast: true }));
});

test('contrast maths matches WCAG reference values', () => {
  assert.equal(contrastRatio([0, 0, 0], [255, 255, 255]).toFixed(1), '21.0');
  assert.equal(contrastRatio([119, 119, 119], [255, 255, 255]).toFixed(2), '4.48');
});

test('bad input is rejected with a clear message', () => {
  assert.throws(() => renderLabel({ kind: 'robot' }), /unknown kind/);
  assert.throws(() => renderLabel({ media: 'hologram' }), /unknown media/);
  assert.throws(() => renderLabel({ lang: 'xx' }), /unknown language/);
  assert.throws(() => renderLabel({ kind: 'human', human: 'text' }), /--human/);
  assert.throws(() => renderLabel({ text: '人工智能' }), /no glyph/);
});

test('the font covers Greek, Cyrillic and Polish', () => {
  for (const text of ['Δημιουργήθηκε με AI', 'Създадено с AI', 'Zażółć gęślą jaźń']) {
    assert.doesNotThrow(() => renderLabel({ kind: 'basic', text, uppercase: true }));
  }
});

test('the label uses the official EU icon geometry', () => {
  const official = readFileSync(officialIcon('basic', 'black').file, 'utf8');
  const firstLetter = official.match(/class="cls-2" d="([^"]+)"/)[1];
  assert.ok(renderLabel({}).svg.includes(firstLetter));
});

test('official EU icons are shipped unchanged in all variants', () => {
  for (const name of ['basic', 'generated', 'modified']) {
    for (const variant of ['black', 'white', 'black-transparent', 'white-transparent']) {
      assert.match(officialIcon(name, variant).svg, /<svg[^>]*viewBox/);
    }
  }
});

test('compact mark: one icon per media type, universal for several', () => {
  const icons = compactIcons();
  for (const n of ['image-ai', 'text-ai', 'audio-ai', 'video-ai', 'universal-ai']) assert.ok(icons[n], n);
  assert.ok(renderLabel({ mark: 'compact', media: 'image' }).svg.includes(icons['image-ai']));
  assert.ok(renderLabel({ mark: 'compact', media: 'image,voice' }).svg.includes(icons['universal-ai']));
  for (const m of MEDIA) assert.doesNotThrow(() => renderLabel({ mark: 'compact', media: m }));
});

test('version matches package.json', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const plugin = JSON.parse(readFileSync(new URL('../.claude-plugin/plugin.json', import.meta.url), 'utf8'));
  assert.equal(VERSION, pkg.version);
  assert.equal(VERSION, plugin.version);
});
