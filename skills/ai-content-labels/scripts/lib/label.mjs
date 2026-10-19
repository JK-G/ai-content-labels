import { decide } from './decide.mjs';
import { stampFrom } from './api.mjs';
import { UsageError, parseBoolean } from './i18n.mjs';
import { VERSION } from './version.mjs';

// One call for an agent that has just generated or edited an image: decide which label the image
// needs (media image, origin generated, or modified with opts.modified), then stamp it when the
// label is required, or when the realism answer is "unsure" (a precaution, in the form a required
// label gets). A voluntary label is not stamped unless opts.voluntary is true: labels are there for
// compliance, not decoration. opts.onlyIfRequired is the default since 0.6.0 and does nothing.

// Options passed on to the stamp. kind, media and lang come from decide.
const STAMP_OPTIONS = ['description', 'text', 'position', 'region', 'regionMask', 'regionPath', 'avoid', 'safeZone', 'palette', 'displayWidth', 'color', 'out', 'force', 'metadata', 'returnImage', 'form', 'icon', 'minimal', 'short', 'full', 'theme', 'uppercase', 'inputBase64', 'mime'];

export class NeedsAnswer extends UsageError {
  constructor(decision) {
    super(
      `${decision.question} Pass realistic true or false (CLI: --realistic or --no-realistic). Ask the user if you cannot tell; if you cannot ask, or nobody knows, pass realistic "unsure" (CLI: --realistic unsure) and the label is added as a precaution.`
    );
    this.code = 'NEEDS_ANSWER';
    this.missing = decision.missing;
    this.question = decision.question;
    this.decision = decision;
  }
}

// The note of a label_image result when nothing was stamped.
export const NOT_LABELLED =
  'Not labelled, and no file written: the label is voluntary for this image, so publish the original. To label it anyway, pass voluntary: true (CLI: --voluntary).';
const DEPRECATED = 'only_if_required (CLI: --only-if-required) is the default since 0.6.0 and has no effect; leave it out.';

// The alt text of an image without a label: the description alone, ending in a full stop.
const plainAlt = (description) => {
  if (!description) return null;
  const d = String(description).replace(/\s+$/, '');
  return /[.!?…]$/.test(d) ? d : `${d}.`;
};

// input: a file path, an http(s) URL or a Buffer (or null with opts.inputBase64). policy is
// { allowFiles, allowPrivate } as for stampFrom. The result has the verdict, whether the label is
// required (true, false, or "unsure" for a precaution), whether it was stamped, the output path
// (null when nothing was written: a labelled image is then in `buffer`), the alt text, the label
// sentence (disclosure), the label box and the metadata written. When nothing is stamped, nothing
// is written either, not even to opts.out: output, label and disclosure are null, and alt is the
// description alone.
export async function labelImage(input, opts = {}, policy = {}) {
  const modified = parseBoolean(opts.modified, 'modified') ?? false;
  const voluntary = parseBoolean(opts.voluntary, 'voluntary') ?? false;
  const onlyIfRequired = parseBoolean(opts.onlyIfRequired, 'only_if_required');
  if (onlyIfRequired && voluntary) throw new UsageError('only_if_required and voluntary contradict; pass voluntary alone to label voluntary images too');
  const decision = decide({ media: 'image', origin: modified ? 'modified' : 'generated', realistic: opts.realistic, creative: opts.creative, lang: opts.lang, voluntary });
  if (decision.required === 'unknown') throw new NeedsAnswer(decision);
  const head = { version: VERSION, verdict: decision.verdict, required: decision.required, officialIcon: decision.officialIcon };
  const notes = onlyIfRequired === undefined ? [] : [DEPRECATED];
  if (!decision.next) {
    return {
      ...head,
      stamped: false,
      output: null,
      label: null,
      alt: plainAlt(opts.description),
      disclosure: null,
      note: [NOT_LABELLED, ...notes].join(' '),
    };
  }
  const stampOpts = Object.fromEntries(STAMP_OPTIONS.filter((k) => opts[k] != null).map((k) => [k, opts[k]]));
  const suggested = { ...decision.next.arguments };
  const { result, image } = await stampFrom({ ...stampOpts, ...suggested, input: input ?? undefined }, policy);
  if (decision.precaution) {
    notes.unshift('Labelled as a precaution: the answer to whether people would take it for real was unsure, and if they would, the label is required. If you learn that nobody would take it for real, the label is voluntary and you can publish the original instead.');
  }
  if (decision.required === false) notes.unshift('The label is voluntary here and was added because voluntary is set.');
  if (decision.required && opts.creative && parseBoolean(opts.creative, 'creative')) {
    notes.push('For an evidently creative work the label may also sit next to the image, in the description or in the credits, as long as people see it at first sight.');
  }
  return {
    ...head,
    ...(decision.precaution && { precaution: true }),
    stamped: true,
    ...result,
    ...(notes.length && { note: notes.join(' ') }),
    ...(image && { buffer: image.buffer }),
  };
}
