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
    // Examples used in decide's advice.
    spoken: 'This recording contains a voice generated with AI',
    describe: 'Modern house among pine trees, architectural visualisation.',
  },
  pl: {
    generated: { label: 'Wygenerowane przez AI', short: 'Wygenerowane', says: 'Wygenerowane przez AI' },
    modified: { label: 'Zmodyfikowane przez AI', short: 'Zmodyfikowane', says: 'Zmodyfikowane przez AI' },
    basic: { label: 'Z udziałem AI', short: 'Z udziałem AI', says: 'Powstało z udziałem AI' },
    human: { label: 'Stworzone przez człowieka', short: 'Stworzone przez człowieka', says: 'Stworzone przez człowieka' },
    media: { image: 'obraz', text: 'tekst', audio: 'dźwięk', voice: 'głos', music: 'muzyka', video: 'wideo' },
    and: 'i',
    spoken: 'To nagranie zawiera głos wygenerowany przez AI',
    describe: 'Nowoczesny dom wśród sosen, wizualizacja architektoniczna.',
  },
};

export const KINDS = ['generated', 'modified', 'basic', 'human'];
export const MEDIA = ['image', 'text', 'audio', 'voice', 'music', 'video'];

// The 24 official EU languages. Labels work in all of them; only those in LANGS have built-in
// wording, the others need the label text in that language (--text).
export const EU_LANGS = ['bg', 'cs', 'da', 'de', 'el', 'en', 'es', 'et', 'fi', 'fr', 'ga', 'hr', 'hu', 'it', 'lt', 'lv', 'mt', 'nl', 'pl', 'pt', 'ro', 'sk', 'sl', 'sv'];

export const hasWording = (lang) => Boolean(LANGS[lang]);

// The built-in wording of a language, or undefined for an EU language without one.
export function strings(lang) {
  if (!EU_LANGS.includes(lang)) throw new UsageError(`unknown language "${lang}"; use one of the 24 EU codes: ${EU_LANGS.join(', ')}`);
  return LANGS[lang];
}

export function list(items, lang) {
  if (items.length < 2) return items.join('');
  return `${items.slice(0, -1).join(', ')} ${strings(lang).and} ${items.at(-1)}`;
}

// "Generated with AI: image and voice." The sentence used for alt text and aria-label.
// In a language without built-in wording the sentence is the custom text alone: the user names the
// part in their own words ("Stimme mit KI generiert"), and the content-type icons stay decorative.
export function sentence({ kind, media = [], text, lang }) {
  const s = strings(lang);
  if (!s && text == null) throw new UsageError(noWording(lang, kind === 'human' ? '--human-text' : '--text'));
  // A custom text may end in its own full stop ("Made with AI."); drop it so the sentence ends in one.
  const head = String(text ?? s[kind].says).replace(/[\s.!?…]+$/, '');
  if (!s) return `${head}.`;
  const names = media.map((m) => s.media[m]);
  return names.length ? `${head}: ${list(names, lang)}.` : `${head}.`;
}

// Yes/no options as they arrive from the CLI (strings) or MCP (booleans, sometimes strings).
// Absent stays undefined, so callers can tell "no" from "not answered".
export function parseBoolean(value, name) {
  if (value == null) return undefined;
  if (value === true || value === 1 || /^(true|yes|1)$/i.test(String(value))) return true;
  if (value === false || value === 0 || /^(false|no|0)$/i.test(String(value))) return false;
  throw new UsageError(`${name} takes true or false, not "${value}"`);
}

export const noWording = (lang, flag = '--text') =>
  `no built-in wording for "${lang}"; pass ${flag} in that language (plain words, e.g. ${flag} "Mit KI generiert")`;

export class UsageError extends Error {}
