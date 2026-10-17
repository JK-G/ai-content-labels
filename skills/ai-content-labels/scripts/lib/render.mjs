import { readFileSync, existsSync } from 'node:fs';
import { euBasic, mediaIcons, euFile } from './assets.mjs';
import { textPaths, measure, capHeight, missingGlyphs, round } from './text.mjs';
import { worstCaseContrast, WCAG } from './contrast.mjs';
import { strings, sentence, parseBoolean, hasWording, noWording, KINDS, MEDIA, UsageError } from './i18n.mjs';

export const THEMES = {
  light: { background: '#ffffff', backgroundOpacity: 0.94, ink: '#1d1d1b', border: '#1d1d1b', borderOpacity: 0.14, eu: 'black' },
  dark: { background: '#1d1d1b', backgroundOpacity: 0.9, ink: '#ffffff', border: '#ffffff', borderOpacity: 0.2, eu: 'white' },
};

// Colours of the official basic icon: the black file has a black disc with white letters,
// the white file a white disc with #1d1d1b letters.
export const EU_COLORS = { black: ['#000000', '#ffffff'], white: ['#ffffff', '#1d1d1b'] };

export const POSITIONS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

const toList = (v) => (v == null || v === '' ? [] : Array.isArray(v) ? v : String(v).split(',')).map((s) => String(s).trim()).filter(Boolean);

// Trimmed and NFC-normalised, so "é" typed as e + combining accent (macOS paste) finds its glyph.
const clean = (v) => (v == null ? undefined : String(v).normalize('NFC').trim());
const bool = (input, key, name) => parseBoolean(input[key], name) ?? false;

export function normalize(input = {}) {
  const height = Number(input.height ?? 32);
  if (Number.isNaN(height)) throw new UsageError('--height must be a number of px');
  if (!Number.isInteger(height)) throw new UsageError('--height must be a whole number of px (half pixels blur the label)');
  const o = {
    kind: input.kind ?? 'generated',
    media: [...new Set(toList(input.media))],
    human: [...new Set(toList(input.human))],
    lang: input.lang ?? 'en',
    text: clean(input.text),
    humanText: clean(input.humanText),
    description: clean(input.description) || undefined,
    short: bool(input, 'short', '--short'),
    uppercase: bool(input, 'uppercase', '--uppercase'),
    theme: input.theme ?? 'light',
    height,
    minimal: bool(input, 'minimal', '--minimal'),
    backgroundOpacity: input.backgroundOpacity == null ? undefined : Number(input.backgroundOpacity),
    allowLowContrast: bool(input, 'allowLowContrast', '--allow-low-contrast'),
    metadata: parseBoolean(input.metadata, '--metadata') ?? true,
    force: bool(input, 'force', '--force'),
    // Output pixels per SVG unit (a PNG at --scale 3 has 3): internal, for hinting the hand.
    density: Number(input.density ?? 1),
  };
  if (o.text === '') throw new UsageError('--text is empty');
  if (o.humanText === '') throw new UsageError('--human-text is empty');
  if (!KINDS.includes(o.kind)) throw new UsageError(`unknown kind "${o.kind}"; use one of: ${KINDS.join(', ')}`);
  for (const m of [...o.media, ...o.human]) {
    if (!MEDIA.includes(m)) throw new UsageError(`unknown media type "${m}"; use any of: ${MEDIA.join(', ')}`);
  }
  if (o.kind === 'human' && o.human.length) throw new UsageError('--human adds a human-made part to an AI label; with --kind human list the types in --media');
  const both = o.media.filter((m) => o.human.includes(m));
  if (both.length) throw new UsageError(`${both.join(', ')} is in both --media and --human; a part is either AI or human-made`);
  if (!THEMES[o.theme]) throw new UsageError(`unknown theme "${o.theme}"; use light or dark`);
  // Text below 24 px tall is set at 6-8 px and nobody reads it; the minimal form has no text.
  const min = o.minimal ? 20 : 24;
  if (!(o.height >= min && o.height <= 512)) {
    throw new UsageError(o.minimal ? 'height must be between 20 and 512 px' : 'a label with text must be at least 24 px tall (up to 512); use --minimal for smaller spots');
  }
  if (o.backgroundOpacity != null && !(o.backgroundOpacity >= 0 && o.backgroundOpacity <= 1)) {
    throw new UsageError('background opacity must be between 0 and 1');
  }
  strings(o.lang);
  // An EU language without built-in wording: the label text comes from the user, in that language.
  if (!hasWording(o.lang)) {
    if (o.text == null) throw new UsageError(noWording(o.lang));
    if (o.kind !== 'human' && o.human.length && o.humanText == null) throw new UsageError(noWording(o.lang, '--human-text'));
  }
  return o;
}

// Renders a label. Returns the SVG, its size, the sentence for alt text, and the contrast it guarantees.
export function renderLabel(input) {
  const o = normalize(input);
  const theme = { ...THEMES[o.theme], ...(o.backgroundOpacity != null && { backgroundOpacity: o.backgroundOpacity }) };
  const contrast = worstCaseContrast(theme);
  if (contrast < WCAG.text && !o.allowLowContrast) {
    throw new UsageError(
      `background opacity ${theme.backgroundOpacity} gives a text contrast of ${contrast.toFixed(2)}:1 on the worst backdrop; WCAG needs ${WCAG.text}:1`
    );
  }

  const s = strings(o.lang);
  const H = o.height;
  const pills = [];
  const pick = (kind) => (o.short ? s[kind].short : s[kind].label);
  pills.push(pill({ kind: o.kind, text: o.text ?? pick(o.kind), media: o.media, o, theme }));
  if (o.kind !== 'human' && o.human.length) {
    pills.push(pill({ kind: 'human', text: o.humanText ?? pick('human'), media: o.human, o, theme }));
  }

  // Whole-pixel widths and gaps, so every pill starts on a pixel edge.
  const gap = Math.round(H * 0.25);
  const width = pills.reduce((w, p) => w + p.width, 0) + gap * (pills.length - 1);
  let x = 0;
  const body = pills
    .map((p) => {
      const markup = p.draw(x);
      x += p.width + gap;
      return markup;
    })
    .join('');

  const disclosure = labelSentence(o);
  const W = width;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="max-width:100%;height:auto" lang="${o.lang}" xml:lang="${o.lang}" role="img" aria-label="${xml(disclosure)}">` +
    `<title>${xml(disclosure)}</title>${body}</svg>`;
  return { svg, width: W, height: H, alt: composeAlt(o), disclosure, contrast: round(contrast, 2), wcag: contrast >= WCAG.text, options: o };
}

// The label as one sentence for screen readers: "Generated with AI: image. Made by a human: text."
export function labelSentence(o) {
  return [
    sentence({ kind: o.kind, media: o.media, text: o.text, lang: o.lang }),
    ...(o.kind !== 'human' && o.human.length ? [sentence({ kind: 'human', media: o.human, text: o.humanText, lang: o.lang })] : []),
  ].join(' ');
}

// The alt text of the labelled content: what it shows, then the label sentence. Without a
// description there is no alt text: the sentence alone is the alt of the label, not of the image.
export function composeAlt(o) {
  if (!o.description) return null;
  const d = o.description.replace(/\s+$/, '');
  const sep = /[.!?…]$/.test(d) ? ' ' : '. ';
  return d + sep + labelSentence(o);
}

// What a result says instead of an alt text when no description was passed.
export const ALT_MISSING = 'pass description (what the image shows) to get the alt text: description + disclosure';

// The hint, only where there is a picture to describe: a label with image or video in it, or one
// that names no media at all. A text or audio label gets none, so nobody invents an image for it.
export function altMissing(o, alt) {
  const parts = [...o.media, ...o.human];
  const visual = !parts.length || parts.includes('image') || parts.includes('video');
  return alt == null && visual ? { altMissing: ALT_MISSING } : {};
}

// One pill: the author mark (EU "AI" disc, or a hand in the same disc), the text unless minimal, then the media icons.
function pill({ kind, text, media, o, theme }) {
  const H = o.height;
  const shown = o.minimal ? '' : o.uppercase ? text.toLocaleUpperCase(o.lang) : text;
  const missing = missingGlyphs(shown);
  if (missing.length) throw new UsageError(`the bundled font has no glyph for: ${missing.join(' ')}`);

  const inset = H * 0.125;
  const markBox = H - 2 * inset;
  // Slightly larger type on the smallest labels, where 0.4H would drop under 10 px.
  // Spaced capitals never below 10 px, so a 24 px upper-case label stays legible.
  const fontSize = o.uppercase ? Math.max(10, H < 28 ? H * 0.37 : H * 0.34) : H < 28 ? H * 0.44 : H * 0.4;
  const tracking = o.uppercase ? 0.06 : 0;
  const iconSize = H * 0.5;
  const iconGap = H * 0.14;

  const mark = kind === 'human' ? (x) => handDisc(x + inset, inset, markBox, theme.eu, o.density) : (x) => euDisc(x + inset, inset, markBox, theme.eu);

  // Without text the divider sits closer to the mark; without text or icons the pill is a circle.
  let width = inset + markBox;
  const textX = width + H * 0.26;
  if (shown) width = textX + measure(shown, fontSize, tracking);
  let dividerX;
  const iconXs = [];
  if (media.length) {
    const gap = shown ? H * 0.28 : H * 0.24;
    dividerX = width + gap;
    width = dividerX + gap;
    for (const _ of media) {
      iconXs.push(width);
      width += iconSize + iconGap;
    }
    width += H * 0.3 - iconGap;
  } else {
    width = shown ? width + H * 0.4 : H;
  }
  width = Math.round(width);

  const bw = Math.max(1, H / 32);
  const iconY = Math.round((H - iconSize) / 2);
  // Content-type strokes never thinner than 1.15 rendered px.
  const iconStroke = Math.max(2, (1.15 * 24) / iconSize);
  const draw = (x0) => {
    const parts = [
      `<rect x="${round(x0 + bw / 2)}" y="${round(bw / 2)}" width="${round(width - bw)}" height="${round(H - bw)}" rx="${round((H - bw) / 2)}" ` +
        `fill="${theme.background}" fill-opacity="${theme.backgroundOpacity}" stroke="${theme.border}" stroke-opacity="${theme.borderOpacity}" stroke-width="${round(bw)}"/>`,
      mark(x0),
    ];
    if (shown) parts.push(textPaths(shown, { x: x0 + textX, baseline: H / 2 + capHeight(fontSize) / 2, size: fontSize, fill: theme.ink, tracking }));
    if (dividerX != null) {
      // On a half pixel, so a 1 px divider fills one pixel column instead of greying two.
      const dx = Math.floor(x0 + dividerX) + 0.5;
      parts.push(
        `<line x1="${dx}" y1="${Math.round(H * 0.28)}" x2="${dx}" y2="${Math.round(H * 0.72)}" ` +
          `stroke="${theme.ink}" stroke-opacity="0.35" stroke-width="${round(bw)}" stroke-linecap="round"/>`
      );
      media.forEach((m, i) => parts.push(icon(mediaIcons().icons[m], Math.round(x0 + iconXs[i]), iconY, iconSize, theme.ink, iconStroke)));
    }
    return parts.join('');
  };
  return { width, draw };
}

// The official basic EU icon, scaled into a square of `size` px at (x, y).
export function euDisc(x, y, size, variant) {
  const eu = euBasic();
  const [vx, vy, vw] = eu.viewBox;
  const [disc, letters] = EU_COLORS[variant];
  return (
    `<g transform="translate(${round(x)} ${round(y)}) scale(${round(size / vw, 5)}) translate(${-vx} ${-vy})">` +
    `<path fill="${disc}" d="${eu.circle}"/>${eu.letters.map((d) => `<path fill="${letters}" d="${d}"/>`).join('')}</g>`
  );
}

// The human-made counterpart of the EU disc: the same disc and colours, a hand instead of "AI".
// The hand is 0.64 of the disc at every size, so it keeps the weight of the "AI" letters next to it.
export const HAND_RATIO = 0.64;
// The stroke in hand units (24×24 box): heavier than the content-type icons, to match the bold "AI".
export const HAND_STROKE = 2.75;
// Lucide's hand is an outline: its fingers are bounded by vertical strokes at these x positions.
const STEMS = [6, 10, 14, 18, 22];

// `density` is the pixels per SVG unit of the output (2 for a PNG at --scale 2); hinting needs it.
export function handDisc(x, y, size, variant, density = 1) {
  const [disc, hand] = EU_COLORS[variant];
  const circle = `<circle cx="${round(x + size / 2)}" cy="${round(y + size / 2)}" r="${round(size / 2)}" fill="${disc}"/>`;
  const g = handGeometry(x, y, size, density);
  if (!g.grid) return circle + icon(mediaIcons().icons.human, g.x, g.y, g.size, hand, HAND_STROKE);
  // Hinted: the paths are redrawn in pixel coordinates, each finger stroke on whole pixels.
  const paths = [...mediaIcons().icons.human.matchAll(/d="([^"]+)"/g)].map((m) => `<path d="${mapPath(m[1], g.fx, g.fy, g.s)}"/>`).join('');
  return (
    circle +
    `<g fill="none" stroke="${hand}" stroke-width="${g.stroke}" stroke-linecap="round" stroke-linejoin="round">${paths}</g>`
  );
}

// Where the hand goes in a disc of `size` px at (x, y). From a 33 px disc up (labels 44 px and taller
// at 1x) the hand is simply scaled. Below that the finger strokes sit 2-3 px apart and a scaled stroke
// blurs them into one shape, so the hand is hinted like a font: about the same proportion, a
// whole-pixel stroke, and each finger stroke snapped to the pixel grid with at least one clear pixel
// between neighbours. The trade-offs: the smallest crisp hand is 12 px (fingers 2 px apart), so in
// discs under 19 px (labels under 25 px) it is larger than 0.64 of the disc; and a 2 px stroke needs
// fingers 3 px apart, so labels up to 34 px get a 1 px stroke, a little lighter than the "AI".
// Hinting works in output pixels: at `density` 2 or 3 most sizes are simply scaled.
export function handGeometry(x, y, size, density = 1) {
  if (density !== 1) {
    const g = handGeometry(x * density, y * density, size * density);
    const back = { s: g.s / density, size: g.size / density, x: g.x / density, y: g.y / density };
    if (!g.grid) return { ...g, ...back };
    return { ...g, ...back, stroke: g.stroke / density, stems: g.stems.map((v) => v / density), fx: (u) => g.fx(u) / density, fy: (v) => g.fy(v) / density };
  }
  const continuous = (s) => ({
    s,
    size: 24 * s,
    // The hand's mass sits up and right of its 24×24 box; nudge it so it centres in the disc.
    x: x + (size - 24 * s) / 2 - 0.02 * size,
    y: y + (size - 24 * s) / 2 + 0.02 * size,
  });
  if (size >= 33) return { grid: false, ...continuous((size * HAND_RATIO) / 24) };
  let c = continuous(Math.max(0.5, (size * HAND_RATIO) / 24));
  // A 2 px stroke at three-quarter scale (fingers 3 px apart), as soon as that stays within 0.70.
  if (c.s < 0.75 && 18 / size <= 0.7) c = continuous(0.75);
  const s = c.s;
  // A whole-pixel stroke close to the scaled one, thin enough to leave a clear pixel between fingers.
  let stroke = Math.max(1, Math.round(HAND_STROKE * s));
  while (stroke > 1 && Math.floor(4 * s) < stroke + 1) stroke--;
  // Odd strokes centre on pixel centres, even ones on pixel edges.
  const snap = (v) => (stroke % 2 ? Math.floor(v) + 0.5 : Math.round(v));
  const stems = [];
  for (const k of STEMS) {
    const at = snap(c.x + s * k);
    stems.push(stems.length ? Math.max(at, stems.at(-1) + stroke + 1) : at);
  }
  // The palm's bottom edge (y = 22) on the grid too.
  const dy = snap(c.y + 22 * s) - (c.y + 22 * s);
  const fx = (u) => {
    if (u <= STEMS[0]) return stems[0] + s * (u - STEMS[0]);
    if (u >= STEMS.at(-1)) return stems.at(-1) + s * (u - STEMS.at(-1));
    const i = Math.min(STEMS.length - 2, Math.floor((u - STEMS[0]) / 4));
    return stems[i] + ((stems[i + 1] - stems[i]) * (u - STEMS[i])) / 4;
  };
  const fy = (v) => c.y + dy + s * v;
  return { grid: true, s, size: ((stems.at(-1) - stems[0]) / 16) * 24, stroke, stems, fx, fy };
}

// Redraws an SVG path through the maps fx and fy (piecewise linear in x, linear in y), in absolute
// commands. Arcs keep their flags; their radii follow the local scale.
function mapPath(d, fx, fy, s) {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d*\.\d+|\d+\.?)(?:e-?\d+)?/g);
  const out = [];
  let i = 0;
  let cmd = '';
  let [cx, cy, sx0, sy0] = [0, 0, 0, 0];
  const num = () => Number(tokens[i++]);
  const pt = (x, y) => `${round(fx(x))} ${round(fy(y))}`;
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++];
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? cx : 0;
    const oy = rel ? cy : 0;
    switch (cmd.toUpperCase()) {
      case 'M': {
        [cx, cy] = [ox + num(), oy + num()];
        [sx0, sy0] = [cx, cy];
        out.push(`M${pt(cx, cy)}`);
        cmd = rel ? 'l' : 'L'; // further pairs are lines
        break;
      }
      case 'L':
        [cx, cy] = [ox + num(), oy + num()];
        out.push(`L${pt(cx, cy)}`);
        break;
      case 'H':
        cx = ox + num();
        out.push(`L${pt(cx, cy)}`);
        break;
      case 'V':
        cy = oy + num();
        out.push(`L${pt(cx, cy)}`);
        break;
      case 'C': {
        const p = [0, 1, 2].map(() => [ox + num(), oy + num()]);
        [cx, cy] = p[2];
        out.push(`C${p.map(([a, b]) => pt(a, b)).join(' ')}`);
        break;
      }
      case 'A': {
        const [rx, ry, rot, large, sweep] = [num(), num(), num(), num(), num()];
        const [x1, y1] = [ox + num(), oy + num()];
        const local = x1 !== cx ? Math.abs((fx(x1) - fx(cx)) / (x1 - cx)) : s;
        out.push(`A${round(rx * local)} ${round(ry * s)} ${rot} ${large} ${sweep} ${pt(x1, y1)}`);
        [cx, cy] = [x1, y1];
        break;
      }
      case 'Z':
        [cx, cy] = [sx0, sy0];
        out.push('Z');
        break;
      default:
        throw new Error(`unsupported path command ${cmd}`);
    }
  }
  return out.join('');
}

// A 24×24 stroke icon scaled to `size` px at (x, y).
export function icon(drawing, x, y, size, color, strokeWidth = 2) {
  return (
    `<g transform="translate(${round(x)} ${round(y)}) scale(${round(size / 24, 5)})" fill="none" stroke="${color}" ` +
    `stroke-width="${round(strokeWidth, 3)}" stroke-linecap="round" stroke-linejoin="round">${drawing}</g>`
  );
}

// The official EU icon files, unchanged.
export const EU_ICONS = ['basic', 'generated', 'modified'];
export const EU_VARIANTS = ['black', 'white', 'black-transparent', 'white-transparent'];

export function officialIcon(name = 'generated', variant = 'black') {
  if (!EU_ICONS.includes(name)) throw new UsageError(`unknown EU icon "${name}"; use one of: ${EU_ICONS.join(', ')}`);
  if (!EU_VARIANTS.includes(variant)) throw new UsageError(`unknown variant "${variant}"; use one of: ${EU_VARIANTS.join(', ')}`);
  const file = euFile(`${name === 'basic' ? 'ai' : `ai-${name}`}-${variant}`);
  if (!existsSync(file)) throw new UsageError(`missing asset ${file}`);
  return { file, svg: readFileSync(file, 'utf8') };
}

export function xml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
