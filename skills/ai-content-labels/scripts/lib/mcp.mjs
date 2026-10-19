// The MCP tools and the JSON-RPC dispatch behind both transports (stdio and HTTP). No dependencies.
//
// Dual-era: a request whose params._meta carries "io.modelcontextprotocol/protocolVersion" is served
// statelessly as the 2026-07-28 revision describes (server/discover, resultType, serverInfo in the
// result's _meta, UnsupportedProtocolVersion errors). Anything else is the legacy era: `initialize`,
// then plain requests, exactly as in 0.1.0.
import { render, decideLabel, eu, stampFrom, placeFrom, FILES_OFF } from './api.mjs';
import { labelImage } from './label.mjs';
import { KINDS, MEDIA, EU_LANGS, UsageError } from './i18n.mjs';
import { POSITIONS, EU_ICONS, EU_VARIANTS, FORMS } from './render.mjs';
import { VERSION } from './version.mjs';

export const MODERN_VERSIONS = ['2026-07-28'];
export const LEGACY_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
export const SUPPORTED_VERSIONS = [...MODERN_VERSIONS, ...LEGACY_VERSIONS];
export const META = {
  protocolVersion: 'io.modelcontextprotocol/protocolVersion',
  clientCapabilities: 'io.modelcontextprotocol/clientCapabilities',
  serverInfo: 'io.modelcontextprotocol/serverInfo',
};
export const ERRORS = { headerMismatch: -32020, unsupportedVersion: -32022 };
const SERVER_INFO = { name: 'ai-content-labels', version: VERSION };

const PATH_NOTE = "Absolute path recommended; a relative path resolves against the server's working directory, which may not be your project.";

const INSTRUCTIONS =
  'Label AI-generated and human-made content with the official EU icon. Labels are for compliance, not decoration: an AI label is added only when the EU AI Act requires it, or when a deciding fact is unsure. ' +
  'If you generated or edited an image yourself, call label_image right after: it decides and, when the label is required, stamps it in one call. You answer realistic honestly; if you cannot tell, ask the user, and if you cannot ask or the user does not know, pass realistic "unsure" and the label is added as a precaution. ' +
  'Where the label is only voluntary, label_image adds nothing and writes no file (stamped: false): publish the original. Pass voluntary: true only when the user wants voluntary labels too. ' +
  'For anything else call decide_label first; if it returns required:"unknown", ask the user its question and call it again (next then holds the call with that answer "unsure", for when nobody can answer). ' +
  "When decide_label's next is null the label is voluntary and nothing more is needed. Otherwise make the call in next: next.tool with next.arguments unchanged, plus the arguments named in next.fill (stamp_image for image files, render_label with format html for web pages and UI). " +
  'For an HTML page or UI where the label is drawn as HTML or SVG over an image, call place_label instead of stamp_image: it writes nothing and returns the spot (box, boxPercent with its anchor) and renderArgs; draw the label with render_label and those arguments at boxPercent. renderArgs.height is the height the label is laid out at, right for an SVG scaled to boxPercent.width; for format html the height is in CSS px: pass label.cssHeight. ' +
  'Look at the image yourself and pass avoid boxes for faces, people, the product or subject, and text: the automatic spot sees only texture. ' +
  'Alt text = a short description of what the image shows, then the label sentence (disclosure); pass description so the result has it composed as alt. alt is null until you pass description; never publish disclosure as the alt of the image. ' +
  'render_label also returns labelAlt, the alt of an <img> that shows the label on its own. ' +
  'When the label is a legal duty, also put the sentence in a visible caption. If a stamp fails with NO_SHARP, show the user the install command from the error.';

const labelProps = {
  kind: { type: 'string', enum: KINDS, description: 'generated (fully AI), modified (real content changed by AI), basic (AI involved, use with text), human (made by a person)' },
  media: { type: 'array', items: { type: 'string', enum: MEDIA }, description: 'What was made with AI (or by a human for kind=human); shown as icons' },
  human: { type: 'array', items: { type: 'string', enum: MEDIA }, description: 'Parts made by a human, shown as a second label next to the AI one' },
  lang: { type: 'string', enum: EU_LANGS, description: 'Label language, default en. Built-in wording: en, pl; other EU languages need text (and human_text)' },
  text: { type: 'string', description: 'Own label text instead of the default wording' },
  human_text: { type: 'string', description: 'Own text for the human-made part' },
  description: { type: 'string', description: 'What the image shows, one short phrase; it goes before the label sentence in the alt text' },
  form: {
    type: 'string',
    enum: FORMS,
    description:
      'icon: the EU "AI" disc alone, 18 px, the default of stamp_image, label_image and place_label for AI labels (Code of Practice Measure 1.1(a)). minimal: the disc and the content-type icons in a pill. short: the disc and one word ("Generated", the wording of the EU icons), the default of render_label and of human-made labels. full: "Generated with AI". The booleans icon, minimal, short and full do the same',
  },
  icon: { type: 'boolean', description: 'Same as form: "icon"' },
  short: { type: 'boolean', description: 'Same as form: "short": one word next to the EU "AI" disc. Add it when the user wants the word' },
  full: { type: 'boolean', description: 'Same as form: "full": the full wording, e.g. "Generated with AI"' },
  uppercase: { type: 'boolean', description: 'Upper case with letter spacing, like the EU icons' },
  minimal: {
    type: 'boolean',
    description: 'Same as form: "minimal": the author mark (EU "AI" disc, or a hand in the same disc) and the content-type icons in a pill, no text',
  },
  color: {
    type: 'string',
    description:
      'Pill colour as hex, e.g. #1f7a52; the text turns white or dark to keep 4.5:1 contrast. stamp_image, label_image and place_label also take auto: the accent colour of the image (outside the region when one is given and the rest is at least 20% of the image), toned to keep 4.5:1. For a brand colour pass it as hex or in palette',
  },
  height: { type: 'integer', description: 'Label height in whole px: at least 18 (icon, or with text), 20 for minimal. With format html, the height in CSS px' },
};

const positionProp = {
  type: 'string',
  enum: POSITIONS,
  description: 'Default auto: the least invasive free spot, bottom-right first, then bottom-center or bottom-left, then the top edge',
};
const regionProp = {
  type: 'string',
  description:
    'Only part of the image is AI (a generated photo inside a designed graphic): its box as "x,y,width,height" in px or % of the image ("50%,35%,46%,57%"). The label goes on that part, in its least invasive spot. For a rounded or angled part, pass region_path or region_mask instead',
};

// The placement options that stamp_image, label_image and place_label share, next to region.
const placeProps = {
  region_mask: {
    type: 'string',
    description: `The AI part as a shape: a PNG mask, resized to the image, inside where its alpha (or, without transparency, its brightness) is 50% or more. The label lies fully inside the shape, with a margin. Not with region or region_path. ${PATH_NOTE}`,
  },
  region_path: {
    type: 'string',
    description: 'The AI part as a shape: SVG path data in image px, e.g. "M100 80 H700 V600 L400 900 L100 600 Z" for a shield. The label lies fully inside it, with a margin. Not with region or region_mask',
  },
  avoid: {
    type: 'array',
    items: { type: 'string' },
    description:
      'Boxes the label must not touch, each "x,y,width,height" in px or %: faces, people, the product or subject, text. Look at the image and pass them: the automatic spot sees only texture, so a smooth back or a clean product surface can look free',
  },
  safe_zone: {
    type: 'string',
    description: "Edges a platform covers with its buttons and captions: meta-reels (14% top, 35% bottom, 6% sides, from the Meta Ads Guide for Instagram Reels), or your own insets \"top,right,bottom,left\" in px or % from the platform's template",
  },
  palette: {
    type: 'array',
    items: { type: 'string' },
    description: 'Brand colours as hex; the one that stands out most from the spot is used exactly as given, with white or dark text for 4.5:1. Not with color or theme',
  },
};

// Where an image comes from and where the labelled one goes, for stamp_image and label_image.
const sourceProps = {
  input: { type: 'string', description: `The image: a file path or an http(s) URL. ${PATH_NOTE}` },
  input_base64: { type: 'string', description: 'The image as base64 (a data: URL also works), instead of input. Without out nothing is written and the labelled image comes back as image content' },
  mime: { type: 'string', description: 'MIME type of input_base64, such as image/png. Optional: the format is read from the data' },
  out: { type: 'string', description: `Output path. For a file input the default is <name>.ai-label.<ext> next to it; for a URL or base64 input, without out the labelled image comes back as image content. ${PATH_NOTE}` },
  return_image: { type: 'boolean', description: 'Also return the labelled image as image content (base64). Default false: images cost many tokens' },
};

const displayWidthProp = {
  type: 'integer',
  description:
    'How wide the image will be shown, in CSS px; default 390, full width on a phone. The label is the smallest legible size there: 18 px for the icon or a label with a word, 20 px minimal. Pass a larger width only for images never shown full width on a phone. When the label has to shrink to fit, the result has a warning',
};

// A deciding fact: true, false, or "unsure" when nobody can tell (the label is then added as a precaution).
const answerProp = (description) => ({ anyOf: [{ type: 'boolean' }, { type: 'string', enum: ['unsure'] }], description });
const voluntaryProp = {
  type: 'boolean',
  description: 'Also label where the label is only voluntary, in the smallest form (the EU icon alone). Default false: a voluntary label is not added. Pass it only when the user wants voluntary labels',
};

const nullable = (type) => ({ type: [type, 'null'] });
const labelBox = {
  type: 'object',
  description: 'Where the label sits in the image, in px',
  properties: {
    left: { type: 'integer' },
    top: { type: 'integer' },
    width: { type: 'integer' },
    height: { type: 'integer' },
    form: { type: 'string', enum: FORMS },
    disc: { type: 'string', description: 'For the icon form: black or white, the official variant used' },
    theme: { type: 'string', description: 'light, dark, or custom with color' },
    color: {
      type: 'object',
      description:
        'The pill colour: background and ink (hex) and source: given (color as hex), auto (color auto) or palette. For auto also accent, the colour found in the image, and sampled: whole image, or outside the region',
    },
    colorNote: { type: 'string' },
    position: { type: 'string' },
    placement: { type: 'string', description: 'auto or given' },
    reason: { type: 'string', description: 'Why auto placement chose this spot' },
    spots: { type: 'object', description: 'How busy each spot is (mean brightness gradient); 6 or less counts as free. A spot outside the shape has no score' },
    why: { type: 'object', description: 'For each spot not taken, why: busy, overlaps an avoid box, does not fit inside the shape, or a better free spot' },
    region: { type: 'object', description: 'The box of the AI part; with region_mask or region_path, the bounding box of the shape' },
    shape: { type: 'string', description: 'mask or path when the region is a shape' },
    safeZone: { type: 'object', description: 'name (null for your own insets) and the insets top, right, bottom, left in px' },
    avoid: { type: 'array', items: { type: 'object' } },
    separation: { type: 'number' },
    minDisplayWidth: { type: 'integer' },
    displayWidth: { type: 'integer' },
    displayHeight: { type: 'number' },
    cssHeight: { type: 'integer', description: 'displayHeight rounded up to whole CSS px: the height for render_label with format html over the shown image' },
  },
};
const versionProp = { type: 'string', description: 'The ai-content-labels version that made this result' };
const stampedProps = {
  version: versionProp,
  output: { ...nullable('string'), description: 'Absolute path of the labelled file, or null when the image is returned as image content instead' },
  mimeType: { type: 'string' },
  image: { type: 'object', properties: { width: { type: 'integer' }, height: { type: 'integer' } } },
  label: labelBox,
  alt: { ...nullable('string'), description: 'Alt text to publish: description, then the label sentence. null until description is passed' },
  altMissing: { type: 'string' },
  disclosure: { type: 'string', description: 'The label sentence' },
  contrast: { type: 'number' },
  wcag: { type: 'boolean' },
  metadata: { type: 'string' },
  warning: { type: 'string', description: 'The label had to shrink to fit and looks smaller than legible where the image is shown' },
};

export const TOOLS = [
  {
    name: 'label_image',
    title: 'Label an AI image',
    description:
      'Call this right after you generate or edit an image that will be published. In one call it decides whether the EU AI Act requires a label (media image, origin generated, or modified with modified:true) and burns the label into the image only when it is required or when realistic is "unsure", then returns the alt text and the label sentence to publish with it. ' +
      'realistic is required: would the people who see it take it for a real photo or event? Answer true or false honestly; ask the user if you cannot tell. If you cannot ask or the user does not know, pass "unsure": the label is then added as a precaution, in the same form as a required one. ' +
      'Where the label is voluntary (realistic false), nothing is stamped or written, not even to out: stamped is false, output, label and disclosure are null, alt is the description alone, and you publish the original. voluntary:true stamps voluntary labels too; only_if_required is the default since 0.6.0 and has no effect. ' +
      'The label is the EU "AI" icon alone, 18 px as the image is shown on a phone, in the least invasive spot (bottom right first); pass short:true when the user wants the word, region when only part of the image is AI, and avoid boxes for faces, people, the product and text. ' +
      'Pass description (what the image shows) to get the alt text. Never use it to mark AI output as human-made. A checklist, not legal advice.',
    inputSchema: {
      type: 'object',
      properties: {
        ...sourceProps,
        realistic: answerProp(
          'Would the foreseeable audience take it for a genuine photo, recording or event? A person, product or place that does not exist but plausibly could counts; photorealism alone does not decide it. "unsure" when nobody can tell: the label is added as a precaution'
        ),
        modified: { type: 'boolean', description: 'true when AI changed a real photo or a human-made image; leave out when AI generated the whole image' },
        voluntary: voluntaryProp,
        creative: { type: 'boolean', description: 'An evidently artistic, satirical or fictional work, obvious to its audience; news or a product shot does not count' },
        lang: labelProps.lang,
        text: { type: 'string', description: 'Own label text; needed for languages other than en and pl' },
        description: labelProps.description,
        position: positionProp,
        region: regionProp,
        ...placeProps,
        display_width: displayWidthProp,
        color: labelProps.color,
        form: labelProps.form,
        icon: labelProps.icon,
        short: labelProps.short,
        minimal: { type: 'boolean', description: 'Same as form: "minimal"; false asks for a word (short)' },
        full: labelProps.full,
        only_if_required: { type: 'boolean', description: 'Deprecated, no effect: since 0.6.0 voluntary labels are skipped by default. Not with voluntary:true' },
        force: { type: 'boolean', description: 'Overwrite an existing output, or stamp an image that is already labelled' },
      },
      required: ['realistic'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        verdict: { type: 'string' },
        required: { type: ['boolean', 'string'], description: 'Whether the AI Act requires the label: true, false, or "unsure" when realistic was unsure (labelled as a precaution)' },
        precaution: { type: 'boolean', description: 'true when the label was added as a precaution, because realistic was "unsure"' },
        stamped: { type: 'boolean', description: 'false when the label is voluntary and voluntary is not set: nothing was stamped or written' },
        officialIcon: nullable('string'),
        note: { type: 'string' },
        ...stampedProps,
        output: { ...nullable('string'), description: 'Absolute path of the labelled file, or null when the image is returned as image content instead, or when nothing was stamped' },
        alt: { ...nullable('string'), description: 'Alt text to publish: description, then the label sentence; the description alone when nothing was stamped. null until description is passed' },
        label: { ...labelBox, type: ['object', 'null'] },
        // null when nothing was stamped.
        disclosure: { ...nullable('string'), description: 'The label sentence, or null when nothing was stamped' },
      },
      required: ['verdict', 'required', 'stamped', 'output', 'alt', 'disclosure'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  {
    name: 'decide_label',
    title: 'Decide the AI label',
    description:
      'Decide which AI label a piece of content needs and whether Article 50(4) of the EU AI Act requires it (deep fakes, public-interest text without editorial review). Returns a short verdict, the label to use, the EU icon, placement and accessibility rules, the label sentence (disclosure) and the next call in `next`: tool (stamp_image or render_label), arguments to pass unchanged, fill (the arguments you still supply, such as input and description) and the same step as a CLI line (cli). ' +
      'An AI label is added only when it is required or a deciding fact is unsure: for a voluntary verdict `next` is null and `optIn` says how to label anyway (voluntary: true). A human-made label keeps its `next`. ' +
      'When a deciding fact is missing (realistic for image, video and audio; public_interest, or editorial_review for public-interest text) it returns required:"unknown", the argument in `missing` and one question: ask the user, never guess. If you cannot ask, or the user does not know, answer "unsure": `next` then holds that call, and the verdict is required:"unsure" with precaution:true and the label a required one gets. ' +
      'A checklist, not legal advice. Call this before render_label or stamp_image; for an image you generated yourself, label_image does both steps.',
    inputSchema: {
      type: 'object',
      properties: {
        media: { type: 'string', enum: ['image', 'video', 'audio', 'text'] },
        origin: { type: 'string', enum: ['generated', 'modified', 'assisted', 'human'], description: 'generated = fully by AI; modified = real content changed by AI; assisted = only standard edits; human = no generative AI' },
        realistic: answerProp(
          'Required for image, video and audio: would the foreseeable audience take it for a genuine photo, recording or event? Photorealism alone does not decide it; a person, product or place that does not exist but plausibly could counts. "unsure" when nobody can tell: label as a precaution.'
        ),
        creative: {
          type: 'boolean',
          description: 'An evidently artistic, satirical or fictional work, obvious to its audience; read strictly, news or a product shot does not count, and an advertisement only in specific cases',
        },
        public_interest: answerProp('Required for text: published to inform the public on matters of public interest. "unsure" when nobody can tell'),
        editorial_review: answerProp(
          'A person with relevant knowledge checked the substance (at least fact-checked it; a spell-check or quick approval does not count), no AI changes after sign-off, and a named person or company holds editorial responsibility. "unsure" when nobody can tell'
        ),
        lang: { type: 'string', enum: EU_LANGS, description: 'Built-in wording: en, pl; for other EU languages disclosure is null and you write the sentence' },
        voluntary: { ...voluntaryProp, description: 'Give a next call for a voluntary verdict too, so the label is added where it is only voluntary. Default false: next is null for a voluntary AI label' },
      },
      required: ['media', 'origin'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        required: {
          type: ['boolean', 'string'],
          description: 'true, false, "unknown" when a deciding fact is missing (ask the question), or "unsure" when a deciding fact was answered unsure (label as a precaution)',
        },
        missing: { type: 'string' },
        question: { type: 'string' },
        precaution: { type: 'boolean', description: 'true when the label is added as a precaution, because a deciding fact is unsure' },
        unsure: { type: 'array', items: { type: 'string' }, description: 'The arguments answered "unsure" that make this a precaution' },
        verdict: { type: 'string' },
        basis: { type: 'string' },
        label: { type: ['object', 'null'] },
        officialIcon: nullable('string'),
        disclosure: nullable('string'),
        next: { type: ['object', 'null'], description: 'The next call; null when the label is voluntary and voluntary is not set' },
        optIn: { type: 'string', description: 'For a voluntary verdict without voluntary: how to label anyway' },
        placement: { type: 'array', items: { type: 'string' } },
        accessibility: { type: 'array', items: { type: 'string' } },
        notes: { type: 'array', items: { type: 'string' } },
        sources: { type: 'object' },
        disclaimer: { type: 'string' },
      },
      required: ['required'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'render_label',
    title: 'Draw a label',
    description:
      'Draw a label (official EU "AI" icon + text + content-type icons, or a human-made label). format svg (default) writes `out` (.svg, .png, .webp) or, with inline:true, returns the SVG text; format html returns a snippet with real text plus its CSS, for web pages. Text contrast is at least 4.5:1 on any backdrop (wcag: true in the result).',
    inputSchema: {
      type: 'object',
      properties: {
        ...labelProps,
        theme: { type: 'string', enum: ['light', 'dark'] },
        format: { type: 'string', enum: ['svg', 'html'], description: "html: real text that zooms, reflows, translates and follows the page's color-scheme; use it for web pages and UI" },
        out: { type: 'string', description: `Optional output path. ${PATH_NOTE}` },
        inline: { type: 'boolean', description: 'Without out: return the SVG text in the result' },
        scale: { type: 'number', description: 'PNG and WebP pixel density, 0.5 to 16, default 1' },
      },
      required: ['kind'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        width: { type: 'number' },
        height: { type: 'number' },
        alt: nullable('string'),
        altMissing: { type: 'string' },
        labelAlt: { type: 'string' },
        disclosure: { type: 'string' },
        contrast: { type: 'number' },
        wcag: { type: 'boolean' },
        out: { type: 'string' },
        pixels: { type: 'object' },
        svg: { type: 'string' },
        html: { type: 'string' },
        css: { type: 'string' },
        hint: { type: 'string' },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'stamp_image',
    title: 'Stamp a label into an image',
    description:
      'Burn a chosen label into one image (jpg, png, webp, avif, tiff) so it stays visible after download and reshare, add an IPTC DigitalSourceType XMP tag, and return the alt text and label sentence to publish with the image. The image is a file path, an http(s) URL or input_base64. Refuses to overwrite or to stamp an already labelled file unless force is true. For an image you generated yourself, label_image picks the label for you.',
    inputSchema: {
      type: 'object',
      properties: {
        ...sourceProps,
        ...labelProps,
        theme: { type: 'string', enum: ['auto', 'light', 'dark'], description: 'auto (default) picks the white or dark pill that stands out from the image; color sets your own' },
        position: positionProp,
        region: regionProp,
        ...placeProps,
        display_width: displayWidthProp,
        metadata: { type: 'boolean', description: 'Write the IPTC DigitalSourceType tag, default true; the ai-content-labels marker that prevents double stamping is always written' },
        force: { type: 'boolean', description: 'Overwrite an existing output, or stamp a file that is already labelled' },
      },
      required: ['kind'],
      additionalProperties: false,
    },
    outputSchema: { type: 'object', properties: stampedProps, required: ['output', 'alt', 'disclosure', 'label'] },
    annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  {
    name: 'place_label',
    title: 'Place a label without stamping',
    description:
      'Work out where a label goes on an image and how it looks, exactly as stamp_image would, without writing anything: for HTML pages and UI that draw the label as HTML or SVG over the image. Returns the label box in px (box) and in % of the image (boxPercent, for CSS), the reason and the score of every spot, and renderArgs: the render_label arguments that draw the same label. Takes the same label and placement options as stamp_image. Call decide_label first for kind.',
    inputSchema: {
      type: 'object',
      properties: {
        input: { type: 'string', description: `The image: a file path or an http(s) URL. ${PATH_NOTE}` },
        input_base64: sourceProps.input_base64,
        mime: sourceProps.mime,
        ...labelProps,
        theme: { type: 'string', enum: ['auto', 'light', 'dark'], description: 'auto (default) picks the white or dark pill that stands out from the image; color sets your own' },
        position: positionProp,
        region: regionProp,
        ...placeProps,
        display_width: displayWidthProp,
      },
      required: ['kind'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        version: versionProp,
        image: stampedProps.image,
        label: labelBox,
        box: {
          type: 'object',
          description: 'The label in image px',
          properties: { left: { type: 'integer' }, top: { type: 'integer' }, width: { type: 'integer' }, height: { type: 'integer' } },
        },
        boxPercent: {
          type: 'object',
          description:
            'The same box in % of the image width (left, width, right) and height (top, height, bottom), for CSS. anchor says which sides to pin: x left, center or right, y top or bottom; pin a bottom-right label with right and bottom',
          properties: {
            left: { type: 'number' },
            top: { type: 'number' },
            width: { type: 'number' },
            height: { type: 'number' },
            right: { type: 'number' },
            bottom: { type: 'number' },
            anchor: { type: 'object', properties: { x: { type: 'string', enum: ['left', 'center', 'right'] }, y: { type: 'string', enum: ['top', 'bottom'] } } },
          },
        },
        renderArgs: { type: 'object', description: 'The render_label arguments that draw this label, to pass unchanged; height is the layout height in CSS px as seen, for an SVG scaled to the box (for format html use label.cssHeight)' },
        warning: stampedProps.warning,
        alt: stampedProps.alt,
        altMissing: { type: 'string' },
        disclosure: { type: 'string', description: 'The label sentence' },
        contrast: { type: 'number' },
        wcag: { type: 'boolean' },
      },
      required: ['version', 'label', 'box', 'boxPercent', 'renderArgs'],
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: 'eu_icon',
    title: 'Official EU icon',
    description: 'Get one of the official EU icons for labelling AI-generated content, unchanged. Returns the SVG and its alt text, or writes it to `out` (.svg, .png).',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', enum: EU_ICONS },
        variant: { type: 'string', enum: EU_VARIANTS },
        out: { type: 'string', description: `Optional output path. ${PATH_NOTE}` },
        height: { type: 'integer', description: 'PNG height in whole px' },
      },
      required: ['name'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: { file: { type: 'string' }, svg: { type: 'string' }, alt: { type: 'string' }, out: { type: 'string' }, pixels: { type: 'object' } },
      required: ['alt'],
    },
    // Read-only without `out`; with `out` it writes a copy of the icon and nothing else.
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
];

// Every result carries the version that made it.
for (const tool of TOOLS) tool.outputSchema.properties = { version: versionProp, ...tool.outputSchema.properties };

const camel = (o) => Object.fromEntries(Object.entries(o ?? {}).map(([k, v]) => [k.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase()), v]));

// The schema says what is allowed; check it here too, so a mistyped argument is refused instead of ignored.
function checkArgs(tool, args) {
  const allowed = Object.keys(tool.inputSchema.properties);
  const unknown = Object.keys(args).filter((k) => !allowed.includes(k));
  if (unknown.length) return `unknown argument "${unknown[0]}"; allowed: ${allowed.join(', ')}`;
  const missing = (tool.inputSchema.required ?? []).filter((k) => args[k] == null);
  if (missing.length) {
    if (tool.name === 'stamp_image' && missing.includes('kind')) return 'stamp_image needs kind; call decide_label first';
    if (tool.name === 'label_image') {
      return 'label_image needs realistic: would the people who see the image take it for a real photo or event? Ask the user if you cannot tell; if you cannot ask or nobody knows, pass realistic "unsure" and the label is added as a precaution';
    }
    return `${tool.name} needs ${missing.join(' and ')}`;
  }
  if (allowed.includes('input_base64')) {
    const given = (args.input != null) + (args.input_base64 != null);
    if (given !== 1) return `${tool.name} needs exactly one of input (a file path or an http(s) URL) and input_base64`;
  }
  return null;
}

// Runs a tool; returns the structured result and, when there is one, the labelled image.
async function callTool(name, args, policy) {
  const a = camel(args);
  const noFiles = () => {
    if (a.out != null && policy.allowFiles === false) throw new UsageError(FILES_OFF);
  };
  switch (name) {
    case 'label_image': {
      const { buffer, ...result } = await labelImage(a.input ?? null, a, policy);
      return { structured: result, image: buffer && { buffer, mimeType: result.mimeType } };
    }
    case 'decide_label':
      return { structured: decideLabel(a) };
    case 'render_label': {
      noFiles();
      const result = await render(a);
      if (result.svg && a.inline !== true) {
        delete result.svg;
        result.hint = 'pass out to write a file, or inline:true to get the SVG text';
      }
      return { structured: result };
    }
    case 'stamp_image': {
      const { result, image } = await stampFrom(a, policy);
      return { structured: result, image };
    }
    case 'place_label': {
      // renderArgs go straight back into render_label, which takes snake_case arguments.
      const result = await placeFrom(a, policy);
      const snake = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`), v]));
      return { structured: { ...result, renderArgs: snake(result.renderArgs) } };
    }
    case 'eu_icon':
      noFiles();
      return { structured: await eu(a.name, a) };
  }
}

const rpcError = (code, message, data, status) => Object.assign(new Error(message), { rpc: code, data, status });

async function callResult(params, policy) {
  const tool = TOOLS.find((t) => t.name === params?.name);
  if (!tool) throw rpcError(-32602, `unknown tool ${params?.name}`);
  const args = params?.arguments ?? {};
  const problem = typeof args === 'object' && !Array.isArray(args) ? checkArgs(tool, args) : 'arguments must be an object';
  if (problem) return { content: [{ type: 'text', text: problem }], isError: true };
  try {
    const { structured: result, image } = await callTool(tool.name, args, policy);
    // Every result says which version made it, first.
    const structured = { version: VERSION, ...result };
    const content = [{ type: 'text', text: JSON.stringify(structured, null, 2) }];
    if (image) content.push({ type: 'image', data: image.buffer.toString('base64'), mimeType: image.mimeType });
    return { content, structuredContent: structured };
  } catch (err) {
    if (err.rpc) throw err;
    const message = forMcp(err.message);
    return { content: [{ type: 'text', text: err.code ? `${err.code}: ${message}` : message }], isError: true };
  }
}

// The library's errors name CLI options ("pass --text"). An MCP caller passes arguments, so name the
// argument and keep the CLI option in brackets: "pass text (CLI: --text)". A message that quotes a
// whole CLI command stays as it is.
const SERVER_FLAGS = new Set(['http', 'port', 'host', 'token', 'allow-files', 'allow-origin']);
const MCP_BOOLEANS = new Set(['force', 'icon', 'minimal', 'short', 'full', 'uppercase', 'realistic', 'creative', 'modified', 'voluntary']);
export function forMcp(message) {
  if (/ai-labelss/.test(message)) return message;
  const seen = new Set();
  return message.replace(/--(no-)?([a-z][a-z-]*)( ")?/g, (match, no, name, quote) => {
    const flag = match.replace(/ "$/, '');
    // Options of the server itself ("start the server with --allow-files") stay CLI options.
    if (SERVER_FLAGS.has(name)) return match;
    // An example value (--text "Mit KI generiert") reads as an argument with its value.
    if (quote) return `${name.replace(/-/g, '_')}: "`;
    const arg = name.replace(/-/g, '_') + (no ? ': false' : MCP_BOOLEANS.has(name) ? ': true' : '');
    if (seen.has(flag)) return arg;
    seen.add(flag);
    return `${arg} (CLI: ${flag})`;
  });
}

// The server's answer to a modern request that names a version it does not speak.
const unsupported = (requested) =>
  rpcError(ERRORS.unsupportedVersion, 'Unsupported protocol version', { supported: SUPPORTED_VERSIONS, requested: requested ?? null }, 400);

// Checks the per-request _meta of a modern request; returns the version it asks for.
function checkModern(params) {
  const meta = params?._meta;
  const version = meta?.[META.protocolVersion];
  if (version == null) throw rpcError(-32602, `missing _meta["${META.protocolVersion}"]: server/discover is a request of protocol version ${MODERN_VERSIONS[0]} or later`, undefined, 400);
  // Per-request _meta belongs to the modern versions; a legacy version starts with initialize instead.
  if (typeof version !== 'string' || !MODERN_VERSIONS.includes(version)) throw unsupported(version);
  const caps = meta[META.clientCapabilities];
  if (caps == null || typeof caps !== 'object' || Array.isArray(caps)) {
    throw rpcError(-32602, `missing _meta["${META.clientCapabilities}"]: every request in protocol version ${version} carries it`, undefined, 400);
  }
  return version;
}

export const isModern = (msg) => msg?.method === 'server/discover' || msg?.params?._meta?.[META.protocolVersion] !== undefined;

// policy: { allowFiles, allowPrivate }. Returns an answer for one JSON-RPC message:
// { reply } with the response object (undefined for a notification) and an HTTP `status`.
export function createDispatcher(policy = {}) {
  async function result(msg) {
    const { method, params } = msg;
    if (isModern(msg)) {
      checkModern(params);
      let r;
      switch (method) {
        case 'server/discover':
          r = { supportedVersions: SUPPORTED_VERSIONS, capabilities: { tools: {} }, instructions: INSTRUCTIONS };
          break;
        case 'tools/list':
          r = { tools: TOOLS };
          break;
        case 'tools/call':
          r = await callResult(params, policy);
          break;
        case 'ping':
          r = {};
          break;
        default:
          throw rpcError(-32601, `method not found: ${method}`, undefined, 404);
      }
      return { resultType: 'complete', ...r, _meta: { [META.serverInfo]: SERVER_INFO } };
    }
    switch (method) {
      case 'initialize': {
        const asked = params?.protocolVersion;
        return {
          protocolVersion: LEGACY_VERSIONS.includes(asked) ? asked : LEGACY_VERSIONS[0],
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
          instructions: INSTRUCTIONS,
        };
      }
      case 'ping':
        return {};
      case 'tools/list':
        return { tools: TOOLS };
      case 'tools/call':
        return callResult(params, policy);
      default:
        throw rpcError(-32601, `method not found: ${method}`);
    }
  }

  return async function dispatch(msg) {
    const notification = msg.id === undefined;
    try {
      const r = await result(msg);
      return notification ? { status: 202 } : { status: 200, reply: { jsonrpc: '2.0', id: msg.id, result: r } };
    } catch (err) {
      // A notification gets no answer, even a failed one.
      if (notification) return { status: 202 };
      const error = { code: err.rpc ?? -32603, message: err.message, ...(err.data !== undefined && { data: err.data }) };
      return { status: err.status ?? 200, reply: { jsonrpc: '2.0', id: msg.id, error } };
    }
  };
}
