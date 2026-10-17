import { writeFileSync, mkdirSync, copyFileSync, existsSync, statSync } from 'node:fs';
import { dirname, extname, join, basename, resolve } from 'node:path';
import { renderLabel, officialIcon, normalize, labelSentence, composeAlt, altMissing } from './render.mjs';
import { renderHtml, LABEL_CSS } from './html.mjs';
import { stampImage, loadSharp, formatFor } from './stamp.mjs';
import { decide } from './decide.mjs';
import { UsageError, sentence, parseBoolean } from './i18n.mjs';
import { ASSETS_DIR, mediaIcons } from './assets.mjs';

// The operations behind both the CLI and the MCP server.

const FORMATS = ['svg', 'html'];

function scaleOf(opts) {
  const scale = Number(opts.scale ?? 1);
  if (!(scale >= 0.5 && scale <= 16)) throw new UsageError(`--scale must be between 0.5 and 16, not "${opts.scale}"`);
  return scale;
}

export async function render(opts = {}) {
  const format = opts.format ?? 'svg';
  if (!FORMATS.includes(format)) throw new UsageError(`unknown format "${format}"; use svg or html`);
  if (format === 'html') return renderHtmlLabel(opts);
  if (parseBoolean(opts.css, '--css')) throw new UsageError('--css goes with --format html');
  const scale = scaleOf(opts);
  // A PNG or WebP knows its pixel density; an SVG is hinted for 1x.
  const raster = opts.out && ['.png', '.webp'].includes(extname(opts.out).toLowerCase());
  const label = renderLabel({ ...opts, density: raster ? scale : 1 });
  // alt is for the content the label describes (null without a description); labelAlt is the alt of
  // an <img> that shows this label on its own.
  const result = {
    width: label.width,
    height: label.height,
    alt: label.alt,
    ...altMissing(label.options, label.alt),
    labelAlt: label.disclosure,
    disclosure: label.disclosure,
    contrast: label.contrast,
    wcag: label.wcag,
  };
  if (opts.out) {
    const out = resolve(opts.out);
    await writeImage(label.svg, out, scale);
    result.out = out;
    if (extname(out).toLowerCase() !== '.svg') result.pixels = { width: Math.round(label.width * scale), height: Math.round(label.height * scale) };
  } else {
    result.svg = label.svg;
  }
  return result;
}

// --format html: real text for web pages. --css alone prints the stylesheet the snippet needs.
async function renderHtmlLabel(opts) {
  if (opts.scale != null) throw new UsageError('--scale applies to PNG and WebP, not to --format html');
  if (parseBoolean(opts.css, '--css')) return { css: LABEL_CSS };
  const label = renderHtml(opts);
  const { html, css, ...rest } = label;
  const result = { html, css, ...rest };
  if (opts.out) {
    const out = resolve(opts.out);
    const ext = extname(out).toLowerCase();
    if (ext !== '.html' && ext !== '.htm') throw new UsageError(`--format html writes an .html file, not "${ext || '(none)'}"; use .svg, .png or .webp without --format html`);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `<style>\n${label.css}</style>\n${label.html}\n`);
    result.out = out;
  }
  return result;
}

// Outputs being written right now, so two parallel calls cannot both pass the "exists" check.
const inFlight = new Set();

export async function stamp(input, opts = {}) {
  if (!input) throw new UsageError('stamp needs an input image');
  // The label is a public claim burned into the file: never default it. render keeps a default kind,
  // because it writes nothing into the user's content.
  if (opts.kind == null) {
    throw new UsageError(
      'stamp needs --kind generated, modified, basic or human. Not sure which? Run: ai-labels decide --media image --origin generated|modified|assisted|human'
    );
  }
  // Label options first: a contradictory label is the user's first problem, not an existing output.
  normalize({ ...opts, height: opts.height ?? 32 });
  const source = resolve(input);
  if (!existsSync(source)) throw new UsageError(`input not found: ${input}`);
  if (statSync(source).isDirectory()) {
    throw new UsageError('input is a folder; stamp takes one file. List the images (jpg, png, webp, avif, tiff) and run it once per file; batch mode is planned');
  }
  const force = parseBoolean(opts.force, '--force') ?? false;
  const ext = extname(source);
  const output = resolve(opts.out ?? join(dirname(source), `${basename(source, ext)}.ai-label${ext}`));
  const same = process.platform === 'win32' ? output.toLowerCase() === source.toLowerCase() : output === source;
  if (same) throw new UsageError('--out must differ from the input');
  formatFor(output);
  if (/\.ai-label\.[^.]+$/i.test(basename(source)) && !force) {
    throw new UsageError(`already labelled by name (${basename(source)}); stamp the original instead, or pass --force`);
  }
  const key = process.platform === 'win32' ? output.toLowerCase() : output;
  if (inFlight.has(key)) throw new UsageError(`${output} is being written by another call`);
  if (existsSync(output) && !force) throw new UsageError(`${output} exists; pass --force to overwrite`);
  inFlight.add(key);
  try {
    mkdirSync(dirname(output), { recursive: true });
    return await stampImage(source, output, { ...opts, force });
  } finally {
    inFlight.delete(key);
  }
}

export function decideLabel(opts) {
  return decide(opts);
}

export function alt(opts) {
  const o = normalize(opts);
  const text = composeAlt(o);
  return { alt: text, ...altMissing(o, text), disclosure: labelSentence(o) };
}

export async function eu(name, opts = {}) {
  const kind = name ?? 'generated';
  const icon = officialIcon(kind, opts.variant ?? 'black');
  // The official icons are in English; their alt text is the matching sentence.
  const alt = sentence({ kind, lang: 'en' });
  if (!opts.out) return { file: icon.file, svg: icon.svg, alt };
  const out = resolve(opts.out);
  const scale = scaleOf(opts);
  const height = Number(opts.height ?? 0);
  if (!Number.isInteger(height) || height < 0 || height > 4096) throw new UsageError('--height must be a whole number of px, up to 4096');
  const result = { file: icon.file, out, alt };
  if (extname(out).toLowerCase() === '.svg') {
    mkdirSync(dirname(out), { recursive: true });
    copyFileSync(icon.file, out);
  } else {
    const info = await writeImage(icon.svg, out, scale, height);
    result.pixels = { width: info.width, height: info.height };
  }
  return result;
}

export function icons(opts = {}) {
  const media = Object.keys(mediaIcons().icons);
  if (opts.out) {
    mkdirSync(opts.out, { recursive: true });
    for (const n of media) copyFileSync(join(ASSETS_DIR, 'icons', 'media', `${n}.svg`), join(opts.out, `${n}.svg`));
  }
  return { media, ...(opts.out && { out: resolve(opts.out) }) };
}

export async function doctor() {
  const checks = [];
  const node = Number(process.versions.node.split('.')[0]);
  checks.push({ check: 'node >= 20', ok: node >= 20, detail: process.versions.node });
  checks.push({ check: 'font and EU icon assets', ok: existsSync(join(ASSETS_DIR, 'font', 'inter-semibold.json')) && existsSync(join(ASSETS_DIR, 'eu', 'basic.json')) });
  try {
    const sharp = await loadSharp();
    checks.push({ check: 'sharp (stamp, PNG output)', ok: true, detail: sharp.versions?.sharp ?? 'loaded' });
  } catch (e) {
    checks.push({ check: 'sharp (stamp, PNG output)', ok: false, detail: e.message });
  }
  return { ok: checks.every((c) => c.ok), checks };
}

async function writeImage(svg, out, scale = 1, height = 0) {
  const ext = extname(out).toLowerCase();
  if (!['.svg', '.png', '.webp'].includes(ext)) throw new UsageError(`unsupported label format "${ext || '(none)'}"; use .svg, .png or .webp`);
  mkdirSync(dirname(out), { recursive: true });
  if (ext === '.svg') {
    writeFileSync(out, svg + '\n');
    return null;
  }
  const sharp = await loadSharp();
  let img = sharp(Buffer.from(svg), { density: 72 * scale });
  if (height) img = img.resize({ height });
  return ext === '.png' ? img.png().toFile(out) : img.webp({ lossless: true }).toFile(out);
}
