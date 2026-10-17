import { readFileSync } from 'node:fs';
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
// The filled hand of the human-made mark: its path and the side of its square viewBox.
export const handMark = () =>
  load('hand', () => {
    const svg = readFileSync(join(ASSETS_DIR, 'icons', 'hand-mark.svg'), 'utf8');
    return { box: Number(svg.match(/viewBox="0 0 (\d+)/)[1]), d: svg.match(/ d="([^"]+)"/)[1] };
  });

export const euFile = (name) => join(ASSETS_DIR, 'eu', `${name}.svg`);
