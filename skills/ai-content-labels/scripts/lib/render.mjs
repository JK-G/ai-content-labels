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

  const mark = kind === 'human' ? (x) => handDisc(x + inset, inset, markBox, theme.eu) : (x) => euDisc(x + inset, inset, markBox, theme.eu);

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
export function handDisc(x, y, size, variant) {
  const [disc, hand] = EU_COLORS[variant];
  // A heavier stroke than the content-type icons, so the hand matches the weight of the bold "AI".
  // Up to a 33 px disc (labels up to 44 px tall) the fingers sit 2-3 px apart and a scaled stroke
  // blurs them into one shape. There the hand is drawn on the pixel grid instead: at half scale with
  // a 1 px stroke (fingers 2 px apart), or at three-quarter scale with a 2 px stroke (3 px apart),
  // snapped so every finger fills whole pixel columns with a clean gap between them.
  const grid = size < 24 ? { scale: 0.5, px: 1 } : size < 33 ? { scale: 0.75, px: 2 } : null;
  const handSize = grid ? 24 * grid.scale : size * 0.64;
  const sw = grid ? grid.px / grid.scale : 2.75;
  // The hand's mass sits up and right of its 24×24 box; nudge it so it centres in the disc.
  let hx = x + (size - handSize) / 2 - 0.02 * size;
  let hy = y + (size - handSize) / 2 + 0.02 * size;
  if (grid) {
    // Finger centres are at 6, 10, 14 and 18 units: put them on pixel centres (1 px) or edges (2 px).
    const f = hx + 6 * grid.scale;
    const snapped = grid.px === 1 ? Math.floor(f) + 0.5 : Math.round(f);
    [hx, hy] = [hx + snapped - f, Math.round(hy)];
  }
  return (
    `<circle cx="${round(x + size / 2)}" cy="${round(y + size / 2)}" r="${round(size / 2)}" fill="${disc}"/>` +
    icon(mediaIcons().icons.human, hx, hy, handSize, hand, sw)
  );
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
