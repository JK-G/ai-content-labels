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
      const label = renderLabel({ ...row, theme: panel.theme });
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
