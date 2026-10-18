import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { renderLabel, formOf, MIN_HEIGHT, FORMS, EU_COLORS } from '../skills/ai-content-labels/scripts/lib/render.mjs';
import { renderHtml } from '../skills/ai-content-labels/scripts/lib/html.mjs';
import { stampBuffer, placeLabel, defaultForm } from '../skills/ai-content-labels/scripts/lib/stamp.mjs';
import { render } from '../skills/ai-content-labels/scripts/lib/api.mjs';
import { labelImage } from '../skills/ai-content-labels/scripts/lib/label.mjs';
import { TOOLS } from '../skills/ai-content-labels/scripts/lib/mcp.mjs';
import { font } from '../skills/ai-content-labels/scripts/lib/assets.mjs';

let sharp = null;
try {
  sharp = createRequire(import.meta.url)('sharp');
} catch {}
const noSharp = !sharp && 'sharp not installed';
const flat = (background, width = 1080, height = 1080) => sharp({ create: { width, height, channels: 3, background } }).png().toBuffer();
// The type size of the word in an SVG label, from the scale of its glyph group (units per em 2048).
const typeSize = (svg) => Number(svg.match(/<g fill="[^"]+" transform="translate\([^)]+\) scale\(([\d.]+)\)">/)[1]) * font().unitsPerEm;

test('the icon form: the official disc alone with a thin ring in the letters\' colour', () => {
  for (const [theme, variant] of [['light', 'black'], ['dark', 'white']]) {
    const icon = renderLabel({ form: 'icon', theme, height: 36 });
    const [disc, letters] = EU_COLORS[variant];
    assert.deepEqual([icon.width, icon.height], [36, 36]);
    // The ring: a full circle in the letters' colour, then the disc inset by H/18 (2 px at 36).
    assert.match(icon.svg, new RegExp(`<title>Generated with AI\\.</title><circle cx="18" cy="18" r="18" fill="${letters}"/><g transform="translate\\(2 2\\) scale\\(`));
    assert.match(icon.svg, new RegExp(`<path fill="${disc}" d="`));
    assert.doesNotMatch(icon.svg, /<rect|<line|stroke=/);
    assert.equal(icon.options.form, 'icon');
    assert.ok(icon.wcag && icon.contrast >= 16);
  }
  // 18 px: a 16 px disc and a 1 px ring; the proportions are the same at every size.
  const small = renderLabel({ icon: true, height: 18, media: 'image' });
  assert.match(small.svg, /<circle cx="9" cy="9" r="9" fill="#ffffff"\/><g transform="translate\(1 1\) scale\(0\.04378\)/);
  assert.equal(small.disclosure, 'Generated with AI: image.');
  assert.throws(() => renderLabel({ icon: true, height: 17 }), /the icon must be at least 18 px/);
  assert.throws(() => renderLabel({ icon: true, color: '#1f7a52' }), /--color colours a pill/);
  assert.throws(() => renderLabel({ icon: true, kind: 'human' }), /human-made label keeps its words/);
  assert.throws(() => renderLabel({ icon: true, human: 'text' }), /--short or --minimal/);
});

test('forms: a name or a flag, conflicts refused, render keeps its default', () => {
  assert.deepEqual(FORMS, ['icon', 'minimal', 'short', 'full']);
  assert.equal(formOf({}), null);
  assert.equal(formOf({ form: 'Icon' }), 'icon');
  assert.equal(formOf({ icon: 'true' }), 'icon');
  assert.equal(formOf({ short: false }), 'full');
  assert.equal(formOf({ form: 'short', short: true }), 'short');
  assert.throws(() => formOf({ form: 'icon', short: true }), /--short and --icon contradict/);
  assert.throws(() => formOf({ form: 'square' }), /unknown form "square"/);
  assert.equal(renderLabel({}).options.form, 'short');
  assert.deepEqual(MIN_HEIGHT, { icon: 18, text: 18, minimal: 20 });
  // stamp, label and place: the icon for AI labels; a word for human-made labels and pill colours.
  assert.equal(defaultForm({ kind: 'generated' }), 'icon');
  assert.equal(defaultForm({ kind: 'basic', text: 'Voice generated with AI' }), 'icon');
  assert.equal(defaultForm({ kind: 'human' }), 'short');
  assert.equal(defaultForm({ kind: 'generated', human: 'text' }), 'short');
  assert.equal(defaultForm({ kind: 'generated', color: 'auto' }), 'short');
  assert.equal(defaultForm({ kind: 'generated', palette: ['#1f7a52'] }), 'short');
  assert.equal(defaultForm({ kind: 'generated', minimal: false }), 'short');
  assert.equal(defaultForm({ kind: 'generated', minimal: true }), 'minimal');
  for (const name of ['render_label', 'stamp_image', 'place_label', 'label_image']) {
    const props = TOOLS.find((t) => t.name === name).inputSchema.properties;
    assert.deepEqual(props.form.enum, FORMS, name);
    assert.ok(props.icon && props.short && props.minimal, name);
  }
});

test('compact geometry under 24 px: thinner inset, type at 10.5 px or more; 24 px and up unchanged', () => {
  // Laid out at its own height, a label is the same SVG with or without designHeight.
  for (const h of [24, 25, 28, 32, 48, 67]) {
    for (const extra of [{}, { media: 'image' }, { full: true, uppercase: true }]) {
      assert.equal(renderLabel({ height: h, designHeight: h, ...extra }).svg, renderLabel({ height: h, ...extra }).svg, `${h} ${JSON.stringify(extra)}`);
    }
  }
  assert.ok(Math.abs(typeSize(renderLabel({ height: 24 }).svg) - 10.56) < 0.02);
  for (const h of [18, 19, 20, 21, 22, 23]) {
    const { svg } = renderLabel({ height: h, media: 'image' });
    assert.ok(typeSize(svg) >= 10.5 - 0.01, `${h}: ${typeSize(svg)}`);
    // The disc fills the height but the inset: 1 px at 18, growing to 3 px at 24.
    const inset = 1 + (h - 18) / 3;
    const scale = Number(svg.match(/<g transform="translate\([\d.]+ [\d.]+\) scale\(([\d.]+)\) translate\(-89\.28 -100\.72\)">/)[1]);
    assert.ok(Math.abs(scale * 365.49 - (h - 2 * inset)) < 0.01, `${h}: disc ${scale * 365.49}`);
  }
  // Continuous at 24: the disc and the type grow from 23 to 24 (disc 17.67 to 18, type 10.5 to 10.56).
  const disc = (h) => Number(renderLabel({ height: h, media: 'image' }).svg.match(/scale\(([\d.]+)\) translate\(-89\.28 -100\.72\)/)[1]) * 365.49;
  assert.ok(Math.abs(disc(23) - (23 - 2 * (1 + 5 / 3))) < 0.01 && Math.abs(disc(24) - 18) < 0.01, `${disc(23)} ${disc(24)}`);
  assert.ok(disc(23) < disc(24));
  assert.ok(typeSize(renderLabel({ height: 23 }).svg) <= typeSize(renderLabel({ height: 24 }).svg));
  // Spaced capitals keep their 10 px floor.
  assert.ok(typeSize(renderLabel({ height: 18, uppercase: true }).svg) >= 10 - 0.01);
  // A design height scales the drawing: laid out at 18, drawn 50 px tall.
  const scaled = renderLabel({ height: 50, designHeight: 18, media: 'image' });
  const own = renderLabel({ height: 18, media: 'image' });
  assert.equal(scaled.height, 50);
  assert.equal(scaled.width, Math.round((own.width * 50) / 18));
  assert.match(scaled.svg, new RegExp(`viewBox="0 0 ${own.width} 18" preserveAspectRatio="none"`));
});

test('HTML icon: the disc as inline SVG with the sentence for screen readers', () => {
  const r = renderHtml({ form: 'icon', media: 'image', description: 'A wolf' });
  assert.match(r.html, /^<span class="ai-label" role="note" lang="en"><svg class="ai-label-mark" aria-hidden="true" focusable="false" viewBox="0 0 18 18" style="width:1\.5em;height:1\.5em"><circle class="ai-label-glyph" cx="9" cy="9" r="9"\/><g transform="translate\(1 1\) scale\(/);
  assert.match(r.html, /<span class="ai-label-sr">Generated with AI: image\.<\/span><\/span>$/);
  assert.doesNotMatch(r.html, /ai-label-pill|ai-label-text/);
  assert.equal(r.alt, 'A wolf. Generated with AI: image.');
  assert.match(renderHtml({ icon: true, height: 18, theme: 'dark' }).html, /data-theme="dark"><svg [^>]*style="width:18px;height:18px"/);
});

test('stamp, label and place default to the icon; the word stays at 10.5 CSS px or more where shown', { skip: noSharp }, async () => {
  const square = await flat('#9fb3c2');
  const story = await flat('#9fb3c2', 1080, 1920);
  for (const image of [square, story]) {
    const icon = await stampBuffer(image, { kind: 'generated', media: 'image' });
    assert.deepEqual([icon.label.form, icon.label.width, icon.label.height], ['icon', 50, 50]);
    assert.ok(icon.label.displayHeight >= 18);
    const word = await placeLabel(image, { kind: 'generated', media: 'image', short: true });
    assert.deepEqual([word.label.form, word.label.height], ['short', 50]);
    // renderArgs are the layout stamp used: the type, scaled to the shown size, is still 10.5 px.
    const drawn = await render(word.renderArgs);
    const shown = (typeSize(drawn.svg) * word.label.displayHeight) / word.renderArgs.height;
    assert.ok(shown >= 10.5, `word shown at ${shown} px`);
    // The stamped label was laid out at renderArgs.height: the drawn label, scaled to the file, is as wide.
    assert.equal(Math.round((drawn.width * word.label.height) / word.renderArgs.height), word.label.width);
    const stamped = await stampBuffer(image, { kind: 'generated', media: 'image', short: true });
    assert.equal(stamped.label.width, word.label.width);
  }
  assert.equal((await stampBuffer(square, { kind: 'human', media: 'image' })).label.form, 'short');
  assert.equal((await stampBuffer(square, { kind: 'generated', color: '#1f7a52' })).label.form, 'short');
  await assert.rejects(stampBuffer(square, { kind: 'generated', icon: true, color: '#1f7a52' }), /--color and --palette colour a pill/);
  // An explicit height under the legible size says so, instead of "had to shrink".
  const low = await stampBuffer(square, { kind: 'generated', short: true, height: 30 });
  assert.match(low.warning, /^the label is smaller than legible at this height: shown 390 px wide it is under the legible 18 px\. Pass a larger --height/);
  const tiny = await stampBuffer(await flat('#9fb3c2', 4000, 300), { kind: 'generated', short: true, region: '0,0,4000,300' });
  assert.match(tiny.warning, /Use the icon form \(--form icon\), use a larger region or put the label next to the image$/);
  const labelled = await labelImage(square, { realistic: true });
  assert.equal(labelled.label.form, 'icon');
  assert.equal(labelled.required, true);
});
