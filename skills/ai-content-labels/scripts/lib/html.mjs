import { euBasic, mediaIcons } from './assets.mjs';
import { normalize, xml } from './render.mjs';
import { strings, sentence } from './i18n.mjs';
import { round } from './text.mjs';

// The label as HTML for web pages and apps: real text that zooms, reflows, translates and follows
// dark mode, with the marks and icons as decorative inline SVG. The SVG renderer stays the one for
// stamping, PNG export and video overlays.

// Spacing between content-type icons, in icon widths (the SVG label uses 0.14H for 0.5H icons).
const ICON_GAP = 0.28;

export const LABEL_CSS = `.ai-label{--ai-label-bg:#fff;--ai-label-ink:#1d1d1b;--ai-label-line:rgb(29 29 27/.14);--ai-label-rule:rgb(29 29 27/.35);--ai-label-disc:#000;--ai-label-glyph:#fff;
  display:inline-flex;flex-wrap:wrap;align-items:center;gap:.4em .6em;font:600 .8em/1.2 Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;vertical-align:middle;max-width:100%}
.ai-label[data-theme=dark]{--ai-label-bg:#1d1d1b;--ai-label-ink:#fff;--ai-label-line:rgb(255 255 255/.2);--ai-label-rule:rgb(255 255 255/.35);--ai-label-disc:#fff;--ai-label-glyph:#1d1d1b}
@media (prefers-color-scheme:dark){.ai-label:not([data-theme=light]){--ai-label-bg:#1d1d1b;--ai-label-ink:#fff;--ai-label-line:rgb(255 255 255/.2);--ai-label-rule:rgb(255 255 255/.35);--ai-label-disc:#fff;--ai-label-glyph:#1d1d1b}}
.ai-label-pill{display:inline-flex;align-items:center;gap:.65em;min-height:2.5em;box-sizing:border-box;min-width:0;max-width:100%;
  padding:.3125em 1em .3125em .3125em;border:1px solid var(--ai-label-line);border-radius:1.25em;background:var(--ai-label-bg);color:var(--ai-label-ink)}
.ai-label-pill.ai-label-bare{padding-right:.3125em}
.ai-label-mark{flex:none;width:1.875em;height:1.875em}
.ai-label-disc{fill:var(--ai-label-disc)}
.ai-label-glyph{fill:var(--ai-label-glyph)}
.ai-label-hand{fill:none;stroke:var(--ai-label-glyph);stroke-width:2.75;stroke-linecap:round;stroke-linejoin:round}
.ai-label-text{min-width:0;overflow-wrap:anywhere}
.ai-label-upper .ai-label-text{text-transform:uppercase;letter-spacing:.06em;font-size:.85em}
.ai-label-media{display:inline-flex;align-items:center;gap:.65em;flex:none}
.ai-label-rule{width:1px;height:1.2em;background:var(--ai-label-rule)}
.ai-label-icons{flex:none;height:1.25em;width:auto;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.ai-label-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0}
@media (forced-colors:active){.ai-label-pill{border-color:CanvasText}.ai-label-disc{fill:CanvasText}.ai-label-glyph{fill:Canvas}.ai-label-hand{stroke:Canvas}.ai-label-rule{background:CanvasText}}
`;

export function renderHtml(input = {}) {
  const o = normalize(input);
  const s = strings(o.lang);
  const pick = (kind) => (o.short ? s[kind].short : s[kind].label);
  const pills = [pill({ kind: o.kind, text: o.text ?? pick(o.kind), media: o.media, own: o.text, o })];
  if (o.kind !== 'human' && o.human.length) pills.push(pill({ kind: 'human', text: o.humanText ?? pick('human'), media: o.human, own: o.humanText, o }));
  const theme = input.theme === 'light' || input.theme === 'dark' ? ` data-theme="${input.theme}"` : '';
  const cls = o.uppercase ? 'ai-label ai-label-upper' : 'ai-label';
  const html = `<span class="${cls}" role="note" lang="${o.lang}"${theme}>${pills.map((p) => p.html).join(' ')}</span>`;
  const disclosure = pills.map((p) => p.sentence).join(' ');
  return { html, css: LABEL_CSS, alt: disclosure, disclosure };
}

function pill({ kind, text, media, own, o }) {
  const said = sentence({ kind, media, text: own, lang: o.lang });
  const sr = (t) => `<span class="ai-label-sr">${xml(t)}</span>`;
  // Visible words plus the rest of the sentence for screen readers: "Generated with AI" + ": image."
  const continues = !o.minimal && said.startsWith(text);
  const parts = [mark(kind)];
  if (o.minimal) parts.push(sr(said));
  else if (continues) parts.push(`<span class="ai-label-text">${xml(text)}</span>`);
  // Short wording ("Generated") is not the start of the sentence: show it, read the full sentence.
  else parts.push(`<span class="ai-label-text" aria-hidden="true">${xml(text)}</span>${sr(said)}`);
  if (media.length) parts.push(`<span class="ai-label-media">${rule()}${icons(media)}</span>`);
  if (continues && said.length > text.length) parts.push(sr(said.slice(text.length)));
  return { html: wrap(parts, o.minimal && !media.length), sentence: said };
}

const wrap = (parts, bare) => `<span class="ai-label-pill${bare ? ' ai-label-bare' : ''}">${parts.join('')}</span>`;
const rule = () => '<span class="ai-label-rule" aria-hidden="true"></span>';

// The author mark in a 24×24 box: the EU "AI" disc, or the hand in the same disc.
function mark(kind) {
  if (kind === 'human') {
    const size = 24 * 0.64;
    const x = (24 - size) / 2 - 0.48;
    const y = (24 - size) / 2 + 0.48;
    return (
      '<svg class="ai-label-mark" aria-hidden="true" focusable="false" viewBox="0 0 24 24"><circle class="ai-label-disc" cx="12" cy="12" r="12"/>' +
      `<g class="ai-label-hand" transform="translate(${round(x)} ${round(y)}) scale(${round(size / 24, 5)})">${mediaIcons().icons.human}</g></svg>`
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
