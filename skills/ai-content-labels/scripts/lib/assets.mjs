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

export const euFile = (name) => join(ASSETS_DIR, 'eu', `${name}.svg`);
