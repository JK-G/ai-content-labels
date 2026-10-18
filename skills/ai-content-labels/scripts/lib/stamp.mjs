import { createRequire } from 'node:module';
import { extname, join, dirname } from 'node:path';
import { readFileSync, renameSync, unlinkSync, existsSync, openSync, readSync, closeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderLabel, formOf, POSITIONS, THEMES, EU_COLORS, ALT_MISSING, MIN_HEIGHT, minHeightOf } from './render.mjs';
import { placeSpot, chooseSpot, shapeWhy, busyMap, parseRegion, parseAvoid, parseSafeZone, avoidHit, maskFrom, maskHas, checkPath, MAP_SIZE } from './place.mjs';
import { parseColor, colorTheme, accentColor, accentTones } from './color.mjs';
import { over, parseHex, contrastRatio } from './contrast.mjs';
import { UsageError, parseBoolean } from './i18n.mjs';
import { VERSION } from './version.mjs';

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

// The smallest legible label, as the image is shown: 18 px for the icon and for a label with words,
// 20 px for the minimal pill (render.mjs says why). Stamped labels never go below these heights in
// the file either.
export { MIN_HEIGHT };

// The form stamp, label and place use when none is asked for: the EU icon alone for an AI label,
// which meets Measure 1.1(a) of the Code of Practice; the word is encouraged, not required. A
// human-made label, a human-made part, and a pill colour (--color, --palette) need a pill, so they
// get the short form.
export function defaultForm(opts) {
  const asked = formOf(opts);
  if (asked) return asked;
  // minimal: false (or icon: false) alone asks for a word.
  if (parseBoolean(opts.minimal, '--minimal') === false || parseBoolean(opts.icon, '--icon') === false) return 'short';
  const human = opts.human != null && opts.human !== '' && !(Array.isArray(opts.human) && !opts.human.length);
  const colour = (opts.color != null && opts.color !== '') || (opts.palette != null && opts.palette !== '');
  return (opts.kind ?? 'generated') === 'human' || human || colour ? 'short' : 'icon';
}

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
// 512 px. 1080 px wide: 50 px for the icon or a word, 56 px minimal.
export function autoHeight(width, { form, minimal = false, displayWidth = PHONE_WIDTH } = {}) {
  const min = minHeightOf(form ?? (minimal ? 'minimal' : 'short'));
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

// Where the label goes and how it looks, without writing a pixel: for HTML pipelines that draw the
// label as HTML or SVG over the image. The same planning as stamp, so the box, size, colour and
// reasons are the ones stamp would use. input is a file path or a Buffer.
export async function placeLabel(input, opts = {}) {
  const { result, label, spot, design } = await plan(await loadSharp(), input, opts, { checkMarker: false });
  const { width: W, height: H } = result.image;
  const box = { left: spot.left, top: spot.top, width: label.width, height: label.height };
  const pct = (v, of) => Math.round((v * 10000) / of) / 100;
  const { label: placed, warning, ...rest } = result;
  return {
    version: VERSION,
    image: result.image,
    label: placed,
    box,
    // right and bottom too, and the side the spot sits on: an HTML label is not exactly as wide as
    // the drawn one, so a corner label anchored by its corner's sides stays in the corner.
    boxPercent: {
      left: pct(box.left, W),
      top: pct(box.top, H),
      width: pct(box.width, W),
      height: pct(box.height, H),
      right: pct(W - box.left - box.width, W),
      bottom: pct(H - box.top - box.height, H),
      anchor: { x: spot.position.endsWith('left') ? 'left' : spot.position.endsWith('right') ? 'right' : 'center', y: spot.position.startsWith('top') ? 'top' : 'bottom' },
    },
    renderArgs: renderArgsOf(label.options, placed, design),
    ...(warning && { warning }),
    ...rest,
  };
}

// The render_label arguments (also the render CLI options, camel-cased) that draw the same label:
// the form is always explicit, so a later change of defaults cannot change the drawing. The height
// is the whole CSS px at or under the label's height where the image is shown, at which stamp lays
// it out too: an SVG drawn with it and scaled to the box is the stamped label. (An HTML label takes
// label.cssHeight, the height rounded up.)
function renderArgsOf(o, placed, design) {
  return {
    kind: o.kind,
    ...(o.media.length && { media: o.media }),
    ...(o.human.length && { human: o.human }),
    lang: o.lang,
    ...(o.text != null && { text: o.text }),
    ...(o.humanText != null && { humanText: o.humanText }),
    form: o.form,
    ...(o.uppercase && { uppercase: true }),
    height: design,
    ...(placed.color ? { color: placed.color.background } : { theme: placed.theme }),
    ...(o.backgroundOpacity != null && { backgroundOpacity: o.backgroundOpacity }),
    ...(o.allowLowContrast && { allowLowContrast: true }),
  };
}

// Reads the image (a path or a Buffer), sizes and places the label, and builds the sharp pipeline
// with the label and the XMP; the caller picks the output format and where it goes.
async function compose(input, opts) {
  const sharp = await loadSharp();
  const { result, label, spot, meta, existingXmp } = await plan(sharp, input, opts, { checkMarker: true });
  // Keep the input's EXIF, ICC profile and XMP; always add the visible-label marker, and the
  // DigitalSourceType for AI labels unless --no-metadata.
  let pipeline = sharp(input, LIMIT).rotate().composite([{ input: Buffer.from(label.svg), left: spot.left, top: spot.top }]).keepIccProfile().keepExif();
  const tag = label.options.metadata && DIGITAL_SOURCE[label.options.kind];
  pipeline = pipeline.withXmp(mergeXmp(existingXmp, label.options.kind, { sourceType: tag || null }));
  const metadata = tag
    ? `XMP DigitalSourceType ${tag.split('/').pop()}`
    : label.options.metadata
      ? 'XMP ai-content-labels marker only: IPTC has no DigitalSourceType term for this label'
      : 'XMP ai-content-labels marker only (no DigitalSourceType, --no-metadata)';
  return { pipeline, result: { version: VERSION, ...result, metadata }, meta };
}

// The palette (--palette): brand colours used exactly as given, as a list of hex colours.
export function parsePalette(value) {
  if (value == null || value === '') return null;
  const list = (Array.isArray(value) ? value : String(value).split(',')).map((v) => String(v).trim()).filter(Boolean);
  if (!list.length) return null;
  return list.map((v) => {
    const hex = parseColor(v);
    if (hex === 'auto') throw new UsageError('--palette takes your brand colours as hex, e.g. #1f7a52,#f2c94c; for the image\'s own accent use --color auto');
    return hex;
  });
}

// The allowed area's shape from --region-mask (a PNG: its alpha, or its brightness when it has no
// transparency) or --region-path (SVG path data in image px), as a mask at most MASK_SIZE px on the
// long side.
const MASK_SIZE = 2048;
async function loadMask(sharp, opts, W, H) {
  const scale = Math.min(1, MASK_SIZE / Math.max(W, H));
  const [w, h] = [Math.max(1, Math.round(W * scale)), Math.max(1, Math.round(H * scale))];
  let values;
  let kind;
  if (opts.regionPath != null && opts.regionPath !== '') {
    kind = 'path';
    // The path is in the image's px; the viewBox maps it onto the (maybe smaller) mask.
    const d = checkPath(opts.regionPath);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><path d="${d}" fill="#fff"/></svg>`;
    values = await sharp(Buffer.from(svg)).resize(w, h, { fit: 'fill' }).ensureAlpha().extractChannel('alpha').raw().toBuffer();
  } else {
    kind = 'mask';
    const file = opts.regionMask;
    const name = Buffer.isBuffer(file) ? 'the --region-mask image' : `--region-mask ${file}`;
    try {
      const m = await sharp(file, LIMIT).metadata();
      const base = () => sharp(file, LIMIT).rotate().resize(w, h, { fit: 'fill' });
      if (m.hasAlpha) {
        values = await base().ensureAlpha().extractChannel('alpha').raw().toBuffer();
        // A mask saved with an alpha channel that is opaque everywhere carries its shape in black and white.
        if (values.every((v) => v === values[0])) values = null;
      }
      values ??= await base().flatten({ background: '#000' }).toColourspace('b-w').raw().toBuffer();
    } catch (e) {
      throw new UsageError(`could not read ${name}: ${e.message}`);
    }
  }
  const mask = maskFrom(values, w, h, W, H);
  if (!mask) throw new UsageError(kind === 'path' ? `--region-path ${opts.regionPath} has no area inside the ${W}×${H} image` : '--region-mask is empty: nothing in it is 50% opaque (or, without transparency, 50% bright)');
  mask.kind = kind;
  return mask;
}

// The pixels of the small copy outside the region (box or mask), when they are at least 20% of the
// image: the designed part of a composite, where a brand colour lives. null otherwise.
function outsidePixels(small, region, mask, W, H) {
  const out = [];
  const { data, width, height, channels } = small;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [ix, iy] = [((x + 0.5) * W) / width, ((y + 0.5) * H) / height];
      const inside = mask ? maskHas(mask, ix, iy) : ix >= region.left && ix < region.left + region.width && iy >= region.top && iy < region.top + region.height;
      if (!inside) out.push(data[(y * width + x) * channels], data[(y * width + x) * channels + 1], data[(y * width + x) * channels + 2]);
    }
  }
  return out.length / 3 >= 0.2 * width * height ? Buffer.from(out) : null;
}

// What to do when the label is under the legible size: a smaller form, a larger region, or a
// label next to the image ("Use the icon form (--form icon), use a larger region or put ...").
function shrinkHelp(icon, region) {
  const ways = [...(icon ? [] : ['use the icon form (--form icon)']), ...(region ? ['use a larger region'] : []), 'put the label next to the image'];
  const text = ways.length > 1 ? `${ways.slice(0, -1).join(', ')} or ${ways.at(-1)}` : ways[0];
  return text[0].toUpperCase() + text.slice(1);
}

// The warning for a label under the legible size where the image is shown: a --height that is too
// small for that, or a label that had to shrink to fit.
function smallWarning({ asked, height, where, shownAt, min, icon, region }) {
  const under = `shown ${shownAt} px wide it is under the legible ${min} px`;
  if (asked != null && height >= asked) return `the label is smaller than legible at this height: ${under}. Pass a larger --height, or leave it out for the smallest legible size`;
  return `the label had to shrink to fit ${where}: ${under}. ${shrinkHelp(icon, region)}`;
}

// Sizes and places the label on the image and picks its colour: everything stamp and place share.
// Returns the rendered label, its spot, the result fields, and the image's metadata and XMP.
async function plan(sharp, input, opts, { checkMarker }) {
  const position = opts.position ?? 'auto';
  if (!POSITIONS.includes(position)) throw new UsageError(`position must be one of: ${POSITIONS.join(', ')}`);
  const color = parseColor(opts.color);
  if (color && opts.theme != null && opts.theme !== 'auto') throw new UsageError('pass --theme or --color, not both');
  const palette = parsePalette(opts.palette);
  if (palette && (color || (opts.theme != null && opts.theme !== 'auto'))) throw new UsageError(`pass --palette or --${color ? 'color' : 'theme'}, not both`);
  const shapes = [opts.region, opts.regionMask, opts.regionPath].filter((v) => v != null && v !== '').length;
  if (shapes > 1) throw new UsageError('pass one of --region, --region-mask and --region-path');
  // The form is explicit from here on, so every drawing below uses the same one.
  const form = defaultForm(opts);
  opts = { ...opts, form, icon: undefined, minimal: undefined, short: undefined, full: undefined };
  if (form === 'icon' && (color || palette)) throw new UsageError('the icon form is the official EU disc in black or white; --color and --palette colour a pill: add --short or --minimal');
  const icon = form === 'icon';
  const min = minHeightOf(form);
  if (opts.height != null && !(Number(opts.height) >= min)) {
    throw new UsageError(`a stamped label must be at least ${min} px tall to stay legible`);
  }
  const displayWidth = opts.displayWidth == null ? null : Number(opts.displayWidth);
  if (displayWidth != null) {
    if (!Number.isInteger(displayWidth) || displayWidth < 100 || displayWidth > 10000) {
      throw new UsageError(`--display-width is the width the image is shown at, in whole CSS px (100 to 10000; 390 for a phone), not "${opts.displayWidth}"`);
    }
    // With --height too, the display width only sets the layout: the image's own width lays the
    // label out at its file size, as 0.1 to 0.3 did.
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
  const previous = checkMarker ? labelledAs(existingXmp) : null;
  if (previous != null && !parseBoolean(opts.force, '--force')) {
    throw new UsageError(`already labelled${previous ? ` as ${previous}` : ''} (an ai-content-labels marker is in the XMP); pass --force to stamp again`);
  }
  const { width: W, height: H } = info;
  // The label belongs to the whole image, or with --region (a box) or --region-mask/--region-path (a
  // shape) to the AI part of it (a generated photo inside a designed graphic): it is then placed on
  // that part. A safe zone trims the edges a platform covers.
  const given = (v) => v != null && v !== '';
  const mask = given(opts.regionMask) || given(opts.regionPath) ? await loadMask(sharp, opts, W, H) : null;
  const region = mask ? mask.box : parseRegion(opts.region, W, H);
  const safe = parseSafeZone(opts.safeZone, W, H);
  const avoid = parseAvoid(opts.avoid, W, H);
  let area = region ?? { left: 0, top: 0, width: W, height: H };
  const untrimmed = safe ? area : null;
  if (safe) {
    const [l, t] = [Math.max(area.left, safe.box.left), Math.max(area.top, safe.box.top)];
    const [r, b] = [Math.min(area.left + area.width, safe.box.left + safe.box.width), Math.min(area.top + area.height, safe.box.top + safe.box.height)];
    if (r <= l || b <= t) throw new UsageError(`the safe zone leaves nothing of the region; the region must reach into the part of the image the platform does not cover`);
    area = { left: l, top: t, width: r - l, height: b - t };
  }
  const where = region ? 'the region' : safe ? 'the safe zone' : 'the image';

  // The smallest legible size where the image is shown: a phone unless --display-width says otherwise.
  const shownAt = displayWidth ?? PHONE_WIDTH;
  let height = opts.height ? Number(opts.height) : autoHeight(W, { form, displayWidth: shownAt });
  // The label is laid out at the height it is seen at, so its type stays legible where the image is
  // shown smaller than its file. The size does not depend on the colour, so it is measured with the
  // light pill.
  // Laid out at the whole px at or under that height, so the type is never smaller than designed
  // once the image is shown, and render draws the same label at renderArgs.height.
  const seen = (h) => (h * Math.min(shownAt, W)) / W;
  const designOf = (h) => Math.max(min, Math.floor(seen(h) + 1e-9));
  const draw = (h, look = { theme: 'light', color: undefined }) => renderLabel({ ...opts, height: h, designHeight: designOf(h), ...look });
  let label = draw(height);
  // Shrink the label when it is wider than the image (or the region) allows, or, in a shape, when no
  // spot that may be used fits inside it.
  const spotsToTry = position === 'auto' ? POSITIONS.slice(1) : [position];
  const inShape = (l) => !mask || spotsToTry.some((p) => placeSpot(p, area, l.width, l.height, Math.round(l.height * 0.5), mask));
  const fits = (l) => l.width + l.height <= area.width && l.height * 2 <= area.height && inShape(l);
  while (!fits(label) && height > min) {
    height = Math.max(min, Math.floor(height * 0.9));
    label = draw(height);
  }
  if (label.width + label.height > area.width || label.height * 2 > area.height) {
    const what = region || safe ? `${where} (${area.width}×${area.height})` : `the image (${W}×${H})`;
    throw new UsageError(
      `${what} is too small for a legible label; it needs about ${label.width + label.height}×${label.height * 2} px. ` +
        (region ? 'Label the whole image instead, or put the label next to it' : `${icon ? '' : 'For thumbnails use the icon form (--form icon), or '}put the label next to the image with render`)
    );
  }

  const margin = Math.round(label.height * 0.5);
  // A small copy for judging spots and colours, decoded once and only when needed.
  let copy;
  const smallCopy = () => (copy ??= decodeSmall(sharp, input, W, H));
  let spot;
  if (position === 'auto') {
    const small = await smallCopy();
    spot = chooseSpot(busyMap(small.data, small.width, small.height, small.channels, small.scale), area, label.width, label.height, margin, { mask, avoid, untrimmed });
  } else {
    const at = placeSpot(position, area, label.width, label.height, margin, mask);
    if (!at) throw new UsageError(`--position ${position} ${shapeWhy(position, label.width, label.height, margin, mask, untrimmed)}; leave --position at auto${icon ? '' : ', or use --form icon for a smaller label'}`);
    const hit = avoidHit(avoid, { left: at.left - margin, top: at.top - margin, width: label.width + 2 * margin, height: label.height + 2 * margin });
    if (hit) throw new UsageError(`--position ${position} overlaps avoid box ${hit}; leave --position at auto, or pick another spot`);
    spot = { position, ...at };
  }
  const { left, top } = spot;

  // The colour: a given one, the image's accent (--color auto), a brand colour from --palette, or the
  // neutral pill that stands out more from the pixels under the label.
  const mean = regionMean(data, info, left, top, label.width, label.height);
  const separationOf = (t) => contrastRatio(over(parseHex(t.background), t.backgroundOpacity, mean), mean);
  // The icon has no pill: what stands out is its disc, black for theme light and white for dark.
  const look = (name) => (icon ? { background: EU_COLORS[THEMES[name].eu][0], backgroundOpacity: 1 } : THEMES[name]);
  let theme = opts.theme && opts.theme !== 'auto' ? opts.theme : null;
  let pill = color === 'auto' ? null : color;
  let accent = null;
  let source = color === 'auto' ? 'auto' : 'given';
  let sampled = null;
  let colorNote;
  if (color === 'auto') {
    // In a composite the designed part outside the AI region carries the brand colour; the photo's
    // incidental colours (a red cable, the sky) would win the whole-image count.
    const small = await smallCopy();
    const outside = region ? outsidePixels(small, region, mask, W, H) : null;
    sampled = outside ? 'outside the region' : 'whole image';
    accent = accentColor(outside ?? small.data, 3);
    if (accent) {
      const { dark, light } = accentTones(accent.oklch);
      pill = separationOf(colorTheme(dark)) >= separationOf(colorTheme(light)) ? dark : light;
      // A pill the same tone as the spot under it would blend in: keep the neutral one there.
      if (separationOf(colorTheme(pill)) < MIN_SEPARATION) pill = null;
    }
    if (!pill) colorNote = accent ? 'the accent colour would blend into the spot under the label; the neutral pill is used' : 'no clear accent colour in the image; the neutral pill is used';
  } else if (palette) {
    // The brand colour that stands out most from the spot, used exactly as given.
    source = 'palette';
    const best = palette.reduce((a, b) => (separationOf(colorTheme(b)) > separationOf(colorTheme(a)) ? b : a));
    if (separationOf(colorTheme(best)) >= MIN_SEPARATION) pill = best;
    else colorNote = 'no palette colour stands out from the spot under the label; the neutral pill is used';
  }
  if (pill) theme = 'custom';
  else if (!theme) theme = separationOf(look('dark')) >= separationOf(look('light')) ? 'dark' : 'light';
  label = draw(label.height, pill ? { theme: undefined, color: pill } : { theme, color: undefined });
  const used = pill ? colorTheme(pill) : look(theme);

  const result = {
    image: { width: W, height: H },
    label: {
      left,
      top,
      width: label.width,
      height: label.height,
      form: label.options.form,
      theme,
      ...(icon && { disc: THEMES[theme].eu }),
      ...(pill && { color: { background: pill, ink: used.ink, source, ...(accent && { accent: accent.hex }), ...(sampled && { sampled }) } }),
      ...(colorNote && { colorNote }),
      position: spot.position,
      placement: position === 'auto' ? 'auto' : 'given',
      ...(spot.spots && { reason: spot.reason, spots: spot.spots, why: spot.why }),
      ...(region && { region }),
      ...(mask && { shape: mask.kind }),
      ...(safe && { safeZone: { name: safe.name, top: safe.top, right: safe.right, bottom: safe.bottom, left: safe.left } }),
      ...(avoid.length && { avoid }),
      separation: Math.round(separationOf(used) * 100) / 100,
      // The narrowest display width at which the label is still `min` px tall (18, or 20 for minimal).
      minDisplayWidth: Math.ceil((min * W) / label.height),
      // How tall the label looks where the image is shown: on a phone unless --display-width.
      displayWidth: shownAt,
      displayHeight: Math.round((label.height * Math.min(shownAt, W) * 10) / W) / 10,
      // The same height in whole CSS px, for render --format html --height over the shown image.
      cssHeight: Math.ceil(Math.round((label.height * Math.min(shownAt, W) * 10) / W) / 10),
    },
    ...(label.height * Math.min(shownAt, W) < min * W && {
      warning: smallWarning({ asked: opts.height == null ? null : Number(opts.height), height: label.height, where, shownAt, min, icon, region }),
    }),
    alt: label.alt,
    ...(label.alt == null && { altMissing: ALT_MISSING }),
    disclosure: label.disclosure,
    contrast: label.contrast,
    wcag: label.wcag,
  };
  return { result, label, spot, meta, existingXmp, design: designOf(label.height) };
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
