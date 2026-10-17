#!/usr/bin/env node
// ai-content-labels: labels for AI-generated and human-made content, built on the official EU icons.
import { render, stamp, decideLabel, alt, eu, icons, doctor } from './lib/api.mjs';
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
  --lang en|pl           default en
  --text "..."           your own label text (basic labels need one in practice)
  --human-text "..."     your own text for the human-made part
  --description "..."    what the image shows, one short phrase; goes before the
                         label sentence in the alt text
  --short                compact wording ("Generated" instead of "Generated with AI")
  --uppercase            upper case with letter spacing, like the EU icons
  --minimal              no text: only the author mark (the EU "AI" disc, or a hand
                         in the same disc) and the content-type icons
  --theme light|dark     stamp also accepts auto (default there)
  --height <px>          default 32, at least 24 with text and 20 with --minimal;
                         stamp picks about 6% of the shorter side and at least 2.5%
                         of the longer side, never below 28 px or above 512 px
  --background-opacity <0-1>
                         refused below the level that keeps 4.5:1 text contrast
                         (override with --allow-low-contrast)

render options
  --out <file>           .svg, .png or .webp (.html with --format html)
  --format svg|html      html: real text for web pages (zooms, reflows, translates,
                         follows dark mode); default svg
  --css                  with --format html, print only the stylesheet
  --scale <n>            PNG and WebP pixel density, 0.5 to 16 (default 1)

stamp options
  --out <file>           default <name>.ai-label.<ext> next to the input
  --position top-left|top-right|bottom-left|bottom-right   default top-left
  --no-metadata          skip the XMP DigitalSourceType tag
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
  Every yes/no option also takes --no-<option>. Without --realistic or --no-realistic
  (or --public-interest for text), decide asks instead of guessing and exits with 2.

Other
  --scale <n>            PNG pixel density for eu (default 1)
  --json                 machine-readable output
`;

const BOOLEAN = new Set(['short', 'uppercase', 'minimal', 'json', 'allow-low-contrast', 'realistic', 'creative', 'public-interest', 'editorial-review', 'metadata', 'force', 'css', 'help']);
const LABEL = ['kind', 'media', 'human', 'lang', 'text', 'human-text', 'description', 'short', 'uppercase', 'minimal', 'theme', 'height', 'background-opacity', 'allow-low-contrast'];
// The options each command accepts; anything else is a typo and must not pass silently.
const OPTIONS = {
  render: [...LABEL, 'out', 'scale', 'format', 'css'],
  stamp: [...LABEL, 'out', 'position', 'metadata', 'force'],
  alt: LABEL,
  decide: ['media', 'origin', 'realistic', 'creative', 'public-interest', 'editorial-review', 'lang'],
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

// The text lines shared by render and stamp: the label sentence, and the alt text when it can be composed.
const altLines = (r) =>
  `disclosure: ${r.disclosure}\n` + (r.alt !== r.disclosure ? `alt: ${r.alt}\n` : 'alt: add --description "what the image shows" to get the full alt text\n');

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
        return `${r.out} (${size})\ntext contrast: ${r.contrast}:1\n${altLines(r)}`;
      });
      return 0;
    }
    case 'stamp': {
      if (rest.length > 1) throw new UsageError(`stamp takes one image; got ${rest.length}. Run it once per file (batch mode is planned)`);
      const result = await stamp(rest[0], flags);
      print(
        result,
        (r) =>
          `${r.output}\nlabel: ${r.label.width}×${r.label.height} px, ${r.label.theme} label, ${r.label.position}, ` +
          `text contrast ${r.contrast.toFixed(2)}:1, stands out ${r.label.separation.toFixed(2)}:1 from the image\n` +
          altLines(r) +
          (r.metadata ? `metadata: ${r.metadata}\n` : '')
      );
      return 0;
    }
    case 'decide': {
      const r = decideLabel(flags);
      const label = (d) =>
        d.label &&
        `Label: --kind ${d.label.kind} --media ${d.label.media.join(',')}${d.label.lang && d.label.lang !== 'en' ? ` --lang ${d.label.lang}` : ''}` +
          (d.officialIcon ? ` (official EU icon with this meaning: ${d.officialIcon})` : '');
      print(r, (d) =>
        (d.required === 'unknown'
          ? [`UNKNOWN: ${d.question}`, label(d), d.disclaimer]
          : [
              `${d.required ? 'REQUIRED' : 'NOT REQUIRED'}: ${d.basis}`,
              label(d),
              d.altText && `Label sentence: ${d.altText}`,
              ...d.placement.map((p) => `- ${p}`),
              ...d.notes.map((n) => `Note: ${n}`),
              ...d.accessibility.map((a) => `Accessibility: ${a}`),
              d.disclaimer,
            ]
        )
          .filter(Boolean)
          .join('\n') + '\n'
      );
      return r.required === 'unknown' ? 2 : 0;
    }
    case 'alt': {
      print(alt(flags), (r) => r.alt + '\n');
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
