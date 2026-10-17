import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeXmp, digitalSourceXmp, autoHeight } from '../skills/ai-content-labels/scripts/lib/stamp.mjs';

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

test('auto height is 4.5% of the shorter side, at least 28 px, with no upper cap', () => {
  assert.equal(autoHeight(1080, 1080), 49);
  assert.equal(autoHeight(300, 200), 28);
  assert.equal(autoHeight(6000, 4000), 180);
});
