import { writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, extname, join, basename } from 'node:path';
import { renderLabel, officialIcon, normalize, labelSentence } from './render.mjs';
import { stampImage, loadSharp } from './stamp.mjs';
import { decide } from './decide.mjs';
import { UsageError } from './i18n.mjs';
import { ASSETS_DIR, mediaIcons } from './assets.mjs';

// The operations behind both the CLI and the MCP server.

export async function render(opts) {
  const label = renderLabel(opts);
  const result = { width: label.width, height: label.height, alt: label.alt, contrast: label.contrast };
  if (opts.out) {
    await writeImage(label.svg, opts.out, Number(opts.scale ?? 1));
    result.out = opts.out;
  } else {
    result.svg = label.svg;
  }
  return result;
}

export async function stamp(input, opts) {
  if (!input) throw new UsageError('stamp needs an input image');
  if (!existsSync(input)) throw new UsageError(`input not found: ${input}`);
  const ext = extname(input);
  const output = opts.out ?? join(dirname(input), `${basename(input, ext)}.ai-label${ext}`);
  mkdirSync(dirname(output), { recursive: true });
  return stampImage(input, output, opts);
}

export function decideLabel(opts) {
  return decide(opts);
}

export function alt(opts) {
  return { alt: labelSentence(normalize(opts)) };
}

export async function eu(name, opts = {}) {
  const icon = officialIcon(name ?? 'generated', opts.variant ?? 'black');
  if (!opts.out) return { file: icon.file, svg: icon.svg };
  if (extname(opts.out).toLowerCase() === '.svg') {
    mkdirSync(dirname(opts.out), { recursive: true });
    copyFileSync(icon.file, opts.out);
  } else {
    await writeImage(icon.svg, opts.out, Number(opts.scale ?? 1), Number(opts.height ?? 0));
  }
  return { file: icon.file, out: opts.out };
}

export function icons(opts = {}) {
  const media = Object.keys(mediaIcons().icons);
  if (opts.out) {
    mkdirSync(opts.out, { recursive: true });
    for (const n of media) copyFileSync(join(ASSETS_DIR, 'icons', 'media', `${n}.svg`), join(opts.out, `${n}.svg`));
  }
  return { media, ...(opts.out && { out: opts.out }) };
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
  mkdirSync(dirname(out), { recursive: true });
  const ext = extname(out).toLowerCase();
  if (ext === '.svg') {
    writeFileSync(out, svg + '\n');
    return;
  }
  const sharp = await loadSharp();
  let img = sharp(Buffer.from(svg), { density: 72 * scale });
  if (height) img = img.resize({ height });
  if (ext === '.png') await img.png().toFile(out);
  else if (ext === '.webp') await img.webp({ lossless: true }).toFile(out);
  else throw new UsageError(`unsupported label format "${ext}"; use .svg, .png or .webp`);
}

