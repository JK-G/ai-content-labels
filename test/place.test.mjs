import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { chooseSpot, busyMap, busyness, spotAt, parseRegion, FREE } from '../skills/ai-content-labels/scripts/lib/place.mjs';
import { parseColor, colorTheme, accentColor, accentTones, rgbToOklch } from '../skills/ai-content-labels/scripts/lib/color.mjs';
import { contrastRatio, parseHex, WCAG } from '../skills/ai-content-labels/scripts/lib/contrast.mjs';
import { stampBuffer } from '../skills/ai-content-labels/scripts/lib/stamp.mjs';
import { labelImage } from '../skills/ai-content-labels/scripts/lib/label.mjs';

let sharp = null;
try {
  sharp = createRequire(import.meta.url)('sharp');
} catch {}
const noSharp = !sharp && 'sharp not installed';

// A flat grey RGB image with noisy ("busy") boxes, as raw pixels.
function picture(w, h, busy = [], grey = 230) {
  const data = Buffer.alloc(w * h * 3, grey);
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) * 255;
  for (const b of busy) {
    for (let y = b.top; y < b.top + b.height; y++) {
      for (let x = b.left; x < b.left + b.width; x++) data.fill(Math.round(rnd()), (y * w + x) * 3, (y * w + x) * 3 + 3);
    }
  }
  return data;
}
const whole = (w, h) => ({ left: 0, top: 0, width: w, height: h });
const corner = (name, w, h) => {
  const half = { width: w / 2, height: h / 4 };
  return {
    'bottom-right': { left: w / 2, top: (3 * h) / 4, ...half },
    'bottom-left': { left: 0, top: (3 * h) / 4, ...half },
    'bottom-center': { left: w / 4, top: (3 * h) / 4, ...half },
    'top-right': { left: w / 2, top: 0, ...half },
  }[name];
};

test('a free bottom-right corner is taken first', () => {
  const map = busyMap(picture(200, 200), 200, 200, 3);
  const spot = chooseSpot(map, whole(200, 200), 60, 20, 10);
  assert.equal(spot.position, 'bottom-right');
  assert.equal(spot.reason, 'bottom-right is free');
  assert.deepEqual([spot.left, spot.top], [130, 170]);
  assert.ok(spot.spots['bottom-right'] <= FREE);
});

test('a busy bottom-right moves the label to the freer of bottom centre and bottom left', () => {
  const busyRight = picture(200, 200, [corner('bottom-right', 200, 200)]);
  const spot = chooseSpot(busyMap(busyRight, 200, 200, 3), whole(200, 200), 60, 20, 10);
  assert.equal(spot.position, 'bottom-left');
  assert.match(spot.reason, /bottom-right is busy/);
  const busyBottom = picture(200, 200, [corner('bottom-right', 200, 200), corner('bottom-left', 200, 200)]);
  assert.equal(chooseSpot(busyMap(busyBottom, 200, 200, 3), whole(200, 200), 60, 20, 10).position, 'top-right');
});

test('when nothing is free, the least busy spot wins, with a handicap for the later tiers', () => {
  const noisy = picture(200, 200, [whole(200, 200)]);
  const spot = chooseSpot(busyMap(noisy, 200, 200, 3), whole(200, 200), 60, 20, 10);
  assert.equal(spot.position, 'bottom-right');
  assert.match(spot.reason, /no spot is free/);
});

test('busyness is near 0 on flat colour and high on noise', () => {
  const map = busyMap(picture(100, 100, [{ left: 50, top: 0, width: 50, height: 100 }]), 100, 100, 3);
  assert.ok(busyness(map, { left: 0, top: 0, width: 40, height: 100 }) < 1);
  assert.ok(busyness(map, { left: 60, top: 0, width: 40, height: 100 }) > 30);
});

test('named spots sit margin px inside the area', () => {
  const area = { left: 100, top: 50, width: 400, height: 300 };
  assert.deepEqual(spotAt('bottom-right', area, 80, 20, 10), { left: 410, top: 320 });
  assert.deepEqual(spotAt('bottom-center', area, 80, 20, 10), { left: 260, top: 320 });
  assert.deepEqual(spotAt('top-left', area, 80, 20, 10), { left: 110, top: 60 });
});

test('a region takes px, % or an object, and is clipped to the image', () => {
  assert.deepEqual(parseRegion('100,50,400,300', 1000, 800), { left: 100, top: 50, width: 400, height: 300 });
  assert.deepEqual(parseRegion('50%,25%,50%,75%', 1000, 800), { left: 500, top: 200, width: 500, height: 600 });
  assert.deepEqual(parseRegion({ left: 900, top: 700, width: 400, height: 400 }, 1000, 800), { left: 900, top: 700, width: 100, height: 100 });
  assert.equal(parseRegion(undefined, 10, 10), null);
  assert.throws(() => parseRegion('1,2,3', 10, 10), /x,y,width,height/);
  assert.throws(() => parseRegion('a,2,3,4', 10, 10), /x,y,width,height/);
  assert.throws(() => parseRegion('2000,0,10,10', 1000, 800), /outside/);
});

test('colours: hex or auto; the ink always keeps 4.5:1 on the pill', () => {
  assert.equal(parseColor('#1F7A52'), '#1f7a52');
  assert.equal(parseColor('abc'), '#aabbcc');
  assert.equal(parseColor('AUTO'), 'auto');
  assert.equal(parseColor(undefined), null);
  assert.throws(() => parseColor('green'), /hex colour/);
  for (let v = 0; v < 256; v += 15) {
    for (const hex of [`#${v.toString(16).padStart(2, '0')}8040`, `#40${v.toString(16).padStart(2, '0')}80`, `#${v.toString(16).padStart(2, '0').repeat(3)}`]) {
      const t = colorTheme(hex);
      assert.ok(contrastRatio(parseHex(t.ink), parseHex(hex)) >= WCAG.text, `${hex} with ${t.ink}`);
      assert.equal(t.eu, t.ink === '#ffffff' ? 'white' : 'black');
    }
  }
});

test('accent tones keep the hue and reach 4.5:1 with white and with the dark ink', () => {
  const green = rgbToOklch([34, 160, 107]);
  const { dark, light } = accentTones(green);
  assert.ok(contrastRatio([255, 255, 255], parseHex(dark)) >= 4.6);
  assert.ok(contrastRatio(parseHex('#1d1d1b'), parseHex(light)) >= 4.6);
  for (const tone of [dark, light]) assert.ok(Math.abs(rgbToOklch(parseHex(tone))[2] - green[2]) < 8, tone);
});

test('the accent is the strongest colour, not the largest pale area; a grey image has none', () => {
  // 90% pale mint, 10% brand green.
  const data = Buffer.alloc(100 * 3);
  for (let i = 0; i < 100; i++) data.set(i < 90 ? [232, 248, 238] : [34, 160, 107], i * 3);
  const accent = accentColor(data, 3);
  assert.ok(Math.abs(accent.oklch[2] - rgbToOklch([34, 160, 107])[2]) < 5);
  assert.equal(accentColor(Buffer.alloc(300, 128), 3), null);
});

// A light graphic with a brand-green bar and "text" (noise) in the bottom-right corner.
async function graphic() {
  const w = 600;
  const h = 600;
  const raw = picture(w, h, [{ left: 380, top: 500, width: 220, height: 100 }], 240);
  for (let y = 40; y < 100; y++) for (let x = 40; x < 560; x++) raw.set([34, 160, 107], (y * w + x) * 3);
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}

test('stamp: auto placement avoids a busy corner, a given position is kept', { skip: noSharp }, async () => {
  const input = await graphic();
  const auto = await stampBuffer(input, { kind: 'generated', media: 'image', minimal: true });
  assert.equal(auto.label.placement, 'auto');
  assert.notEqual(auto.label.position, 'bottom-right');
  assert.ok(auto.label.position.startsWith('bottom'));
  const given = await stampBuffer(input, { kind: 'generated', media: 'image', minimal: true, position: 'bottom-right' });
  assert.equal(given.label.position, 'bottom-right');
  assert.equal(given.label.placement, 'given');
  assert.equal(given.label.reason, undefined);
});

test('stamp: a region puts the label on that part of the image', { skip: noSharp }, async () => {
  const input = await graphic();
  const r = await stampBuffer(input, { kind: 'generated', media: 'image', minimal: true, region: '0,150,300,300' });
  const { left, top, width, height } = r.label;
  assert.ok(left >= 0 && left + width <= 300 && top >= 150 && top + height <= 450, JSON.stringify(r.label));
  assert.deepEqual(r.label.region, { left: 0, top: 150, width: 300, height: 300 });
  await assert.rejects(stampBuffer(input, { kind: 'generated', media: 'image', region: '0,0,60,30' }), /region \(60×30\) is too small/);
});

test('stamp: a given colour is used as is; auto takes the accent and keeps 4.5:1', { skip: noSharp }, async () => {
  const input = await graphic();
  const given = await stampBuffer(input, { kind: 'generated', media: 'image', color: '#1f7a52', position: 'bottom-left', format: 'png' });
  assert.equal(given.label.theme, 'custom');
  assert.deepEqual(given.label.color, { background: '#1f7a52', ink: '#ffffff', source: 'given' });
  // The pill between the disc and the word: a small pill has a thin inset, so the disc nearly meets its edge.
  const px = await sharp(given.buffer).extract({ left: given.label.left + Math.round(given.label.height * 1.08), top: given.label.top + Math.round(given.label.height / 2), width: 1, height: 1 }).raw().toBuffer();
  assert.deepEqual([...px].slice(0, 3), parseHex('#1f7a52'));
  const auto = await stampBuffer(input, { kind: 'generated', media: 'image', color: 'auto' });
  assert.equal(auto.label.color.source, 'auto');
  assert.ok(Math.abs(rgbToOklch(parseHex(auto.label.color.background))[2] - rgbToOklch([34, 160, 107])[2]) < 8);
  assert.ok(auto.contrast >= WCAG.text && auto.wcag);
  const grey = await sharp({ create: { width: 300, height: 300, channels: 3, background: '#777777' } }).png().toBuffer();
  const neutral = await stampBuffer(grey, { kind: 'generated', media: 'image', color: 'auto' });
  assert.ok(['light', 'dark'].includes(neutral.label.theme));
  assert.match(neutral.label.colorNote, /no clear accent colour/);
  await assert.rejects(stampBuffer(input, { kind: 'generated', color: '#1f7a52', theme: 'dark' }), /--theme or --color/);
});

test('label_image: the EU icon alone, required or voluntary, and the caller can pick', { skip: noSharp }, async () => {
  const input = await graphic();
  const voluntary = await labelImage(input, { realistic: false, voluntary: true });
  assert.equal(voluntary.label.form, 'icon');
  assert.equal((await labelImage(input, { realistic: 'unsure' })).label.form, 'icon');
  const required = await labelImage(input, { realistic: true });
  assert.equal(required.label.form, 'icon');
  assert.equal((await labelImage(input, { realistic: true, short: true })).label.form, 'short');
  assert.equal((await labelImage(input, { realistic: true, form: 'minimal' })).label.form, 'minimal');
  assert.equal((await labelImage(input, { realistic: false, voluntary: true, full: true })).label.form, 'full');
  assert.equal((await labelImage(input, { realistic: false, voluntary: true, minimal: false })).label.form, 'short');
  assert.equal((await labelImage(input, { realistic: true, minimal: true })).label.form, 'minimal');
});

test('review fixes: theme auto is accepted, short with minimal is refused, a shrunk label warns', { skip: noSharp }, async () => {
  const input = await graphic();
  assert.equal((await stampBuffer(input, { kind: 'generated', media: 'image', theme: 'auto' })).label.placement, 'auto');
  const { stampFrom } = await import('../skills/ai-content-labels/scripts/lib/api.mjs');
  assert.ok((await stampFrom({ input, kind: 'generated', theme: 'auto', color: '#1f7a52' })).result.label.color);
  await assert.rejects(stampBuffer(input, { kind: 'generated', short: true, minimal: true }), /--short and --minimal contradict/);
  assert.equal((await stampBuffer(input, { kind: 'generated', media: 'image' })).warning, undefined);
  const banner = await sharp({ create: { width: 4000, height: 300, channels: 3, background: '#dddddd' } }).png().toBuffer();
  const wide = await stampBuffer(banner, { kind: 'generated', media: 'image' });
  assert.ok(wide.label.displayHeight < 24);
  assert.match(wide.warning, /under the legible 18 px\. Put the label next to the image$/);
  const wideWord = await stampBuffer(banner, { kind: 'generated', media: 'image', short: true });
  assert.match(wideWord.warning, /under the legible 18 px\. Use the icon form \(--form icon\) or put the label next to the image$/);
});

test('review fixes: no accent from empty data; an accent pill that would blend in falls back to neutral', { skip: noSharp }, async () => {
  assert.equal(accentColor(Buffer.alloc(0), 3), null);
  const flatGreen = await sharp({ create: { width: 400, height: 400, channels: 3, background: '#1f7a52' } }).png().toBuffer();
  const r = await stampBuffer(flatGreen, { kind: 'generated', media: 'image', color: 'auto' });
  assert.ok(['light', 'dark'].includes(r.label.theme));
  assert.match(r.label.colorNote, /would blend into the spot/);
});
