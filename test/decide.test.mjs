import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide } from '../skills/ai-content-labels/scripts/lib/decide.mjs';

test('a realistic AI image is a deep fake: label required, generated icon, burned in', () => {
  const d = decide({ media: 'image', origin: 'generated', realistic: true });
  assert.equal(d.required, true);
  assert.match(d.basis, /Article 50\(4\)/);
  assert.equal(d.officialIcon, 'generated');
  assert.deepEqual(d.label, { kind: 'generated', media: ['image'], lang: 'en' });
  assert.ok(d.placement.some((p) => /stamp/.test(p)));
  assert.equal(d.altText, 'Generated with AI: image.');
});

test('a stylised AI illustration needs no label, but gets the same advice', () => {
  const d = decide({ media: 'image', origin: 'generated', realistic: false });
  assert.equal(d.required, false);
  assert.equal(d.label.kind, 'generated');
});

test('a creative deep fake: required, label need not be embedded but must be seen at first exposure', () => {
  const d = decide({ media: 'video', origin: 'modified', realistic: true, creative: true });
  assert.equal(d.required, true);
  assert.equal(d.officialIcon, 'modified');
  assert.ok(d.notes.some((n) => /need not be embedded/.test(n) && /first exposure/.test(n) && /Commitment 3/.test(n)));
  assert.ok(!d.placement.some((p) => /Burn it/.test(p)));
});

test('public-interest text: required without editorial review, not with it', () => {
  assert.equal(decide({ media: 'text', origin: 'generated', publicInterest: true }).required, true);
  assert.equal(decide({ media: 'text', origin: 'generated', publicInterest: true, editorialReview: true }).required, false);
  assert.equal(decide({ media: 'text', origin: 'generated', publicInterest: false }).required, false);
});

test('audio needs an audible disclaimer', () => {
  const d = decide({ media: 'audio', origin: 'generated', realistic: true });
  assert.equal(d.required, true);
  assert.ok(d.placement.some((p) => /audible disclaimer/.test(p)));
});

test('human-made content: no duty, human label with a warning', () => {
  const d = decide({ media: 'text', origin: 'human', lang: 'pl' });
  assert.equal(d.required, false);
  assert.equal(d.label.kind, 'human');
  assert.equal(d.officialIcon, null);
  assert.equal(d.altText, 'Stworzone przez człowieka: tekst.');
});

test('standard edits only: no duty, basic label optional', () => {
  const d = decide({ media: 'image', origin: 'assisted', realistic: true });
  assert.equal(d.required, false);
  assert.equal(d.label.kind, 'basic');
});

test('CLI-style yes/no strings are understood', () => {
  assert.equal(decide({ media: 'image', origin: 'generated', realistic: 'yes' }).required, true);
  assert.equal(decide({ media: 'image', origin: 'generated', realistic: 'no' }).required, false);
});

test('unknown values are rejected', () => {
  assert.throws(() => decide({ media: 'hologram' }), /media/);
  assert.throws(() => decide({ media: 'image', origin: 'alien' }), /origin/);
});

test('no verdict without the deciding fact: image, video and audio need realistic', () => {
  for (const media of ['image', 'video', 'audio']) {
    const d = decide({ media, origin: 'generated' });
    assert.equal(d.required, 'unknown');
    assert.match(d.question, /--realistic or --no-realistic/);
    assert.equal(d.basis, undefined);
    assert.equal(d.placement, undefined);
    assert.deepEqual(d.label, { kind: 'generated', media: [media], lang: 'en' });
  }
  assert.equal(decide({ media: 'image', origin: 'modified', realistic: 'false' }).required, false);
});

test('no verdict without the deciding fact: text needs public interest', () => {
  const d = decide({ media: 'text', origin: 'modified' });
  assert.equal(d.required, 'unknown');
  assert.match(d.question, /--public-interest or --no-public-interest/);
});

test('media and origin are both required', () => {
  assert.throws(() => decide({}), /needs --media and --origin/);
  assert.throws(() => decide({ media: 'image' }), /needs --media and --origin/);
  assert.throws(() => decide({ media: 'image', origin: 'generated', realistic: 'maybe' }), /true or false/);
});

test('verdicts carry the Guidelines test, the deployer scope and no "No duty" prefix', () => {
  const yes = decide({ media: 'image', origin: 'generated', realistic: true });
  assert.match(yes.basis, /foreseeable audience, including children/);
  assert.match(yes.sources.guidelines, /20 July 2026/);
  assert.ok(yes.notes.some((n) => n.startsWith('The duty falls on the deployer')));
  assert.match(yes.disclaimer, /not legal advice/);
  const no = decide({ media: 'image', origin: 'generated', realistic: false });
  assert.doesNotMatch(no.basis, /^No duty/);
  assert.match(no.basis, /foreseeable audience/);
  assert.ok(!no.notes.some((n) => /deployer/.test(n)));
});

test('editorial review exception asks for named responsibility; human mark is not an EU icon', () => {
  const t = decide({ media: 'text', origin: 'generated', publicInterest: true, editorialReview: true });
  assert.match(t.basis, /editorial responsibility and how to contact them/);
  const h = decide({ media: 'image', origin: 'human' });
  assert.ok(h.notes.some((n) => /not an EU icon/.test(n)));
});

test('accessibility advice fits the media', () => {
  const text = decide({ media: 'text', origin: 'generated', publicInterest: true }).accessibility.join(' ');
  assert.doesNotMatch(text, /burned into an image/);
  assert.doesNotMatch(text, /during a video/);
  const image = decide({ media: 'image', origin: 'generated', realistic: true }).accessibility.join(' ');
  assert.match(image, /what it shows, then the label sentence/);
  assert.doesNotMatch(image, /during a video/);
  assert.match(decide({ media: 'video', origin: 'generated', realistic: true }).accessibility.join(' '), /during a video/);
});
