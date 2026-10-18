import { decide } from './decide.mjs';
import { stampFrom } from './api.mjs';
import { UsageError, parseBoolean } from './i18n.mjs';

// One call for an agent that has just generated or edited an image: decide which label the image
// needs (media image, origin generated, or modified with opts.modified), then stamp that label.
// The agent knows the image is AI; the one fact it must still give is whether the audience would
// take it for real (opts.realistic). By default it stamps a voluntary label too, because labelling
// AI images is good practice; opts.onlyIfRequired skips the stamp when the label is not a duty.

// Options passed on to the stamp. kind, media and lang come from decide.
const STAMP_OPTIONS = ['description', 'text', 'position', 'region', 'displayWidth', 'color', 'out', 'force', 'metadata', 'returnImage', 'minimal', 'short', 'full', 'theme', 'uppercase', 'inputBase64', 'mime'];
// The form the caller chose wins over the one decide suggests.
const FORM_OPTIONS = ['minimal', 'short', 'full'];

export class NeedsAnswer extends UsageError {
  constructor(decision) {
    super(`${decision.question} Pass realistic true or false (CLI: --realistic or --no-realistic).`);
    this.code = 'NEEDS_ANSWER';
    this.missing = decision.missing;
    this.question = decision.question;
    this.decision = decision;
  }
}

// input: a file path, an http(s) URL or a Buffer (or null with opts.inputBase64). policy is
// { allowFiles, allowPrivate } as for stampFrom. The result has the verdict, whether the label is
// required, whether it was stamped, the output path (null when nothing was written: the labelled
// image is then in `buffer`), the alt text, the label sentence (disclosure), the label box and the
// metadata written.
export async function labelImage(input, opts = {}, policy = {}) {
  const modified = parseBoolean(opts.modified, 'modified') ?? false;
  const decision = decide({ media: 'image', origin: modified ? 'modified' : 'generated', realistic: opts.realistic, creative: opts.creative, lang: opts.lang });
  if (decision.required === 'unknown') throw new NeedsAnswer(decision);
  const head = { verdict: decision.verdict, required: decision.required, officialIcon: decision.officialIcon };
  const onlyIfRequired = parseBoolean(opts.onlyIfRequired, 'only_if_required') ?? false;
  if (onlyIfRequired && !decision.required) {
    return {
      ...head,
      stamped: false,
      output: null,
      label: null,
      alt: opts.description ?? null,
      disclosure: decision.disclosure,
      note: 'Not stamped: the label is voluntary for this image and only-if-required is set. Labelling AI images is still good practice.',
    };
  }
  const stampOpts = Object.fromEntries(STAMP_OPTIONS.filter((k) => opts[k] != null).map((k) => [k, opts[k]]));
  const suggested = { ...decision.next.arguments };
  if (FORM_OPTIONS.some((k) => opts[k] != null)) delete suggested.minimal;
  const { result, image } = await stampFrom({ ...stampOpts, ...suggested, input: input ?? undefined }, policy);
  const notes = [];
  if (!decision.required) notes.push('The label is voluntary here and was stamped as good practice; pass only-if-required to skip voluntary labels.');
  if (decision.required && opts.creative && parseBoolean(opts.creative, 'creative')) {
    notes.push('For an evidently creative work the label may also sit next to the image, in the description or in the credits, as long as people see it at first sight.');
  }
  return {
    ...head,
    stamped: true,
    ...result,
    ...(notes.length && { note: notes.join(' ') }),
    ...(image && { buffer: image.buffer }),
  };
}
