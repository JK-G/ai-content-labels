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

test('the stylesheet keeps WCAG text contrast in both themes and follows dark mode', () => {
  const light = { bg: LABEL_CSS.match(/--ai-label-bg:(#[0-9a-f]+)/)[1], ink: LABEL_CSS.match(/--ai-label-ink:(#[0-9a-f]+)/)[1] };
  const dark = LABEL_CSS.match(/\[data-theme=dark\]\{--ai-label-bg:(#[0-9a-f]+);--ai-label-ink:(#[0-9a-f]+)/);
  assert.ok(contrastRatio(parseHex(light.ink), parseHex(light.bg)) >= 4.5);
  assert.ok(contrastRatio(parseHex(dark[2]), parseHex(dark[1])) >= 4.5);
  assert.match(LABEL_CSS, /prefers-color-scheme:dark/);
  assert.match(LABEL_CSS, /forced-colors:active/);
});

test('a pill keeps its icons on its line and narrows its text instead of overflowing', () => {
  // A wrapping pill pushed its icons to a second line even with room to spare (checked in Chrome).
  const pill = LABEL_CSS.match(/\.ai-label-pill\{[^}]*\}/)[0];
  assert.doesNotMatch(pill, /flex-wrap/);
  assert.match(pill, /min-width:0/);
  assert.match(pill, /max-width:100%/);
  assert.match(LABEL_CSS, /\.ai-label-text\{min-width:0;overflow-wrap:anywhere\}/);
});
