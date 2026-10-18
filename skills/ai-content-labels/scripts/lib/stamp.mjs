import { createRequire } from 'node:module';
import { extname, join, dirname } from 'node:path';
import { readFileSync, renameSync, unlinkSync, existsSync, openSync, readSync, closeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderLabel, POSITIONS, THEMES, ALT_MISSING } from './render.mjs';
import { spotAt, chooseSpot, busyMap, parseRegion, MAP_SIZE } from './place.mjs';
import { parseColor, colorTheme, accentColor, accentTones } from './color.mjs';
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

// The smallest legible label: 24 px tall with text, 20 px without (--minimal), as the image is
// shown. Stamped labels never go below these heights in the file either.
export const MIN_HEIGHT = { text: 24, minimal: 20 };

// The width an image is shown at on a phone, in CSS px: full width in a feed, a story or a mobile
// article. The automatic size assumes it, because a label that is legible there is legible on
// every larger screen; --display-width sets another width.
export const PHONE_WIDTH = 390;

// --color auto keeps the neutral pill where the accent tone would stand out from the spot under the
// label by less than this luminance ratio.
export const MIN_SEPARATION = 1.5;

// The largest image stamped, in pixels (about 7070×7070, or 8660×5770 at 3:2). Decoding is capped at
// this too, so a small file that claims huge dimensions cannot exhaust memory.
export const MAX_PIXELS = 50_000_000;
const LIMIT = { limitInputPixels: MAX_PIXELS };
// Raster formats as sharp names them ("heif" is AVIF). SVG, PDF and the rest are refused: a vector
// file can ask for any size, and none of them is a photo to label.
const RASTER = ['jpeg', 'png', 'webp', 'heif', 'tiff', 'gif'];
const notRaster = (format) => `${format} input is not stamped; export the image as PNG, JPG or WebP first (stamp takes jpg, png, webp, avif, tiff, and still gif)`;

// SVG and other XML start with "<" (after an optional BOM and white space); every raster format
// starts with a binary signature. Checked before sharp sees the file, which would render an SVG.
function looksLikeMarkup(input) {
  let head;
  if (Buffer.isBuffer(input)) head = input.subarray(0, 256);
  else {
    let fd;
    try {
      fd = openSync(input, 'r');
      head = Buffer.alloc(256);
      head = head.subarray(0, readSync(fd, head, 0, 256, 0));
    } catch {
      return false;
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  }
  return /^(﻿)?\s*</.test(head.toString('utf8'));
}

// Label height in the file's pixels for an image `width` px wide: the smallest legible height
// (MIN_HEIGHT) as the image is shown `displayWidth` CSS px wide, never below it in the file, at most
// 512 px. 1080 px wide: 56 px minimal, 67 px with text.
export function autoHeight(width, { minimal = false, displayWidth = PHONE_WIDTH } = {}) {
  const min = minimal ? MIN_HEIGHT.minimal : MIN_HEIGHT.text;
  return Math.min(512, Math.max(min, Math.ceil((min * width) / displayWidth)));
}

export async function stampImage(input, output, opts = {}) {
  const format = formatFor(output);
  const { pipeline, result } = await compose(input, opts);
  // Write next to the output and rename, so nobody sees a half-written file.
  const part = `${output}.part`;
  try {
    await format.apply(pipeline).toFile(part);
    renameSync(part, output);
  } catch (e) {
    if (existsSync(part)) unlinkSync(part);
    throw e;
  }
  return { output, ...result };
}

// The same stamp on an image held in memory (a download, a base64 upload, a generator's output).
// Returns the labelled image as a Buffer with its MIME type; nothing is written to disk. The format
// is opts.format (jpeg, png, webp, avif, tiff) or, by default, the input's own.
export async function stampBuffer(buffer, opts = {}) {
  if (!Buffer.isBuffer(buffer)) throw new UsageError('stampBuffer takes a Buffer with the image');
  const { pipeline, result, meta } = await compose(buffer, opts);
  const type = TYPES[normalType(opts.format ?? meta.format)];
  const out = await type.apply(pipeline).toBuffer();
  return { buffer: out, mimeType: type.mime, format: type.name, ...result };
}

// Reads the image (a path or a Buffer), sizes and places the label, and builds the sharp pipeline
// with the label and the XMP; the caller picks the output format and where it goes.
async function compose(input, opts) {
  const sharp = await loadSharp();
  const position = opts.position ?? 'auto';
  if (!POSITIONS.includes(position)) throw new UsageError(`position must be one of: ${POSITIONS.join(', ')}`);
  const color = parseColor(opts.color);
  if (color && opts.theme != null && opts.theme !== 'auto') throw new UsageError('pass --theme or --color, not both');
  const minimal = parseBoolean(opts.minimal, '--minimal') ?? false;
  const min = minimal ? MIN_HEIGHT.minimal : MIN_HEIGHT.text;
  if (opts.height != null && !(Number(opts.height) >= min)) {
    throw new UsageError(`a stamped label must be at least ${min} px tall to stay legible${minimal ? '' : '; use --minimal for smaller spots'}`);
  }
  const displayWidth = opts.displayWidth == null ? null : Number(opts.displayWidth);
  if (displayWidth != null) {
    if (!Number.isInteger(displayWidth) || displayWidth < 100 || displayWidth > 10000) {
      throw new UsageError(`--display-width is the width the image is shown at, in whole CSS px (100 to 10000; 390 for a phone), not "${opts.displayWidth}"`);
    }
    if (opts.height != null) throw new UsageError('pass --height or --display-width, not both');
  }
  const name = Buffer.isBuffer(input) ? 'the image' : input;

  // The header first: format, size and frames are known before a single pixel is decoded, so a
  // vector file or a pixel bomb is refused without the memory it would take.
  let data, info, meta;
  if (looksLikeMarkup(input)) throw new UsageError(notRaster('SVG'));
  try {
    meta = await sharp(input, LIMIT).metadata();
  } catch (e) {
    if (/pixel limit/i.test(e.message)) throw new UsageError(`the image is over the ${MAX_PIXELS / 1e6} megapixel limit; scale it down first`);
    throw new Error(`could not read ${name}: ${e.message}`);
  }
  if (!RASTER.includes(meta.format)) throw new UsageError(notRaster(String(meta.format ?? 'this').toUpperCase()));
  if ((meta.pages ?? 1) > 1) throw new UsageError(`animated images are not supported yet (${meta.pages} frames); export a still frame, or wait for video labels`);
  if (meta.width * meta.height > MAX_PIXELS) {
    throw new UsageError(`the image is ${meta.width}×${meta.height} px, over the ${MAX_PIXELS / 1e6} megapixel limit; scale it down first`);
  }
  // Pixels after EXIF rotation, for the size and for picking the theme.
  try {
    ({ data, info } = await sharp(input, LIMIT).rotate().removeAlpha().raw().toBuffer({ resolveWithObject: true }));
  } catch (e) {
    throw new Error(`could not read ${name}: ${e.message}`);
  }
  const existingXmp = meta.xmp?.toString('utf8').replace(/\0+$/, '');
  const previous = labelledAs(existingXmp);
  if (previous != null && !parseBoolean(opts.force, '--force')) {
    throw new UsageError(`already labelled${previous ? ` as ${previous}` : ''} (an ai-content-labels marker is in the XMP); pass --force to stamp again`);
  }
  const { width: W, height: H } = info;
  // The label belongs to the whole image, or with --region to the AI part of it (a generated photo
  // inside a designed graphic): it is then placed on that part.
  const region = parseRegion(opts.region, W, H);
  const area = region ?? { left: 0, top: 0, width: W, height: H };

  // The smallest legible size where the image is shown: a phone unless --display-width says otherwise.
  const shownAt = displayWidth ?? PHONE_WIDTH;
  let height = opts.height ? Number(opts.height) : autoHeight(W, { minimal, displayWidth: shownAt });
  // The size does not depend on the colour, so it is measured with the light pill.
  const draw = (h) => renderLabel({ ...opts, height: h, theme: 'light', color: undefined });
  let label = draw(height);
  // Shrink the label when it is wider than the image (or the region) allows.
  const fits = (l) => l.width + l.height <= area.width && l.height * 2 <= area.height;
  while (!fits(label) && height > min) {
    height = Math.max(min, Math.floor(height * 0.9));
    label = draw(height);
  }
  if (!fits(label)) {
    const what = region ? `the region (${area.width}×${area.height})` : `the image (${W}×${H})`;
    throw new UsageError(
      `${what} is too small for a legible label; it needs about ${label.width + label.height}×${label.height * 2} px. ` +
        (region ? 'Label the whole image instead, or put the label next to it' : `${minimal ? '' : 'For thumbnails use --minimal, or '}put the label next to the image with render`)
    );
  }

  const margin = Math.round(label.height * 0.5);
  // A small copy for judging spots and colours, decoded once and only when needed.
  let copy;
  const smallCopy = () => (copy ??= decodeSmall(sharp, input, W, H));
  let spot;
  if (position === 'auto') {
    const small = await smallCopy();
    spot = chooseSpot(busyMap(small.data, small.width, small.height, small.channels, small.scale), area, label.width, label.height, margin);
  } else {
    spot = { position, ...spotAt(position, area, label.width, label.height, margin) };
  }
  const { left, top } = spot;

  // The colour: a given one, the image's accent (--color auto), or the neutral pill that stands out
  // more from the pixels under the label.
  const mean = regionMean(data, info, left, top, label.width, label.height);
  const separationOf = (t) => contrastRatio(over(parseHex(t.background), t.backgroundOpacity, mean), mean);
  let theme = opts.theme && opts.theme !== 'auto' ? opts.theme : null;
  let pill = color === 'auto' ? null : color;
  let accent = null;
  if (color === 'auto') {
    accent = accentColor((await smallCopy()).data, 3);
    if (accent) {
      const { dark, light } = accentTones(accent.oklch);
      pill = separationOf(colorTheme(dark)) >= separationOf(colorTheme(light)) ? dark : light;
      // A pill the same tone as the spot under it would blend in: keep the neutral one there.
      if (separationOf(colorTheme(pill)) < MIN_SEPARATION) pill = null;
    }
  }
  if (pill) theme = 'custom';
  else if (!theme) theme = separationOf(THEMES.dark) >= separationOf(THEMES.light) ? 'dark' : 'light';
  label = renderLabel({ ...opts, height: label.height, ...(pill ? { theme: undefined, color: pill } : { theme, color: undefined }) });
  const used = pill ? colorTheme(pill) : THEMES[theme];

  // Keep the input's EXIF, ICC profile and XMP; always add the visible-label marker, and the
  // DigitalSourceType for AI labels unless --no-metadata.
  let pipeline = sharp(input, LIMIT).rotate().composite([{ input: Buffer.from(label.svg), left, top }]).keepIccProfile().keepExif();
  const tag = label.options.metadata && DIGITAL_SOURCE[label.options.kind];
  pipeline = pipeline.withXmp(mergeXmp(existingXmp, label.options.kind, { sourceType: tag || null }));

  const result = {
    image: { width: W, height: H },
    label: {
      left,
      top,
      width: label.width,
      height: label.height,
      form: label.options.form,
      theme,
      ...(pill && { color: { background: pill, ink: used.ink, source: color === 'auto' ? 'auto' : 'given', ...(accent && { accent: accent.hex }) } }),
      ...(color === 'auto' && !pill && { colorNote: accent ? 'the accent colour would blend into the spot under the label; the neutral pill is used' : 'no clear accent colour in the image; the neutral pill is used' }),
      position: spot.position,
      placement: position === 'auto' ? 'auto' : 'given',
      ...(spot.spots && { reason: spot.reason, spots: spot.spots }),
      ...(region && { region }),
      separation: Math.round(separationOf(used) * 100) / 100,
      // The narrowest display width at which the label is still `min` px tall (24, or 20 for minimal).
      minDisplayWidth: Math.ceil((min * W) / label.height),
      // How tall the label looks where the image is shown: on a phone unless --display-width.
      displayWidth: shownAt,
      displayHeight: Math.round((label.height * Math.min(shownAt, W) * 10) / W) / 10,
    },
    ...(label.height * Math.min(shownAt, W) < min * W && {
      warning: `the label had to shrink to fit ${region ? 'the region' : 'the image'}: shown ${shownAt} px wide it is under the legible ${min} px. ${minimal ? '' : 'Use --minimal, '}${region ? 'a larger region, ' : ''}or put the label next to the image`,
    }),
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
  return { pipeline, result, meta };
}

// The image at most MAP_SIZE px on the long side, in 3-channel sRGB, for judging spots and colours.
async function decodeSmall(sharp, input, W, H) {
  const scale = Math.min(1, MAP_SIZE / Math.max(W, H));
  const [w, h] = [Math.max(1, Math.round(W * scale)), Math.max(1, Math.round(H * scale))];
  const { data, info } = await sharp(input, LIMIT).rotate().resize(w, h, { fit: 'fill' }).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels, scale: info.width / W };
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

// Output formats by name, with the MIME type and extension a buffer result reports.
const TYPES = {
  jpeg: { name: 'jpeg', mime: 'image/jpeg', ext: '.jpg', apply: (p) => p.jpeg({ quality: 92, mozjpeg: true }) },
  png: { name: 'png', mime: 'image/png', ext: '.png', apply: (p) => p.png() },
  webp: { name: 'webp', mime: 'image/webp', ext: '.webp', apply: (p) => p.webp({ quality: 92 }) },
  avif: { name: 'avif', mime: 'image/avif', ext: '.avif', apply: (p) => p.avif({ quality: 70 }) },
  tiff: { name: 'tiff', mime: 'image/tiff', ext: '.tiff', apply: (p) => p.tiff() },
};
const EXTENSIONS = { '.jpg': 'jpeg', '.jpeg': 'jpeg', '.png': 'png', '.webp': 'webp', '.avif': 'avif', '.tif': 'tiff', '.tiff': 'tiff' };

// A format name, MIME type or sharp's metadata.format ("heif" for AVIF) as a key of TYPES. Anything
// else (gif, svg) becomes png, a still format every platform takes.
export function normalType(type) {
  const t = String(type ?? '')
    .toLowerCase()
    .replace(/^image\//, '')
    .replace(/;.*$/, '');
  if (t === 'jpg' || t === 'pjpeg') return 'jpeg';
  if (t === 'heif' || t === 'heic') return 'avif';
  if (t === 'tif') return 'tiff';
  return TYPES[t] ? t : 'png';
}

// The name, MIME type and file extension of a format.
export const typeInfo = (type) => {
  const { name, mime, ext } = TYPES[normalType(type)];
  return { name, mime, ext };
};

export function formatFor(output) {
  const ext = extname(output).toLowerCase();
  if (ext === '.gif') throw new UsageError('GIF output is not supported; pass --out name.png or name.webp');
  const type = TYPES[EXTENSIONS[ext]];
  if (!type) throw new UsageError(`unsupported output format "${ext || '(none)'}"; use .jpg, .png, .webp, .avif or .tiff`);
  return { apply: type.apply, mime: type.mime };
}
