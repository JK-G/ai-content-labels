// WCAG 2.2 contrast, with a label background that may be partly transparent. The label can sit on
// any image, so the check uses the worst backdrop: pure black under a light label, pure white under
// a dark one. A label that passes here passes on every image.

export function parseHex(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}

export function luminance([r, g, b]) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Colour of `fg` drawn with `alpha` over `backdrop`.
export const over = (fg, alpha, backdrop) => fg.map((c, i) => c * alpha + backdrop[i] * (1 - alpha));

// Lowest contrast between the label's ink and its background over a black or white backdrop.
export function worstCaseContrast({ ink, background, backgroundOpacity }) {
  const fg = parseHex(ink);
  const bg = parseHex(background);
  return Math.min(
    contrastRatio(fg, over(bg, backgroundOpacity, [0, 0, 0])),
    contrastRatio(fg, over(bg, backgroundOpacity, [255, 255, 255]))
  );
}

export const WCAG = { text: 4.5, graphics: 3 };
