#!/usr/bin/env node
// Renders the ready-made "Made by a human" labels in labels/human-made/: node tools/make-human-pack.mjs
// People label their own work by hand, so these files need no agent and no install.
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { renderLabel } from '../skills/ai-content-labels/scripts/lib/render.mjs';
import { MEDIA } from '../skills/ai-content-labels/scripts/lib/i18n.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const PACK_DIR = join(root, 'labels', 'human-made');
export const LANGS = ['en', 'pl'];
export const THEMES = ['light', 'dark'];
// SVG at the default label height (it scales); PNG at a web size and a print/social size.
export const SVG_HEIGHT = 32;
export const PNG_HEIGHTS = [48, 128];

// Every label in the pack: its folder, file name and the renderLabel options that draw it.
export function variants() {
  const list = [];
  for (const lang of LANGS) {
    for (const theme of THEMES) {
      const add = (name, opts) => list.push({ dir: join(lang, theme), name, opts: { kind: 'human', lang, theme, ...opts } });
      add('human-made', {});
      // Polish has one wording; English also has the compact "Human-made".
      if (lang === 'en') add('human-made-short', { short: true });
      for (const m of MEDIA) add(`human-made-${m}`, { media: m });
      add('human-made-mark', { minimal: true });
      for (const m of MEDIA) add(`human-made-mark-${m}`, { minimal: true, media: m });
    }
  }
  return list;
}

export const svgOf = (v) => renderLabel({ ...v.opts, height: SVG_HEIGHT }).svg + '\n';

async function main() {
  const sharp = createRequire(import.meta.url)('sharp');
  for (const lang of LANGS) rmSync(join(PACK_DIR, lang), { recursive: true, force: true });
  const all = variants();
  for (const v of all) {
    const dir = join(PACK_DIR, v.dir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${v.name}.svg`), svgOf(v));
    for (const h of PNG_HEIGHTS) {
      const { svg } = renderLabel({ ...v.opts, height: h });
      await sharp(Buffer.from(svg)).png().toFile(join(dir, `${v.name}-${h}.png`));
    }
  }

  // A preview of the main variants on light and dark backgrounds.
  const rows = [
    ['human-made', 'human-made-short', 'human-made-mark'],
    ['human-made-image', 'human-made-text', 'human-made-mark-image', 'human-made-mark-text'],
  ];
  const panels = [];
  for (const [p, theme] of THEMES.entries()) {
    for (const [l, lang] of LANGS.entries()) {
      let y = 24;
      for (const row of rows) {
        let x = 24;
        for (const name of row) {
          const v = all.find((a) => a.name === name && a.opts.lang === lang && a.opts.theme === theme);
          if (!v) continue;
          const { svg, width } = renderLabel({ ...v.opts, height: 40 });
          panels.push({ p, l, x, y, svg });
          x += width + 16;
        }
        y += 56;
      }
    }
  }
  const W = 1200;
  const H = 2 * 2 * 136;
  const bg = { light: '#f2f1ee', dark: '#26282b' };
  const base = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${THEMES.map((t, p) => `<rect y="${p * 272}" width="${W}" height="272" fill="${bg[t]}"/>`).join('')}</svg>`;
  await sharp(Buffer.from(base))
    .composite(panels.map((c) => ({ input: Buffer.from(c.svg), left: c.x, top: c.p * 272 + c.l * 136 + c.y })))
    .png()
    .toFile(join(PACK_DIR, 'preview.png'));
  console.log(`labels/human-made: ${all.length} labels, ${all.length * (1 + PNG_HEIGHTS.length)} files`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
