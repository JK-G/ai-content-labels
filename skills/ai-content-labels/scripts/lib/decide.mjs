import { UsageError, sentence } from './i18n.mjs';

// Which label a piece of content needs under Article 50(4) of the EU AI Act, read together with the
// EU icon guidance and the Code of Practice on marking and labelling AI-generated content
// (10 June 2026). It covers deployers: people and companies who publish AI content. It is a
// checklist, not legal advice; the sources are in `SOURCES`.

export const SOURCES = {
  act: 'Regulation (EU) 2024/1689 (AI Act), Article 50(4) and 50(5), and the deep fake definition in Article 3(60)',
  icons: 'https://digital-strategy.ec.europa.eu/en/policies/eu-icons-labelling-ai-generated-content',
  code: 'https://digital-strategy.ec.europa.eu/en/policies/code-practice-ai-generated-content',
};

const ORIGINS = ['generated', 'modified', 'assisted', 'human'];
const MEDIA = ['image', 'video', 'audio', 'text'];

const yes = (v) => v === true || v === 'yes' || v === 'true' || v === 1;

export function decide(input = {}) {
  const media = input.media ?? 'image';
  const origin = input.origin ?? 'generated';
  if (!MEDIA.includes(media)) throw new UsageError(`media must be one of: ${MEDIA.join(', ')}`);
  if (!ORIGINS.includes(origin)) throw new UsageError(`origin must be one of: ${ORIGINS.join(', ')}`);
  const realistic = yes(input.realistic);
  const creative = yes(input.creative);
  const publicInterest = yes(input.publicInterest);
  const editorialReview = yes(input.editorialReview);
  const lang = input.lang ?? 'en';

  const out = {
    required: false,
    basis: '',
    label: null,
    officialIcon: null,
    placement: [],
    accessibility: [],
    notes: [],
    sources: SOURCES,
    disclaimer: 'A checklist based on the AI Act and the EU guidance, not legal advice. Commission guidelines on Article 50 may refine it.',
  };

  if (origin === 'human') {
    out.basis = 'No duty: the AI Act does not regulate human-made content.';
    out.label = { kind: 'human', media: [media] };
    out.notes.push(
      'A "human-made" label is a claim to your audience. Use it only when no generative AI produced or changed this part; AI spell-check or noise reduction is a judgement call, so say so if in doubt.',
      'The human-made label must not look like the EU AI icon.'
    );
    return finish(out, lang);
  }

  if (origin === 'assisted') {
    out.basis =
      'No duty, on this reading: content that AI touched only with standard edits (colour correction, noise reduction, spelling) is not "generated or manipulated" in the sense of the deep fake definition (Article 3(60)), as long as the edit does not change what it shows or says. Article 50(2) has an explicit exception of this kind for providers ("an assistive function for standard editing").';
    out.label = { kind: 'basic', media: [media] };
    out.notes.push('A label is optional here. If the edit changes what the content shows or says, treat it as "modified" instead.');
    return finish(out, lang);
  }

  const kind = origin; // generated | modified
  out.label = { kind, media: [media] };
  out.officialIcon = kind;
  out.notes.push(
    `Labels from render and stamp use the basic EU icon with this text, which the EU guidance allows. The official icon with the same meaning, in English only, is available unchanged: "eu ${kind}".`
  );

  if (media === 'text') {
    if (publicInterest && !editorialReview) {
      out.required = true;
      out.basis = 'Article 50(4), second subparagraph: AI-generated or AI-manipulated text published to inform the public on matters of public interest, without human review or editorial control.';
    } else if (publicInterest) {
      out.basis = 'No duty: the text had human review or editorial control and someone holds editorial responsibility (Article 50(4) exception). Keep a record of who that is.';
      out.notes.push('Labelling is still a good practice and builds trust.');
    } else {
      out.basis = 'No duty: the text is not published to inform the public on matters of public interest. Labelling is a voluntary good practice.';
    }
    if (out.required) {
      out.placement.push('Put the label at the start of the text or right next to its headline, so readers see it before they read.');
    } else {
      out.placement.push('If you label it, place the label next to the headline or byline.');
    }
    return finish(out, lang);
  }

  if (realistic) {
    out.required = true;
    out.basis =
      'Article 50(4), first subparagraph: a deep fake, meaning AI-generated or AI-manipulated content that resembles existing persons, objects, places, entities or events and would falsely appear authentic (Article 3(60)). This includes realistic product, place and event images, not only people.';
    if (creative) {
      out.notes.push(
        'Evidently artistic, creative, satirical or fictional work: disclose in a way that does not hamper the display or enjoyment of the work. The label does not have to be embedded in the content itself; a caption or credit line can do.'
      );
    }
  } else {
    out.basis = 'No duty: the content does not look like a real person, object, place or event (it is clearly illustrative or stylised). Labelling is a voluntary good practice.';
  }

  const placement = {
    image: [
      'Burn the label into the image pixels (the `stamp` command), so it stays visible when the image is downloaded or reshared.',
      'Use a corner where platforms do not draw their own buttons or captions; the label must be visible at first sight, with nothing covering it.',
    ],
    video: [
      'Show the label from the first frame and keep it on screen for the whole video (or at least long enough to be read and understood).',
      'Burn it into the frames so it survives downloads and reshares; place it away from the player controls.',
      'If only some parts are AI (for example the voice in certain scenes), keep the persistent label and add per-segment icons on top of it, never instead of it.',
    ],
    audio: [
      'Audio-only content cannot show a visual label: add an audible disclaimer at the start (for example "This recording contains a voice generated with AI").',
      'Where the audio has a player, cover art or a page, show the visual label there too.',
    ],
  };
  if (creative) {
    out.placement.push('For a creative work a caption, credit line or player overlay is enough, placed so it does not hamper the work.');
    if (media === 'audio') out.placement.push(placement.audio[0]);
  } else {
    out.placement.push(...placement[media]);
  }
  return finish(out, lang);
}

function finish(out, lang) {
  out.accessibility.push(
    'Give the content an alt text or aria-label that includes the label sentence; text burned into an image is invisible to screen readers.',
    'Keep the label large enough to read on the smallest screen where the content appears; ai-content-labels guarantees 4.5:1 text contrast on any backdrop.',
    'Do not animate or flash the label (WCAG 2.3.1); a label that changes during a video must stay on screen long enough to be read.'
  );
  if (out.label) out.altText = sentence({ kind: out.label.kind, media: out.label.media, lang });
  return out;
}

