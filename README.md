# ai-content-labels

[![tests](https://github.com/JK-G/ai-content-labels/actions/workflows/test.yml/badge.svg)](https://github.com/JK-G/ai-content-labels/actions/workflows/test.yml)

Labels for AI-generated and human-made content, built on the official EU icons. ai-content-labels tells you whether the EU AI Act requires a label and draws one that keeps WCAG contrast on any background. It burns the label into images, writes it as HTML for web pages and hands you the alt text. It ships as a CLI, an MCP server and a skill for Claude Code and other agents.

![Labels in a light and a dark theme: "Generated with AI" with an image icon, "Modified with AI" with image and voice icons, a custom "Voice generated with AI", an AI label next to a "Human-made" label, a Polish label and an upper-case label](docs/labels.png)

Unofficial. Not affiliated with the European Commission, and not legal advice.

## Why

Article 50(4) of the AI Act applies from 2 August 2026. Deep fakes, and AI-generated text published to inform the public on matters of public interest, must be disclosed by the professional user of the AI system (the deployer). The deployer duty was not delayed by the AI Omnibus. On 10 June 2026 the Commission published three icons for this, free for anyone to use. In the Commission's words, "the use of these EU icons is optional, but the labelling requirements under Article 50 AI Act are not."

The icons leave the practical questions open. Does this image need a label at all? Which of the three icons? Where does it go, how big, and what does a screen reader hear? How do you show that only the voice was AI and the script was written by a person? This project answers those questions in code, so a person or an agent gets the same answer every time.

## What it does

- **`decide`** goes through the Article 50(4) questions: would the audience take the content for real, is it an artistic work, is the text published on a matter of public interest, did a person review it. It returns whether the label is a duty or a voluntary choice, which label fits (and the official EU icon with the same meaning), where to place it, the label sentence and the next step, as a command and, in JSON and over MCP, as the tool call to make. When a deciding fact is missing, it asks one question instead of guessing. The answer is a few lines; `--explain` adds the legal basis, notes and sources.
- **`stamp`** burns the label into a JPG, PNG, WebP, AVIF or TIFF, so it survives downloads and reshares as the EU guidance asks. You always say which label (`--kind`); stamp never assumes "Generated with AI". The label height follows the image (about 6% of the shorter side and at least 2.5% of the longer side, never below 28 px or above 512 px), its colour is the one that stands out more from the corner it sits in. Those are the file's pixels: for an image shown smaller, such as a post full width on a phone, pass `--display-width 390` and the label stays at least 28 px tall on that screen. For generated and modified labels an IPTC DigitalSourceType tag goes into the XMP; basic and human-made labels get only the project's marker, because the IPTC vocabulary has no term for them.
- **`render`** draws the same label as SVG, PNG or WebP, with `role="img"`, `lang` and an `aria-label`. With `--format html` it writes the label as real text and inline icons, for web pages and apps.
- **Content-type icons** show which part was AI: image, text, audio, voice, music, video. A second label, "Made by a human", shows which part was not.
- **`eu`** gives you the twelve official EU files, unchanged.
- **Languages:** English and Polish wording is built in. For the other 22 official EU languages, pass `--lang` with your own `--text` in that language (`--lang de --text "Mit KI generiert"`), so screen readers read the label with the right voice.

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

On Windows PowerShell, use `Copy-Item -Recurse ai-content-labels\skills\ai-content-labels $HOME\.claude\skills\` for the copy. The last step adds sharp to the copied skill; you can skip it if you only need SVG labels and `decide`. The folder carries its own licence notices (`NOTICE.md`), so copy it whole.

From a shell, without cloning:

```
npx -y github:JK-G/ai-content-labels stamp photo.jpg --kind generated --media image --description "what it shows"
```

Installed with npm (`npm install -g github:JK-G/ai-content-labels`), the command is `ai-labels`, also available as `ai-content-labels`.

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

From the command line. `ai-labels` is the command the package installs; from a clone, run `node skills/ai-content-labels/scripts/ai-labels.mjs` instead.

```
$ ai-labels decide --media image --origin generated
UNKNOWN: Would the people who will see it take it for a genuine photo, recording or event? Rerun with --realistic or --no-realistic.

$ ai-labels decide --media image --origin generated --realistic
REQUIRED: realistic AI image, a deep fake under Article 50(4)
Next: ai-labels stamp <image> --kind generated --media image --description "what it shows"
Label: --kind generated --media image, says "Generated with AI: image." (official EU icon with this meaning: generated)
- Burn the label into the image pixels (the `stamp` command), so it stays visible when the image is downloaded or reshared.
- Use a corner where platforms do not draw their own buttons or captions; ...
Accessibility: Give the image an alt text that says what it shows, then the label sentence (alt="<what the image shows>. Generated with AI: image."); ...
Do not animate the label (WCAG 2.2.2) or make it flash (WCAG 2.3.1). Not legal advice. More: rerun with --explain

$ ai-labels stamp wolf.png --kind generated --media image --description "Low-poly grey wolf standing, front view"
wolf.ai-label.png
label: 447×75 px, light pill, top-left, text contrast 14.78:1, stands out 14.19:1 from the image
display: 24 px tall or more when the image is shown 402 px wide or wider; shown narrower, as on a phone, it is smaller: pass --display-width 390
disclosure: Generated with AI: image.
alt: Low-poly grey wolf standing, front view. Generated with AI: image.
metadata: XMP DigitalSourceType trainedAlgorithmicMedia

$ ai-labels render --kind modified --media image,voice --human text --lang pl --out label.svg
$ ai-labels render --format html --kind generated --media text
```

`decide` exits with code 2 when it has to ask, so a script cannot mistake a question for a verdict. For text published on a matter of public interest it also asks whether a person reviewed it (`--editorial-review`), because that decides the case. With `--json`, the field `missing` names the argument to answer, and after a verdict the field `next` holds the next call: the MCP tool, the arguments to pass unchanged, the ones still to fill in (`fill`) and the CLI line. `ai-labels help` lists every option.

## Which label

| Kind | Use it when | Default text (en / pl) |
|---|---|---|
| `generated` | All of the content comes from AI, apart from the prompt | Generated with AI / Wygenerowane przez AI |
| `modified` | Real or human-made content was partly changed by AI: a swapped face, added objects, a replaced voice | Modified with AI / Zmodyfikowane przez AI |
| `basic` | AI was involved and you want your own words, such as "Voice generated with AI" | Made with AI / Z udziałem AI |
| `human` | A person made it without generative AI, and you want to say so | Made by a human / Stworzone przez człowieka (this project's own mark, not an EU icon) |

`--media` adds the content-type icons. `--human text` puts a "Made by a human" label next to an AI label. `--short` switches to the compact wording that mirrors the EU icons ("Generated"), and `--uppercase` sets it in spaced capitals like the icons themselves.

### Minimal form

![Minimal labels: the AI disc with an image icon, with image and voice icons, an AI label next to a hand with a text icon, and a hand with text and image icons](docs/minimal.png)

`--minimal` drops the text. The left side says who made it (the EU "AI" disc, or a hand in the same disc), the right side says what (the content-type icons). It fits where a full label does not: thumbnails, avatars, dense feeds, UI chips. Two things to know before you use it:

- In user testing for the EU icons, labels with text were noticed and understood better. When the label is a legal duty, prefer the full form, or keep the minimal one and say the same thing in words in the caption.
- Without text, "generated" and "modified" look the same. Only the alt text tells them apart.

The minimal form goes down to 20 px; labels with text stop at 24 px, because smaller type is unreadable. The hand is a filled glyph at 0.62 of its disc at every size, in SVG, PNG and HTML alike. Being solid, it matches the weight of the bold "AI" letters, and at the smallest sizes it still reads as a raised hand by its outline.

![Minimal AI and human-made labels at 20, 24, 28, 32 and 40 px, at actual size and enlarged four times, in a light and a dark theme](docs/small.png)

## Accessibility

Article 50(5) asks for disclosures that conform to the applicable accessibility requirements, and the EU icon guidance asks for alt text or ARIA labels. The labels follow WCAG 2.2:

- **Contrast:** the text keeps at least 4.5:1 against its own background even when that background is semi-transparent and the image behind it is pure black or pure white. Options that would break this are refused unless you pass `--allow-low-contrast`.
- **Screen readers:** `render`, `stamp` and `alt` return the label sentence as `disclosure` ("Generated with AI: image and voice."). Text burned into pixels is invisible to assistive technology, so the alt text of a labelled image is a short description of what it shows, then that sentence: pass `--description` and the commands return it composed as `alt` ("Modern house among pine trees, architectural visualisation. Generated with AI: image."). Without a description `alt` is null, so an agent cannot publish the sentence alone as the alt of an informative image. `render` also returns `labelAlt`, the alt for an `<img>` that shows the label on its own. When the label is a legal duty, put the sentence in a visible caption too. Rendered SVGs carry it in `aria-label` and `<title>`; when the image's alt or caption already says it, give a separate label `alt=""` or `aria-hidden="true"`.
- **Real text on web pages:** `render --format html` writes the label as text with decorative inline icons and a stylesheet (`--css`). It zooms, reflows, translates and follows the page's colour scheme and forced colours, which an image of text cannot do (WCAG 1.4.4, 1.4.5, 1.4.12). A page that declares only a light scheme keeps a light label when the system is dark; `--theme` pins one. In a narrow column the icons move under the words instead of the words breaking. Use SVG or PNG for images, video overlays and places that only accept an image.
- **Legible everywhere:** in SVG, PNG and stamped labels the text is drawn as outlines from Inter SemiBold, so it looks the same in every browser and image viewer and covers the alphabets of all 24 official EU languages. Labels with text are never smaller than 24 px tall, and minimal ones 20 px; an image too small for that gets an error instead of an unreadable label. Those are the file's pixels. A screen that shows the image smaller shrinks the label too, so `stamp` reports the narrowest display width at which the label stays 24 px tall, and `--display-width` sizes it for the screen you name (390 for a phone).
- **Still:** labels are static. The skill tells agents not to animate them (WCAG 2.2.2) or make them flash (WCAG 2.3.1).

## What the AI Act asks

The short version is in the [Why](#why) section. The rules behind `decide`, with quotes and links to the Act, the EU icon page and the Code of Practice, are in [`references/rules.md`](skills/ai-content-labels/references/rules.md). They include the Commission's Guidelines on Article 50 of 20 July 2026, with paragraph numbers. `decide` is a checklist, not legal advice.

## Limits

- **Video and audio are not stamped yet.** For video, render a PNG label and overlay it for the whole clip with ffmpeg (the skill shows the command). Labels that follow the timeline, such as a voice icon shown only while an AI voice speaks, are planned. Audio-only content needs a spoken disclaimer; `decide` says so.
- **One still image per `stamp` run.** Batch mode is planned. Animated WebP and GIF are refused; export a still frame.
- **Stamping rewrites the file.** The EXIF data, the colour profile and the XMP (rights, credit, captions) are carried over. The project's marker is always added to the XMP, so a labelled file is not stamped twice by mistake, even after a rename; `--no-metadata` skips only the IPTC DigitalSourceType. An older IPTC-IIM block is not carried over. The pixels change, so an existing C2PA manifest no longer verifies: sign again after stamping if you rely on C2PA.
- **Two built-in languages.** English and Polish. The other EU languages need `--lang` and `--text` (and `--human-text` for a human-made part); the sentence is then your text alone, and the content-type icons stay decorative. Built-in wording for more languages is welcome as a pull request to [`i18n.mjs`](skills/ai-content-labels/scripts/lib/i18n.mjs).

## Roadmap

1. A simple online generator: pick the options, download PNG or SVG.
2. Video labels that follow the timeline.
3. More built-in languages.

## Credits and licences

- **EU icons:** European Commission, [EU icons for labelling AI-generated content](https://digital-strategy.ec.europa.eu/en/policies/eu-icons-labelling-ai-generated-content). Free to use without attribution. Using them does not mean you signed the Code of Practice. The human-made mark (a hand in the same disc) is this project's own design, not an EU icon.
- **Content-type icons:** [Lucide](https://lucide.dev), ISC licence; the music and text icons are derived from Feather, MIT licence.
- **The hand in the human-made mark:** [Phosphor](https://phosphoricons.com) "hand-palm", fill weight, MIT licence. The full notices for both sets ship in the skill folder (`assets/icons/LICENSE.txt`).
- **Font:** [Inter](https://rsms.me/inter/) by Rasmus Andersson, SIL Open Font License 1.1.

The code is MIT. Details for the third-party files are in [NOTICE.md](NOTICE.md).
