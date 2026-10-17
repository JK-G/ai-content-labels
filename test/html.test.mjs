import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderHtml, LABEL_CSS } from '../skills/ai-content-labels/scripts/lib/html.mjs';
import { contrastRatio, parseHex } from '../skills/ai-content-labels/scripts/lib/contrast.mjs';

const strip = (html) => html.replace(/<svg[\s\S]*?<\/svg>/g, '');

test('the HTML label is real text with the full sentence for screen readers', () => {
  const { html, disclosure } = renderHtml({ kind: 'generated', media: 'image', human: 'text' });
  assert.match(html, /^<span class="ai-label" role="note" lang="en">/);
  assert.match(strip(html), />Generated with AI</);
  assert.match(strip(html), />Made by a human</);
  assert.match(html, /<span class="ai-label-sr">: image\.<\/span>/);
  assert.equal(disclosure, 'Generated with AI: image. Made by a human: text.');
  for (const svg of html.match(/<svg[^>]*>/g)) assert.match(svg, /aria-hidden="true"/);
  assert.doesNotMatch(html, /<path[^>]*d="[^"]*"[^>]*class="ai-label-text"/); // no text drawn as outlines
});

// The text a screen reader gets: everything except SVGs and aria-hidden elements, in order.
const spoken = (html) =>
  html
    .replace(/<svg[\s\S]*?<\/svg>/g, '')
    .replace(/<span[^>]*aria-hidden="true"[^>]*>[^<]*<\/span>/g, '')
    .replace(/<[^>]+>/g, '');

test('short wording is shown and the full sentence is read', () => {
  const generated = renderHtml({ media: 'image', short: true }).html;
  assert.match(strip(generated), /class="ai-label-text">Generated</);
  assert.equal(spoken(generated), 'Generated with AI: image.');
  // "Human-made" is not the start of the sentence: shown, hidden from screen readers, sentence read instead.
  const human = renderHtml({ kind: 'human', media: 'text', short: true }).html;
  assert.match(human, /<span class="ai-label-text" aria-hidden="true">Human-made<\/span>/);
  assert.equal(spoken(human), 'Made by a human: text.');
  assert.equal(spoken(renderHtml({ media: 'image', human: 'text' }).html), 'Generated with AI: image. Made by a human: text.');
});

test('language, theme pinning and minimal form', () => {
  assert.match(renderHtml({ lang: 'pl', media: 'image' }).html, /lang="pl"/);
  assert.match(renderHtml({ theme: 'dark' }).html, /data-theme="dark"/);
  assert.doesNotMatch(renderHtml({}).html, /data-theme/);
  const minimal = renderHtml({ kind: 'human', media: 'text', minimal: true }).html;
  assert.doesNotMatch(minimal, /ai-label-text/);
  assert.match(minimal, /<span class="ai-label-sr">Made by a human: text\.<\/span>/);
});

test('the stylesheet keeps WCAG text contrast in both themes and follows the page colour scheme', () => {
  const [, lightBg, darkBg] = LABEL_CSS.match(/--ai-label-bg:light-dark\((#[0-9a-f]+),(#[0-9a-f]+)\)/);
  const [, lightInk, darkInk] = LABEL_CSS.match(/--ai-label-ink:light-dark\((#[0-9a-f]+),(#[0-9a-f]+)\)/);
  assert.ok(contrastRatio(parseHex(lightInk), parseHex(lightBg)) >= 4.5);
  assert.ok(contrastRatio(parseHex(darkInk), parseHex(darkBg)) >= 4.5);
  // The page's color-scheme decides, not the OS: a light-only page keeps a light pill in dark mode.
  assert.match(LABEL_CSS, /\.ai-label\{color-scheme:inherit;/);
  assert.match(LABEL_CSS, /\.ai-label\[data-theme=dark\]\{color-scheme:dark\}/);
  assert.match(LABEL_CSS, /\.ai-label\[data-theme=light\]\{color-scheme:light\}/);
  // Browsers without light-dark() fall back to literal colours and the OS setting.
  const fallback = LABEL_CSS.match(/@supports not \(color:light-dark\(#000,#fff\)\)\{(.*)\}\n/)[1];
  assert.match(fallback, /--ai-label-bg:#fff;--ai-label-ink:#1d1d1b/);
  assert.match(fallback, /prefers-color-scheme:dark/);
  assert.match(LABEL_CSS, /forced-colors:active/);
});

test('narrow columns wrap whole words and move the icons under them', () => {
  const pill = LABEL_CSS.match(/\.ai-label-pill\{[^}]*\}/)[0];
  assert.doesNotMatch(pill, /flex-wrap/);
  assert.match(pill, /min-width:0/);
  assert.match(pill, /max-width:100%/);
  assert.match(LABEL_CSS, /\.ai-label-body\{display:inline-flex;flex-wrap:wrap;[^}]*min-width:0\}/);
  // min-width:0: a word longer than the column breaks inside the pill instead of overflowing it.
  assert.match(LABEL_CSS, /\.ai-label-text\{min-width:0;overflow-wrap:break-word;hyphens:auto\}/);
  assert.doesNotMatch(LABEL_CSS, /overflow-wrap:anywhere/);
  // Type floors: 12 px for the label, 10 px for spaced capitals.
  assert.match(LABEL_CSS, /font:600 max\(\.875em,12px\)/);
  assert.match(LABEL_CSS, /\.ai-label-upper \.ai-label-text\{[^}]*font-size:max\(\.85em,10px\)/);
  const { html } = renderHtml({ kind: 'modified', media: 'image,voice', lang: 'pl' });
  assert.match(html, /<\/svg><span class="ai-label-body"><span class="ai-label-text">Zmodyfikowane przez AI<\/span><span class="ai-label-media">/);
  // A bare minimal badge has no body, so no gap after the mark.
  assert.doesNotMatch(renderHtml({ minimal: true }).html, /ai-label-body/);
});

test('the hand in the HTML mark is the same filled glyph and proportion as the SVG label', () => {
  const { html } = renderHtml({ kind: 'human', media: 'text' });
  // 0.62 of the 24-unit disc, centred, coloured like the "AI" letters (and Canvas in forced colours).
  assert.match(html, /<path class="ai-label-glyph" transform="translate\(4\.56 4\.56\) scale\(0\.05813\)" d="M216/);
  assert.doesNotMatch(LABEL_CSS, /ai-label-hand/);
});

test('alt is null without a description; with one it is the description, then the sentence', () => {
  const plain = renderHtml({ media: 'image' });
  assert.equal(plain.alt, null);
  assert.match(plain.altMissing, /pass description/);
  const wolf = renderHtml({ media: 'image', description: 'Wilk', lang: 'pl' });
  assert.equal(wolf.alt, 'Wilk. Wygenerowane przez AI: obraz.');
  assert.equal(wolf.altMissing, undefined);
});

test('own text in another EU language is tagged with that language and read alone', () => {
  const { html, disclosure } = renderHtml({ lang: 'fr', text: 'Généré par IA', media: 'image' });
  assert.match(html, /^<span class="ai-label" role="note" lang="fr">/);
  assert.equal(disclosure, 'Généré par IA.');
  assert.equal(spoken(html), 'Généré par IA.');
  assert.throws(() => renderHtml({ lang: 'fr', media: 'image' }), /no built-in wording for "fr"/);
});
