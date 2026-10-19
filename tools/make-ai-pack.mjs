#!/usr/bin/env node
// Renders the ready-made AI labels in labels/ai-generated/: node tools/make-ai-pack.mjs
// For people who place a label by hand where the AI Act requires one, or where they choose to label.
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { renderLabel } from '../skills/ai-content-labels/scripts/lib/render.mjs';
import { MEDIA } from '../skills/ai-content-labels/scripts/lib/i18n.mjs';
import { LANGS, THEMES, SVG_HEIGHT, PNG_HEIGHTS } from './make-human-pack.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const PACK_DIR = join(root, 'labels', 'ai-generated');
export { LANGS, THEMES, PNG_HEIGHTS };

// Every label in the pack: its folder, file name and the renderLabel options that draw it.
// Without text, generated, modified and basic look the same, so the EU icon alone and the minimal
// pill come once, as the basic label ("Made with AI"); the words come per kind.
export function variants() {
  const list = [];
  for (const lang of LANGS) {
    for (const theme of THEMES) {
      const add = (name, opts) => list.push({ dir: join(lang, theme), name, opts: { lang, theme, ...opts } });
      add('ai-icon', { kind: 'basic', icon: true });
      for (const m of MEDIA) add(`ai-mark-${m}`, { kind: 'basic', minimal: true, media: m });
      for (const kind of ['generated', 'modified', 'basic']) {
        add(`ai-${kind}`, { kind, full: true });
        // "Made with AI" has no shorter wording.
        if (kind !== 'basic') add(`ai-${kind}-short`, { kind, short: true });
        for (const m of MEDIA) add(`ai-${kind}-${m}`, { kind, full: true, media: m });
      }
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

  // A preview of the main variants on light and dark backgrounds, English and Polish.
  const rows = [
    ['ai-icon', 'ai-mark-image', 'ai-generated-short', 'ai-modified-short'],
    ['ai-generated', 'ai-modified', 'ai-basic'],
    ['ai-generated-image', 'ai-modified-voice', 'ai-basic-text'],
  ];
  const ROW = 56;
  const block = 24 + rows.length * ROW;
  const panels = [];
  for (const [p, theme] of THEMES.entries()) {
    for (const [l, lang] of LANGS.entries()) {
      let y = 24;
      for (const row of rows) {
        let x = 24;
        for (const name of row) {
          const v = all.find((a) => a.name === name && a.opts.lang === lang && a.opts.theme === theme);
          const { svg, width } = renderLabel({ ...v.opts, height: 40 });
          panels.push({ top: (p * LANGS.length + l) * block + y, left: x, svg });
          x += width + 16;
        }
        y += ROW;
      }
    }
  }
  const W = 1200;
  const panel = LANGS.length * block;
  const bg = { light: '#f2f1ee', dark: '#26282b' };
  const base = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${THEMES.length * panel}">${THEMES.map((t, p) => `<rect y="${p * panel}" width="${W}" height="${panel}" fill="${bg[t]}"/>`).join('')}</svg>`;
  await sharp(Buffer.from(base))
    .composite(panels.map((c) => ({ input: Buffer.from(c.svg), left: c.left, top: c.top })))
    .png()
    .toFile(join(PACK_DIR, 'preview.png'));
  console.log(`labels/ai-generated: ${all.length} labels, ${all.length * (1 + PNG_HEIGHTS.length)} files`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
