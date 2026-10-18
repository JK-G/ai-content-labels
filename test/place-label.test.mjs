import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chooseSpot, placeSpot, busyMap, maskFrom, maskCovers, parseAvoid, parseSafeZone, checkPath, SAFE_ZONES } from '../skills/ai-content-labels/scripts/lib/place.mjs';
import { placeLabel, stampBuffer, parsePalette } from '../skills/ai-content-labels/scripts/lib/stamp.mjs';
import { placeFrom, render } from '../skills/ai-content-labels/scripts/lib/api.mjs';
import { labelImage } from '../skills/ai-content-labels/scripts/lib/label.mjs';
import { decide } from '../skills/ai-content-labels/scripts/lib/decide.mjs';
import { renderHtml } from '../skills/ai-content-labels/scripts/lib/html.mjs';
import { createDispatcher, TOOLS } from '../skills/ai-content-labels/scripts/lib/mcp.mjs';
import { rgbToOklch } from '../skills/ai-content-labels/scripts/lib/color.mjs';
import { parseHex } from '../skills/ai-content-labels/scripts/lib/contrast.mjs';
import { VERSION } from '../skills/ai-content-labels/scripts/lib/version.mjs';
import { UsageError } from '../skills/ai-content-labels/scripts/lib/i18n.mjs';
import * as lib from '../skills/ai-content-labels/scripts/lib/index.mjs';

let sharp = null;
try {
  sharp = createRequire(import.meta.url)('sharp');
} catch {}
const noSharp = !sharp && 'sharp not installed';
const tmp = mkdtempSync(join(tmpdir(), 'ai-labels-place-'));
const scripts = fileURLToPath(new URL('../skills/ai-content-labels/scripts/', import.meta.url));
const cli = (...args) => spawnSync(process.execPath, [join(scripts, 'ai-labels.mjs'), ...args], { encoding: 'utf8' });

// A shield: a rectangle with a pointed bottom. The bounding box is 300,200,480,800; its bottom
// corners (and a label placed there) lie outside the shape.
const SHIELD = 'M300 200 H780 V800 L540 1000 L300 800 Z';
const inShield = (x, y) => x >= 300 && x <= 780 && y >= 200 && y <= 1000 && (y <= 800 || Math.abs(x - 540) <= ((1000 - y) * 240) / 200);
// The mask is judged by pixel centres, so the corners are checked half a pixel inside.
const boxInShield = (b, m = 0) =>
  [
    [b.left - m + 0.5, b.top - m + 0.5],
    [b.left + b.width + m - 0.5, b.top - m + 0.5],
    [b.left - m + 0.5, b.top + b.height + m - 0.5],
    [b.left + b.width + m - 0.5, b.top + b.height + m - 0.5],
  ].every(([x, y]) => inShield(x, y));
// The shield as raw mask bytes, for the pure functions.
function shieldMask(W = 1080, H = 1080) {
  const values = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) values[y * W + x] = inShield(x + 0.5, y + 0.5) ? 255 : 0;
  return maskFrom(values, W, H, W, H);
}
const flatMap = (W, H) => busyMap(Buffer.alloc(W * H * 3, 200), W, H, 3);

// A designed ad: a brand-green band, a light background and a grey-blue "photo" in the shield.
async function ad({ photo = '#7a8fa6', band = '#1f7a52' } = {}) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080"><rect width="1080" height="1080" fill="#f4f1ea"/><rect width="1080" height="120" fill="${band}"/><path d="${SHIELD}" fill="${photo}"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

test('a spot in a shape moves inward until the label and its margin are inside', () => {
  const mask = shieldMask();
  assert.deepEqual(mask.box, { left: 300, top: 200, width: 480, height: 800 });
  const [w, h, margin] = [120, 40, 20];
  // At the bounding box's corner the label would sit outside the shield.
  const corner = { left: 780 - margin - w, top: 1000 - margin - h };
  assert.equal(maskCovers(mask, { left: corner.left - margin, top: corner.top - margin, width: w + 2 * margin, height: h + 2 * margin }), false);
  for (const position of ['bottom-right', 'bottom-left', 'bottom-center', 'top-right']) {
    const at = placeSpot(position, mask.box, w, h, margin, mask);
    assert.ok(at, position);
    assert.ok(boxInShield({ ...at, width: w, height: h }, margin), `${position}: ${JSON.stringify(at)}`);
  }
  // The right corner stays on the right half, as low as it fits.
  const br = placeSpot('bottom-right', mask.box, w, h, margin, mask);
  assert.ok(br.left + w / 2 > 540 && br.top > 600, JSON.stringify(br));
  // Too wide to fit before the middle: rejected.
  assert.equal(placeSpot('bottom-right', mask.box, 470, 40, 20, mask), null);
});

test('auto placement in a shape, with avoid boxes, reports why each spot lost', () => {
  const mask = shieldMask();
  const map = flatMap(1080, 1080);
  const spot = chooseSpot(map, mask.box, 120, 40, 20, { mask });
  assert.equal(spot.position, 'bottom-right');
  assert.ok(boxInShield({ left: spot.left, top: spot.top, width: 120, height: 40 }, 20));
  assert.equal(spot.why['bottom-left'], 'free, but bottom-right comes first');
  const avoided = chooseSpot(map, mask.box, 120, 40, 20, { mask, avoid: [{ left: 540, top: 600, width: 240, height: 400 }] });
  assert.notEqual(avoided.position, 'bottom-right');
  assert.equal(avoided.why['bottom-right'], 'overlaps avoid box 1');
  assert.match(avoided.reason, /^bottom-right overlaps avoid box 1; /);
  // A spot that cannot fit in the shape has no score, only a reason.
  const wide = chooseSpot(map, mask.box, 300, 40, 20, { mask });
  for (const [p, why] of Object.entries(wide.why)) if (why === 'does not fit inside the shape') assert.equal(wide.spots[p], undefined, p);
  // Busy spots say how busy.
  const noisy = Buffer.alloc(200 * 200 * 3);
  let seed = 3;
  for (let i = 0; i < noisy.length; i += 3) noisy.fill((seed = (seed * 1103515245 + 12345) % 2 ** 31) % 256, i, i + 3);
  for (let y = 0; y < 200; y++) for (let x = 0; x < 100; x++) noisy.fill(200, (y * 200 + x) * 3, (y * 200 + x) * 3 + 3);
  const half = chooseSpot(busyMap(noisy, 200, 200, 3), { left: 0, top: 0, width: 200, height: 200 }, 60, 20, 10);
  assert.equal(half.position, 'bottom-left');
  assert.match(half.why['bottom-right'], /^busy \(score \d+(\.\d)?, free is 6 or less\)$/);
});

test('when every spot is rejected, the error lists the reasons and what to do', () => {
  const area = { left: 0, top: 0, width: 400, height: 400 };
  assert.throws(
    () => chooseSpot(flatMap(400, 400), area, 100, 30, 15, { avoid: [area] }),
    (e) => e instanceof UsageError && /no spot is left for the label: bottom-right overlaps avoid box 1;/.test(e.message) && /--minimal/.test(e.message) && /--position/.test(e.message)
  );
});

test('avoid boxes, safe zones and paths are parsed and checked', () => {
  assert.deepEqual(parseAvoid('10,20,30,40', 100, 100), [{ left: 10, top: 20, width: 30, height: 40 }]);
  assert.deepEqual(parseAvoid(['0,0,50%,50%', { left: 1, top: 2, width: 3, height: 4 }], 200, 100), [
    { left: 0, top: 0, width: 100, height: 50 },
    { left: 1, top: 2, width: 3, height: 4 },
  ]);
  assert.equal(parseAvoid('1,2,3,4;5,6,7,8', 100, 100).length, 2);
  // A ";" inside one CLI value or one MCP array element holds several boxes too.
  assert.equal(parseAvoid(['1,2,3,4;5,6,7,8', '9,9,1,1'], 100, 100).length, 3);
  assert.deepEqual(parseAvoid(undefined, 10, 10), []);
  assert.throws(() => parseAvoid('1,2,3', 100, 100), /--avoid is a box the label must not cover/);
  assert.throws(() => parseAvoid('500,500,10,10', 100, 100), /--avoid .* lies outside/);

  const reels = parseSafeZone('meta-reels', 1080, 1920);
  assert.deepEqual({ ...reels, box: undefined }, { name: 'meta-reels', top: 269, right: 65, bottom: 672, left: 65, box: undefined });
  assert.deepEqual(reels.box, { left: 65, top: 269, width: 950, height: 979 });
  assert.equal(SAFE_ZONES['meta-reels'].checked, '2026-10-18');
  assert.match(SAFE_ZONES['meta-reels'].source, /^https:\/\/www\.facebook\.com\/business\/ads-guide\//);
  assert.deepEqual({ ...parseSafeZone('100,10%,200,0', 1000, 1000), box: undefined }, { name: null, top: 100, right: 100, bottom: 200, left: 0, box: undefined });
  assert.throws(() => parseSafeZone('meta-story', 100, 100), /preset \(meta-reels\) or the insets top,right,bottom,left/);
  assert.throws(() => parseSafeZone('60%,0,60%,0', 100, 100), /leaves nothing/);

  assert.equal(checkPath(' M0 0 L10 0 L5 9 Z '), 'M0 0 L10 0 L5 9 Z');
  assert.throws(() => checkPath('M0 0"/><image href="x'), /SVG path data/);
  assert.throws(() => checkPath('L0 0'), /SVG path data/);
  assert.deepEqual(parsePalette('#1f7a52, f2c94c'), ['#1f7a52', '#f2c94c']);
  assert.throws(() => parsePalette('auto'), /--palette takes your brand colours/);
  assert.throws(() => parsePalette('#1f7a52,green'), /hex colour/);
});

test('place: the same plan as stamp, without writing anything', { skip: noSharp }, async () => {
  const image = await ad();
  const dir = mkdtempSync(join(tmp, 'place-'));
  const input = join(dir, 'ad.png');
  writeFileSync(input, image);
  const before = readdirSync(dir);
  const p = await placeFrom({ input, kind: 'generated', media: 'image' });
  assert.deepEqual(readdirSync(dir), before);
  const s = await stampBuffer(image, { kind: 'generated', media: 'image' });
  assert.equal(p.version, VERSION);
  assert.deepEqual(p.label, s.label);
  assert.deepEqual(p.box, { left: s.label.left, top: s.label.top, width: s.label.width, height: s.label.height });
  const pct = (v) => Math.round((v * 10000) / 1080) / 100;
  assert.deepEqual(p.boxPercent, {
    left: pct(s.label.left),
    top: pct(s.label.top),
    width: pct(s.label.width),
    height: pct(s.label.height),
    right: pct(1080 - s.label.left - s.label.width),
    bottom: pct(1080 - s.label.top - s.label.height),
    anchor: { x: 'right', y: 'bottom' },
  });
  // cssHeight: the height as shown, in whole CSS px, for an HTML label.
  assert.equal(p.label.cssHeight, Math.ceil(p.label.displayHeight));
  assert.equal(s.label.cssHeight, p.label.cssHeight);
  const topLeft = await placeLabel(image, { kind: 'generated', position: 'top-left' });
  assert.deepEqual(topLeft.boxPercent.anchor, { x: 'left', y: 'top' });
  assert.deepEqual((await placeLabel(image, { kind: 'generated', position: 'bottom-center' })).boxPercent.anchor, { x: 'center', y: 'bottom' });
  assert.equal(p.buffer, undefined);
  assert.equal(p.metadata, undefined);
  assert.equal(p.disclosure, 'Generated with AI: image.');
  // renderArgs draw the label stamp burned in, at its height as seen (CSS px), with the form explicit.
  assert.deepEqual(p.renderArgs, { kind: 'generated', media: ['image'], lang: 'en', form: 'icon', height: Math.floor(p.label.displayHeight), theme: s.label.theme });
  const drawn = await render(p.renderArgs);
  assert.equal(drawn.height, 18);
  assert.equal(drawn.width, drawn.height);
  const coloured = await placeLabel(image, { kind: 'modified', media: 'image', full: true, color: '#1f7a52', uppercase: true });
  assert.deepEqual(coloured.renderArgs, { kind: 'modified', media: ['image'], lang: 'en', form: 'full', uppercase: true, height: Math.floor(coloured.label.displayHeight), color: '#1f7a52' });
  const pill = await render(coloured.renderArgs);
  // The same shape as the stamped pill, within rounding.
  assert.ok(Math.abs(pill.width / pill.height - coloured.box.width / coloured.box.height) < 0.02, JSON.stringify([pill.width, pill.height, coloured.box]));
  // A file path works too, and the library exports it.
  assert.deepEqual((await lib.placeLabel(input, { kind: 'generated', media: 'image' })).box, p.box);
  await assert.rejects(placeFrom({ input }), /place needs --kind/);
  await assert.rejects(placeFrom({ input: join(tmp, 'missing.png'), kind: 'generated' }), /input not found/);
});

test('region-path and region-mask: the label lands inside the shield, not in its bounding-box corner', { skip: noSharp }, async () => {
  const image = await ad();
  const byPath = await placeLabel(image, { kind: 'generated', media: 'image', regionPath: SHIELD });
  assert.equal(byPath.label.shape, 'path');
  assert.deepEqual(byPath.label.region, { left: 300, top: 200, width: 480, height: 800 });
  const margin = Math.round(byPath.box.height / 2);
  assert.ok(boxInShield(byPath.box, margin), JSON.stringify(byPath.box));
  // The same shape as a PNG with alpha, as a black-and-white PNG, and as black and white with an
  // opaque alpha channel: one placement.
  const shape = (fill, background) =>
    sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="540" height="540">${background ? `<rect width="540" height="540" fill="${background}"/>` : ''}<path transform="scale(0.5)" d="${SHIELD}" fill="${fill}"/></svg>`));
  const alpha = join(tmp, 'mask-alpha.png');
  await shape('#000').png().toFile(alpha);
  const bw = join(tmp, 'mask-bw.png');
  await shape('#fff', '#000').removeAlpha().png().toFile(bw);
  const opaque = join(tmp, 'mask-opaque.png');
  await shape('#fff', '#000').ensureAlpha().png().toFile(opaque);
  for (const regionMask of [alpha, bw, opaque]) {
    const r = await placeLabel(image, { kind: 'generated', media: 'image', regionMask });
    assert.equal(r.label.shape, 'mask', regionMask);
    assert.ok(boxInShield(r.box, margin - 2), `${regionMask}: ${JSON.stringify(r.box)}`);
  }
  // stamp takes the same shape.
  const stamped = await stampBuffer(image, { kind: 'generated', media: 'image', regionPath: SHIELD });
  assert.deepEqual(stamped.label, byPath.label);
  // label (label_image) passes the placement options on.
  const labelled = await labelImage(image, { realistic: true, regionPath: SHIELD, avoid: ['0,0,10,10'], safeZone: '0,0,0,0' });
  assert.equal(labelled.label.shape, 'path');
  assert.deepEqual(labelled.label.avoid, [{ left: 0, top: 0, width: 10, height: 10 }]);
});

test('shapes on a large non-square image: the mask is scaled per axis', { skip: noSharp }, async () => {
  // 3000×2047 gives a mask of 2048×1397 or so: one scale for both axes would push a bottom spot up.
  for (const [W, H] of [[3000, 2047], [2047, 3000]]) {
    const image = await sharp({ create: { width: W, height: H, channels: 3, background: '#cccccc' } }).png().toBuffer();
    for (const position of ['bottom-right', 'top-left']) {
      const plain = await placeLabel(image, { kind: 'generated', media: 'image', position });
      const shaped = await placeLabel(image, { kind: 'generated', media: 'image', position, regionPath: `M0 0 H${W} V${H} H0 Z` });
      assert.deepEqual(shaped.box, plain.box, `${W}×${H} ${position}`);
      assert.deepEqual(shaped.label.region, { left: 0, top: 0, width: W, height: H });
    }
  }
});

test('a spot the safe zone squeezes out of the shape says so', { skip: noSharp }, async () => {
  const image = await ad();
  // Only the shield's pointed bottom lies below 70%: the safe zone leaves no room there for a
  // bottom spot that the whole shield has.
  const r = await placeLabel(image, { kind: 'generated', media: 'image', regionPath: SHIELD, safeZone: '75%,0,0,0' }).catch((e) => e);
  assert.match(String(r.message ?? JSON.stringify(r.label?.why)), /does not fit inside the shape within the safe zone/);
});

test('shapes: one region option at a time, and an empty shape is refused', { skip: noSharp }, async () => {
  const image = await ad();
  await assert.rejects(placeLabel(image, { kind: 'generated', region: '0,0,10,10', regionPath: SHIELD }), /one of --region, --region-mask and --region-path/);
  await assert.rejects(placeLabel(image, { kind: 'generated', regionPath: 'M2000 2000 H2100 V2100 Z' }), /has no area inside the 1080×1080 image/);
  const empty = join(tmp, 'empty.png');
  await sharp({ create: { width: 20, height: 20, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toFile(empty);
  await assert.rejects(placeLabel(image, { kind: 'generated', regionMask: empty }), /--region-mask is empty/);
  await assert.rejects(placeLabel(image, { kind: 'generated', regionMask: join(tmp, 'nope.png') }), /could not read --region-mask/);
  // A frame of thin bars: its bounding box is large, but no label fits inside the shape. A given
  // position is refused, and auto lists every spot.
  const frame = 'M300 200 H780 V220 H300 Z M300 200 H320 V1000 H300 Z M760 200 H780 V1000 H760 Z';
  await assert.rejects(placeLabel(image, { kind: 'generated', media: 'image', regionPath: frame, position: 'bottom-right' }), /--position bottom-right does not fit inside the shape/);
  await assert.rejects(placeLabel(image, { kind: 'generated', media: 'image', regionPath: frame }), /no spot is left for the label: bottom-right does not fit inside the shape;/);
});

test('avoid and safe zone in a real image; a given position on an avoid box is refused', { skip: noSharp }, async () => {
  const story = await sharp({ create: { width: 1080, height: 1920, channels: 3, background: '#d8dde3' } }).png().toBuffer();
  const r = await placeLabel(story, { kind: 'generated', media: 'image', safeZone: 'meta-reels', avoid: ['540,0,540,1920'] });
  assert.deepEqual(r.label.safeZone, { name: 'meta-reels', top: 269, right: 65, bottom: 672, left: 65 });
  const { left, top, width, height } = r.box;
  assert.ok(left >= 65 && top >= 269 && left + width <= 1015 && top + height <= 1248, JSON.stringify(r.box));
  assert.ok(left + width + height / 2 <= 540, 'clear of the avoid box with its margin');
  assert.equal(r.label.position, 'bottom-left');
  assert.equal(r.label.why['bottom-right'], 'overlaps avoid box 1');
  assert.deepEqual(r.label.avoid, [{ left: 540, top: 0, width: 540, height: 1920 }]);
  await assert.rejects(placeLabel(story, { kind: 'generated', position: 'bottom-right', avoid: '540,0,540,1920' }), /--position bottom-right overlaps avoid box 1/);
  await assert.rejects(placeLabel(story, { kind: 'generated', avoid: '0,0,100%,100%' }), /no spot is left for the label/);
  const custom = await placeLabel(story, { kind: 'generated', safeZone: '10%,0,50%,0', position: 'bottom-right' });
  assert.equal(custom.label.safeZone.name, null);
  assert.ok(custom.box.top + custom.box.height <= 960);
});

test('palette: the brand colour that stands out most, used exactly as given', { skip: noSharp }, async () => {
  const image = await ad();
  const r = await stampBuffer(image, { kind: 'generated', media: 'image', palette: ['#f4f1ea', '#1f7a52'] });
  assert.deepEqual(r.label.color, { background: '#1f7a52', ink: '#ffffff', source: 'palette' });
  assert.equal(r.label.theme, 'custom');
  // None stands out from the spot: the neutral pill, with a note.
  const flat = await sharp({ create: { width: 600, height: 600, channels: 3, background: '#1f7a52' } }).png().toBuffer();
  const none = await stampBuffer(flat, { kind: 'generated', media: 'image', palette: '#1f7a52' });
  assert.ok(['light', 'dark'].includes(none.label.theme));
  assert.match(none.label.colorNote, /no palette colour stands out/);
  await assert.rejects(stampBuffer(image, { kind: 'generated', palette: '#1f7a52', color: '#ffffff' }), /pass --palette or --color, not both/);
  await assert.rejects(stampBuffer(image, { kind: 'generated', palette: '#1f7a52', theme: 'dark' }), /pass --palette or --theme, not both/);
  assert.equal((await stampBuffer(image, { kind: 'generated', palette: '#1f7a52', theme: 'auto' })).label.color.source, 'palette');
});

test('color auto with a region takes the accent from the designed part outside it', { skip: noSharp }, async () => {
  // The photo in the shield is a large pale red; the design around it has a green band.
  const image = await ad({ photo: '#e39a94' });
  const hue = (hex) => rgbToOklch(parseHex(hex))[2];
  const outside = await stampBuffer(image, { kind: 'generated', media: 'image', color: 'auto', regionPath: SHIELD });
  assert.equal(outside.label.color.source, 'auto');
  assert.equal(outside.label.color.sampled, 'outside the region');
  assert.ok(Math.abs(hue(outside.label.color.accent) - hue('#1f7a52')) < 10, outside.label.color.accent);
  const box = await stampBuffer(image, { kind: 'generated', media: 'image', color: 'auto', region: '300,200,480,800' });
  assert.equal(box.label.color.sampled, 'outside the region');
  // Without a region the whole image counts, and the red photo wins.
  const whole = await stampBuffer(image, { kind: 'generated', media: 'image', color: 'auto' });
  assert.equal(whole.label.color.source, 'auto');
  assert.equal(whole.label.color.sampled, 'whole image');
  assert.ok(Math.abs(hue(whole.label.color.accent) - hue('#e39a94')) < 15, whole.label.color.accent);
  // A region that covers over 80% of the image leaves too little outside it: the whole image.
  const big = await stampBuffer(image, { kind: 'generated', media: 'image', color: 'auto', region: '0,0,1080,1000' });
  assert.equal(big.label.color.sampled, 'whole image');
});

test('HTML label with --height: the pill is that tall; without it nothing changes', () => {
  const plain = renderHtml({ kind: 'generated', media: 'image' });
  assert.doesNotMatch(plain.html, /font-size/);
  const h24 = renderHtml({ kind: 'generated', media: 'image', height: 24 });
  // The SVG label's geometry: a disc of 24 - 2 × 3 = 18 px, so the font size is 18 / 1.875 = 9.6 px,
  // and padding of the 3 px inset less the 1px border.
  assert.match(h24.html, /^<span class="ai-label" role="note" lang="en" style="font-size:9.6px"><span class="ai-label-pill" style="min-height:0;padding:2px 1em 2px 2px">/);
  assert.match(h24.html, /<span class="ai-label-text" style="font-size:10.56px">Generated<\/span>/);
  assert.equal(h24.html.replace(/ style="(font-size|min-height)[^"]+"/g, ''), plain.html);
  // Mark, content-type icons (1.25em) and words grow with the height across 24 px.
  const geometry = (h) => {
    const html = renderHtml({ kind: 'generated', media: 'image', height: h }).html;
    const em = Number(html.match(/^<span [^>]*style="font-size:([\d.]+)px"/)[1]);
    return { mark: em * 1.875, icons: em * 1.25, word: Number(html.match(/class="ai-label-text" style="font-size:([\d.]+)px"/)[1]) };
  };
  for (let h = 22; h < 26; h++) {
    const [a, b] = [geometry(h), geometry(h + 1)];
    for (const k of ['mark', 'icons', 'word']) assert.ok(b[k] >= a[k] - 1e-9, `${k} ${h} -> ${h + 1}: ${a[k]} -> ${b[k]}`);
  }
  // Under 24 px the padding thins instead of the type: the mark is the SVG's disc, min-height is lifted.
  const minimal = renderHtml({ kind: 'generated', media: 'image', minimal: true, height: 20 });
  assert.match(minimal.html, /^<span class="ai-label" role="note" lang="en" style="font-size:8px"><span class="ai-label-pill" style="min-height:0;padding:1.5px 1em 1.5px 1.5px">/);
  const h18 = renderHtml({ kind: 'generated', media: 'image', height: 18 });
  assert.match(h18.html, /^<span class="ai-label" role="note" lang="en" style="font-size:8.533px"><span class="ai-label-pill" style="min-height:0;padding:0px 1em 0px 0px">/);
  assert.match(h18.html, /<span class="ai-label-text" style="font-size:10.5px">Generated<\/span>/);
  const h22 = renderHtml({ kind: 'generated', height: 22, uppercase: true });
  assert.match(h22.html, /class="ai-label-text"[^>]* style="font-size:10px"/);
  const bare = renderHtml({ kind: 'generated', minimal: true, height: 22 });
  assert.match(bare.html, /<span class="ai-label-pill ai-label-bare" style="min-height:0;padding:1.75px">/);
  const colour = renderHtml({ kind: 'generated', height: 48, color: '#1f7a52', uppercase: true });
  assert.match(colour.html, /style="font-size:19.2px;--ai-label-bg:#1f7a52;/);
  assert.match(colour.html, /class="ai-label-text"[^>]* style="font-size:16.32px"/);
  assert.throws(() => renderHtml({ kind: 'generated', height: 17 }), /at least 18 px/);
  assert.throws(() => renderHtml({ kind: 'generated', minimal: true, height: 18 }), /between 20 and 512/);
});

test('every result carries the version', { skip: noSharp }, async () => {
  assert.equal(decide({ media: 'image', origin: 'generated', realistic: true }).version, VERSION);
  assert.equal(decide({ media: 'image', origin: 'generated' }).version, VERSION);
  assert.equal((await render({ kind: 'generated' })).version, VERSION);
  assert.equal((await render({ kind: 'generated', format: 'html' })).version, VERSION);
  assert.equal((await render({ format: 'html', css: true })).version, VERSION);
  const image = await ad();
  assert.equal((await stampBuffer(image, { kind: 'generated' })).version, VERSION);
  assert.equal((await labelImage(image, { realistic: true })).version, VERSION);
  assert.equal((await labelImage(image, { realistic: false, onlyIfRequired: true })).version, VERSION);
  const json = JSON.parse(cli('decide', '--media', 'image', '--origin', 'human', '--json').stdout);
  assert.equal(json.version, VERSION);
  assert.equal(JSON.parse(cli('icons', '--json').stdout).version, VERSION);
});

// The JSON schema subset the tools use: types, required and known properties.
function conforms(schema, value, path = '$') {
  const types = [].concat(schema.type ?? []);
  const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
  const t = typeOf(value);
  if (types.length && !types.some((x) => x === t || (x === 'number' && t === 'integer'))) return `${path}: ${t} is not ${types.join('|')}`;
  if (t === 'object' && schema.properties) {
    for (const k of schema.required ?? []) if (!(k in value)) return `${path}.${k} is missing`;
    for (const [k, v] of Object.entries(value)) {
      if (!schema.properties[k]) return `${path}.${k} is not in the output schema`;
      const problem = conforms(schema.properties[k], v, `${path}.${k}`);
      if (problem) return problem;
    }
  }
  return null;
}

test('MCP place_label: read-only, conforms to its schema; stamp_image takes the new options', { skip: noSharp }, async () => {
  const tool = TOOLS.find((t) => t.name === 'place_label');
  assert.equal(tool.annotations.readOnlyHint, true);
  for (const k of ['region_mask', 'region_path', 'avoid', 'safe_zone', 'palette']) {
    assert.ok(tool.inputSchema.properties[k], k);
    assert.ok(TOOLS.find((t) => t.name === 'stamp_image').inputSchema.properties[k], k);
    assert.ok(TOOLS.find((t) => t.name === 'label_image').inputSchema.properties[k], k);
  }
  for (const k of ['out', 'force', 'metadata', 'return_image']) assert.equal(tool.inputSchema.properties[k], undefined, k);
  for (const t of TOOLS) assert.ok(t.outputSchema.properties.version, t.name);
  const input = join(tmp, 'mcp-ad.png');
  writeFileSync(input, await ad());
  const dispatch = createDispatcher({ allowFiles: true });
  const call = async (name, args) => (await dispatch({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })).reply.result;
  const placed = await call('place_label', { input, kind: 'generated', media: ['image'], region_path: SHIELD, avoid: ['0,0,10,10'], safe_zone: '0,0,0,0', palette: ['#1f7a52'] });
  assert.notEqual(placed.isError, true, placed.content[0].text);
  assert.equal(conforms(tool.outputSchema, placed.structuredContent), null);
  assert.equal(placed.structuredContent.version, VERSION);
  assert.ok(boxInShield(placed.structuredContent.box));
  // renderArgs go straight into render_label: snake_case, every case.
  for (const extra of [{ human: ['text'], human_text: 'Text by our team', full: true }, { color: '#1f7a52', uppercase: true }, { palette: ['#1f7a52', '#f2c94c'], minimal: true }, { text: 'Own words', kind: 'basic' }, {}, { form: 'short' }]) {
    const p = await call('place_label', { input, kind: 'generated', media: ['image'], ...extra });
    assert.notEqual(p.isError, true, p.content[0].text);
    const drawn = await call('render_label', p.structuredContent.renderArgs);
    assert.notEqual(drawn.isError, true, `${JSON.stringify(extra)}: ${drawn.content[0].text}`);
    assert.equal(drawn.structuredContent.height, Math.max(18, Math.floor(p.structuredContent.label.displayHeight)));
    const html = await call('render_label', { ...p.structuredContent.renderArgs, format: 'html', height: p.structuredContent.label.cssHeight });
    assert.notEqual(html.isError, true, html.content[0].text);
  }
  assert.equal(Object.keys((await call('place_label', { input, kind: 'generated', human: ['text'], human_text: 'x' })).structuredContent.renderArgs).includes('humanText'), false);
  // stamp_image and label_image results with the new label fields conform to their schemas.
  const placement = { region_path: SHIELD, avoid: ['600,600,200,200'], safe_zone: 'meta-reels', palette: ['#1f7a52', '#f2c94c'] };
  const stamped = await call('stamp_image', { input, kind: 'generated', media: ['image'], out: join(tmp, 'mcp-stamped.png'), ...placement });
  assert.notEqual(stamped.isError, true, stamped.content[0].text);
  for (const k of ['why', 'shape', 'safeZone', 'avoid', 'cssHeight']) assert.ok(k in stamped.structuredContent.label, k);
  assert.equal(conforms(TOOLS.find((t) => t.name === 'stamp_image').outputSchema, stamped.structuredContent), null);
  const labelled = await call('label_image', { input, realistic: true, out: join(tmp, 'mcp-labelled.png'), color: 'auto', region_path: SHIELD, avoid: placement.avoid, safe_zone: 'meta-reels' });
  assert.notEqual(labelled.isError, true, labelled.content[0].text);
  assert.equal(conforms(TOOLS.find((t) => t.name === 'label_image').outputSchema, labelled.structuredContent), null);
  const eu = await call('eu_icon', { name: 'basic' });
  assert.equal(eu.structuredContent.version, VERSION);
  const unknownPreset = await call('place_label', { input, kind: 'generated', safe_zone: 'tiktok' });
  assert.equal(unknownPreset.isError, true);
  assert.match(unknownPreset.content[0].text, /safe_zone \(CLI: --safe-zone\) is a preset \(meta-reels\)/);
  // With file paths off (HTTP mode) a mask file is refused; a path shape still works.
  const http = createDispatcher({ allowFiles: false });
  const base64 = (await ad()).toString('base64');
  const refused = (await http({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'place_label', arguments: { input_base64: base64, kind: 'generated', region_mask: input } } })).reply.result;
  assert.equal(refused.isError, true);
  assert.match(refused.content[0].text, /file paths are turned off/);
  const ok = (await http({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'place_label', arguments: { input_base64: base64, kind: 'generated', region_path: SHIELD } } })).reply.result;
  assert.notEqual(ok.isError, true, ok.content[0].text);
});

test('CLI place: label, box and render lines; --avoid repeats; --json has the version', { skip: noSharp }, async () => {
  const input = join(tmp, 'cli-story.png');
  await sharp({ create: { width: 1080, height: 1350, channels: 3, background: '#ccd5dd' } }).png().toFile(input);
  const r = cli('place', input, '--kind', 'generated', '--media', 'image', '--avoid', '800,1100,280,250', '--avoid', '0,1100,300,250');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^label: 50×50 px, icon, black disc, bottom-center \(auto: bottom-right overlaps avoid box 1; bottom-center is free\)/);
  assert.match(r.stdout, /\nskipped: bottom-right overlaps avoid box 1; bottom-left overlaps avoid box 2\n/);
  assert.match(r.stdout, /\nbox: left \d+, top \d+, \d+×\d+ px of 1080×1350; in %: left [\d.]+%, top [\d.]+%, width [\d.]+%, height [\d.]+%\n/);
  assert.match(r.stdout, /\nrender: ai-labels render --kind generated --media image --lang en --form icon --height 18 --theme light\n/);
  assert.deepEqual(readdirSync(tmp).filter((f) => f.startsWith('cli-story')), ['cli-story.png']);
  const j = JSON.parse(cli('place', input, '--kind', 'generated', '--json').stdout);
  assert.equal(j.version, VERSION);
  assert.ok(j.boxPercent && j.renderArgs);
  assert.equal(cli('place', input).status, 2);
  assert.match(cli('place', input, '--kind', 'generated', '--out', 'x.png').stderr, /unknown option for place: --out/);
  assert.match(cli('place').stderr, /place needs an image/);
  const shield = cli('stamp', input, '--kind', 'generated', '--region-path', 'M0 0 H1080 V1000 L540 1350 L0 1000 Z', '--safe-zone', 'meta-reels', '--palette', '#1f7a52', '--out', join(tmp, 'cli-out.png'));
  assert.equal(shield.status, 0, shield.stderr);
  assert.match(shield.stdout, /#1f7a52 pill \(from --palette\)/);
  // The render line pastes into a POSIX shell: a "#" would start a comment, so such values are quoted.
  const coloured = cli('place', input, '--kind', 'basic', '--text', "Joe's AI #1", '--color', '#1f7a52');
  assert.equal(coloured.status, 0, coloured.stderr);
  const line = coloured.stdout.match(/\nrender: (.*)\n/)[1];
  assert.match(line, / --text 'Joe'\\''s AI #1' /);
  assert.match(line, / --color '#1f7a52'$/);
  if (spawnSync('sh', ['-c', 'true']).status === 0) {
    const words = spawnSync('sh', ['-c', `printf '[%s]' ${line.replace(/^ai-labels /, '')}`], { encoding: 'utf8' }).stdout;
    assert.match(words, /\[--text\]\[Joe's AI #1\]/);
    assert.match(words, /\[--color\]\[#1f7a52\]$/);
  }
});
