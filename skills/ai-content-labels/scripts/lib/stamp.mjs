import { createRequire } from 'node:module';
import { extname, join, dirname } from 'node:path';
import { readFileSync, renameSync, unlinkSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderLabel, POSITIONS, THEMES, ALT_MISSING } from './render.mjs';
import { over, parseHex, contrastRatio } from './contrast.mjs';
import { UsageError, parseBoolean } from './i18n.mjs';

// Burns a label into an image, so it survives downloads and reshares as the EU guidance asks.

export async function loadSharp() {
  try {
    return createRequire(import.meta.url)('sharp');
  } catch {
    const skillDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const repo = join(skillDir, '..', '..');
    const where = isOurRepo(repo) ? `run \`npm install --omit=dev\` in ${repo}` : `run \`npm install sharp@0.35\` in ${skillDir}`;
    const err = new UsageError(
      `stamping and PNG output need the optional dependency "sharp": ${where}, ` +
        'or run through npx: `npx -y github:JK-G/ai-content-labels stamp ...`.'
    );
    err.code = 'NO_SHARP';
    throw err;
  }
}

// True when the skill still sits inside a clone of this repository (not copied on its own).
function isOurRepo(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name === 'ai-content-labels';
  } catch {
    return false;
  }
}

const DIGITAL_SOURCE = {
  generated: 'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia',
  modified: 'http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia',
};

// Our own XMP property that says a visible label was burned in. It is written on every stamp
// (human-made and --no-metadata included), so a labelled file is never stamped again by mistake.
// The DigitalSourceType alone cannot say that: AI generators write it into unlabelled images.
export const LABEL_NS = 'https://github.com/JK-G/ai-content-labels/xmp/1.0/';
const labelDescription = (kind) => `<rdf:Description rdf:about="" xmlns:aicl="${LABEL_NS}"><aicl:VisibleLabel>${kind}</aicl:VisibleLabel></rdf:Description>`;
const MARKER = /<aicl:VisibleLabel>([^<]*)<\/aicl:VisibleLabel>/;
const sourceDescription = (type) =>
  '<rdf:Description rdf:about="" xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/">' +
  `<Iptc4xmpExt:DigitalSourceType>${type}</Iptc4xmpExt:DigitalSourceType></rdf:Description>`;

// The kind an earlier stamp recorded ("generated", "human", ...), "" for a marker without a value,
// null when the file has no marker.
export function labelledAs(xmp) {
  if (!xmp?.includes(LABEL_NS)) return null;
  return xmp.match(MARKER)?.[1] ?? '';
}

// A new XMP packet with the marker and, when `sourceType` is set, the IPTC DigitalSourceType.
// By default the DigitalSourceType is the one for the kind (none for basic and human).
export function digitalSourceXmp(kind, { sourceType = DIGITAL_SOURCE[kind] ?? null } = {}) {
  return (
    '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>' +
    '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
    (sourceType ? sourceDescription(sourceType) : '') +
    `${labelDescription(kind)}</rdf:RDF></x:xmpmeta><?xpacket end="w"?>`
  );
}

// Adds the marker (and the DigitalSourceType, when set) to the XMP packet the file already has,
// keeping everything else (rights, credit, captions). Without a readable packet, starts a new one.
export function mergeXmp(existing, kind, { sourceType = DIGITAL_SOURCE[kind] ?? null } = {}) {
  if (!existing || existing.lastIndexOf('</rdf:RDF>') < 0) return digitalSourceXmp(kind, { sourceType });
  let merged = existing;
  if (sourceType) {
    const element = /<Iptc4xmpExt:DigitalSourceType>[^<]*<\/Iptc4xmpExt:DigitalSourceType>/;
    const attribute = /Iptc4xmpExt:DigitalSourceType="[^"]*"/;
    if (element.test(merged)) merged = merged.replace(element, `<Iptc4xmpExt:DigitalSourceType>${sourceType}</Iptc4xmpExt:DigitalSourceType>`);
    else if (attribute.test(merged)) merged = merged.replace(attribute, `Iptc4xmpExt:DigitalSourceType="${sourceType}"`);
    else {
      const close = merged.lastIndexOf('</rdf:RDF>');
      merged = merged.slice(0, close) + sourceDescription(sourceType) + merged.slice(close);
    }
  }
  // A forced restamp records the new kind in the existing marker.
  if (MARKER.test(merged)) return merged.replace(MARKER, `<aicl:VisibleLabel>${kind}</aicl:VisibleLabel>`);
  if (merged.includes(LABEL_NS)) return merged;
  const close = merged.lastIndexOf('</rdf:RDF>');
  return merged.slice(0, close) + labelDescription(kind) + merged.slice(close);
}

// Stamped labels never go below these heights: a label with text needs 24 px to stay readable.
export const MIN_HEIGHT = { text: 24, minimal: 20 };

// Label height for an image: about 6% of the shorter side and at least 2.5% of the longer side
// (so tall 9:16 covers and wide banners still get a visible label), between 28 and 512 px.
export const autoHeight = (w, h) => Math.min(512, Math.max(28, Math.round(Math.min(w, h) * 0.06), Math.round(Math.max(w, h) * 0.025)));

export async function stampImage(input, output, opts = {}) {
  const format = formatFor(output);
  const sharp = await loadSharp();
  const position = opts.position ?? 'top-left';
  if (!POSITIONS.includes(position)) throw new UsageError(`position must be one of: ${POSITIONS.join(', ')}`);
  const minimal = parseBoolean(opts.minimal, '--minimal') ?? false;
  const min = minimal ? MIN_HEIGHT.minimal : MIN_HEIGHT.text;
  if (opts.height != null && !(Number(opts.height) >= min)) {
    throw new UsageError(`a stamped label must be at least ${min} px tall to stay legible${minimal ? '' : '; use --minimal for smaller spots'}`);
  }

  // Pixels after EXIF rotation, for the size and for picking the theme.
  let data, info, meta;
  try {
    meta = await sharp(input).metadata();
    if ((meta.pages ?? 1) <= 1) ({ data, info } = await sharp(input).rotate().removeAlpha().raw().toBuffer({ resolveWithObject: true }));
  } catch (e) {
    throw new Error(`could not read ${input}: ${e.message}`);
  }
  if ((meta.pages ?? 1) > 1) throw new UsageError(`animated images are not supported yet (${meta.pages} frames); export a still frame, or wait for video labels`);
  const existingXmp = meta.xmp?.toString('utf8').replace(/\0+$/, '');
  const previous = labelledAs(existingXmp);
  if (previous != null && !parseBoolean(opts.force, '--force')) {
    throw new UsageError(`already labelled${previous ? ` as ${previous}` : ''} (an ai-content-labels marker is in the XMP); pass --force to stamp again`);
  }
  const { width: W, height: H } = info;

  let height = opts.height ? Number(opts.height) : autoHeight(W, H);
  let label = renderLabel({ ...opts, height, theme: opts.theme === 'auto' || !opts.theme ? 'light' : opts.theme });
  // Shrink the label when it is wider than the image allows.
  const fits = (l) => l.width + l.height <= W && l.height * 2 <= H;
  while (!fits(label) && height > min) {
    height = Math.max(min, Math.floor(height * 0.9));
    label = renderLabel({ ...opts, height, theme: label.options.theme });
  }
  if (!fits(label)) {
    throw new UsageError(
      `the image (${W}×${H}) is too small for a legible label; it needs about ${label.width + label.height}×${label.height * 2} px. ` +
        'For thumbnails use --minimal, or put the label next to the image with render'
    );
  }

  const margin = Math.round(label.height * 0.5);
  const left = position.endsWith('left') ? margin : W - margin - label.width;
  const top = position.startsWith('top') ? margin : H - margin - label.height;

  // The theme whose pill stands out more from the pixels under it.
  const mean = regionMean(data, info, left, top, label.width, label.height);
  const separation = (t) => contrastRatio(over(parseHex(THEMES[t].background), THEMES[t].backgroundOpacity, mean), mean);
  let theme = opts.theme && opts.theme !== 'auto' ? opts.theme : null;
  if (!theme) {
    theme = separation('dark') >= separation('light') ? 'dark' : 'light';
    label = renderLabel({ ...opts, height: label.height, theme });
  }

  // Keep the input's EXIF, ICC profile and XMP; always add the visible-label marker, and the
  // DigitalSourceType for AI labels unless --no-metadata.
  let pipeline = sharp(input).rotate().composite([{ input: Buffer.from(label.svg), left, top }]).keepIccProfile().keepExif();
  const tag = label.options.metadata && DIGITAL_SOURCE[label.options.kind];
  pipeline = pipeline.withXmp(mergeXmp(existingXmp, label.options.kind, { sourceType: tag || null }));
  pipeline = format.apply(pipeline);
  // Write next to the output and rename, so nobody sees a half-written file.
  const part = `${output}.part`;
  try {
    await pipeline.toFile(part);
    renameSync(part, output);
  } catch (e) {
    if (existsSync(part)) unlinkSync(part);
    throw e;
  }

  return {
    output,
    image: { width: W, height: H },
    label: { left, top, width: label.width, height: label.height, theme, position, separation: Math.round(separation(theme) * 100) / 100 },
    alt: label.alt,
    ...(label.alt == null && { altMissing: ALT_MISSING }),
    disclosure: label.disclosure,
    contrast: label.contrast,
    wcag: label.wcag,
    metadata: tag
      ? `XMP DigitalSourceType ${tag.split('/').pop()}`
      : label.options.metadata
        ? 'XMP ai-content-labels marker only: IPTC has no DigitalSourceType term for this label'
        : 'XMP ai-content-labels marker only (no DigitalSourceType, --no-metadata)',
  };
}

// Mean sRGB colour of the pixels under the label, sampled on a grid.
function regionMean(data, info, left, top, w, h) {
  const { width, channels } = info;
  const sum = [0, 0, 0];
  let n = 0;
  const step = Math.max(1, Math.floor(Math.min(w, h) / 12));
  for (let y = top; y < top + h; y += step) {
    for (let x = left; x < left + w; x += step) {
      const i = (y * width + x) * channels;
      for (let c = 0; c < 3; c++) sum[c] += data[i + c];
      n++;
    }
  }
  return n ? sum.map((s) => s / n) : [255, 255, 255];
}

export function formatFor(output) {
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
  if (ext === '.gif') throw new UsageError('GIF output is not supported; pass --out name.png or name.webp');
  if (!apply) throw new UsageError(`unsupported output format "${ext || '(none)'}"; use .jpg, .png, .webp, .avif or .tiff`);
  return { apply };
}
