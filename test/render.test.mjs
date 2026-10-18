import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderLabel, officialIcon, THEMES, HAND_RATIO } from '../skills/ai-content-labels/scripts/lib/render.mjs';
import { worstCaseContrast, contrastRatio, WCAG } from '../skills/ai-content-labels/scripts/lib/contrast.mjs';
import { KINDS, MEDIA, LANGS, sentence } from '../skills/ai-content-labels/scripts/lib/i18n.mjs';
import { VERSION } from '../skills/ai-content-labels/scripts/lib/version.mjs';
import { font, handMark } from '../skills/ai-content-labels/scripts/lib/assets.mjs';
import { round } from '../skills/ai-content-labels/scripts/lib/text.mjs';

test('every kind renders in every language and theme', () => {
  for (const kind of KINDS) {
    for (const lang of Object.keys(LANGS)) {
      for (const theme of Object.keys(THEMES)) {
        for (const opts of [{}, { short: true }, { uppercase: true }]) {
          const { svg, width, height, alt, disclosure } = renderLabel({ kind, lang, theme, media: 'image', ...opts });
          assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="\d+" height="32"/);
          assert.match(svg, /role="img" aria-label="[^"]+"><title>/);
          assert.ok(width > height, `${kind}/${lang}/${theme} is wider than tall`);
          assert.ok(disclosure.endsWith('.'));
          assert.equal(alt, null);
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
  assert.equal(renderLabel({ media: 'image,voice' }).disclosure, 'Generated with AI: image and voice.');
  assert.equal(
    renderLabel({ media: 'image', human: 'text', lang: 'pl' }).disclosure,
    'Wygenerowane przez AI: obraz. Stworzone przez człowieka: tekst.'
  );
  assert.equal(renderLabel({ kind: 'basic', text: 'Voice generated with AI' }).disclosure, 'Voice generated with AI.');
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

test('minimal: mark and icons only, same alt text', () => {
  const full = renderLabel({ media: 'image,voice', lang: 'pl' });
  const minimal = renderLabel({ media: 'image,voice', lang: 'pl', minimal: true });
  assert.ok(minimal.width < full.width / 2);
  assert.equal(minimal.disclosure, full.disclosure);
  // No glyph group: the only scaled groups are the EU disc and the two icons.
  assert.equal((minimal.svg.match(/scale\(/g) ?? []).length, 3);
  for (const kind of KINDS) for (const m of MEDIA) assert.doesNotThrow(() => renderLabel({ kind, media: m, minimal: true }));
});

test('minimal without media is a round badge, and ignores text the font cannot draw', () => {
  for (const kind of ['generated', 'human']) {
    const { width, height } = renderLabel({ kind, minimal: true, height: 40 });
    assert.equal(width, height);
  }
  assert.doesNotThrow(() => renderLabel({ kind: 'basic', text: '人工智能', minimal: true }));
});

test('version matches package.json', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const plugin = JSON.parse(readFileSync(new URL('../.claude-plugin/plugin.json', import.meta.url), 'utf8'));
  assert.equal(VERSION, pkg.version);
  assert.equal(VERSION, plugin.version);
});

test('decomposed (NFD) text is normalised and finds its glyphs', () => {
  const nfd = 'Café generated with AI';
  assert.doesNotThrow(() => renderLabel({ kind: 'basic', text: nfd }));
  assert.equal(renderLabel({ kind: 'basic', text: nfd }).disclosure, 'Café generated with AI.');
});

test('sentence drops the custom text\'s own full stop', () => {
  assert.equal(sentence({ kind: 'basic', text: 'Made with AI.', lang: 'en' }), 'Made with AI.');
  assert.equal(sentence({ kind: 'basic', text: 'Made with AI!  ', media: ['image'], lang: 'en' }), 'Made with AI: image.');
});

test('alt text = description, then the label sentence; disclosure is the sentence alone', () => {
  const l = renderLabel({ media: 'image', description: 'Grey wolf head, digital painting.' });
  assert.equal(l.alt, 'Grey wolf head, digital painting. Generated with AI: image.');
  assert.equal(l.disclosure, 'Generated with AI: image.');
  assert.match(l.svg, /aria-label="Generated with AI: image\."/);
  assert.equal(renderLabel({ media: 'image', description: 'A wolf.' }).alt, 'A wolf. Generated with AI: image.');
  assert.equal(renderLabel({ media: 'image', description: 'A wolf' }).alt, 'A wolf. Generated with AI: image.');
  assert.equal(renderLabel({ media: 'image', description: 'Is this wolf real?' }).alt, 'Is this wolf real? Generated with AI: image.');
  assert.equal(renderLabel({ media: 'image', description: 'A wolf…' }).alt, 'A wolf… Generated with AI: image.');
  // No description, no alt text: the sentence alone is the alt of the label, never of the image.
  assert.equal(renderLabel({ media: 'image' }).alt, null);
  assert.equal(renderLabel({ media: 'image', description: '   ' }).alt, null);
});

test('empty, duplicated and contradictory input is refused or cleaned', () => {
  assert.throws(() => renderLabel({ text: '   ' }), /--text is empty/);
  assert.throws(() => renderLabel({ media: 'image', human: 'text', humanText: '' }), /--human-text is empty/);
  assert.equal(renderLabel({ media: 'image,image' }).disclosure, 'Generated with AI: image.');
  assert.throws(() => renderLabel({ media: 'image,text', human: 'text' }), /text is in both --media and --human/);
  assert.throws(() => renderLabel({ short: 'maybe' }), /true or false/);
  assert.equal(renderLabel({ short: 'false' }).width, renderLabel({ full: true }).width);
  assert.throws(() => renderLabel({ full: true, short: true }), /--full and --short contradict/);
  assert.throws(() => renderLabel({ full: true, minimal: true }), /--full and --minimal contradict/);
});

test('labels with text and the icon are at least 18 px; minimal ones at least 20', () => {
  assert.throws(() => renderLabel({ height: 17 }), /a label with text must be at least 18 px tall/);
  assert.doesNotThrow(() => renderLabel({ height: 18 }));
  assert.doesNotThrow(() => renderLabel({ height: 24 }));
  assert.throws(() => renderLabel({ form: 'icon', height: 17 }), /the icon must be at least 18 px/);
  assert.doesNotThrow(() => renderLabel({ form: 'icon', height: 18 }));
  assert.doesNotThrow(() => renderLabel({ height: 20, minimal: true, media: 'image', human: 'text' }));
  assert.throws(() => renderLabel({ height: 19, minimal: true }), /between 20 and 512/);
});

test('whole-pixel geometry: root width, pill edge and a half-pixel divider', () => {
  const { svg, width } = renderLabel({ media: 'image' });
  assert.ok(Number.isInteger(width));
  const rect = svg.match(/<rect x="([\d.]+)" y="[\d.]+" width="([\d.]+)"[^>]*stroke-width="([\d.]+)"/);
  assert.equal(Number(rect[2]) + Number(rect[3]), width);
  const line = svg.match(/<line x1="([\d.]+)"/);
  assert.equal(Number(line[1]) % 1, 0.5);
  for (const h of [20, 24, 28, 32, 40, 48]) assert.ok(Number.isInteger(renderLabel({ media: 'image', human: 'text', minimal: true, height: h }).width));
});

test('height is a whole number of px', () => {
  assert.throws(() => renderLabel({ height: 32.5 }), /whole number of px/);
  assert.throws(() => renderLabel({ height: 'abc' }), /must be a number of px/);
  assert.doesNotThrow(() => renderLabel({ height: '32' }));
});

test('the SVG scales down in a narrow container instead of being clipped', () => {
  assert.match(renderLabel({ media: 'image' }).svg, /^<svg [^>]*style="max-width:100%;height:auto"/);
});

test('spaced capitals are never set below 10 px', () => {
  const scale = (px) => `scale(${round(px / font().unitsPerEm, 5)})`;
  assert.ok(renderLabel({ height: 24, uppercase: true, media: 'image' }).svg.includes(scale(10)));
  assert.ok(renderLabel({ height: 40, uppercase: true }).svg.includes(scale(40 * 0.34)));
});

test('any EU language with its own text; lang and the sentence follow it', () => {
  const de = renderLabel({ lang: 'de', text: 'Mit KI generiert', media: 'image' });
  assert.match(de.svg, /^<svg [^>]*lang="de" xml:lang="de"[^>]*aria-label="Mit KI generiert\."/);
  assert.equal(de.disclosure, 'Mit KI generiert.');
  assert.throws(() => renderLabel({ lang: 'de', media: 'image' }), /no built-in wording for "de"; pass --text/);
  assert.throws(() => renderLabel({ lang: 'de', text: 'Mit KI generiert', human: 'text' }), /pass --human-text/);
  assert.equal(renderLabel({ lang: 'de', text: 'Mit KI generiert', human: 'text', humanText: 'Von Menschen geschrieben' }).disclosure, 'Mit KI generiert. Von Menschen geschrieben.');
  assert.throws(() => renderLabel({ lang: 'xx', text: 'x' }), /24 EU codes/);
});

test('the result says whether the label meets WCAG text contrast', () => {
  assert.equal(renderLabel({}).wcag, true);
  assert.equal(renderLabel({ backgroundOpacity: 0.3, allowLowContrast: true }).wcag, false);
});

test('the SVG declares its language', () => {
  assert.match(renderLabel({}).svg, /^<svg [^>]*lang="en" xml:lang="en"/);
  assert.match(renderLabel({ lang: 'pl' }).svg, /^<svg [^>]*lang="pl" xml:lang="pl"/);
});

test('the hand is a filled glyph, centred in its disc at the same proportion at every height', () => {
  const { d, box } = handMark();
  for (let H = 20; H <= 64; H++) {
    const svg = renderLabel({ kind: 'human', minimal: true, height: H }).svg;
    const size = H * 0.75;
    const g = size * HAND_RATIO;
    const at = H * 0.125 + (size - g) / 2;
    assert.ok(svg.includes(`<g transform="translate(${round(at)} ${round(at)}) scale(${round(g / box, 5)})"><path fill="#ffffff" d="${d}"/></g>`), `H=${H}`);
    assert.doesNotMatch(svg, /NaN|stroke-width="[^"]*"[^>]*d="M10\.5/);
  }
  // The dark theme inverts it like the EU disc: white disc, #1d1d1b hand.
  assert.match(renderLabel({ kind: 'human', minimal: true, theme: 'dark' }).svg, /<circle [^>]*fill="#ffffff"\/><g [^>]*><path fill="#1d1d1b"/);
});

test('the skill folder carries the third-party notices, so a plain copy of it does too', () => {
  const skill = new URL('../skills/ai-content-labels/', import.meta.url);
  const icons = readFileSync(new URL('assets/icons/LICENSE.txt', skill), 'utf8');
  assert.match(icons, /ISC License/);
  assert.match(icons, /Copyright \(c\) 2026 Lucide Icons and Contributors/);
  assert.match(icons, /The MIT License \(MIT\)\s+Copyright \(c\) 2013-present Cole Bemis/);
  assert.match(icons, /hand-mark\.svg[\s\S]*Copyright \(c\) Tailwind Labs, Inc\./);
  const notice = readFileSync(new URL('NOTICE.md', skill), 'utf8');
  for (const f of ['assets/icons/LICENSE.txt', 'assets/font/OFL.txt']) assert.ok(notice.includes(f), f);
});
