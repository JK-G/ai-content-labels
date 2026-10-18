import { euBasic, mediaIcons, handMark } from './assets.mjs';
import { normalize, xml, composeAlt, altMissing, HAND_RATIO, EU_COLORS } from './render.mjs';
import { colorTheme } from './color.mjs';
import { parseHex } from './contrast.mjs';
import { strings, sentence } from './i18n.mjs';
import { round } from './text.mjs';

// The label as HTML for web pages and apps: real text that zooms, reflows, translates and follows
// the page's colour scheme, with the marks and icons as decorative inline SVG. The SVG renderer
// stays the one for stamping, PNG export and video overlays.

// Spacing between content-type icons, in icon widths (the SVG label uses 0.14H for 0.5H icons).
const ICON_GAP = 0.28;

// The colours follow the page's color-scheme through light-dark(): a page that declares only light
// (or nothing) gets the light pill even when the OS is dark; data-theme pins one. Browsers without
// light-dark() get literal colours and the prefers-color-scheme rule.
export const LABEL_CSS = `.ai-label{color-scheme:inherit;--ai-label-bg:light-dark(#fff,#1d1d1b);--ai-label-ink:light-dark(#1d1d1b,#fff);--ai-label-line:light-dark(rgb(29 29 27/.14),rgb(255 255 255/.2));--ai-label-rule:light-dark(rgb(29 29 27/.35),rgb(255 255 255/.35));--ai-label-disc:light-dark(#000,#fff);--ai-label-glyph:light-dark(#fff,#1d1d1b);
  display:inline-flex;flex-wrap:wrap;align-items:center;gap:.4em .6em;font:600 max(.875em,12px)/1.2 Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;vertical-align:middle;max-width:100%}
.ai-label[data-theme=light]{color-scheme:light}
.ai-label[data-theme=dark]{color-scheme:dark}
@supports not (color:light-dark(#000,#fff)){.ai-label{--ai-label-bg:#fff;--ai-label-ink:#1d1d1b;--ai-label-line:rgb(29 29 27/.14);--ai-label-rule:rgb(29 29 27/.35);--ai-label-disc:#000;--ai-label-glyph:#fff}.ai-label[data-theme=dark]{--ai-label-bg:#1d1d1b;--ai-label-ink:#fff;--ai-label-line:rgb(255 255 255/.2);--ai-label-rule:rgb(255 255 255/.35);--ai-label-disc:#fff;--ai-label-glyph:#1d1d1b}@media (prefers-color-scheme:dark){.ai-label:not([data-theme=light]){--ai-label-bg:#1d1d1b;--ai-label-ink:#fff;--ai-label-line:rgb(255 255 255/.2);--ai-label-rule:rgb(255 255 255/.35);--ai-label-disc:#fff;--ai-label-glyph:#1d1d1b}}}
.ai-label-pill{display:inline-flex;align-items:center;gap:.65em;min-height:2.5em;box-sizing:border-box;min-width:0;max-width:100%;
  padding:.3125em 1em .3125em .3125em;border:1px solid var(--ai-label-line);border-radius:1.25em;background:var(--ai-label-bg);color:var(--ai-label-ink)}
.ai-label-pill.ai-label-bare{padding-right:.3125em}
.ai-label-mark{flex:none;width:1.875em;height:1.875em}
.ai-label-disc{fill:var(--ai-label-disc)}
.ai-label-glyph{fill:var(--ai-label-glyph)}
.ai-label-body{display:inline-flex;flex-wrap:wrap;align-items:center;gap:.2em .65em;min-width:0}
.ai-label-text{min-width:0;overflow-wrap:break-word;hyphens:auto}
.ai-label-upper .ai-label-text{text-transform:uppercase;letter-spacing:.06em;font-size:max(.85em,10px)}
.ai-label-media{display:inline-flex;align-items:center;gap:.65em;flex:none}
.ai-label-rule{width:1px;height:1.2em;background:var(--ai-label-rule)}
.ai-label-icons{flex:none;height:1.25em;width:auto;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.ai-label-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0}
@media (forced-colors:active){.ai-label-pill{border-color:CanvasText}.ai-label-disc{fill:CanvasText}.ai-label-glyph{fill:Canvas}.ai-label-rule{background:CanvasText}}
`;

// With a height, the pill is exactly that many CSS px tall and laid out like the SVG label at that
// height: the mark is the SVG's disc (N minus an inset of 0.125N, or for words under 24 px 1 px at
// 18 growing to 3 px at 24), the padding is the inset less the 1px border, and min-height is
// lifted, so the pill is border + padding + disc + padding + border = N. The label's font size is
// the disc / 1.875 (the mark is 1.875em), and the words get the SVG label's type size at that height
// (10.5 px or more under 24 px, 0.44N to 28, then 0.4N; spaced capitals never under 10 px).
export function heightStyles(o) {
  const N = o.height;
  const compact = !o.minimal && N < 24;
  const inset = compact ? 1 + (N - 18) / 3 : N * 0.125;
  const pad = round(inset - 1, 3);
  const text = o.uppercase ? Math.max(10, N < 28 ? N * 0.37 : N * 0.34) : compact ? Math.max(10.5, N * 0.44) : N < 28 ? N * 0.44 : N * 0.4;
  return {
    root: `font-size:${round((N - 2 * inset) / 1.875, 3)}px`,
    text: ` style="font-size:${round(text, 3)}px"`,
    pill: ` style="min-height:0;padding:${pad}px 1em ${pad}px ${pad}px"`,
    bare: ` style="min-height:0;padding:${pad}px"`,
  };
}

// The icon form: the EU disc alone with its thin ring, as inline SVG in an 18-unit box (a 16-unit
// disc and a 1-unit ring), coloured by the page's scheme like the mark in the pill. 1.5em by
// default (18 px or more, as the type is 12 px or more), or exactly --height px.
function iconHtml(o, input) {
  const eu = euBasic();
  const [vx, vy, vw] = eu.viewBox;
  const size = input.height != null ? `width:${o.height}px;height:${o.height}px` : 'width:1.5em;height:1.5em';
  const svg =
    `<svg class="ai-label-mark" aria-hidden="true" focusable="false" viewBox="0 0 18 18" style="${size}"><circle class="ai-label-glyph" cx="9" cy="9" r="9"/>` +
    `<g transform="translate(1 1) scale(${round(16 / vw, 5)}) translate(${-vx} ${-vy})"><path class="ai-label-disc" d="${eu.circle}"/>` +
    `${eu.letters.map((d) => `<path class="ai-label-glyph" d="${d}"/>`).join('')}</g></svg>`;
  const said = sentence({ kind: o.kind, media: o.media, text: o.text, lang: o.lang });
  const scheme = input.theme === 'light' || input.theme === 'dark' ? ` data-theme="${input.theme}"` : '';
  const html = `<span class="ai-label" role="note" lang="${o.lang}"${scheme}>${svg}<span class="ai-label-sr">${xml(said)}</span></span>`;
  const alt = composeAlt(o);
  return { html, css: LABEL_CSS, alt, ...altMissing(o, alt), disclosure: said };
}

export function renderHtml(input = {}) {
  const o = normalize(input);
  if (o.icon) return iconHtml(o, input);
  // Without --height the label follows the page's font size (never under 12 px), as before.
  const sized = input.height != null ? heightStyles(o) : null;
  const s = strings(o.lang);
  const pick = (kind) => (o.short ? s[kind].short : s[kind].label);
  const pills = [pill({ kind: o.kind, text: o.text ?? pick(o.kind), media: o.media, own: o.text, o, sized })];
  if (o.kind !== 'human' && o.human.length) pills.push(pill({ kind: 'human', text: o.humanText ?? pick('human'), media: o.human, own: o.humanText, o, sized }));
  const style = [sized?.root, o.color && colorVars(o.color)].filter(Boolean).join(';');
  const scheme = !o.color && (input.theme === 'light' || input.theme === 'dark') ? ` data-theme="${input.theme}"` : '';
  const theme = (style ? ` style="${style}"` : '') + scheme;
  const cls = o.uppercase ? 'ai-label ai-label-upper' : 'ai-label';
  const html = `<span class="${cls}" role="note" lang="${o.lang}"${theme}>${pills.map((p) => p.html).join(' ')}</span>`;
  const disclosure = pills.map((p) => p.sentence).join(' ');
  const alt = composeAlt(o);
  return { html, css: LABEL_CSS, alt, ...altMissing(o, alt), disclosure };
}

// A label colour (--color) as the stylesheet's custom properties, set on the label itself so they
// win over the light and dark ones; forced-colors mode still replaces them.
function colorVars(hex) {
  const t = colorTheme(hex);
  const rgb = parseHex(t.ink).join(' ');
  const [disc, glyph] = EU_COLORS[t.eu];
  return `--ai-label-bg:${t.background};--ai-label-ink:${t.ink};--ai-label-line:rgb(${rgb}/${t.borderOpacity});--ai-label-rule:rgb(${rgb}/.35);--ai-label-disc:${disc};--ai-label-glyph:${glyph}`;
}

function pill({ kind, text, media, own, o, sized }) {
  const said = sentence({ kind, media, text: own, lang: o.lang });
  const sr = (t) => `<span class="ai-label-sr">${xml(t)}</span>`;
  const size = sized ? sized.text : '';
  // Visible words plus the rest of the sentence for screen readers: "Generated with AI" + ": image."
  const continues = !o.minimal && said.startsWith(text);
  // The words, icons and screen-reader text sit in one wrapping body, so in a narrow column the
  // icons move under the words instead of the words breaking letter by letter.
  const body = [];
  if (o.minimal) body.push(sr(said));
  else if (continues) body.push(`<span class="ai-label-text"${size}>${xml(text)}</span>`);
  // Short wording ("Generated") is not the start of the sentence: show it, read the full sentence.
  else body.push(`<span class="ai-label-text" aria-hidden="true"${size}>${xml(text)}</span>${sr(said)}`);
  if (media.length) body.push(`<span class="ai-label-media">${rule()}${icons(media)}</span>`);
  if (continues && said.length > text.length) body.push(sr(said.slice(text.length)));
  // A bare minimal badge has only the screen-reader text, which takes no room: no body, no gap.
  const bare = o.minimal && !media.length;
  const parts = bare ? [mark(kind), ...body] : [mark(kind), `<span class="ai-label-body">${body.join('')}</span>`];
  return { html: wrap(parts, bare, sized), sentence: said };
}

const wrap = (parts, bare, sized) => `<span class="ai-label-pill${bare ? ' ai-label-bare' : ''}"${sized ? (bare ? sized.bare : sized.pill) : ''}>${parts.join('')}</span>`;
const rule = () => '<span class="ai-label-rule" aria-hidden="true"></span>';

// The author mark in a 24×24 box: the EU "AI" disc, or the hand in the same disc.
function mark(kind) {
  if (kind === 'human') {
    // The same glyph and proportion as the SVG and PNG labels: the raised hand, 0.62 of the disc tall.
    const { box, d } = handMark();
    const size = 24 * HAND_RATIO;
    const at = round((24 - size) / 2);
    return (
      '<svg class="ai-label-mark" aria-hidden="true" focusable="false" viewBox="0 0 24 24"><circle class="ai-label-disc" cx="12" cy="12" r="12"/>' +
      `<path class="ai-label-glyph" transform="translate(${at} ${at}) scale(${round(size / box, 5)})" d="${d}"/></svg>`
    );
  }
  const eu = euBasic();
  return (
    `<svg class="ai-label-mark" aria-hidden="true" focusable="false" viewBox="${eu.viewBox.join(' ')}"><path class="ai-label-disc" d="${eu.circle}"/>` +
    `${eu.letters.map((d) => `<path class="ai-label-glyph" d="${d}"/>`).join('')}</svg>`
  );
}

function icons(media) {
  const step = 24 * (1 + ICON_GAP);
  const width = round(24 * media.length + 24 * ICON_GAP * (media.length - 1));
  const body = media.map((m, i) => `<g transform="translate(${round(i * step)} 0)">${mediaIcons().icons[m]}</g>`).join('');
  return `<svg class="ai-label-icons" aria-hidden="true" focusable="false" viewBox="0 0 ${width} 24" style="aspect-ratio:${width}/24">${body}</svg>`;
}
