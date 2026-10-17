import { readFileSync, existsSync } from 'node:fs';
import { euBasic, mediaIcons, compactIcons, euFile } from './assets.mjs';
import { textPaths, measure, capHeight, missingGlyphs, round } from './text.mjs';
import { worstCaseContrast, WCAG } from './contrast.mjs';
import { strings, sentence, KINDS, MEDIA, UsageError } from './i18n.mjs';

export const THEMES = {
  light: { background: '#ffffff', backgroundOpacity: 0.94, ink: '#1d1d1b', border: '#1d1d1b', borderOpacity: 0.14, eu: 'black' },
  dark: { background: '#1d1d1b', backgroundOpacity: 0.9, ink: '#ffffff', border: '#ffffff', borderOpacity: 0.2, eu: 'white' },
};

// Colours of the official basic icon: the black file has a black disc with white letters,
// the white file a white disc with #1d1d1b letters.
const EU_COLORS = { black: ['#000000', '#ffffff'], white: ['#ffffff', '#1d1d1b'] };

// Media types that share a compact icon.
const COMPACT_FOR = { image: 'image-ai', text: 'text-ai', audio: 'audio-ai', voice: 'audio-ai', music: 'audio-ai', video: 'video-ai' };

export const POSITIONS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

const toList = (v) => (v == null || v === '' ? [] : Array.isArray(v) ? v : String(v).split(',')).map((s) => String(s).trim()).filter(Boolean);

export function normalize(input = {}) {
  const o = {
    kind: input.kind ?? 'generated',
    media: toList(input.media),
    human: toList(input.human),
    lang: input.lang ?? 'en',
    // NFC, so "é" typed as e + combining accent (macOS paste) finds its glyph.
    text: input.text ? String(input.text).normalize('NFC') : undefined,
    humanText: input.humanText ? String(input.humanText).normalize('NFC') : undefined,
    short: Boolean(input.short),
    uppercase: Boolean(input.uppercase),
    theme: input.theme ?? 'light',
    height: Number(input.height ?? 32),
    mark: input.mark ?? 'eu',
    backgroundOpacity: input.backgroundOpacity == null ? undefined : Number(input.backgroundOpacity),
    allowLowContrast: Boolean(input.allowLowContrast),
  };
  if (!KINDS.includes(o.kind)) throw new UsageError(`unknown kind "${o.kind}"; use one of: ${KINDS.join(', ')}`);
  for (const m of [...o.media, ...o.human]) {
    if (!MEDIA.includes(m)) throw new UsageError(`unknown media type "${m}"; use any of: ${MEDIA.join(', ')}`);
  }
  if (o.kind === 'human' && o.human.length) throw new UsageError('--human adds a human-made part to an AI label; with --kind human list the types in --media');
  if (!THEMES[o.theme]) throw new UsageError(`unknown theme "${o.theme}"; use light or dark`);
  if (!['eu', 'compact'].includes(o.mark)) throw new UsageError(`unknown mark "${o.mark}"; use eu or compact`);
  if (!(o.height >= 16 && o.height <= 512)) throw new UsageError('height must be between 16 and 512 px');
  if (o.backgroundOpacity != null && !(o.backgroundOpacity >= 0 && o.backgroundOpacity <= 1)) {
    throw new UsageError('background opacity must be between 0 and 1');
  }
  strings(o.lang);
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

  const gap = H * 0.25;
  const width = pills.reduce((w, p) => w + p.width, 0) + gap * (pills.length - 1);
  let x = 0;
  const body = pills
    .map((p) => {
      const markup = p.draw(x);
      x += p.width + gap;
      return markup;
    })
    .join('');

  const alt = labelSentence(o);
  const W = Math.ceil(width);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${xml(alt)}">` +
    `<title>${xml(alt)}</title>${body}</svg>`;
  return { svg, width: W, height: H, alt, contrast: round(contrast, 2), options: o };
}

// The label as one sentence for alt text and aria-label: "Generated with AI: image. Made by a human: text."
export function labelSentence(o) {
  return [
    sentence({ kind: o.kind, media: o.media, text: o.text, lang: o.lang }),
    ...(o.kind !== 'human' && o.human.length ? [sentence({ kind: 'human', media: o.human, text: o.humanText, lang: o.lang })] : []),
  ].join(' ');
}

function pill({ kind, text, media, o, theme }) {
  const H = o.height;
  const shown = o.uppercase ? text.toLocaleUpperCase(o.lang) : text;
  const missing = missingGlyphs(shown);
  if (missing.length) throw new UsageError(`the bundled font has no glyph for: ${missing.join(' ')}`);

  const inset = H * 0.125;
  const markBox = H - 2 * inset;
  const fontSize = o.uppercase ? H * 0.34 : H * 0.4;
  const tracking = o.uppercase ? 0.06 : 0;
  const iconSize = H * 0.5;
  const iconGap = H * 0.14;

  // The leading mark, and the media icons that follow the text.
  let mark;
  let trailing = media;
  if (kind === 'human') {
    mark = (x) => icon(mediaIcons().icons.human, x + inset + (markBox - H * 0.56) / 2, (H - H * 0.56) / 2, H * 0.56, theme.ink);
  } else if (o.mark === 'compact') {
    const name = media.length === 1 ? COMPACT_FOR[media[0]] : 'universal-ai';
    const drawing = compactIcons()[name];
    if (!drawing) throw new UsageError(`compact icon "${name}" is missing from assets/icons/compact`);
    const size = H * 0.6;
    mark = (x) => icon(drawing, x + inset + (markBox - size) / 2, (H - size) / 2, size, theme.ink);
    if (media.length === 1) trailing = [];
  } else {
    mark = (x) => euDisc(x + inset, inset, markBox, theme.eu);
  }

  const textX = inset + markBox + H * 0.26;
  const textW = measure(shown, fontSize, tracking);
  let width = textX + textW;
  let dividerX;
  const iconXs = [];
  if (trailing.length) {
    dividerX = width + H * 0.28;
    width = dividerX + H * 0.28;
    for (const _ of trailing) {
      iconXs.push(width);
      width += iconSize + iconGap;
    }
    width += H * 0.3 - iconGap;
  } else {
    width += H * 0.4;
  }

  const bw = Math.max(1, H / 32);
  const draw = (x0) => {
    const parts = [
      `<rect x="${round(x0 + bw / 2)}" y="${round(bw / 2)}" width="${round(width - bw)}" height="${round(H - bw)}" rx="${round((H - bw) / 2)}" ` +
        `fill="${theme.background}" fill-opacity="${theme.backgroundOpacity}" stroke="${theme.border}" stroke-opacity="${theme.borderOpacity}" stroke-width="${round(bw)}"/>`,
      mark(x0),
      textPaths(shown, { x: x0 + textX, baseline: H / 2 + capHeight(fontSize) / 2, size: fontSize, fill: theme.ink, tracking }),
    ];
    if (dividerX != null) {
      parts.push(
        `<line x1="${round(x0 + dividerX)}" y1="${round(H * 0.28)}" x2="${round(x0 + dividerX)}" y2="${round(H * 0.72)}" ` +
          `stroke="${theme.ink}" stroke-opacity="0.35" stroke-width="${round(bw)}" stroke-linecap="round"/>`
      );
      trailing.forEach((m, i) => parts.push(icon(mediaIcons().icons[m], x0 + iconXs[i], (H - iconSize) / 2, iconSize, theme.ink)));
    }
    return parts.join('');
  };
  return { width, draw };
}

// The official basic EU icon, scaled into a square of `size` px at (x, y).
function euDisc(x, y, size, variant) {
  const eu = euBasic();
  const [vx, vy, vw] = eu.viewBox;
  const [disc, letters] = EU_COLORS[variant];
  return (
    `<g transform="translate(${round(x)} ${round(y)}) scale(${round(size / vw, 5)}) translate(${-vx} ${-vy})">` +
    `<path fill="${disc}" d="${eu.circle}"/>${eu.letters.map((d) => `<path fill="${letters}" d="${d}"/>`).join('')}</g>`
  );
}

// A 24×24 stroke icon scaled to `size` px at (x, y).
function icon(drawing, x, y, size, color) {
  return (
    `<g transform="translate(${round(x)} ${round(y)}) scale(${round(size / 24, 5)})" fill="none" stroke="${color}" ` +
    `stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${drawing}</g>`
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
