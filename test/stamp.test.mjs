import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, copyFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { createRequire } from 'node:module';
import { mergeXmp, digitalSourceXmp, autoHeight, labelledAs, LABEL_NS } from '../skills/ai-content-labels/scripts/lib/stamp.mjs';
import { renderLabel } from '../skills/ai-content-labels/scripts/lib/render.mjs';
import { stamp } from '../skills/ai-content-labels/scripts/lib/api.mjs';

let sharp = null;
try {
  sharp = createRequire(import.meta.url)('sharp');
} catch {}
const tmp = mkdtempSync(join(tmpdir(), 'ai-labels-stamp-'));
const flat = async (name, grey, w = 400, h = 400) => {
  const file = join(tmp, name);
  await sharp({ create: { width: w, height: h, channels: 3, background: { r: grey, g: grey, b: grey } } }).png().toFile(file);
  return file;
};

const packet = (body) =>
  `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">${body}</rdf:RDF></x:xmpmeta>`;

test('mergeXmp adds the tag and keeps the rest', () => {
  const merged = mergeXmp(packet('<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>Ann</dc:creator></rdf:Description>'), 'generated');
  assert.match(merged, /<dc:creator>Ann<\/dc:creator>/);
  assert.match(merged, /<Iptc4xmpExt:DigitalSourceType>http:\/\/cv\.iptc\.org\/newscodes\/digitalsourcetype\/trainedAlgorithmicMedia</);
  assert.ok(merged.indexOf('DigitalSourceType') < merged.indexOf('</rdf:RDF>'));
});

test('mergeXmp replaces an existing value in element or attribute form', () => {
  const el = mergeXmp(packet('<rdf:Description><Iptc4xmpExt:DigitalSourceType>http://x/digitalCapture</Iptc4xmpExt:DigitalSourceType></rdf:Description>'), 'modified');
  assert.match(el, /compositeWithTrainedAlgorithmicMedia/);
  assert.doesNotMatch(el, /digitalCapture/);
  const attr = mergeXmp(packet('<rdf:Description Iptc4xmpExt:DigitalSourceType="http://x/digitalCapture"/>'), 'generated');
  assert.match(attr, /DigitalSourceType="http:\/\/cv\.iptc\.org\/newscodes\/digitalsourcetype\/trainedAlgorithmicMedia"/);
});

test('mergeXmp starts a packet when there is none or it is unreadable', () => {
  assert.equal(mergeXmp(undefined, 'generated'), digitalSourceXmp('generated'));
  assert.equal(mergeXmp('garbage', 'generated'), digitalSourceXmp('generated'));
});

test('auto height: the smallest legible size full width on a phone, 18 px for the icon and words, 20 minimal, up to 512', () => {
  assert.equal(autoHeight(1080), 50); // ceil(18 × 1080 / 390)
  assert.equal(autoHeight(1080, { form: 'icon' }), 50);
  assert.equal(autoHeight(1080, { form: 'short' }), 50);
  assert.equal(autoHeight(1080, { minimal: true }), 56);
  assert.equal(autoHeight(1080, { form: 'minimal' }), 56);
  assert.equal(autoHeight(1600), 74);
  // Narrower than a phone: shown 1:1, so the legible size itself.
  assert.equal(autoHeight(300), 18);
  assert.equal(autoHeight(200, { minimal: true }), 20);
  // Shown wider than the phone: smaller in the file, never below the legible size.
  assert.equal(autoHeight(1080, { displayWidth: 1080 }), 18);
  assert.equal(autoHeight(12000), 512);
  // The 0.3 call shape (width, height) still works.
  assert.equal(autoHeight(1080, 1080), 50);
  assert.doesNotThrow(() => renderLabel({ height: autoHeight(12000) }));
});

test('mergeXmp marks the file as visibly labelled, once', () => {
  assert.ok(digitalSourceXmp('generated').includes(LABEL_NS));
  assert.ok(mergeXmp(packet('<rdf:Description/>'), 'modified').includes(LABEL_NS));
  const twice = mergeXmp(mergeXmp(packet(''), 'generated'), 'generated');
  assert.equal(twice.split(LABEL_NS).length, 2);
});

test('the marker is written for every kind; the DigitalSourceType only when asked', () => {
  const human = mergeXmp(packet(''), 'human', { sourceType: null });
  assert.match(human, /<aicl:VisibleLabel>human<\/aicl:VisibleLabel>/);
  assert.doesNotMatch(human, /DigitalSourceType/);
  assert.doesNotMatch(digitalSourceXmp('basic'), /DigitalSourceType/);
  assert.doesNotMatch(mergeXmp(undefined, 'generated', { sourceType: null }), /DigitalSourceType/);
  assert.equal(labelledAs(human), 'human');
  assert.equal(labelledAs(packet('')), null);
  // A forced restamp records the new kind.
  assert.match(mergeXmp(human, 'generated'), /<aicl:VisibleLabel>generated<\/aicl:VisibleLabel>/);
});

test('the theme is the one that stands out more from the image', { skip: !sharp && 'sharp not installed' }, async () => {
  const mid = await stamp(await flat('g155.png', 155), { kind: 'generated', media: 'image', short: true });
  assert.equal(mid.label.theme, 'dark');
  assert.ok(mid.label.separation > 5);
  const darker = await stamp(await flat('g100.png', 100), { kind: 'generated', media: 'image', short: true });
  assert.equal(darker.label.theme, 'light');
  // The icon: the black disc (theme light) on a light image, the white one (theme dark) on a dark one.
  const light = await stamp(await flat('g220.png', 220), { kind: 'generated', media: 'image' });
  assert.deepEqual([light.label.form, light.label.theme, light.label.disc], ['icon', 'light', 'black']);
  const dark = await stamp(await flat('g40.png', 40), { kind: 'generated', media: 'image' });
  assert.deepEqual([dark.label.form, dark.label.theme, dark.label.disc], ['icon', 'dark', 'white']);
});

test('stamp refuses to overwrite, to stamp twice or onto itself; force overrides', { skip: !sharp && 'sharp not installed' }, async () => {
  const input = await flat('twice.png', 200, 800, 600);
  const first = await stamp(input, { kind: 'generated', media: 'image' });
  assert.ok(isAbsolute(first.output) && existsSync(first.output));
  await assert.rejects(stamp(input, { kind: 'generated', media: 'image' }), /exists; pass --force/);
  await assert.doesNotReject(stamp(input, { kind: 'generated', media: 'image', force: true }));
  await assert.rejects(stamp(first.output, { kind: 'generated', media: 'image', out: join(tmp, 'again.png') }), /already labelled by name/);
  await assert.rejects(stamp(input, { kind: 'generated', media: 'image', out: input }), /--out must differ/);
  const copy = join(tmp, 'copy.png');
  await sharp(first.output).keepMetadata().png().toFile(copy);
  await assert.rejects(stamp(copy, { kind: 'generated', media: 'image' }), /already labelled as generated \(an ai-content-labels marker/);
  // A contradictory label is reported first, even when the output already exists.
  await assert.rejects(stamp(input, { kind: 'generated', media: 'image,text', human: 'text' }), /text is in both --media and --human/);
});

test('an AI image with a DigitalSourceType from its generator can still be stamped', { skip: !sharp && 'sharp not installed' }, async () => {
  const input = join(tmp, 'from-generator.png');
  const fromGenerator = packet(
    '<rdf:Description rdf:about="" xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/"><Iptc4xmpExt:DigitalSourceType>http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia</Iptc4xmpExt:DigitalSourceType></rdf:Description>'
  );
  await sharp({ create: { width: 800, height: 600, channels: 3, background: '#888' } }).withXmp(fromGenerator).png().toFile(input);
  await assert.doesNotReject(stamp(input, { kind: 'generated', media: 'image' }));
});

test('a human-made or untagged stamp still cannot be stamped over after a rename', { skip: !sharp && 'sharp not installed' }, async () => {
  const input = await flat('rename.png', 120, 800, 600);
  const human = await stamp(input, { kind: 'human', media: 'image', out: join(tmp, 'h.png') });
  assert.match(human.metadata, /marker only: IPTC has no DigitalSourceType term/);
  const xmp = (await sharp(human.output).metadata()).xmp.toString();
  assert.match(xmp, /aicl:VisibleLabel>human/);
  assert.doesNotMatch(xmp, /DigitalSourceType/);
  copyFileSync(human.output, join(tmp, 'h2.png'));
  await assert.rejects(stamp(join(tmp, 'h2.png'), { kind: 'generated', media: 'image', out: join(tmp, 'h3.png') }), /already labelled as human/);
  const bare = await stamp(input, { kind: 'generated', media: 'image', metadata: false, out: join(tmp, 'n.png') });
  assert.match(bare.metadata, /--no-metadata/);
  assert.doesNotMatch((await sharp(bare.output).metadata()).xmp.toString(), /DigitalSourceType/);
  copyFileSync(bare.output, join(tmp, 'n2.png'));
  await assert.rejects(stamp(join(tmp, 'n2.png'), { kind: 'generated', media: 'image', out: join(tmp, 'n3.png') }), /already labelled as generated/);
});

test('two parallel stamps to one output: one wins, no partial file is left', { skip: !sharp && 'sharp not installed' }, async () => {
  const dir = mkdtempSync(join(tmp, 'race-'));
  const input = join(dir, 'in.png');
  await sharp({ create: { width: 800, height: 600, channels: 3, background: '#777' } }).png().toFile(input);
  const out = join(dir, 'out.png');
  const results = await Promise.allSettled([stamp(input, { kind: 'generated', media: 'image', out }), stamp(input, { kind: 'generated', media: 'image', out })]);
  assert.equal(results.filter((r) => r.status === 'rejected').length, 1);
  assert.match(results.find((r) => r.status === 'rejected').reason.message, /being written by another call/);
  await assert.rejects(stamp(input, { kind: 'generated', media: 'image', out: join(dir, 'bad.gif') }), /GIF output is not supported/);
  assert.deepEqual(readdirSync(dir).filter((f) => f.endsWith('.part')), []);
  assert.deepEqual(readdirSync(dir).sort(), ['in.png', 'out.png']);
});

test('folders and animated images are refused with what to do instead', { skip: !sharp && 'sharp not installed' }, async () => {
  await assert.rejects(stamp(tmp, { kind: 'generated', media: 'image' }), /input is a folder; stamp takes one file/);
  const frame = (c) => sharp({ create: { width: 200, height: 200, channels: 3, background: c } }).png().toBuffer();
  const anim = join(tmp, 'anim.webp');
  await sharp([await frame('#f00'), await frame('#00f')], { join: { animated: true } }).webp().toFile(anim);
  await assert.rejects(stamp(anim, { kind: 'generated', media: 'image', minimal: true }), /animated images are not supported yet \(2 frames\)/);
});

test('alt is null without a description, and the result says what to pass', { skip: !sharp && 'sharp not installed' }, async () => {
  const input = await flat('alt.png', 90, 800, 600);
  const r = await stamp(input, { kind: 'generated', media: 'image', out: join(tmp, 'alt-out.png') });
  assert.equal(r.alt, null);
  assert.match(r.altMissing, /pass description/);
  assert.notEqual(r.alt, r.disclosure);
  assert.equal(r.wcag, true);
  const d = await stamp(input, { kind: 'generated', media: 'image', description: 'A wolf.', out: join(tmp, 'alt-out2.png') });
  assert.equal(d.alt, 'A wolf. Generated with AI: image.');
  assert.equal(d.altMissing, undefined);
  const low = await stamp(input, { kind: 'generated', media: 'image', short: true, backgroundOpacity: 0.3, allowLowContrast: true, out: join(tmp, 'alt-out3.png') });
  assert.equal(low.wcag, false);
});

test('the icon and a label with text need 18 px; minimal stamps need 20', { skip: !sharp && 'sharp not installed' }, async () => {
  const input = await flat('floor.png', 240, 800, 600);
  await assert.rejects(stamp(input, { kind: 'generated', media: 'image', short: true, height: 17, out: join(tmp, 'f1.png') }), /at least 18 px/);
  await assert.rejects(stamp(input, { kind: 'generated', media: 'image', height: 17, out: join(tmp, 'f1.png') }), /at least 18 px/);
  await assert.rejects(stamp(input, { kind: 'generated', media: 'image', minimal: true, height: 19, out: join(tmp, 'f1.png') }), /between 20 and 512 px/);
  const r = await stamp(input, { kind: 'generated', media: 'image', height: 18, short: true, out: join(tmp, 'f2.png') });
  assert.equal(r.label.height, 18);
  const m = await stamp(input, { kind: 'generated', media: 'image', height: 20, minimal: true, out: join(tmp, 'f3.png') });
  assert.equal(m.label.height, 20);
});

test('the label is the smallest legible size where the image is shown, a phone by default', { skip: !sharp && 'sharp not installed' }, async () => {
  // A 1080 px feed post shown full width on a 390 px phone: 50 px in the file, 18 px as shown.
  const post = await flat('post.png', 200, 1080, 1350);
  const plain = await stamp(post, { kind: 'generated', media: 'image', out: join(tmp, 'post-a.png') });
  assert.deepEqual([plain.label.form, plain.label.height, plain.label.width], ['icon', 50, 50]);
  assert.equal(plain.label.displayWidth, 390);
  assert.ok(plain.label.displayHeight >= 18 && plain.label.displayHeight < 19);
  assert.equal(plain.label.minDisplayWidth, Math.ceil((18 * 1080) / 50));
  const word = await stamp(post, { kind: 'generated', media: 'image', short: true, out: join(tmp, 'post-w.png') });
  assert.deepEqual([word.label.form, word.label.height], ['short', 50]);
  const minimal = await stamp(post, { kind: 'generated', media: 'image', minimal: true, out: join(tmp, 'post-b.png') });
  assert.equal(minimal.label.height, 56);
  assert.ok(minimal.label.displayHeight >= 20);
  // Shown wider than on a phone (a desktop-only page): smaller in the file, never below 18 px.
  const wide = await stamp(post, { kind: 'generated', media: 'image', displayWidth: 1080, out: join(tmp, 'post-c.png') });
  assert.equal(wide.label.height, 18);
  // --height with --display-width: that size, laid out for that width.
  const both = await stamp(post, { kind: 'generated', short: true, displayWidth: 1080, height: 40, out: join(tmp, 'post-d.png') });
  assert.deepEqual([both.label.height, both.label.displayHeight], [40, 40]);
  await assert.rejects(stamp(post, { kind: 'generated', displayWidth: '39.5', out: join(tmp, 'post-e.png') }), /whole CSS px/);
});
