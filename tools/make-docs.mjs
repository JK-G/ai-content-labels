#!/usr/bin/env node
// Renders the README images in docs/ from the current renderer: node tools/make-docs.mjs
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { renderLabel } from '../skills/ai-content-labels/scripts/lib/render.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sharp = createRequire(import.meta.url)('sharp');
const docs = join(root, 'docs');
mkdirSync(docs, { recursive: true });

const SCALE = 2;
const PANELS = [
  { theme: 'light', background: '#f2f1ee' },
  { theme: 'dark', background: '#26282b' },
];

async function sheet(file, rows, { panelWidth, rowHeight, pad = 24 }) {
  const height = pad * 2 + rows.length * rowHeight;
  const parts = [];
  PANELS.forEach((panel, p) => {
    const x0 = p * panelWidth;
    parts.push(`<rect x="${x0}" width="${panelWidth}" height="${height}" fill="${panel.background}"/>`);
    rows.forEach((row, i) => {
      const label = renderLabel({ ...row, theme: panel.theme, density: SCALE });
      const y = pad + i * rowHeight + (rowHeight - label.height) / 2;
      parts.push(`<svg x="${x0 + pad}" y="${y}" width="${label.width}" height="${label.height}">${label.svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')}</svg>`);
    });
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${panelWidth * 2}" height="${height}">${parts.join('')}</svg>`;
  await sharp(Buffer.from(svg), { density: 72 * SCALE }).png().toFile(join(docs, file));
  console.log(`docs/${file}`);
}

await sheet(
  'labels.png',
  [
    { kind: 'generated', media: 'image', height: 36 },
    { kind: 'modified', media: 'image,voice', height: 36 },
    { kind: 'basic', text: 'Voice generated with AI', height: 36 },
    { kind: 'generated', media: 'image', human: 'text', short: true, height: 36 },
    { kind: 'human', media: 'text,image', height: 36 },
    { kind: 'generated', media: 'image,video', lang: 'pl', height: 36 },
    { kind: 'generated', media: 'image', short: true, uppercase: true, height: 36 },
  ],
  { panelWidth: 480, rowHeight: 52 }
);

await sheet(
  'minimal.png',
  [
    { media: 'image', minimal: true, height: 36 },
    { media: 'image,voice', minimal: true, height: 36 },
    { media: 'image', human: 'text', minimal: true, height: 36 },
    { kind: 'human', media: 'text,image', minimal: true, height: 36 },
  ],
  { panelWidth: 240, rowHeight: 52 }
);

// Small sizes, where the minimal form lives: each label at 1x (enlarged pixel for pixel, so the
// grid shows) next to the same label rendered at 4x.
async function smallSheet(file, heights, { pad = 24, zoom = 4 } = {}) {
  const tiles = [];
  for (const [p, panel] of PANELS.entries()) {
    for (const h of heights) {
      // Each rendering gets the label drawn for its pixel density, as render --scale does.
      const draw = (density) => renderLabel({ media: 'image', human: 'text', minimal: true, height: h, theme: panel.theme, density });
      const label = draw(1);
      const flat = (svg, density) => sharp(Buffer.from(svg), { density }).flatten({ background: panel.background });
      const crisp = await flat(label.svg, 72).png().toBuffer();
      const actual = await sharp(crisp).resize({ width: label.width * zoom, kernel: 'nearest' }).png().toBuffer();
      const sharp4 = await flat(draw(zoom).svg, 72 * zoom).png().toBuffer();
      tiles.push({ p, h, w: label.width * zoom, ht: label.height * zoom, actual, sharp4 });
    }
  }
  const colW = Math.max(...tiles.map((t) => t.w));
  const panelW = pad * 3 + colW * 2;
  const rowH = Math.max(...tiles.map((t) => t.ht)) + pad;
  const height = pad + heights.length * rowH;
  const composite = [];
  const bg = PANELS.map((panel, p) => `<rect x="${p * panelW}" width="${panelW}" height="${height}" fill="${panel.background}"/>`).join('');
  for (const t of tiles) {
    const i = heights.indexOf(t.h);
    const top = pad + i * rowH + Math.round((rowH - pad - t.ht) / 2);
    composite.push({ input: t.actual, left: t.p * panelW + pad, top }, { input: t.sharp4, left: t.p * panelW + pad * 2 + colW, top });
  }
  await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${panelW * 2}" height="${height}">${bg}</svg>`))
    .composite(composite)
    .png()
    .toFile(join(docs, file));
  console.log(`docs/${file}`);
}

await smallSheet('small.png', [20, 24, 28, 32, 40]);
