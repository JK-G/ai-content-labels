import { font } from './assets.mjs';

// Lays out one line of text with the bundled Inter SemiBold outlines, so a label looks the same
// in every browser and rasteriser and needs no installed font.

export function missingGlyphs(text) {
  const { glyphs } = font();
  return [...new Set([...text].filter((ch) => !glyphs[ch]))];
}

// Width in px of `text` at `size` px, with `tracking` in em.
export function measure(text, size, tracking = 0) {
  const f = font();
  const chars = [...text];
  let units = 0;
  chars.forEach((ch, i) => {
    units += f.glyphs[ch][0];
    if (i < chars.length - 1) units += f.kern[ch]?.[chars[i + 1]] ?? 0;
  });
  return (units / f.unitsPerEm) * size + tracking * size * Math.max(chars.length - 1, 0);
}

// SVG group with the text drawn as paths; (x, baseline) is the start of the baseline.
export function textPaths(text, { x, baseline, size, fill, tracking = 0 }) {
  const f = font();
  const scale = size / f.unitsPerEm;
  const trackUnits = tracking * f.unitsPerEm;
  const chars = [...text];
  let pen = 0;
  const parts = [];
  chars.forEach((ch, i) => {
    const [advance, d] = f.glyphs[ch];
    if (d) parts.push(pen ? `<path transform="translate(${round(pen)} 0)" d="${d}"/>` : `<path d="${d}"/>`);
    pen += advance + trackUnits;
    if (i < chars.length - 1) pen += f.kern[ch]?.[chars[i + 1]] ?? 0;
  });
  return `<g fill="${fill}" transform="translate(${round(x)} ${round(baseline)}) scale(${round(scale, 5)})">${parts.join('')}</g>`;
}

// Cap height in px at `size` px, used to centre text vertically.
export const capHeight = (size) => (font().capHeight / font().unitsPerEm) * size;

export function round(n, digits = 2) {
  const p = 10 ** digits;
  return Math.round(n * p) / p;
}
