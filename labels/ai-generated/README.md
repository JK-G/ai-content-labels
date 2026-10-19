# AI labels

Ready-made labels for content made or changed with AI, built on the official EU "AI" icon. Download them and place them on your image, page or video yourself. No agent and no install needed.

![The labels in English and Polish, light and dark: the EU "AI" icon alone, the icon with an image icon, "Generated", "Modified", the full wording, and versions with a content-type icon](preview.png)

**Download:** every file in one ZIP, `ai-generated-labels.zip`, from the [latest release](https://github.com/JK-G/ai-content-labels/releases/latest), or pick single files from the folders below.

## When you need one

Under Article 50(4) of the EU AI Act, which applies from 2 August 2026, a label is a legal duty for a professional user (the deployer) in two cases:

- **Deep fakes.** AI-generated or AI-modified images, video or audio that people would take for a real person, object, place or event.
- **AI text on a matter of public interest**, published to inform the public, unless a person reviewed it and someone holds editorial responsibility for it.

Everywhere else the label is optional: a stylised illustration, pixel art, an obviously impossible scene. Use the pack where the label is required, or where you choose to label. When you are not sure which case you are in, run the check first: `ai-labels decide --media image --origin generated` asks the one question that decides it. If nobody can answer it, label as a precaution. This is a checklist, not legal advice.

## What is in the pack

Two languages, `en/` and `pl/`, each in `light/` and `dark/`.

| File | What it shows |
|---|---|
| `ai-icon` | The EU "AI" icon alone, the smallest label |
| `ai-mark-<type>` | The icon and one content-type icon, no words |
| `ai-generated`, `ai-modified` | "Generated with AI", "Modified with AI" |
| `ai-generated-short`, `ai-modified-short` | One word: "Generated", "Modified" |
| `ai-basic` | "Made with AI", for content AI was involved in |
| `ai-<kind>-<type>` | The wording and one content-type icon: `image`, `text`, `audio`, `voice`, `music`, `video` |

Every label comes as `.svg` (scales to any size), `-48.png` (web) and `-128.png` (print and social media), on a transparent background.

Without words, "generated" and "modified" look the same, so `ai-icon` and `ai-mark-<type>` come once. Their SVGs say "Made with AI" to screen readers; the alt text of your content says which it was.

## Placing it

- **Pick a theme.** A light label stands out on dark or busy images, a dark one on light images. Either keeps its text at 4.5:1 contrast or better on any background.
- **Find a clear spot.** Put it where nothing covers it, for example the bottom-right corner, and where people see it the first time they see the content.
- **Size.** Keep the icon and labels with words at least 18 px tall where people see them, 20 px for `ai-mark-<type>`.
- **Alt text.** Text inside an image is invisible to screen readers. Add the sentence after a description of the image: "Modern house among pine trees. Generated with AI: image."
- **Stamp instead.** To burn a label into a photo instead of placing it by hand: `ai-labels stamp photo.jpg --kind generated --media image --description "what it shows"`.

Using the EU icon does not mean you signed the Code of Practice. For work made without generative AI, use the "Made by a human" pack in [`labels/human-made`](../human-made) instead.

## Credits

The "AI" icon is the European Commission's [EU icon for labelling AI-generated content](https://digital-strategy.ec.europa.eu/en/policies/eu-icons-labelling-ai-generated-content), free to use without attribution. The content-type icons are Lucide (ISC licence; the music and text icons derive from Feather, MIT licence), and the text is Inter (SIL Open Font License 1.1), drawn as outlines. Full notices: [NOTICE.md](../../NOTICE.md).
