import { UsageError } from './i18n.mjs';

// Where a stamped label goes. With position auto (the default) it takes the least invasive spot at
// the edge of the image, or of the AI part of it (region): the bottom-right corner when it is free,
// else the freer of bottom centre and bottom left, else the top edge. "Busy" is the mean brightness
// gradient under and around the label on a small copy of the image: flat background is near 0,
// text, logos and fine detail are high. It sees texture only: a face or a clean product surface can
// score as free, so the caller passes those as avoid boxes.

export const POSITIONS = ['auto', 'bottom-right', 'bottom-center', 'bottom-left', 'top-right', 'top-center', 'top-left'];

// The spots auto tries, in order of preference; within a tier the least busy free one wins.
export const TIERS = [['bottom-right'], ['bottom-center', 'bottom-left'], ['top-right', 'top-left', 'top-center']];

// Mean gradient (0-255 scale) up to which a spot counts as free: flat or softly shaded background.
export const FREE = 6;

// The long side of the copy the gradient is measured on.
export const MAP_SIZE = 320;

// The box of the label at a named spot inside `area`, `margin` px from its edges.
export function spotAt(position, area, w, h, margin) {
  const left = position.endsWith('left') ? area.left + margin : position.endsWith('right') ? area.left + area.width - margin - w : area.left + Math.round((area.width - w) / 2);
  const top = position.startsWith('top') ? area.top + margin : area.top + area.height - margin - h;
  return { left, top };
}

// The brightness gradient of an RGB image (`channels` per pixel) as a summed-area table, so the mean
// over any box costs four lookups.
export function busyMap(data, width, height, channels, scale = 1) {
  const lum = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const p = i * channels;
    lum[i] = 0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2];
  }
  const at = (x, y) => lum[Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))];
  const sum = new Float64Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      row += (Math.abs(at(x + 1, y) - at(x - 1, y)) + Math.abs(at(x, y + 1) - at(x, y - 1))) / 2;
      sum[(y + 1) * (width + 1) + x + 1] = sum[y * (width + 1) + x + 1] + row;
    }
  }
  return { sum, width, height, scale };
}

// Mean gradient over a box given in the full image's pixels.
export function busyness(map, { left, top, width, height }) {
  const W = map.width + 1;
  const x0 = Math.max(0, Math.min(map.width, Math.floor(left * map.scale)));
  const y0 = Math.max(0, Math.min(map.height, Math.floor(top * map.scale)));
  const x1 = Math.max(x0 + 1, Math.min(map.width, Math.ceil((left + width) * map.scale)));
  const y1 = Math.max(y0 + 1, Math.min(map.height, Math.ceil((top + height) * map.scale)));
  const s = map.sum;
  return (s[y1 * W + x1] - s[y0 * W + x1] - s[y1 * W + x0] + s[y0 * W + x0]) / ((x1 - x0) * (y1 - y0));
}

const round1 = (v) => Math.round(v * 10) / 10;

// The box of the label plus `margin` px on every side: what must stay inside the shape and clear of
// the avoid boxes.
const withMargin = (left, top, w, h, margin) => ({ left: left - margin, top: top - margin, width: w + 2 * margin, height: h + 2 * margin });

// The label's spot at a named position. Without a shape it is spotAt. With one (a mask), it starts
// there and moves inward in small steps (bottom spots up, top spots down, the side corners also
// towards the middle) until the label and its margin lie inside the shape: lowest first for bottom
// spots, then as far to the side as it fits. null when it does not fit before the middle of the area.
export function placeSpot(position, area, w, h, margin, mask = null) {
  const start = spotAt(position, area, w, h, margin);
  if (!mask) return start;
  const dy = position.startsWith('top') ? 1 : -1;
  const dx = position.endsWith('left') ? 1 : position.endsWith('right') ? -1 : 0;
  const step = Math.max(1, Math.round(margin / 4));
  const cx = area.left + area.width / 2;
  const cy = area.top + area.height / 2;
  for (let top = start.top; dy > 0 ? top + h / 2 <= cy : top + h / 2 >= cy; top += dy * step) {
    let left = start.left;
    do {
      if (maskCovers(mask, withMargin(left, top, w, h, margin))) return { left, top };
      left += dx * step;
    } while (dx && (dx > 0 ? left + w / 2 <= cx : left + w / 2 >= cx));
  }
  return null;
}

// The 1-based number of the first avoid box that the label and its margin overlap, or 0.
export function avoidHit(avoid, box) {
  const i = avoid.findIndex((a) => box.left < a.left + a.width && a.left < box.left + box.width && box.top < a.top + a.height && a.top < box.top + box.height);
  return i + 1;
}

// Why a spot does not fit a shape: the shape itself, or the part of it the safe zone leaves.
export function shapeWhy(position, w, h, margin, mask, untrimmed) {
  const safeZone = untrimmed && placeSpot(position, untrimmed, w, h, margin, mask);
  return safeZone ? 'does not fit inside the shape within the safe zone' : 'does not fit inside the shape';
}

const busyWhy = (busy) => `busy (score ${round1(busy)}, free is ${FREE} or less)`;

// The least invasive spot for a w×h label in `area`. Each spot is judged with a ring of half the
// margin around the label, so a label is not pressed against text either. A spot that does not fit
// inside the shape (mask) or overlaps an avoid box is rejected; `why` says why each spot that was
// not taken lost. When every spot is rejected, a UsageError lists the reasons. `untrimmed` is the
// area before a safe zone trimmed it, so a reason can say when the safe zone is what leaves no room.
export function chooseSpot(map, area, w, h, margin, { mask = null, avoid = [], untrimmed = null } = {}) {
  const pad = Math.round(margin / 2);
  const spots = TIERS.flatMap((names, tier) =>
    names.map((position) => {
      const at = placeSpot(position, area, w, h, margin, mask);
      if (!at) return { position, tier, why: shapeWhy(position, w, h, margin, mask, untrimmed) };
      const { left, top } = at;
      const busy = busyness(map, { left: left - pad, top: top - pad, width: w + 2 * pad, height: h + 2 * pad });
      const hit = avoidHit(avoid, withMargin(left, top, w, h, margin));
      return { position, left, top, tier, busy, ...(hit && { why: `overlaps avoid box ${hit}` }) };
    })
  );
  const open = spots.filter((s) => !s.why);
  if (!open.length) {
    throw new UsageError(
      `no spot is left for the label: ${spots.map((s) => `${s.position} ${s.why}`).join('; ')}. ` +
        'Use --minimal for a smaller label, make the avoid boxes smaller, or pick a spot with --position'
    );
  }
  const free = open.filter((s) => s.busy <= FREE);
  const first = spots[0];
  let pick;
  let reason;
  if (free.length) {
    pick = free.reduce((a, b) => (b.tier < a.tier || (b.tier === a.tier && b.busy < a.busy) ? b : a));
    const corner = first.why ? `bottom-right ${first.why}` : 'bottom-right is busy (text, a logo or detail)';
    reason = pick.tier === 0 ? 'bottom-right is free' : `${corner}; ${pick.position} is ${pick.tier === 1 ? 'free' : 'the first free spot'}`;
  } else {
    // Nothing is free: the least busy spot, with a small handicap for the less preferred tiers.
    pick = open.reduce((a, b) => (b.busy * (1 + 0.25 * b.tier) < a.busy * (1 + 0.25 * a.tier) ? b : a));
    reason = `no spot is free; ${pick.position} is the least busy`;
  }
  const lost = (s) =>
    s.why ?? (s.busy > FREE ? busyWhy(s.busy) : s.tier > pick.tier || round1(s.busy) <= round1(pick.busy) ? `free, but ${pick.position} comes first` : `free, but ${pick.position} is less busy`);
  return {
    position: pick.position,
    left: pick.left,
    top: pick.top,
    reason,
    // Scores only for spots the label could take: a spot outside the shape has no box to score.
    spots: Object.fromEntries(spots.filter((s) => s.busy != null).map((s) => [s.position, round1(s.busy)])),
    why: Object.fromEntries(spots.filter((s) => s !== pick).map((s) => [s.position, lost(s)])),
  };
}

// A box as "x,y,w,h" in px or with % of the image size ("55%,40%,45%,60%"), or
// { left, top, width, height }, clipped to the image. `name` and `example` go into the errors.
function parseBox(value, W, H, { name, what }) {
  const parts = typeof value === 'object' && !Array.isArray(value) ? [value.left, value.top, value.width, value.height] : Array.isArray(value) ? value : String(value).split(',');
  const bad = () => new UsageError(`${name} is ${what} as x,y,width,height in px or %, e.g. 540,380,500,620 or 50%,35%,46%,57%; not "${typeof value === 'object' ? JSON.stringify(value) : value}"`);
  if (parts.length !== 4) throw bad();
  const [x, y, w, h] = parts.map((p, i) => {
    const s = String(p ?? '').trim();
    const pct = s.endsWith('%');
    const n = Number(pct ? s.slice(0, -1) : s);
    if (s === '' || !Number.isFinite(n) || n < 0) throw bad();
    return Math.round(pct ? (n / 100) * (i % 2 ? H : W) : n);
  });
  const left = Math.min(x, W);
  const top = Math.min(y, H);
  const box = { left, top, width: Math.min(x + w, W) - left, height: Math.min(y + h, H) - top };
  if (box.width <= 0 || box.height <= 0) throw new UsageError(`${name} ${typeof value === 'object' ? JSON.stringify(value) : value} lies outside the ${W}×${H} image`);
  return box;
}

// The part of the image the label belongs to: "x,y,w,h" in px or with % of the image size
// ("55%,40%,45%,60%"), or { left, top, width, height }. Clipped to the image.
export function parseRegion(value, W, H) {
  if (value == null || value === '') return null;
  return parseBox(value, W, H, { name: '--region', what: 'the box of the AI part' });
}

// Boxes the label must not touch (faces, people, the product, text): one box, a list of them, or
// several in one string separated by ";". Each as for --region.
export function parseAvoid(value, W, H) {
  if (value == null || value === '') return [];
  const given = Array.isArray(value) && !(value.length === 4 && value.every((v) => typeof v === 'number')) ? value : [value];
  // A string may hold several boxes separated by ";", in a CLI value or an MCP array element alike.
  const list = given.flatMap((v) => (typeof v === 'string' ? v.split(';') : [v]));
  return list.filter((v) => v != null && String(v).trim() !== '').map((v) => parseBox(typeof v === 'string' ? v.trim() : v, W, H, { name: '--avoid', what: 'a box the label must not cover' }));
}

// Platform safe zones: the share of the image that the platform's own buttons, captions and
// progress bars may cover, as insets from each edge. Only presets with a published, checked source;
// any other platform takes its numbers as --safe-zone top,right,bottom,left from its own template.
export const SAFE_ZONES = {
  // Meta Ads Guide, Instagram Reels (video and image ad specs): "Consider leaving at least 14% of
  // the top, 35% of the bottom, and 6% on each side of your asset free from text".
  'meta-reels': {
    top: '14%',
    right: '6%',
    bottom: '35%',
    left: '6%',
    source: 'https://www.facebook.com/business/ads-guide/update/video/instagram-reels',
    checked: '2026-10-18',
  },
};

// --safe-zone: a preset name or the insets "top,right,bottom,left" in px or % of the image (like CSS
// margin). Returns { name, top, right, bottom, left } in px, and the box that is left.
export function parseSafeZone(value, W, H) {
  if (value == null || value === '') return null;
  const s = String(value).trim().toLowerCase();
  const preset = SAFE_ZONES[s];
  const parts = preset ? [preset.top, preset.right, preset.bottom, preset.left] : s.split(',');
  const bad = () =>
    new UsageError(
      `--safe-zone is a preset (${Object.keys(SAFE_ZONES).join(', ')}) or the insets top,right,bottom,left in px or % of the image, e.g. 14%,6%,35%,6%; not "${value}"`
    );
  if (parts.length !== 4) throw bad();
  const [top, right, bottom, left] = parts.map((p, i) => {
    const t = String(p).trim();
    const pct = t.endsWith('%');
    const n = Number(pct ? t.slice(0, -1) : t);
    if (t === '' || !Number.isFinite(n) || n < 0) throw bad();
    return Math.round(pct ? (n / 100) * (i % 2 ? W : H) : n);
  });
  const box = { left, top, width: W - left - right, height: H - top - bottom };
  if (box.width <= 0 || box.height <= 0) throw new UsageError(`--safe-zone ${value} leaves nothing of the ${W}×${H} image`);
  return { name: preset ? s : null, top, right, bottom, left, box };
}

// A shape as a mask: `values` holds one byte per pixel of a width×height copy of the W×H image;
// 128 or more (50%) is inside. Each axis has its own scale, because rounding the copy's size makes
// them differ. Kept as a summed-area table, so whether a box lies fully inside costs four lookups.
// null when nothing is inside.
export function maskFrom(values, width, height, W, H) {
  const [sx, sy] = [width / W, height / H];
  const W1 = width + 1;
  const sum = new Uint32Array(W1 * (height + 1));
  let [x0, y0, x1, y1] = [width, height, -1, -1];
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      if (values[y * width + x] >= 128) {
        row++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        y1 = y;
      }
      sum[(y + 1) * W1 + x + 1] = sum[y * W1 + x + 1] + row;
    }
  }
  if (x1 < 0) return null;
  const left = Math.floor(x0 / sx + 1e-9);
  const top = Math.floor(y0 / sy + 1e-9);
  const box = { left, top, width: Math.min(W, Math.ceil((x1 + 1) / sx - 1e-9)) - left, height: Math.min(H, Math.ceil((y1 + 1) / sy - 1e-9)) - top };
  return { sum, width, height, sx, sy, box };
}

// True when the box (in the image's pixels) lies fully inside the mask.
export function maskCovers(mask, { left, top, width, height }) {
  // The epsilon keeps a box that ends on the image's edge from rounding one pixel past the mask.
  const x0 = Math.floor(left * mask.sx + 1e-9);
  const y0 = Math.floor(top * mask.sy + 1e-9);
  const x1 = Math.ceil((left + width) * mask.sx - 1e-9);
  const y1 = Math.ceil((top + height) * mask.sy - 1e-9);
  if (x0 < 0 || y0 < 0 || x1 > mask.width || y1 > mask.height || x1 <= x0 || y1 <= y0) return false;
  const W1 = mask.width + 1;
  const s = mask.sum;
  return s[y1 * W1 + x1] - s[y0 * W1 + x1] - s[y1 * W1 + x0] + s[y0 * W1 + x0] === (x1 - x0) * (y1 - y0);
}

// True when the image pixel (x, y) is inside the mask.
export const maskHas = (mask, x, y) => {
  const mx = Math.min(mask.width - 1, Math.floor(x * mask.sx));
  const my = Math.min(mask.height - 1, Math.floor(y * mask.sy));
  const s = mask.sum;
  const W1 = mask.width + 1;
  return s[(my + 1) * W1 + mx + 1] - s[my * W1 + mx + 1] - s[(my + 1) * W1 + mx] + s[my * W1 + mx] === 1;
};

// An SVG path for --region-path: only path commands, numbers and separators, so nothing else can
// reach the SVG renderer.
export function checkPath(d) {
  const s = String(d ?? '').trim();
  if (!s || !/^[MmLlHhVvCcSsQqTtAaZz0-9eE.,+\-\s]+$/.test(s) || !/^[Mm]/.test(s)) {
    throw new UsageError(`--region-path is the outline of the AI part as SVG path data in image px, e.g. "M100 80 H700 V600 L400 900 L100 600 Z"; not "${d}"`);
  }
  return s;
}
