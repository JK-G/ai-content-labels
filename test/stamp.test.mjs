import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { createRequire } from 'node:module';
import { mergeXmp, digitalSourceXmp, autoHeight, LABEL_NS } from '../skills/ai-content-labels/scripts/lib/stamp.mjs';
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

test('auto height: 6% of the shorter side, 2.5% of the longer, between 28 and 512 px', () => {
  assert.equal(autoHeight(720, 1280), 43);
  assert.equal(autoHeight(1600, 240), 40);
  assert.equal(autoHeight(1080, 1080), 65);
  assert.equal(autoHeight(1600, 1200), 72);
  assert.equal(autoHeight(300, 200), 28);
  assert.equal(autoHeight(12000, 12000), 512);
  assert.doesNotThrow(() => renderLabel({ height: autoHeight(12000, 12000) }));
});

test('mergeXmp marks the file as visibly labelled, once', () => {
  assert.ok(digitalSourceXmp('generated').includes(LABEL_NS));
  assert.ok(mergeXmp(packet('<rdf:Description/>'), 'modified').includes(LABEL_NS));
  const twice = mergeXmp(mergeXmp(packet(''), 'generated'), 'generated');
  assert.equal(twice.split(LABEL_NS).length, 2);
});

test('the theme is the one that stands out more from the image', { skip: !sharp && 'sharp not installed' }, async () => {
  const mid = await stamp(await flat('g155.png', 155), { media: 'image' });
  assert.equal(mid.label.theme, 'dark');
  assert.ok(mid.label.separation > 5);
  const darker = await stamp(await flat('g100.png', 100), { media: 'image' });
  assert.equal(darker.label.theme, 'light');
});

test('stamp refuses to overwrite, to stamp twice or onto itself; force overrides', { skip: !sharp && 'sharp not installed' }, async () => {
  const input = await flat('twice.png', 200, 800, 600);
  const first = await stamp(input, { media: 'image' });
  assert.ok(isAbsolute(first.output) && existsSync(first.output));
  await assert.rejects(stamp(input, { media: 'image' }), /exists; pass --force/);
  await assert.doesNotReject(stamp(input, { media: 'image', force: true }));
  await assert.rejects(stamp(first.output, { media: 'image', out: join(tmp, 'again.png') }), /already labelled by name/);
  await assert.rejects(stamp(input, { media: 'image', out: input }), /--out must differ/);
  const copy = join(tmp, 'copy.png');
  await sharp(first.output).keepMetadata().png().toFile(copy);
  await assert.rejects(stamp(copy, { media: 'image' }), /already labelled \(an ai-content-labels marker/);
  // A contradictory label is reported first, even when the output already exists.
  await assert.rejects(stamp(input, { media: 'image,text', human: 'text' }), /text is in both --media and --human/);
});

test('an AI image with a DigitalSourceType from its generator can still be stamped', { skip: !sharp && 'sharp not installed' }, async () => {
  const input = join(tmp, 'from-generator.png');
  const fromGenerator = packet(
    '<rdf:Description rdf:about="" xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/"><Iptc4xmpExt:DigitalSourceType>http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia</Iptc4xmpExt:DigitalSourceType></rdf:Description>'
  );
  await sharp({ create: { width: 800, height: 600, channels: 3, background: '#888' } }).withXmp(fromGenerator).png().toFile(input);
  await assert.doesNotReject(stamp(input, { media: 'image' }));
});

test('a label with text needs 24 px; minimal stamps go down to 20', { skip: !sharp && 'sharp not installed' }, async () => {
  const input = await flat('floor.png', 240, 800, 600);
  await assert.rejects(stamp(input, { media: 'image', height: 20, out: join(tmp, 'f1.png') }), /at least 24 px/);
  const r = await stamp(input, { media: 'image', height: 20, minimal: true, out: join(tmp, 'f2.png') });
  assert.equal(r.label.height, 20);
});
