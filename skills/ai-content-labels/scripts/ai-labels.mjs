#!/usr/bin/env node
// ai-content-labels: labels for AI-generated and human-made content, built on the official EU icons.
import { render, stamp, decideLabel, alt, eu, icons, doctor } from './lib/api.mjs';
import { basename } from 'node:path';
import { UsageError, parseBoolean } from './lib/i18n.mjs';

const HELP = `ai-labels <command> [options]

Commands
  decide                 Which label the content needs, and whether the AI Act requires it
  render                 Draw a label as SVG (stdout) or to --out file.svg|.png|.webp,
                         or as HTML with --format html
  stamp <image>          Burn a label into one image (jpg, png, webp, avif, tiff)
  alt                    Print the alt text for a label
  eu [basic|generated|modified]
                         The official EU icon, unchanged (--variant, --out)
  icons [--out dir]      List the content-type icons, or copy them to a folder
  doctor                 Check the setup

Label options (render, stamp, alt)
  --kind generated|modified|basic|human   default generated
  --media image,text,audio,voice,music,video
                         what was made with AI (or by a human, with --kind human)
  --human text,...       add a "made by a human" part next to an AI label
  --lang <EU code>       default en; built-in wording en and pl; other languages
                         need --text (and --human-text)
  --text "..."           your own label text (basic labels need one in practice)
  --human-text "..."     your own text for the human-made part
  --description "..."    what the image shows, one short phrase; goes before the
                         label sentence in the alt text
  --short                compact wording ("Generated" instead of "Generated with AI")
  --uppercase            upper case with letter spacing, like the EU icons
  --minimal              no text: only the author mark (the EU "AI" disc, or a hand
                         in the same disc) and the content-type icons
  --theme light|dark     light = white pill with dark text; stamp also accepts auto
                         (default there)
  --height <px>          whole px, default 32, at least 24 with text and 20 with --minimal;
                         stamp picks about 6% of the shorter side and at least 2.5%
                         of the longer side, never below 28 px or above 512 px
  --background-opacity <0-1>
                         refused below the level that keeps 4.5:1 text contrast
                         (override with --allow-low-contrast)

render options
  --out <file>           .svg, .png or .webp (.html with --format html)
  --format svg|html      html: real text for web pages (zooms, reflows, translates,
                         follows the page colour scheme); default svg
  --css                  with --format html, print only the stylesheet
  --scale <n>            PNG and WebP pixel density, 0.5 to 16 (default 1)

stamp options
  --out <file>           default <name>.ai-label.<ext> next to the input
  --position top-left|top-right|bottom-left|bottom-right   default top-left
  --no-metadata          skip the IPTC DigitalSourceType tag; the small ai-content-labels
                         marker that prevents double stamping is always written
  --force                overwrite an existing output, or stamp a labelled file again

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
  --json                 machine-readable output
`;

const BOOLEAN = new Set(['short', 'uppercase', 'minimal', 'json', 'allow-low-contrast', 'realistic', 'creative', 'public-interest', 'editorial-review', 'explain', 'metadata', 'force', 'css', 'help']);
const LABEL = ['kind', 'media', 'human', 'lang', 'text', 'human-text', 'description', 'short', 'uppercase', 'minimal', 'theme', 'height', 'background-opacity', 'allow-low-contrast'];
// The options each command accepts; anything else is a typo and must not pass silently.
const OPTIONS = {
  render: [...LABEL, 'out', 'scale', 'format', 'css'],
  stamp: [...LABEL, 'out', 'position', 'metadata', 'force'],
  alt: LABEL,
  decide: ['media', 'origin', 'realistic', 'creative', 'public-interest', 'editorial-review', 'lang', 'explain'],
  eu: ['variant', 'out', 'scale', 'height'],
  icons: ['out'],
  doctor: [],
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
      flags[camel(key)] = value;
    } else {
      positional.push(a);
    }
  }
  return { positional, flags, keys, missing };
}

// The label sentence, and the alt text of the content when a description made it possible.
const altLines = (r) => `disclosure: ${r.disclosure}\n` + (r.alt ? `alt: ${r.alt}\n` : 'alt: add --description "what the image shows" to get the full alt text\n');

// "text contrast 12.55:1", with a warning when --allow-low-contrast let a label below 4.5:1 through.
const contrastLine = (r, minimal, sep) => `${minimal ? 'mark' : 'text'} contrast${sep}${r.contrast.toFixed(2)}:1${r.wcag ? '' : ' (below WCAG 1.4.3, 4.5:1)'}`;

const attr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');

// decide's ready next command, with the label flags filled in.
function nextStep(d) {
  const l = d.label;
  const flags =
    `--kind ${l.kind} --media ${l.media.join(',')}` + (l.lang && l.lang !== 'en' ? ` --lang ${l.lang}` : '') + (d.disclosure == null ? ' --text "label in that language"' : '');
  const head = d.required ? 'Next:' : 'Next (voluntary):';
  switch (l.media[0]) {
    case 'image':
      return `${head} ai-labels stamp <image> ${flags} --description "what it shows"`;
    case 'text':
      return `${head} ai-labels render --format html ${flags}, at the top of the text`;
    case 'video':
      return `${head} ai-labels render ${flags} --out label.png --height <6% of the shorter side>, then ffmpeg -i in.mp4 -i label.png -filter_complex "overlay=24:24" -c:a copy out.mp4`;
    default:
      return `${head} a short spoken disclaimer at the start, and ai-labels render --format html ${flags} next to the player`;
  }
}

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
  if (command === 'stamp' && rest.length > 1) throw new UsageError(`stamp takes one image; got ${rest.length}. Run it once per file (batch mode is planned)`);
  const extra = command === 'stamp' || command === 'eu' ? rest.slice(1) : rest;
  if (extra.length) throw new UsageError(`unexpected argument "${extra[0]}"; put text with spaces in quotes: --text "Voice generated with AI"`);
  const minimal = parseBoolean(flags.minimal, '--minimal') ?? false;
  const print = (result, text) => process.stdout.write(flags.json || !text ? JSON.stringify(result, null, 2) + '\n' : text(result));

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
          `${r.out} (${size})\n${contrastLine(r, minimal, ': ')}\n` +
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
          `${r.output}\nlabel: ${r.label.width}×${r.label.height} px, ${r.label.theme} pill, ${r.label.position}, ` +
          `${contrastLine(r, minimal, ' ')}, stands out ${r.label.separation.toFixed(2)}:1 from the image\n` +
          altLines(r) +
          (r.metadata ? `metadata: ${r.metadata}\n` : '')
      );
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
                nextStep(d),
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
                nextStep(d),
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
