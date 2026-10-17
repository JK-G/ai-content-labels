#!/usr/bin/env node
// Builds the runtime assets under skills/ai-content-labels/assets from the upstream sources:
//   node tools/build-assets.mjs --inter <Inter-SemiBold.ttf> --eu <dir with the EU SVGs> --lucide <lucide-static icons dir>
//     [--heroicons <heroicons package dir>]
// The runtime never needs these sources or opentype.js: it reads the JSON this script writes.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';
const { parse } = opentype;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const assets = join(root, 'skills', 'ai-content-labels', 'assets');

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, a, i, all) => (a.startsWith('--') ? [...pairs, [a.slice(2), all[i + 1]]] : pairs), [])
);
for (const k of ['inter', 'eu', 'lucide']) {
  if (!args[k]) throw new Error(`missing --${k}`);
}

// ---------- Font: Inter SemiBold glyph outlines, advances and kerning ----------

// Every official EU language: Latin with diacritics, Greek, Cyrillic, plus common punctuation.
const ranges = [
  [0x20, 0x7e], [0xa0, 0xff], [0x100, 0x17f], [0x218, 0x21b],
  [0x386, 0x3ce], [0x400, 0x45f],
  [0x2010, 0x2014], [0x2018, 0x201e], [0x2022, 0x2022], [0x2026, 0x2026], [0x20ac, 0x20ac],
];
const chars = [];
for (const [a, b] of ranges) for (let c = a; c <= b; c++) chars.push(String.fromCodePoint(c));

const font = parse(readFileSync(args.inter).buffer);
const upm = font.unitsPerEm;
const glyphs = {};
const glyphOf = {};
for (const ch of chars) {
  const g = font.charToGlyph(ch);
  if (!g || g.index === 0) continue;
  glyphOf[ch] = g;
  const d = g.getPath(0, 0, upm).toPathData({ decimalPlaces: 0, flipY: false });
  glyphs[ch] = d ? [g.advanceWidth, d] : [g.advanceWidth];
}

// Kerning only between letters and the punctuation that sits next to them in labels.
const kernChars = Object.keys(glyphOf).filter((c) => /[\p{L}.,:;'’"“”«»()-]/u.test(c));
const kern = {};
let pairs = 0;
for (const l of kernChars) {
  for (const r of kernChars) {
    const v = font.getKerningValue(glyphOf[l], glyphOf[r]);
    if (v) {
      (kern[l] ??= {})[r] = v;
      pairs++;
    }
  }
}

const os2 = font.tables.os2;
const fontJson = {
  name: 'Inter SemiBold 4.1',
  license: 'SIL Open Font License 1.1, see assets/font/OFL.txt',
  unitsPerEm: upm,
  ascender: font.ascender,
  descender: font.descender,
  capHeight: os2.sCapHeight,
  xHeight: os2.sxHeight,
  glyphs,
  kern,
};
mkdirSync(join(assets, 'font'), { recursive: true });
writeFileSync(join(assets, 'font', 'inter-semibold.json'), JSON.stringify(fontJson));
copyFileSync(join(dirname(args.inter), '..', '..', 'LICENSE.txt'), join(assets, 'font', 'OFL.txt'));
console.log(`font: ${Object.keys(glyphs).length} glyphs, ${pairs} kerning pairs`);

// ---------- EU icons: official files, unmodified, under plain names ----------

const euNames = {
  'LABEL_AI_black.svg': 'ai-black.svg',
  'LABEL_AI_white.svg': 'ai-white.svg',
  'LABEL_AI_black transparent.svg': 'ai-black-transparent.svg',
  'LABEL_AI_white transparent.svg': 'ai-white-transparent.svg',
  'LABEL_AI GENERATED_black.svg': 'ai-generated-black.svg',
  'LABEL_AI GENERATED_white.svg': 'ai-generated-white.svg',
  'LABEL_AI GENERATED_black transparent.svg': 'ai-generated-black-transparent.svg',
  'LABEL_AI GENERATED_white transparent.svg': 'ai-generated-white-transparent.svg',
  'LABEL_AI MODIFIED_black.svg': 'ai-modified-black.svg',
  'LABEL_AI MODIFIED_white.svg': 'ai-modified-white.svg',
  'LABEL_AI MODIFIED_black transparent.svg': 'ai-modified-black-transparent.svg',
  'LABEL_AI MODIFIED_white transparent.svg': 'ai-modified-white-transparent.svg',
};
mkdirSync(join(assets, 'eu'), { recursive: true });
const found = readdirSync(args.eu);
for (const [from, to] of Object.entries(euNames)) {
  if (!found.includes(from)) throw new Error(`EU icon not found: ${from}`);
  copyFileSync(join(args.eu, from), join(assets, 'eu', to));
}

// The basic icon's geometry, for drawing it inside a label. Same paths, cropped to the circle.
const basic = readFileSync(join(args.eu, 'LABEL_AI_black.svg'), 'utf8');
const ds = [...basic.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((m) => m[1]);
if (ds.length !== 3) throw new Error(`expected 3 paths in the basic EU icon, found ${ds.length}`);
const euJson = {
  source: 'European Commission, EU icons for labelling AI-generated content (10 June 2026)',
  url: 'https://digital-strategy.ec.europa.eu/en/policies/eu-icons-labelling-ai-generated-content',
  // Circle centre (272.03, 283.47), radius 182.745: the viewBox below is its bounding box.
  viewBox: [89.28, 100.72, 365.49, 365.49],
  circle: ds[0],
  letters: ds.slice(1),
  colors: { dark: '#1d1d1b', light: '#ffffff' },
};
writeFileSync(join(assets, 'eu', 'basic.json'), JSON.stringify(euJson, null, 2) + '\n');
console.log(`eu: ${Object.keys(euNames).length} official files, basic geometry extracted`);

// ---------- Media icons: Lucide glyphs for the content types ----------

const media = {
  image: 'image',
  text: 'type',
  audio: 'volume-2',
  voice: 'mic',
  music: 'music',
  video: 'square-play',
};
const mediaJson = {
  source: 'Lucide 1.59.0 (ISC), https://lucide.dev',
  viewBox: [0, 0, 24, 24],
  icons: {},
};
mkdirSync(join(assets, 'icons', 'media'), { recursive: true });
for (const [key, name] of Object.entries(media)) {
  const svg = readFileSync(join(args.lucide, `${name}.svg`), 'utf8');
  const inner = svg
    .slice(svg.indexOf('>', svg.indexOf('<svg')) + 1, svg.lastIndexOf('</svg>'))
    .replace(/\s*\n\s*/g, '')
    .trim();
  mediaJson.icons[key] = inner;
  writeFileSync(
    join(assets, 'icons', 'media', `${key}.svg`),
    `<!-- From Lucide "${name}" (ISC), https://lucide.dev -->\n` +
      `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>\n`
  );
}
writeFileSync(join(assets, 'icons', 'media.json'), JSON.stringify(mediaJson, null, 2) + '\n');
console.log(`media: ${Object.keys(media).join(', ')}`);

// ---------- The hand of the human-made mark: Heroicons "hand-raised", 24 solid ----------

if (args.heroicons) {
  const hand = readFileSync(join(args.heroicons, '24', 'solid', 'hand-raised.svg'), 'utf8').trim();
  writeFileSync(join(assets, 'icons', 'hand-mark.svg'), `<!-- From Heroicons "hand-raised", 24 solid (MIT), https://heroicons.com -->\n${hand}\n`);
  console.log('hand: Heroicons hand-raised (solid)');
}
