# ai-content-labels

[![tests](https://github.com/JK-G/ai-content-labels/actions/workflows/test.yml/badge.svg)](https://github.com/JK-G/ai-content-labels/actions/workflows/test.yml)

Labels for AI-generated and human-made content, built on the official EU icons. ai-content-labels tells you whether the EU AI Act requires a label, draws one that keeps WCAG contrast on any background, burns it into images and hands you the alt text. It ships as a CLI, an MCP server and a skill for Claude Code and other agents.

![Labels in a light and a dark theme: "Generated with AI" with an image icon, "Modified with AI" with image and voice icons, a custom "Voice generated with AI", an AI label next to a "Human-made" label, a Polish label and an upper-case label](docs/labels.png)

Unofficial. Not affiliated with the European Commission, and not legal advice.

## Why

Article 50(4) of the AI Act applies from 2 August 2026. Deep fakes, and AI-generated text published to inform the public on matters of public interest, must be disclosed. On 10 June 2026 the Commission published three icons for this, free for anyone to use. In the Commission's words, "the use of these EU icons is optional, but the labelling requirements under Article 50 AI Act are not."

The icons leave the practical questions open. Does this image need a label at all? Which of the three icons? Where does it go, how big, and what does a screen reader hear? How do you show that only the voice was AI and the script was written by a person? This project answers those questions in code, so a person or an agent gets the same answer every time.

## What it does

- **`decide`** goes through the Article 50(4) questions: does the content look real, is it an artistic work, is the text published on a matter of public interest, did a person review it. It returns whether the label is a duty or a voluntary choice, which label fits (and the official EU icon with the same meaning), where to place it, and the alt text.
- **`stamp`** burns the label into a JPG, PNG, WebP, AVIF or TIFF, so it survives downloads and reshares as the EU guidance asks. The label height follows the image (about 4.5% of the shorter side), its colour follows the corner it sits in, and an IPTC DigitalSourceType tag goes into the file's XMP.
- **`render`** draws the same label as SVG, PNG or WebP for web pages and apps, with `role="img"` and an `aria-label`.
- **Content-type icons** show which part was AI: image, text, audio, voice, music, video. A second label, "Made by a human", shows which part was not.
- **`eu`** gives you the twelve official EU files, unchanged.
- **Languages:** English and Polish wording is built in. Your own `--text` works in all 24 official EU languages.

## Install

As a Claude Code plugin (skill and MCP server):

```
/plugin marketplace add JK-G/ai-content-labels
/plugin install ai-content-labels@ai-content-labels
```

As a plain skill, without the plugin system:

```
git clone https://github.com/JK-G/ai-content-labels
cp -r ai-content-labels/skills/ai-content-labels ~/.claude/skills/
cd ~/.claude/skills/ai-content-labels && npm install sharp@0.35
```

On Windows PowerShell, use `Copy-Item -Recurse ai-content-labels\skills\ai-content-labels $HOME\.claude\skills\` for the copy. The last step adds sharp to the copied skill; you can skip it if you only need SVG labels and `decide`.

From a shell, without cloning:

```
npx -y github:JK-G/ai-content-labels stamp photo.jpg --media image
```

As an MCP server in Claude Desktop, Cursor or another client:

```json
{
  "mcpServers": {
    "ai-content-labels": {
      "command": "npx",
      "args": ["-y", "-p", "github:JK-G/ai-content-labels", "ai-content-labels-mcp"]
    }
  }
}
```

Requires Node.js 20.9 or newer. Drawing SVG labels and `decide` have no dependencies. Stamping and PNG output use [sharp](https://sharp.pixelplumbing.com), an optional dependency that npm installs with the package. The plugin system does not run npm, so after a plugin install ask Claude to "run ai-content-labels doctor" and it will tell you the one command to run.

## Quick start

In Claude Code, ask in your own words: "label this image as AI-generated", "does this AI photo need a label under the AI Act?", or in Polish "oznacz tę grafikę jako wygenerowaną przez AI". The skill works out the facts, runs `decide`, stamps or renders the label and gives you the alt text to publish.

From the command line (`ai-labels` below stands for `node skills/ai-content-labels/scripts/ai-labels.mjs`):

```
$ ai-labels decide --media image --origin generated --realistic
REQUIRED: Article 50(4), first subparagraph: a deep fake, meaning AI-generated or AI-manipulated content that resembles existing persons, objects, places, entities or events and would falsely appear authentic (Article 3(60)). ...
Label: --kind generated --media image (EU icon: generated)
Alt text: Generated with AI: image.

$ ai-labels stamp product-shot.jpg --kind generated --media image
product-shot.ai-label.jpg
label: 292×49 px, dark, top-left, contrast 12.55:1
alt: Generated with AI: image.
metadata: XMP DigitalSourceType trainedAlgorithmicMedia

$ ai-labels render --kind modified --media image,voice --human text --lang pl --out label.svg
```

`ai-labels help` lists every option.

## Which label

| Kind | Use it when | Default text (en / pl) |
|---|---|---|
| `generated` | All of the content comes from AI, apart from the prompt | Generated with AI / Wygenerowane przez AI |
| `modified` | Real or human-made content was partly changed by AI: a swapped face, added objects, a replaced voice | Modified with AI / Zmodyfikowane przez AI |
| `basic` | AI was involved and you want your own words, such as "Voice generated with AI" | Made with AI / Z udziałem AI |
| `human` | A person made it without generative AI, and you want to say so | Made by a human / Stworzone przez człowieka |

`--media` adds the content-type icons. `--human text` puts a "Made by a human" label next to an AI label. `--short` switches to the compact wording that mirrors the EU icons ("Generated"), and `--uppercase` sets it in spaced capitals like the icons themselves.

### Minimal form

![Minimal labels: the AI disc with an image icon, with image and voice icons, an AI label next to a hand with a text icon, and a hand with text and image icons](docs/minimal.png)

`--minimal` drops the text. The left side says who made it (the EU "AI" disc, or a hand in the same disc), the right side says what (the content-type icons). It fits where a full label does not: thumbnails, avatars, dense feeds, UI chips. Two things to know before you use it:

- In user testing for the EU icons, labels with text were noticed and understood better. When the label is a legal duty, prefer the full form, or keep the minimal one and say the same thing in words in the caption.
- Without text, "generated" and "modified" look the same. Only the alt text tells them apart.

## Accessibility

Article 50(5) asks for disclosures that conform to the applicable accessibility requirements, and the EU icon guidance asks for alt text or ARIA labels. The labels follow WCAG 2.2:

- **Contrast:** the text keeps at least 4.5:1 against its own background even when that background is semi-transparent and the image behind it is pure black or pure white. Options that would break this are refused unless you pass `--allow-low-contrast`.
- **Screen readers:** `decide`, `render`, `stamp` and `alt` return the label as a sentence ("Generated with AI: image and voice."). Text burned into pixels is invisible to assistive technology, so publish that sentence in the `alt`, `aria-label` or caption. Rendered SVGs carry it in `aria-label` and `<title>`.
- **Legible everywhere:** the text is drawn as outlines from Inter SemiBold, so it looks the same in every browser and image viewer and covers the alphabets of all 24 official EU languages. Stamped labels are never smaller than 20 px tall; an image too small for that gets an error instead of an unreadable label.
- **Still:** labels are static. The skill tells agents not to animate them.

## What the AI Act asks

The short version is in the [Why](#why) section. The rules behind `decide`, with quotes and links to the Act, the EU icon page and the Code of Practice, are in [`references/rules.md`](skills/ai-content-labels/references/rules.md). `decide` is a checklist, not legal advice, and the Commission's guidelines on Article 50 may change the details.

## Limits

- **Video and audio are not stamped yet.** For video, render a PNG label and overlay it for the whole clip with ffmpeg (the skill shows the command). Labels that follow the timeline, such as a voice icon shown only while an AI voice speaks, are planned. Audio-only content needs a spoken disclaimer; `decide` says so.
- **Stamping rewrites the file.** The EXIF data, the colour profile and the XMP (rights, credit, captions) are carried over, and the DigitalSourceType is added to the XMP. An older IPTC-IIM block is not carried over. The pixels change, so an existing C2PA manifest no longer verifies: sign again after stamping if you rely on C2PA.
- **Two built-in languages.** English and Polish. Other languages work with `--text`; built-in wording for more languages is welcome as a pull request to [`i18n.mjs`](skills/ai-content-labels/scripts/lib/i18n.mjs).

## Roadmap

1. A simple online generator: pick the options, download PNG or SVG.
2. Video labels that follow the timeline.
3. More built-in languages.

## Credits and licences

- **EU icons:** European Commission, [EU icons for labelling AI-generated content](https://digital-strategy.ec.europa.eu/en/policies/eu-icons-labelling-ai-generated-content). Free to use without attribution. Using them does not mean you signed the Code of Practice.
- **Content-type icons:** [Lucide](https://lucide.dev), ISC licence.
- **Font:** [Inter](https://rsms.me/inter/) by Rasmus Andersson, SIL Open Font License 1.1.

The code is MIT. Details for the third-party files are in [NOTICE.md](NOTICE.md).
