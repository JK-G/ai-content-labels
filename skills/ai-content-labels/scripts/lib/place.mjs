import { UsageError } from './i18n.mjs';

// Where a stamped label goes. With position auto (the default) it takes the least invasive spot at
// the edge of the image, or of the AI part of it (region): the bottom-right corner when it is free,
// else the freer of bottom centre and bottom left, else the top edge. "Busy" is the mean brightness
// gradient under and around the label on a small copy of the image: flat background is near 0,
// text, logos and fine detail are high.

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

// The least invasive spot for a w×h label in `area`. Each spot is judged with a ring of half the
// margin around the label, so a label is not pressed against text either.
export function chooseSpot(map, area, w, h, margin) {
  const pad = Math.round(margin / 2);
  const spots = TIERS.flatMap((names, tier) =>
    names.map((position) => {
      const { left, top } = spotAt(position, area, w, h, margin);
      return { position, left, top, tier, busy: busyness(map, { left: left - pad, top: top - pad, width: w + 2 * pad, height: h + 2 * pad }) };
    })
  );
  const free = spots.filter((s) => s.busy <= FREE);
  let pick;
  let reason;
  if (free.length) {
    pick = free.reduce((a, b) => (b.tier < a.tier || (b.tier === a.tier && b.busy < a.busy) ? b : a));
    reason = pick.tier === 0 ? 'bottom-right is free' : `bottom-right is busy (text, a logo or detail); ${pick.position} is ${pick.tier === 1 ? 'free' : 'the first free spot'}`;
  } else {
    // Nothing is free: the least busy spot, with a small handicap for the less preferred tiers.
    pick = spots.reduce((a, b) => (b.busy * (1 + 0.25 * b.tier) < a.busy * (1 + 0.25 * a.tier) ? b : a));
    reason = `no spot is free; ${pick.position} is the least busy`;
  }
  return { position: pick.position, left: pick.left, top: pick.top, reason, spots: Object.fromEntries(spots.map((s) => [s.position, round1(s.busy)])) };
}

// The part of the image the label belongs to: "x,y,w,h" in px or with % of the image size
// ("55%,40%,45%,60%"), or { left, top, width, height }. Clipped to the image.
export function parseRegion(value, W, H) {
  if (value == null || value === '') return null;
  const parts = typeof value === 'object' && !Array.isArray(value) ? [value.left, value.top, value.width, value.height] : Array.isArray(value) ? value : String(value).split(',');
  const bad = () => new UsageError(`--region is the box of the AI part as x,y,width,height in px or %, e.g. 540,380,500,620 or 50%,35%,46%,57%; not "${typeof value === 'object' ? JSON.stringify(value) : value}"`);
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
  if (box.width <= 0 || box.height <= 0) throw new UsageError(`--region ${value} lies outside the ${W}×${H} image`);
  return box;
}
