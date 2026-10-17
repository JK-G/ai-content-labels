#!/usr/bin/env node
// ai-content-labels: labels for AI-generated and human-made content, built on the official EU icons.
import { render, stamp, decideLabel, alt, eu, icons, doctor } from './lib/api.mjs';
import { UsageError } from './lib/i18n.mjs';

const HELP = `ai-labels <command> [options]

Commands
  decide                 Which label the content needs, and whether the AI Act requires it
  render                 Draw a label as SVG (stdout) or to --out file.svg|.png|.webp
  stamp <image>          Burn a label into an image (jpg, png, webp, avif, tiff)
  alt                    Print the alt-text sentence for a label
  eu [basic|generated|modified]
                         The official EU icon, unchanged (--variant, --out)
  icons [--out dir]      List the media and compact icons, or copy them to a folder
  doctor                 Check the setup

Label options (render, stamp, alt)
  --kind generated|modified|basic|human   default generated
  --media image,text,audio,voice,music,video
                         what was made with AI (or by a human, with --kind human)
  --human text,...       add a "made by a human" part next to an AI label
  --lang en|pl           default en
  --text "..."           your own label text (basic labels need one in practice)
  --human-text "..."     your own text for the human-made part
  --short                compact wording ("Generated" instead of "Generated with AI")
  --uppercase            upper case with letter spacing, like the EU icons
  --mark eu|compact      leading mark: the EU icon (default) or the compact icon set
  --theme light|dark     stamp also accepts auto (default there)
  --height <px>          default 32; stamp picks about 4.5% of the shorter image side
  --background-opacity <0-1>
                         refused below the level that keeps 4.5:1 text contrast
                         (override with --allow-low-contrast)

stamp options
  --out <file>           default <name>.ai-label.<ext> next to the input
  --position top-left|top-right|bottom-left|bottom-right   default top-left
  --no-metadata          skip the XMP DigitalSourceType tag

decide options
  --media image|video|audio|text   --origin generated|modified|assisted|human
  --realistic            looks like a real person, object, place or event
  --creative             evidently artistic, satirical or fictional work
  --public-interest      text published to inform the public on matters of public interest
  --editorial-review     a human reviewed the text and someone holds editorial responsibility

Other
  --scale <n>            PNG pixel density for render and eu (default 1)
  --json                 machine-readable output
`;

const BOOLEAN = new Set(['short', 'uppercase', 'json', 'allow-low-contrast', 'realistic', 'creative', 'public-interest', 'editorial-review', 'help']);
const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h') {
      flags.help = true;
    } else if (a.startsWith('--')) {
      let [key, value] = a.slice(2).split(/=(.*)/s);
      if (key.startsWith('no-') && value === undefined) {
        flags[camel(key.slice(3))] = false;
        continue;
      }
      if (value === undefined) {
        if (BOOLEAN.has(key)) value = true;
        else {
          value = argv[++i];
          if (value === undefined) throw new UsageError(`--${key} needs a value`);
        }
      }
      flags[camel(key)] = value;
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

async function main(argv) {
  const { positional, flags } = parseArgs(argv);
  const [command, ...rest] = positional;
  if (!command || flags.help || command === 'help') {
    process.stdout.write(HELP);
    return 0;
  }
  const print = (result, text) => process.stdout.write(flags.json || !text ? JSON.stringify(result, null, 2) + '\n' : text(result));

  switch (command) {
    case 'render': {
      const result = await render(flags);
      print(result, (r) => (r.svg ? r.svg + '\n' : `${r.out} (${r.width}×${r.height}, contrast ${r.contrast}:1)\nalt: ${r.alt}\n`));
      return 0;
    }
    case 'stamp': {
      const result = await stamp(rest[0], flags);
      print(
        result,
        (r) =>
          `${r.output}\nlabel: ${r.label.width}×${r.label.height} px, ${r.label.theme}, ${r.label.position}, contrast ${r.contrast}:1\n` +
          `alt: ${r.alt}\n${r.metadata ? `metadata: ${r.metadata}\n` : ''}`
      );
      return 0;
    }
    case 'decide': {
      const r = decideLabel(flags);
      print(r, (d) =>
        [
          `${d.required ? 'REQUIRED' : 'Not required'}: ${d.basis}`,
          d.label && `Label: --kind ${d.label.kind} --media ${d.label.media.join(',')}${d.euIcon ? ` (EU icon: ${d.euIcon})` : ''}`,
          d.altText && `Alt text: ${d.altText}`,
          ...d.placement.map((p) => `- ${p}`),
          ...d.notes.map((n) => `Note: ${n}`),
          ...d.accessibility.map((a) => `Accessibility: ${a}`),
          d.disclaimer,
        ]
          .filter(Boolean)
          .join('\n') + '\n'
      );
      return 0;
    }
    case 'alt': {
      print(alt(flags), (r) => r.alt + '\n');
      return 0;
    }
    case 'eu': {
      const r = await eu(rest[0], flags);
      print(r, (x) => (x.out ? `${x.out}\n` : x.svg));
      return 0;
    }
    case 'icons': {
      print(icons(flags), (r) => `media: ${r.media.join(', ')}\ncompact: ${r.compact.join(', ') || '(none)'}\n${r.out ? `copied to ${r.out}\n` : ''}`);
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
