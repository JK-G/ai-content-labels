#!/usr/bin/env node
// ai-content-labels: labels for AI-generated and human-made content, built on the official EU icons.
import { render, stamp, placeFrom, decideLabel, alt, eu, icons, doctor } from './lib/api.mjs';
import { labelImage, NeedsAnswer } from './lib/label.mjs';
import { agentInstructions, writeInstructions } from './lib/init.mjs';
import { isUrl } from './lib/source.mjs';
import { basename } from 'node:path';
import { UsageError, parseBoolean } from './lib/i18n.mjs';
import { PHONE_WIDTH } from './lib/stamp.mjs';
import { formOf, minHeightOf } from './lib/render.mjs';
import { VERSION } from './lib/version.mjs';

const HELP = `ai-labels <command> [options]

Commands
  label <image>          For an image you generated or edited with AI: decide the label
                         and stamp it in one step (needs --realistic or --no-realistic)
  decide                 Which label the content needs, and whether the AI Act requires it
  render                 Draw a label as SVG (stdout) or to --out file.svg|.png|.webp,
                         or as HTML with --format html
  stamp <image>          Burn a label into one image (jpg, png, webp, avif, tiff)
  place <image>          Where stamp would put the label, and the render options that
                         draw it, without writing anything: for HTML and SVG labels
                         drawn over an image on a page
  alt                    Print the alt text for a label
  eu [basic|generated|modified]
                         The official EU icon, unchanged (--variant, --out)
  icons [--out dir]      List the content-type icons, or copy them to a folder
  doctor                 Check the setup
  init                   Print a short block for AGENTS.md (or GEMINI.md, CLAUDE.md,
                         Copilot instructions) telling agents to label the images they make

Label options (render, stamp, alt)
  --kind generated|modified|basic|human   default generated; stamp requires it
  --media image,text,audio,voice,music,video
                         what was made with AI (or by a human, with --kind human)
  --human text,...       add a "made by a human" part next to an AI label
  --lang <EU code>       default en; built-in wording en and pl; other languages
                         need --text (and --human-text)
  --text "..."           your own label text (basic labels need one in practice)
  --human-text "..."     your own text for the human-made part
  --description "..."    what the image shows, one short phrase; goes before the
                         label sentence in the alt text
  --form icon|minimal|short|full, or the same as a flag (--icon, --minimal, ...):
  --icon                 the EU "AI" disc alone, with a thin ring; the default of
                         stamp, label and place for AI labels
  --minimal              the author mark (the EU "AI" disc, or a hand in the same
                         disc) and the content-type icons in a pill, no text
  --short                one word next to the EU "AI" disc ("Generated", "Modified",
                         the wording of the EU icons); the default of render and of
                         human-made labels, and with --color or --palette
  --full                 the full wording ("Generated with AI")
  --uppercase            upper case with letter spacing, like the EU icons
  --theme light|dark     light = white pill with dark text (a black disc for the
                         icon); stamp also accepts auto (default there)
  --color <hex>          a pill in your colour, e.g. #1f7a52; the text turns white or
                         dark to keep 4.5:1 contrast. stamp, label and place also take
                         auto: the image's accent colour (outside the region when the
                         rest is at least 20% of the image), toned to keep 4.5:1
  --height <px>          whole px, default 32, at least 18 (icon, or with text) and 20
                         with --minimal; stamp picks the smallest legible size (see
                         --display-width). With --format html, exactly that tall in CSS px
  --background-opacity <0-1>
                         refused below the level that keeps 4.5:1 text contrast
                         (override with --allow-low-contrast)

render options
  --out <file>           .svg, .png or .webp (.html with --format html)
  --format svg|html      html: real text for web pages (zooms, reflows, translates,
                         follows the page colour scheme); default svg
  --css                  with --format html, print only the stylesheet
  --scale <n>            PNG and WebP pixel density, 0.5 to 16 (default 1)

stamp options (place takes the same, apart from --out, --no-metadata and --force)
  --out <file>           default <name>.ai-label.<ext> next to the input
  --position auto|bottom-right|bottom-center|bottom-left|top-right|top-center|top-left
                         default auto: the least invasive free spot, bottom right
                         first, then bottom centre or bottom left, then the top edge
  --region x,y,w,h       the AI part of a larger graphic (px, or % of the image, e.g.
                         50%,35%,46%,57%); the label goes on that part
  --region-mask <png>    the AI part as a shape: inside where the mask's alpha (or,
                         without transparency, its brightness) is 50% or more
  --region-path "<d>"    the AI part as an SVG path in image px, e.g.
                         "M100 80 H700 V600 L400 900 L100 600 Z"; the label lies fully
                         inside the shape. One of --region, --region-mask, --region-path
  --avoid x,y,w,h        a box the label must not touch (a face, a person, the product,
                         text), px or %; repeat it for more boxes. Auto placement sees
                         only texture, so pass what matters
  --safe-zone <preset>|top,right,bottom,left
                         edges a platform covers: meta-reels (14% top, 35% bottom, 6%
                         sides), or your own insets in px or %, e.g. 14%,6%,35%,6%
  --palette #hex,#hex    brand colours, used exactly as given: the one that stands out
                         most from the spot (not with --color or --theme)
  --display-width <px>   how wide the image will be shown, in CSS px; default 390, full
                         width on a phone. The label is the smallest legible there:
                         18 px for the icon or a word, 20 px with --minimal (a 1080 px
                         wide image gets 50 px, or 56 px minimal)
  --no-metadata          skip the IPTC DigitalSourceType tag; the small ai-content-labels
                         marker that prevents double stamping is always written
  --force                overwrite an existing output, or stamp a labelled file again

label options
  --realistic | --no-realistic
                         required: would people take the image for a real photo or event?
  --modified             AI changed a real or human-made image (default: generated by AI)
  --creative             an evidently artistic, satirical or fictional work
  --only-if-required     stamp only when the AI Act requires the label; by default a
                         voluntary label is stamped too
  --lang, --text, --description, --position, --region, --region-mask, --region-path,
  --avoid, --safe-zone, --palette, --display-width, --color, --form, --icon, --minimal,
  --short, --full, --out, --force, --no-metadata
                         as for stamp; <image> is a file path or an http(s) URL
                         (a URL needs --out). The label is the EU icon alone unless
                         you pick a form (--short for the word)

init options
  --write                append the block to the file instead of printing it; run again
                         to update it in place (it sits between marker comments)
  --file <path>          with --write, default AGENTS.md

decide options
  --media image|video|audio|text   --origin generated|modified|assisted|human
  --realistic            would its audience take it for a genuine photo, recording or
                         event? (a person, product or place that does not exist but
                         plausibly could counts; photorealism alone does not decide it)
  --creative             an evidently artistic, satirical or fictional work, obvious to
                         its audience; read strictly, news or a product shot does not
                         count, and an advertisement only in specific cases
  --public-interest      text published to inform the public on matters of public interest
  --editorial-review     a person with relevant knowledge checked the substance (at least
                         fact-checked it; a spell-check or quick approval does not count),
                         no AI changes after sign-off, and a named person or company
                         holds editorial responsibility
  --explain              also print the basis, notes, accessibility advice and sources
  Every yes/no option also takes --no-<option>. Without --realistic or --no-realistic
  (for text: --public-interest, then --editorial-review), decide asks instead of
  guessing and exits with 2.

Other
  --scale <n>            PNG pixel density for eu (default 1)
  --json                 machine-readable output; every JSON result has a version field
`;

const BOOLEAN = new Set(['modified', 'only-if-required', 'write', 'icon', 'short', 'full', 'uppercase', 'minimal', 'json', 'allow-low-contrast', 'realistic', 'creative', 'public-interest', 'editorial-review', 'explain', 'metadata', 'force', 'css', 'help']);
const LABEL = ['kind', 'media', 'human', 'lang', 'text', 'human-text', 'description', 'form', 'icon', 'short', 'full', 'uppercase', 'minimal', 'theme', 'color', 'height', 'background-opacity', 'allow-low-contrast'];
// The options each command accepts; anything else is a typo and must not pass silently.
const PLACE = ['position', 'region', 'region-mask', 'region-path', 'avoid', 'safe-zone', 'palette', 'display-width'];
// Options that may be given more than once; they collect into a list.
const REPEATABLE = new Set(['avoid']);
const OPTIONS = {
  render: [...LABEL, 'out', 'scale', 'format', 'css'],
  stamp: [...LABEL, ...PLACE, 'out', 'metadata', 'force'],
  place: [...LABEL, ...PLACE],
  alt: LABEL,
  decide: ['media', 'origin', 'realistic', 'creative', 'public-interest', 'editorial-review', 'lang', 'explain'],
  eu: ['variant', 'out', 'scale', 'height'],
  icons: ['out'],
  doctor: [],
  label: ['realistic', 'modified', 'creative', 'lang', 'text', 'description', ...PLACE, 'color', 'form', 'icon', 'minimal', 'short', 'full', 'out', 'only-if-required', 'force', 'metadata'],
  init: ['write', 'file'],
};
const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  const keys = [];
  const missing = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h') {
      flags.help = true;
    } else if (a.startsWith('--')) {
      let [key, value] = a.slice(2).split(/=(.*)/s);
      if (key.startsWith('no-') && BOOLEAN.has(key.slice(3)) && value === undefined) {
        [key, value] = [key.slice(3), false];
      } else if (BOOLEAN.has(key)) {
        value = parseBoolean(value ?? true, `--${key}`);
      } else if (value === undefined) {
        if (argv[i + 1] === undefined || argv[i + 1].startsWith('--')) missing.push(key);
        else value = argv[++i];
      }
      keys.push(key);
      if (REPEATABLE.has(key) && value !== undefined) (flags[camel(key)] ??= []).push(value);
      else flags[camel(key)] = value;
    } else {
      positional.push(a);
    }
  }
  return { positional, flags, keys, missing };
}

// The label sentence, and the alt text of the content when a description made it possible.
// A text or audio label has no picture to describe, so it gets no hint about --description.
const altLines = (r) =>
  `disclosure: ${r.disclosure}\n` + (r.alt ? `alt: ${r.alt}\n` : r.altMissing ? 'alt: add --description "what the image shows" to get the full alt text\n' : '');

// How big the label looks where the image is shown: a phone does not display file pixels 1:1.
function displayLine(r) {
  const l = r.label;
  const floor = minHeightOf(l.form);
  const where = l.displayWidth === PHONE_WIDTH ? ' (full width on a phone; --display-width for other sizes)' : '';
  const small = l.displayHeight < floor ? `, under the legible ${floor} px` : '';
  return `display: ${l.displayHeight} px tall when the image is shown ${l.displayWidth} px wide${where}${small}\n`;
}

// "bottom-right (auto: bottom-right is free)", "#1b7a52 pill (auto, from #22a06b)", "light pill".
const placeText = (l) => (l.placement === 'auto' ? `${l.position} (auto: ${l.reason})` : l.position);
const pillText = (l) =>
  l.color
    ? `${l.color.background} pill${l.color.source === 'auto' ? ` (auto, from ${l.color.accent}${l.color.sampled === 'outside the region' ? ' outside the region' : ''})` : l.color.source === 'palette' ? ' (from --palette)' : ''}`
    : l.disc
      ? `${l.disc} disc`
      : `${l.theme} pill`;
// The spots auto placement could not use for a reason other than busyness: an avoid box, the shape.
const skippedLine = (l) => {
  const skipped = Object.entries(l.why ?? {}).filter(([, why]) => !why.startsWith('busy') && !why.startsWith('free'));
  return skipped.length ? `skipped: ${skipped.map(([p, why]) => `${p} ${why}`).join('; ')}\n` : '';
};
const labelLine = (r) =>
  `label: ${r.label.width}×${r.label.height} px, ${r.label.form}, ${pillText(r.label)}, ${placeText(r.label)}, ` +
  `${contrastLine(r, r.label.form, ' ')}, stands out ${r.label.separation.toFixed(2)}:1 from the image\n` +
  skippedLine(r.label) +
  (r.label.colorNote ? `color: ${r.label.colorNote}\n` : '') +
  (r.warning ? `warning: ${r.warning}\n` : '');

// "text contrast 12.55:1", with a warning when --allow-low-contrast let a label below 4.5:1 through.
const contrastLine = (r, form, sep) => `${form === 'minimal' || form === 'icon' ? 'mark' : 'text'} contrast${sep}${r.contrast.toFixed(2)}:1${r.wcag ? '' : ' (below WCAG 1.4.3, 4.5:1)'}`;

const attr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');

// A value as one shell word: single-quoted when it has anything a POSIX shell would read (a "#"
// starts a comment), with a ' inside written as '\''.
const shellWord = (value) => (/^[\w.,:%+=@/-]+$/.test(value) ? value : `'${value.replace(/'/g, "'\\''")}'`);

// renderArgs as render options: "--kind generated --media image --short --height 78 --theme light".
const renderFlags = (args) =>
  Object.entries(args)
    .map(([k, v]) => {
      const flag = `--${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
      if (v === true) return flag;
      return `${flag} ${shellWord(Array.isArray(v) ? v.join(',') : String(v))}`;
    })
    .join(' ');

// decide's next step as one line: "Next: ai-labels stamp <image> --kind generated ...".
const nextLine = (d) => `${d.required ? 'Next:' : 'Next (voluntary):'} ${d.next.cli}${d.next.note ? `, ${d.next.note}` : ''}`;

async function main(argv) {
  const { positional, flags, keys, missing } = parseArgs(argv);
  const [command, ...rest] = positional;
  if (!command || flags.help || command === 'help') {
    process.stdout.write(HELP);
    return 0;
  }
  const allowed = OPTIONS[command];
  if (!allowed) throw new UsageError(`unknown command "${command}"; run "ai-labels help"`);
  const unknown = keys.filter((k) => k !== 'json' && !allowed.includes(k));
  if (unknown.length) throw new UsageError(`unknown option for ${command}: ${unknown.map((k) => `--${k}`).join(', ')}; run "ai-labels help"`);
  if (missing.length) throw new UsageError(`--${missing[0]} needs a value`);
  // A stray word is usually an unquoted value ("--text Voice generated with AI" keeps only "Voice").
  if ((command === 'stamp' || command === 'label' || command === 'place') && rest.length > 1) throw new UsageError(`${command} takes one image; got ${rest.length}. Run it once per file (batch mode is planned)`);
  const extra = ['stamp', 'label', 'place', 'eu'].includes(command) ? rest.slice(1) : rest;
  if (extra.length) throw new UsageError(`unexpected argument "${extra[0]}"; put text with spaces in quotes: --text "Voice generated with AI"`);
  const form = formOf(flags);
  // Every JSON result says which version made it, first.
  const print = (result, text) => process.stdout.write(flags.json || !text ? JSON.stringify({ version: VERSION, ...result }, null, 2) + '\n' : text(result));

  switch (command) {
    case 'render': {
      const result = await render(flags);
      print(result, (r) => {
        if (r.css && !r.html) return r.css;
        if (r.html && !r.out) return r.html + '\n';
        if (r.svg) return r.svg + '\n';
        if (r.html) return `${r.out}\ndisclosure: ${r.disclosure}\n`;
        const size = r.pixels && (r.pixels.width !== r.width || r.pixels.height !== r.height) ? `${r.pixels.width}×${r.pixels.height} px, displays at ${r.width}×${r.height}` : `${r.width}×${r.height} px`;
        const embed = `<img src="${attr(basename(r.out))}" alt="${attr(r.labelAlt)}" width="${r.width}" height="${r.height}">`;
        return (
          `${r.out} (${size})\n${contrastLine(r, form, ': ')}\n` +
          `embed: ${embed} (use alt="" if a caption already carries this sentence)\n` +
          (r.alt ? `alt: ${r.alt}\n` : '')
        );
      });
      return 0;
    }
    case 'stamp': {
      const result = await stamp(rest[0], flags);
      print(
        result,
        (r) =>
          `${r.output}\n` +
          labelLine(r) +
          displayLine(r) +
          altLines(r) +
          (r.metadata ? `metadata: ${r.metadata}\n` : '')
      );
      return 0;
    }
    case 'place': {
      if (!rest[0]) throw new UsageError('place needs an image: ai-labels place <image> --kind generated --media image');
      const result = await placeFrom({ ...flags, input: rest[0] });
      print(result, (r) => {
        const b = r.box;
        const p = r.boxPercent;
        return (
          labelLine(r) +
          displayLine(r) +
          `box: left ${b.left}, top ${b.top}, ${b.width}×${b.height} px of ${r.image.width}×${r.image.height}; ` +
          `in %: left ${p.left}%, top ${p.top}%, width ${p.width}%, height ${p.height}%\n` +
          `render: ai-labels render ${renderFlags(r.renderArgs)}\n` +
          altLines(r)
        );
      });
      return 0;
    }
    case 'label': {
      const input = rest[0];
      if (!input) throw new UsageError('label needs an image: ai-labels label <image> --realistic|--no-realistic');
      if (isUrl(input) && flags.out == null) throw new UsageError('label with a URL needs --out <file> for the labelled image');
      let r;
      try {
        r = await labelImage(input, flags);
      } catch (e) {
        if (!(e instanceof NeedsAnswer)) throw e;
        // The same question decide asks, and the same exit code: a script cannot mistake it for a verdict.
        const d = e.decision;
        print(d, () => `UNKNOWN: ${d.question} Rerun with --realistic or --no-realistic.\n`);
        return 2;
      }
      print(r, (x) =>
        !x.stamped
          ? `${x.verdict}\nNot stamped: the label is voluntary here and --only-if-required is set.\n${x.disclosure ? `disclosure: ${x.disclosure}\n` : ''}`
          : `${x.verdict}${x.required ? '' : ' (stamped anyway: labelling AI images is good practice; --only-if-required skips it)'}\n` +
            `${x.output}\n` +
            labelLine(x) +
            displayLine(x) +
            altLines(x) +
            (x.metadata ? `metadata: ${x.metadata}\n` : '')
      );
      return 0;
    }
    case 'init': {
      const write = parseBoolean(flags.write, '--write') ?? false;
      if (flags.file != null && !write) throw new UsageError('--file goes with --write; without it, init prints the block');
      if (!write) {
        print({ block: agentInstructions() }, (x) => x.block);
        return 0;
      }
      const r = writeInstructions(flags.file ?? 'AGENTS.md');
      print(r, (x) => `${x.file}: ${x.status === 'unchanged' ? 'already up to date' : x.status}\n`);
      return 0;
    }
    case 'decide': {
      const r = decideLabel(flags);
      const explain = parseBoolean(flags.explain, '--explain') ?? false;
      // "Label: --kind generated --media image, says "Generated with AI: image." (official EU icon ...)"
      const label = (d) =>
        d.label &&
        `Label: --kind ${d.label.kind} --media ${d.label.media.join(',')}${d.label.lang && d.label.lang !== 'en' ? ` --lang ${d.label.lang}` : ''}` +
          (d.disclosure ? `, says "${d.disclosure}"` : '') +
          (d.officialIcon ? ` (official EU icon with this meaning: ${d.officialIcon})` : '');
      const flag = (d) => d.missing.replace(/_/g, '-');
      // Short by default: verdict, next command, label, where to put it, what screen readers need,
      // and the no-animation rule. --explain adds the basis, notes, the rest of the advice and sources.
      print(r, (d) =>
        (d.required === 'unknown'
          ? [`UNKNOWN: ${d.question} Rerun with --${flag(d)} or --no-${flag(d)}.`, label(d), d.disclaimer]
          : explain
            ? [
                d.verdict,
                nextLine(d),
                label(d),
                ...d.placement.map((p) => `- ${p}`),
                `Basis: ${d.basis}`,
                ...d.notes.map((n) => `Note: ${n}`),
                ...d.accessibility.map((a) => `Accessibility: ${a}`),
                ...Object.values(d.sources).map((s) => `Source: ${s}`),
                d.disclaimer,
              ]
            : [
                d.verdict,
                nextLine(d),
                label(d),
                ...d.placement.slice(0, 2).map((p) => `- ${p}`),
                `Accessibility: ${d.accessibility[0]}`,
                'Do not animate the label (WCAG 2.2.2) or make it flash (WCAG 2.3.1). Not legal advice. More: rerun with --explain',
              ]
        )
          .filter(Boolean)
          .join('\n') + '\n'
      );
      return r.required === 'unknown' ? 2 : 0;
    }
    case 'alt': {
      print(alt(flags), (r) => (r.alt ? r.alt + '\n' : altLines(r)));
      return 0;
    }
    case 'eu': {
      const r = await eu(rest[0], flags);
      print(r, (x) => (x.out ? `${x.out}\nalt: ${x.alt}\n` : x.svg));
      return 0;
    }
    case 'icons': {
      print(icons(flags), (r) => `${r.media.join(', ')}\n${r.out ? `copied to ${r.out}\n` : ''}`);
      return 0;
    }
    case 'doctor': {
      const r = await doctor();
      print(r, (d) => d.checks.map((c) => `${c.ok ? 'ok  ' : 'FAIL'} ${c.check}${c.detail ? `: ${c.detail}` : ''}`).join('\n') + '\n');
      return r.ok ? 0 : 1;
    }
    default:
      throw new UsageError(`unknown command "${command}"; run "ai-labels help"`);
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`ai-labels: ${err.message}\n`);
    process.exit(err instanceof UsageError ? 2 : 1);
  }
);
