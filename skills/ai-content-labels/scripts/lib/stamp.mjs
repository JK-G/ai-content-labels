import { createRequire } from 'node:module';
import { extname, join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderLabel, POSITIONS } from './render.mjs';
import { luminance } from './contrast.mjs';
import { UsageError } from './i18n.mjs';

// Burns a label into an image, so it survives downloads and reshares as the EU guidance asks.

export async function loadSharp() {
  try {
    return createRequire(import.meta.url)('sharp');
  } catch {
    const skillDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const repo = join(skillDir, '..', '..');
    const where = existsSync(join(repo, 'package.json'))
      ? `run \`npm install --omit=dev\` in ${repo}`
      : `run \`npm install sharp\` in ${skillDir}`;
    const err = new UsageError(
      `stamping and PNG output need the optional dependency "sharp": ${where}, ` +
        'or run through npx: `npx -y github:JK-G/ai-content-labels stamp ...`.'
    );
    err.code = 'NO_SHARP';
    throw err;
  }
}

const DIGITAL_SOURCE = {
  generated: 'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia',
  modified: 'http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia',
};

export function digitalSourceXmp(kind) {
  const type = DIGITAL_SOURCE[kind];
  if (!type) return null;
  return (
    '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>' +
    '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
    '<rdf:Description rdf:about="" xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/">' +
    `<Iptc4xmpExt:DigitalSourceType>${type}</Iptc4xmpExt:DigitalSourceType>` +
    '</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>'
  );
}

// Label height for an image: about 4.5% of the shorter side, never below 28 px.
export const autoHeight = (w, h) => Math.max(28, Math.min(160, Math.round(Math.min(w, h) * 0.045)));

export async function stampImage(input, output, opts = {}) {
  const sharp = await loadSharp();
  const position = opts.position ?? 'top-left';
  if (!POSITIONS.includes(position)) throw new UsageError(`position must be one of: ${POSITIONS.join(', ')}`);

  // Pixels after EXIF rotation, for the size and for picking the theme.
  const { data, info } = await sharp(input).rotate().removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = info;

  let height = opts.height ? Number(opts.height) : autoHeight(W, H);
  let label = renderLabel({ ...opts, height, theme: opts.theme === 'auto' || !opts.theme ? 'light' : opts.theme });
  // Shrink the label when it is wider than the image allows.
  const fits = (l) => l.width + l.height <= W && l.height * 2 <= H;
  while (!fits(label) && height > 20) {
    height = Math.max(20, Math.floor(height * 0.9));
    label = renderLabel({ ...opts, height, theme: label.options.theme });
  }
  if (!fits(label)) throw new UsageError(`the image (${W}×${H}) is too small for a legible label`);

  const margin = Math.round(label.height * 0.5);
  const left = position.endsWith('left') ? margin : W - margin - label.width;
  const top = position.startsWith('top') ? margin : H - margin - label.height;

  let theme = opts.theme && opts.theme !== 'auto' ? opts.theme : null;
  if (!theme) {
    // A dark label on a light area and a light label on a dark one, so the label stands out.
    theme = regionLuminance(data, info, left, top, label.width, label.height) > 0.4 ? 'dark' : 'light';
    label = renderLabel({ ...opts, height: label.height, theme });
  }

  const format = formatFor(output);
  let pipeline = sharp(input).rotate().composite([{ input: Buffer.from(label.svg), left, top }]).keepIccProfile();
  const xmp = opts.metadata === false ? null : digitalSourceXmp(label.options.kind);
  if (xmp) pipeline = pipeline.withXmp(xmp);
  pipeline = format.apply(pipeline);
  await pipeline.toFile(output);

  return {
    output,
    image: { width: W, height: H },
    label: { left, top, width: label.width, height: label.height, theme, position },
    alt: label.alt,
    contrast: label.contrast,
    metadata: xmp ? `XMP DigitalSourceType ${DIGITAL_SOURCE[label.options.kind].split('/').pop()}` : null,
  };
}

function regionLuminance(data, info, left, top, w, h) {
  const { width, channels } = info;
  let sum = 0;
  let n = 0;
  const step = Math.max(1, Math.floor(Math.min(w, h) / 12));
  for (let y = top; y < top + h; y += step) {
    for (let x = left; x < left + w; x += step) {
      const i = (y * width + x) * channels;
      sum += luminance([data[i], data[i + 1], data[i + 2]]);
      n++;
    }
  }
  return n ? sum / n : 1;
}

function formatFor(output) {
  const ext = extname(output).toLowerCase();
  const map = {
    '.jpg': (p) => p.jpeg({ quality: 92, mozjpeg: true }),
    '.jpeg': (p) => p.jpeg({ quality: 92, mozjpeg: true }),
    '.png': (p) => p.png(),
    '.webp': (p) => p.webp({ quality: 92 }),
    '.avif': (p) => p.avif({ quality: 70 }),
    '.tif': (p) => p.tiff(),
    '.tiff': (p) => p.tiff(),
  };
  const apply = map[ext];
  if (!apply) throw new UsageError(`unsupported output format "${ext || '(none)'}"; use .jpg, .png, .webp, .avif or .tiff`);
  return { apply };
}
