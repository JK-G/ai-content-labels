// Label wording per language. `label` is the visible text, `short` the compact form that mirrors
// the EU icons ("AI" + "Generated"), `says` the sentence for alt text and screen readers.
// The EU guidance asks for plain language and no abbreviations other than "AI". A new language
// needs all keys below; please open an issue or a pull request.

export const LANGS = {
  en: {
    generated: { label: 'Generated with AI', short: 'Generated', says: 'Generated with AI' },
    modified: { label: 'Modified with AI', short: 'Modified', says: 'Modified with AI' },
    basic: { label: 'Made with AI', short: 'Made with AI', says: 'Made with AI' },
    human: { label: 'Made by a human', short: 'Human-made', says: 'Made by a human' },
    media: { image: 'image', text: 'text', audio: 'audio', voice: 'voice', music: 'music', video: 'video' },
    and: 'and',
  },
  pl: {
    generated: { label: 'Wygenerowane przez AI', short: 'Wygenerowane', says: 'Wygenerowane przez AI' },
    modified: { label: 'Zmodyfikowane przez AI', short: 'Zmodyfikowane', says: 'Zmodyfikowane przez AI' },
    basic: { label: 'Z udziałem AI', short: 'Z udziałem AI', says: 'Powstało z udziałem AI' },
    human: { label: 'Stworzone przez człowieka', short: 'Stworzone przez człowieka', says: 'Stworzone przez człowieka' },
    media: { image: 'obraz', text: 'tekst', audio: 'dźwięk', voice: 'głos', music: 'muzyka', video: 'wideo' },
    and: 'i',
  },
};

export const KINDS = ['generated', 'modified', 'basic', 'human'];
export const MEDIA = ['image', 'text', 'audio', 'voice', 'music', 'video'];

export function strings(lang) {
  const s = LANGS[lang];
  if (!s) throw new UsageError(`unknown language "${lang}"; available: ${Object.keys(LANGS).join(', ')}`);
  return s;
}

export function list(items, lang) {
  if (items.length < 2) return items.join('');
  return `${items.slice(0, -1).join(', ')} ${strings(lang).and} ${items.at(-1)}`;
}

// "Generated with AI: image and voice." The sentence used for alt text and aria-label.
export function sentence({ kind, media = [], text, lang }) {
  const s = strings(lang);
  const head = text ?? s[kind].says;
  const names = media.map((m) => s.media[m]);
  return names.length ? `${head}: ${list(names, lang)}.` : `${head}.`;
}

export class UsageError extends Error {}
