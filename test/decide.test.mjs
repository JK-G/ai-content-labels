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
  assert.equal(d.disclosure, 'Generated with AI: image.');
  assert.equal(d.altText, undefined);
  assert.equal(d.verdict, 'REQUIRED: realistic AI image, a deep fake under Article 50(4)');
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
  assert.equal(decide({ media: 'text', origin: 'generated', publicInterest: true, editorialReview: false }).required, true);
  assert.equal(decide({ media: 'text', origin: 'generated', publicInterest: true, editorialReview: true }).required, false);
  assert.equal(decide({ media: 'text', origin: 'generated', publicInterest: false }).required, false);
});

test('public-interest text without an answer on editorial review: ask, do not guess', () => {
  for (const origin of ['generated', 'modified']) {
    const d = decide({ media: 'text', origin, publicInterest: true });
    assert.equal(d.required, 'unknown');
    assert.equal(d.missing, 'editorial_review');
    assert.match(d.question, /fact-checked/);
    assert.doesNotMatch(d.question, /--/);
  }
  assert.equal(decide({ media: 'text', origin: 'generated', publicInterest: true, editorialReview: 'true' }).required, false);
  assert.equal(decide({ media: 'text', origin: 'generated', publicInterest: true, editorialReview: 'false' }).required, true);
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
  assert.equal(d.disclosure, 'Stworzone przez człowieka: tekst.');
  assert.equal(d.verdict, 'NOT REQUIRED: human-made content');
});

test('the alt text example is built from the label sentence, so a human verdict shows no AI sentence', () => {
  const h = decide({ media: 'image', origin: 'human' }).accessibility[0];
  assert.match(h, /Made by a human: image\./);
  assert.doesNotMatch(h, /Generated with AI/);
  // A placeholder, never a ready description someone could paste onto an unrelated image.
  assert.match(decide({ media: 'image', origin: 'generated', realistic: true }).accessibility[0], /alt="<what the image shows>\. Generated with AI: image\."/);
  assert.match(decide({ media: 'image', origin: 'generated', realistic: true, lang: 'pl' }).accessibility[0], /alt="<co przedstawia obraz>\. Wygenerowane przez AI: obraz\."/);
  for (const media of ['image', 'video', 'audio', 'text']) {
    assert.doesNotMatch(JSON.stringify(decide({ media, origin: 'generated', realistic: true, publicInterest: false })), /house|dom wśród/i);
  }
  // Image guidance (describe what it shows) only for images.
  for (const media of ['video', 'audio', 'text']) assert.doesNotMatch(decide({ media, origin: 'generated', realistic: true, publicInterest: false }).accessibility[0], /what the image shows/);
});

test('every verdict carries the next step as data: the MCP tool, its arguments and the CLI line', () => {
  const image = decide({ media: 'image', origin: 'generated', realistic: true, lang: 'pl' }).next;
  assert.equal(image.tool, 'stamp_image');
  assert.deepEqual(image.arguments, { kind: 'generated', media: ['image'], lang: 'pl' });
  assert.deepEqual(image.fill, ['input', 'description']);
  assert.equal(image.cli, 'ai-labels stamp <image> --kind generated --media image --lang pl --description "what it shows"');
  const text = decide({ media: 'text', origin: 'generated', publicInterest: true, editorialReview: false }).next;
  assert.equal(text.tool, 'render_label');
  assert.equal(text.arguments.format, 'html');
  assert.equal(text.note, 'at the top of the text');
  assert.equal(decide({ media: 'video', origin: 'modified', realistic: true }).next.tool, 'render_label');
  assert.deepEqual(decide({ media: 'video', origin: 'modified', realistic: true }).next.fill, ['out', 'height']);
  assert.match(decide({ media: 'audio', origin: 'generated', realistic: true }).next.note, /spoken disclaimer/);
  // Voluntary verdicts get one too; a language without wording asks for the text.
  assert.equal(decide({ media: 'image', origin: 'human' }).next.arguments.kind, 'human');
  const de = decide({ media: 'image', origin: 'generated', realistic: true, lang: 'de' }).next;
  assert.ok(de.fill.includes('text'));
  assert.match(de.cli, /--lang de --text "label in that language"/);
  // No next step while decide still has a question.
  assert.equal(decide({ media: 'image', origin: 'generated' }).next, undefined);
});

test('languages: any EU code; without built-in wording the sentence is left to the user', () => {
  const de = decide({ media: 'image', origin: 'generated', realistic: true, lang: 'de' });
  assert.equal(de.required, true);
  assert.equal(de.disclosure, null);
  assert.deepEqual(de.label, { kind: 'generated', media: ['image'], lang: 'de' });
  assert.ok(de.notes.some((n) => /no built-in wording for "de"/.test(n)));
  assert.equal(decide({ media: 'image', origin: 'generated', lang: 'fr' }).disclosure, null);
  assert.throws(() => decide({ media: 'image', origin: 'generated', realistic: true, lang: 'xx' }), /24 EU codes/);
});

test('video, audio and animation advice follows the Code and WCAG', () => {
  const video = decide({ media: 'video', origin: 'generated', realistic: true });
  assert.match(video.placement[0], /Sub-measure 1\.2\.2\(b\)/);
  assert.match(video.accessibility[0], /WCAG 1\.2\.5/);
  assert.match(video.accessibility[0], /captions alone do not reach blind viewers/);
  assert.match(video.accessibility.join(' '), /WCAG 2\.2\.2/);
  const audio = decide({ media: 'audio', origin: 'modified', realistic: true, lang: 'pl' });
  assert.match(audio.placement[0], /To nagranie zawiera głos wygenerowany przez AI/);
  assert.match(audio.placement[0], /Sub-measure 1\.2\.3/);
  assert.match(audio.accessibility[0], /WCAG 1\.2\.1/);
  const human = decide({ media: 'image', origin: 'human' }).notes.join(' ');
  assert.match(human, /Measure 2\.1/);
  assert.match(human, /2005\/29\/EC/);
});

test('every verdict has a short verdict line', () => {
  const cases = [
    { media: 'image', origin: 'generated', realistic: true },
    { media: 'video', origin: 'modified', realistic: true, creative: true },
    { media: 'image', origin: 'generated', realistic: false },
    { media: 'text', origin: 'generated', publicInterest: true, editorialReview: true },
    { media: 'text', origin: 'generated', publicInterest: true, editorialReview: false },
    { media: 'text', origin: 'generated', publicInterest: false },
    { media: 'image', origin: 'assisted' },
    { media: 'audio', origin: 'human' },
  ];
  for (const c of cases) {
    const d = decide(c);
    assert.match(d.verdict, d.required ? /^REQUIRED/ : /^NOT REQUIRED/);
    assert.ok(d.verdict.length < 90, d.verdict);
  }
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
    assert.equal(d.missing, 'realistic');
    assert.match(d.question, /genuine photo/);
    assert.doesNotMatch(d.question, /--/);
    assert.equal(d.disclosure, `Generated with AI: ${media}.`);
    assert.equal(d.basis, undefined);
    assert.equal(d.placement, undefined);
    assert.deepEqual(d.label, { kind: 'generated', media: [media], lang: 'en' });
  }
  assert.equal(decide({ media: 'image', origin: 'modified', realistic: 'false' }).required, false);
});

test('no verdict without the deciding fact: text needs public interest', () => {
  const d = decide({ media: 'text', origin: 'modified' });
  assert.equal(d.required, 'unknown');
  assert.equal(d.missing, 'public_interest');
  assert.match(d.question, /matter of public interest/);
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
  const text = decide({ media: 'text', origin: 'generated', publicInterest: true, editorialReview: false }).accessibility.join(' ');
  assert.doesNotMatch(text, /burned into an image/);
  assert.doesNotMatch(text, /during a video/);
  const image = decide({ media: 'image', origin: 'generated', realistic: true }).accessibility.join(' ');
  assert.match(image, /what it shows, then the label sentence/);
  assert.doesNotMatch(image, /during a video/);
  assert.match(decide({ media: 'video', origin: 'generated', realistic: true }).accessibility.join(' '), /during a video/);
});

test('the video rule is the Code\'s, and the whole-video advice is marked as this project\'s', () => {
  const [rule] = decide({ media: 'video', origin: 'generated', realistic: true }).placement;
  assert.match(rule, /^Show the label from the first frame, repeat it at regular intervals where possible and at least after every break/);
  assert.match(rule, /The Code also encourages keeping it on screen for the whole video or the whole AI part; this project recommends that/);
  assert.doesNotMatch(rule, /keep it on screen for the whole video\. If you cannot/);
});

test('image advice points social posts to --display-width', () => {
  assert.match(decide({ media: 'image', origin: 'generated', realistic: true }).placement[1], /--display-width 390/);
});
