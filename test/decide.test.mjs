import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide } from '../skills/ai-content-labels/scripts/lib/decide.mjs';

test('a realistic AI image is a deep fake: label required, generated icon, burned in', () => {
  const d = decide({ media: 'image', origin: 'generated', realistic: true });
  assert.equal(d.required, true);
  assert.match(d.basis, /Article 50\(4\)/);
  assert.equal(d.euIcon, 'generated');
  assert.deepEqual(d.label, { kind: 'generated', media: ['image'] });
  assert.ok(d.placement.some((p) => /stamp/.test(p)));
  assert.equal(d.altText, 'Generated with AI: image.');
});

test('a stylised AI illustration needs no label, but gets the same advice', () => {
  const d = decide({ media: 'image', origin: 'generated', realistic: false });
  assert.equal(d.required, false);
  assert.equal(d.label.kind, 'generated');
});

test('a creative deep fake: required, but a caption is enough', () => {
  const d = decide({ media: 'video', origin: 'modified', realistic: true, creative: true });
  assert.equal(d.required, true);
  assert.equal(d.euIcon, 'modified');
  assert.ok(d.notes.some((n) => /does not hamper/.test(n)));
  assert.ok(!d.placement.some((p) => /Burn it/.test(p)));
});

test('public-interest text: required without editorial review, not with it', () => {
  assert.equal(decide({ media: 'text', origin: 'generated', publicInterest: true }).required, true);
  assert.equal(decide({ media: 'text', origin: 'generated', publicInterest: true, editorialReview: true }).required, false);
  assert.equal(decide({ media: 'text', origin: 'generated' }).required, false);
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
  assert.equal(d.euIcon, null);
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
