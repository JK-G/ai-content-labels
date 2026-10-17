---
name: ai-content-labels
description: Label content as AI-generated, AI-modified or human-made with the official EU icons, and work out what Article 50 of the EU AI Act asks for. Use right after you generate or edit an image that will be published, and when the user asks to label, mark, tag, badge or disclose AI content or human-made content, in any wording or language (AI label, AI badge, "generated with AI" watermark, made by a human, AI Act labelling, Article 50 disclosure; Polish - oznacz jako AI, plakietka AI, oznaczenie treści AI, znak AI Act, stworzone przez człowieka), when they ask whether something must be labelled under the AI Act, and when an image, video, audio or text made or edited with AI is about to be published in a project that labels AI content. Labels an image in one call, draws HTML, SVG or PNG labels for pages and UI, and returns the alt text to publish with the content.
license: MIT
metadata:
  version: "0.2.0"
  homepage: https://github.com/JK-G/ai-content-labels
---

# ai-content-labels

The CLI is `scripts/ai-labels.mjs` in this skill's folder. Run it with Node 20.9 or newer, using the
absolute path of this folder, or from inside it:

```
node scripts/ai-labels.mjs <command> [options]
```

In Claude Code `${CLAUDE_SKILL_DIR}` points to this folder:
`node "${CLAUDE_SKILL_DIR}/scripts/ai-labels.mjs" <command>`. Without the folder, or when sharp is
missing, the same CLI runs with no install: `npx -y -p github:JK-G/ai-content-labels ai-labels <command>`.

`decide` writes its next command as `ai-labels ...`, the name the package installs (also as
`ai-content-labels`); here it means the `node` line above. If the ai-content-labels MCP server is
connected, the tools `label_image`, `decide_label`, `render_label`, `stamp_image` and `eu_icon` do
the same. `help` lists every option. Stamping and PNG output need `sharp`. When `doctor` reports it
missing, run the install command it prints (it knows whether this skill sits in a clone of the
repository or was copied on its own), or use the `npx` line above.

## An image you generated or edited yourself

You already know it is AI and whether it looks real, so label it in one step, right after you make it
and before you hand it over:

```
node scripts/ai-labels.mjs label image.png --realistic --description "what it shows"
```

(MCP: `label_image` with `input` or `input_base64`, `realistic` and `description`.)

- `--realistic` or `--no-realistic` is required: would the people who see it take it for a genuine
  photo or event? Answer honestly; a person, product or place that does not exist but plausibly
  could counts. If you cannot tell, ask the user. Without it, `label` asks the same question as
  `decide` and exits with code 2.
- `--modified` when you changed a real photo or a human-made image instead of making it from scratch.
- It stamps a voluntary label too, because labelling AI images is good practice;
  `--only-if-required` skips the stamp when the AI Act does not require the label.
- `--lang pl` for a Polish label; `--display-width 390` for an image shown full width on a phone;
  `--out` for the output path (default `<name>.ai-label.<ext>` next to the image).
- Then publish the `alt` it returns, as in step 4 below. For anything else (video, audio, text, an
  image someone else made, a human-made label) use the full workflow.

## Workflow

1. **Get the facts, mostly from context.** You need the media type (image, video, audio, text) and the
   origin: `generated` (all AI, apart from the prompt), `modified` (real or human-made content partly
   changed by AI), `assisted` (only standard edits such as colour or noise) or `human`. Then:
   - `--realistic` or `--no-realistic`: would its audience take it for a genuine photo, recording
     or event? A person, product or place that does not exist but plausibly could counts;
     photorealism alone does not decide it. This decides most cases.
   - `--creative`: an evidently artistic, satirical or fictional work, obvious to its audience.
     Read strictly: news or a product shot does not count, and an advertisement only in specific
     cases.
   - Text only: `--public-interest` (published to inform the public on matters of public interest)
     and `--editorial-review` (a person with relevant knowledge checked the substance, at least
     fact-checked it; a spell-check or quick approval does not count; no AI changes after sign-off;
     and a named person or company holds editorial responsibility).

   Ask only for what you cannot infer, in one short question. If `decide` answers `UNKNOWN`
   (`required: "unknown"` over MCP), ask the one question it names in `missing` (`realistic`,
   `public_interest` or `editorial_review`); never guess it. For public-interest text it always
   asks about editorial review, because that decides the case.

   The duty binds deployers in the EU, and deployers elsewhere when they foresee the content being
   used in the EU, for example by publishing it on the open internet. A person acting in a purely
   personal, non-professional way has no duty; work for pay or regular economic benefit, as a
   freelancer or for an employer, is professional. If the user is clearly acting privately, say the
   duty does not apply to them and offer the label as voluntary.
2. **Decide:** `decide --media image --origin generated --realistic --lang pl`. It says whether the
   label is a legal duty or a voluntary one, the next command to run, which label to use (and the
   official EU icon with the same meaning), where to put it, and the label sentence (`disclosure`).
   `--explain` adds the basis, notes and sources; `--json` always has everything. In JSON and over
   MCP, `next` holds the next call: `tool`, `arguments` to pass unchanged, `fill` (what you still
   supply, such as `input` and `description`) and the same step as a CLI line (`cli`).
3. **Make the label:**
   - Image file: `stamp photo.jpg --kind generated --media image --lang pl --description "..."`.
     `--kind` is required: stamp never guesses the claim it burns in. For an image you made yourself, `label` does steps 2 and 3 at once. Writes `photo.ai-label.jpg`
     with the label in the pixels, keeps the EXIF and XMP of the original and adds an IPTC
     DigitalSourceType to the XMP for generated and modified labels. The size and colour adapt to
     the image; `--position` picks the corner (default top-left). It stamps one still file per run
     and refuses to overwrite or to stamp a labelled file again unless you pass `--force`.
   - Size for the screen: the automatic size is in the file's pixels. A 1600×1200 photo shown full
     width on a phone (about 390 px) displays its label about 18 px tall. When the image will be shown
     narrower than its own width (social feeds, stories, mobile articles), pass the display width:
     `--display-width 390` makes the label at least 28 px tall as shown. The result's
     `label.minDisplayWidth` says the narrowest width at which the label stays 24 px tall. For
     social posts, crop to the platform's final aspect first (Instagram 4:5 or 1:1), then stamp
     with `--display-width 390`, so the label sits inside every crop.
   - A folder of images: run `decide` once per distinct kind of content, then stamp each file with
     its own `--description`, and report one table: file, output, alt text.
   - Web page or app: use `render --format html` (real text: zooms, reflows, translates) and put
     the CSS from `render --format html --css` on the page once. The HTML label follows the page's
     color-scheme (light unless the page declares light dark); force it with `--theme`. Use SVG or
     PNG (`render ... --out label.svg`) for images, video overlays and places that only accept an
     image.
   - Video, for now: render a PNG (`render ... --out label.png --height <about 6% of the shorter
     side>`) and overlay it away from the player controls. The Code of Practice asks for the label
     at the start, at regular intervals where possible and at least after every break, and
     encourages keeping it for the whole video. This project recommends the whole video, which is
     what this does: `ffmpeg -i in.mp4 -i label.png -filter_complex "overlay=24:24" -c:a copy out.mp4`.
     Put the label sentence in visible text next to the player and say it in the audio
     (a spoken disclaimer at the start, or a line in the audio description); captions alone do not
     reach blind viewers. Labels that change with the timeline are not built yet.
   - Audio: put the visual label on the player, cover or page, and tell the user to add a short
     spoken disclaimer at the start, in the language of the recording; in long or live recordings,
     repeat it at regular intervals where it fits and at least after breaks. Put the sentence at the start of the transcript too.
     Audio alone cannot carry a visual label.
4. **Publish the alt text and the label sentence** with the content. Alt text = a short description
   of what the image shows, then the label sentence, e.g.
   `alt="Modern house among pine trees, architectural visualisation. Generated with AI: image."`
   Look at the image and describe what is actually there; do not reuse the example. Pass
   `--description` so `stamp` and `render` return it composed as `alt`; without it `alt` is null.
   Never use the label sentence (`disclosure`) alone as the alt of an informative image; it is the
   alt of the label itself, which `render` returns as `labelAlt`. When the label is a legal duty,
   also put the sentence in a visible caption. Text burned into pixels is invisible to screen
   readers. For a separate label on a page:
   - inline SVG works as is (it carries `role="img"`, `lang` and an `aria-label`); prefer
     `--format html` for page text that must reflow;
   - as `<img src="label.svg">`, give the img its own alt with the label sentence;
   - when the content's alt or caption already carries the sentence, give the separate label
     `alt=""` or `aria-hidden="true"`, so screen readers do not hear it twice.
5. **Report back** in a few lines: what you labelled and where the files are, whether the label is
   required or voluntary and on what basis, and anything you assumed.

## Which label

| Situation | Options |
|---|---|
| All of it made by AI | `--kind generated` |
| Real or human-made content changed by AI (a swapped face, added objects, a replaced voice) | `--kind modified` |
| AI was involved and you want your own wording | `--kind basic --text "Voice generated with AI"` |
| Made by a person, confirmed by the user | `--kind human --media text,image`. If the person wants to place the label by hand, point them to the ready-made files in `labels/human-made` of the repository (or the `human-made-labels.zip` release asset) instead |
| AI image with a human-written text | `--kind generated --media image --human text` |
| A human-made layout, mockup or collage containing an AI-generated element | Run decide with `--realistic` for the element. If the post is about the visualisation, crop to the AI element and stamp that; if it shows the whole design, use `--kind modified --media image` with `--description` naming the AI part |

- `--media` lists only the parts that are AI (or, with `--kind human`, the parts made by a person).
  A type cannot be in both `--media` and `--human`.
- Match the language of the content: `--lang pl` for Polish. Only `en` and `pl` are built in; for
  another EU language pass `--lang` with `--text` in that language (plain words, no abbreviation
  other than "AI"), e.g. `--lang de --text "Mit KI generiert"`. The sentence is then your text
  alone, so name the part in it ("Stimme mit KI generiert").
- `--short` gives the compact wording ("Generated"), useful for two labels side by side.
- `--minimal` drops the text: the author mark (EU "AI" disc, or a hand in the same disc) plus the content-type icons.
  Use it only when the user asks for it or the spot is too small for text (thumbnails, avatars, UI
  chips; labels with text need at least 24 px, minimal ones 20 px). When `decide` says the label
  is required, keep the full form, or use the minimal one and put the label sentence in a visible
  caption. Without text, "generated" and "modified" look the same, so the alt text must carry the
  difference.
- The hand mark is this project's design, not an EU icon. It has no meaning under the AI Act.
  Where you use it, explain it once (a legend, caption or an "about our labels" page).
- The untouched EU files: `eu generated --variant black --out ai-generated.svg` (also `basic`,
  `modified`; variants `black`, `white`, `black-transparent`, `white-transparent`).

## Do not

- Do not call labelled content "AI Act compliant". Say the label follows the EU icon guidance;
  `decide` is a checklist, not legal advice.
- Do not put a human-made label on anything generative AI produced or changed, and do not infer it.
- Do not use the EU transparent variants on top of photos; their letters can drop below WCAG
  contrast there. Labels drawn by this tool keep 4.5:1 text contrast on any backdrop.
- Do not shrink a stamped label below its automatic size, cover it with other UI, animate it
  (WCAG 2.2.2) or make it flash (WCAG 2.3.1).
- Stamping changes the pixels, so an existing C2PA manifest stops verifying. If the file had one,
  tell the user to sign it again after stamping.

The rules behind `decide`, with sources: `references/rules.md`.
