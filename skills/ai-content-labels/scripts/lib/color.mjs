import { parseHex, contrastRatio, WCAG } from './contrast.mjs';
import { UsageError } from './i18n.mjs';

// Label colours other than the neutral white and dark pills: a colour the user gives, or the accent
// colour of the image (--color auto). The pill is opaque, so the text contrast is exact; the ink is
// white or near black, whichever keeps 4.5:1. OKLCH keeps the hue while the lightness changes.

const DARK_INK = '#1d1d1b';

export function parseColor(value) {
  if (value == null || value === '') return null;
  const v = String(value).trim().toLowerCase();
  if (v === 'auto') return 'auto';
  const m = v.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (!m) throw new UsageError(`--color takes auto or a hex colour such as #1f7a52, not "${value}"`);
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return `#${h}`;
}

// The pill for a background colour: white text when it reaches 4.5:1 (as on most brand buttons),
// otherwise the dark ink, or black for the few mid tones where only black does. The EU disc is the
// official white one on dark pills and the black one on light pills.
export function colorTheme(hex) {
  const bg = parseHex(hex);
  const ink = ['#ffffff', DARK_INK, '#000000'].find((c) => contrastRatio(parseHex(c), bg) >= WCAG.text);
  const light = ink === '#ffffff';
  return { background: hex, backgroundOpacity: 1, ink, border: ink, borderOpacity: light ? 0.2 : 0.14, eu: light ? 'white' : 'black' };
}

const toLinear = (c) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const toGamma = (l) => 255 * (l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055);

export function rgbToOklch(rgb) {
  const [r, g, b] = rgb.map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360];
}

function oklchToLinear([L, C, h]) {
  const A = C * Math.cos((h * Math.PI) / 180);
  const B = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}

// The colour in sRGB, with its chroma lowered until it fits the sRGB gamut.
export function oklchToRgb([L, C, h]) {
  const inGamut = (c) => oklchToLinear([L, c, h]).every((v) => v >= -1e-6 && v <= 1 + 1e-6);
  let c = C;
  if (!inGamut(c)) {
    let [lo, hi] = [0, C];
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(mid)) lo = mid;
      else hi = mid;
    }
    c = lo;
  }
  return oklchToLinear([L, c, h]).map((v) => Math.round(toGamma(Math.min(1, Math.max(0, v)))));
}

export const toHex = (rgb) => `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`;

// The accent colour of an image (RGB pixels, `channels` per pixel): the hue that carries the most
// colour among clearly coloured pixels, averaged in OKLab with more weight on stronger colours, so a
// brand green wins over a pale mint background. null when under 2% of the image is clearly coloured.
export function accentColor(data, channels) {
  const count = Math.floor(data.length / channels);
  const hist = new Float64Array(36);
  const coloured = [];
  for (let i = 0; i < count; i++) {
    const [L, C, h] = rgbToOklch([data[i * channels], data[i * channels + 1], data[i * channels + 2]]);
    if (C < 0.06 || L < 0.2 || L > 0.97) continue;
    hist[Math.floor(h / 10) % 36] += C;
    coloured.push([L, C, h]);
  }
  if (!count || coloured.length < 0.02 * count) return null;
  let peak = 0;
  let best = -1;
  for (let i = 0; i < 36; i++) {
    const v = 2 * hist[i] + hist[(i + 35) % 36] + hist[(i + 1) % 36];
    if (v > best) [best, peak] = [v, i];
  }
  const centre = peak * 10 + 5;
  let [sL, sA, sB, w] = [0, 0, 0, 0];
  for (const [L, C, h] of coloured) {
    if (Math.abs(((h - centre + 540) % 360) - 180) > 20) continue;
    const rad = (h * Math.PI) / 180;
    sL += L * C;
    sA += C * Math.cos(rad) * C;
    sB += C * Math.sin(rad) * C;
    w += C;
  }
  if (!w) return null;
  const [A, B] = [sA / w, sB / w];
  const oklch = [sL / w, Math.hypot(A, B), ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360];
  return { oklch, hex: toHex(oklchToRgb(oklch)) };
}

// A little over 4.5:1, so rounding to whole sRGB values never drops a tone below it.
const TARGET = 4.6;

// Two pill colours in the accent's hue, each as close to the accent as 4.5:1 allows: a dark one
// for white text and a light one for dark text.
export function accentTones([L, C, h]) {
  const tone = (l) => toHex(oklchToRgb([l, C, h]));
  const passes = (l, ink) => contrastRatio(parseHex(ink), parseHex(tone(l))) >= TARGET;
  // The largest lightness at or below the accent's that keeps white text at 4.6:1, and the
  // smallest at or above it that keeps the dark ink there.
  const search = (from, to, ink) => {
    if (passes(from, ink)) return from;
    let [bad, good] = [from, to];
    for (let i = 0; i < 24; i++) {
      const mid = (bad + good) / 2;
      if (passes(mid, ink)) good = mid;
      else bad = mid;
    }
    return good;
  };
  return { dark: tone(search(L, 0, '#ffffff')), light: tone(search(L, 1, DARK_INK)) };
}
