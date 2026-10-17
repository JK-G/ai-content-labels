import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ASSETS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets');

const cache = new Map();
function load(key, read) {
  if (!cache.has(key)) cache.set(key, read());
  return cache.get(key);
}

const json = (...parts) => JSON.parse(readFileSync(join(ASSETS_DIR, ...parts), 'utf8'));

export const font = () => load('font', () => json('font', 'inter-semibold.json'));
export const euBasic = () => load('eu', () => json('eu', 'basic.json'));
export const mediaIcons = () => load('media', () => json('icons', 'media.json'));

// Compact icons are plain SVG files; keep only the drawing inside the root element.
export const compactIcons = () =>
  load('compact', () => {
    const dir = join(ASSETS_DIR, 'icons', 'compact');
    const icons = {};
    if (!existsSync(dir)) return icons;
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.svg'))) {
      const svg = readFileSync(join(dir, file), 'utf8');
      const start = svg.indexOf('>', svg.indexOf('<svg')) + 1;
      icons[file.replace(/\.svg$/, '')] = svg.slice(start, svg.lastIndexOf('</svg>')).replace(/\s*\n\s*/g, '').trim();
    }
    return icons;
  });

export const euFile = (name) => join(ASSETS_DIR, 'eu', `${name}.svg`);
