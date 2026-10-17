#!/usr/bin/env node
// Renders the README images in docs/ from the current renderer: node tools/make-docs.mjs
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { renderLabel } from '../skills/ai-content-labels/scripts/lib/render.mjs';
import { textPaths, measure } from '../skills/ai-content-labels/scripts/lib/text.mjs';
import { compactIcons } from '../skills/ai-content-labels/scripts/lib/assets.mjs';

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
    { kind: 'generated', media: 'image', mark: 'compact', height: 36 },
  ],
  { panelWidth: 480, rowHeight: 52 }
);

// Compact icons at 24 and 48 px, with their names.
{
  const names = ['image-ai', 'text-ai', 'audio-ai', 'video-ai', 'universal-ai'];
  const icons = compactIcons();
  const cell = 120;
  const height = 150;
  const parts = [];
  PANELS.forEach((panel, p) => {
    const ink = panel.theme === 'light' ? '#1d1d1b' : '#ffffff';
    const x0 = p * cell * names.length;
    parts.push(`<rect x="${x0}" width="${cell * names.length}" height="${height}" fill="${panel.background}"/>`);
    names.forEach((n, i) => {
      const cx = x0 + i * cell + cell / 2;
      const draw = (size, y) =>
        `<g transform="translate(${cx - size / 2} ${y}) scale(${size / 24})" fill="none" stroke="${ink}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icons[n]}</g>`;
      parts.push(draw(48, 18), draw(24, 80));
      parts.push(textPaths(n, { x: cx - measure(n, 12) / 2, baseline: 132, size: 12, fill: ink }));
    });
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cell * names.length * 2}" height="${height}">${parts.join('')}</svg>`;
  await sharp(Buffer.from(svg), { density: 72 * SCALE }).png().toFile(join(docs, 'compact-icons.png'));
  console.log('docs/compact-icons.png');
}
