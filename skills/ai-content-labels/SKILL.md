---
name: ai-content-labels
description: Label content as AI-generated, AI-modified or human-made with the official EU icons, and work out what Article 50 of the EU AI Act asks for. Use when the user asks to label, mark, tag, badge or disclose AI content or human-made content, in any wording or language (AI label, AI badge, "generated with AI" watermark, made by a human, AI Act labelling, Article 50 disclosure; Polish - oznacz jako AI, plakietka AI, oznaczenie treści AI, znak AI Act, stworzone przez człowieka), when they ask whether something must be labelled under the AI Act, and when an image, video, audio or text made or edited with AI is about to be published in a project that labels AI content. Burns the label into images, draws SVG or PNG labels for pages and UI, and returns the alt text to publish with the content.
---

# ai-content-labels

Run the CLI from the project root:

```
node "${CLAUDE_SKILL_DIR}/scripts/ai-labels.mjs" <command> [options]
```

If the plugin's MCP server is connected, the tools `decide_label`, `render_label`, `stamp_image` and
`eu_icon` do the same. `help` lists every option. Stamping and PNG output need `sharp`. When `doctor`
reports it missing, run the install command it prints (it knows whether this skill sits in a clone of
the repository or was copied on its own), or call the CLI through
`npx -y github:JK-G/ai-content-labels <command>`.

## Workflow

1. **Get the facts, mostly from context.** You need the media type (image, video, audio, text) and the
   origin: `generated` (all AI, apart from the prompt), `modified` (real or human-made content partly
   changed by AI), `assisted` (only standard edits such as colour or noise) or `human`. Then:
   - `--realistic`: does it look like a real person, object, place or event, so it could pass as
     authentic? This decides most cases. A photorealistic product shot or a place that does not
     exist counts, not only people.
   - `--creative`: an evidently artistic, satirical or fictional work.
   - Text only: `--public-interest` (published to inform the public on matters of public interest)
     and `--editorial-review` (a person reviewed it and someone holds editorial responsibility).

   Ask only for what you cannot infer, in one short question.
2. **Decide:** `decide --media image --origin generated --realistic --lang pl`. It says whether the
   label is a legal duty or a voluntary one, which label to use (and the official EU icon with the
   same meaning), where to put it, and the alt text.
3. **Make the label:**
   - Image file: `stamp photo.jpg --kind generated --media image --lang pl`. Writes
     `photo.ai-label.jpg` with the label in the pixels, keeps the EXIF and XMP of the original and
     adds an IPTC DigitalSourceType to the XMP. The size and colour adapt to the image;
     `--position` picks the corner (default top-left).
   - Web page or app: `render --kind generated --media image --out label.svg`, or inline the SVG
     the command prints. The SVG carries `role="img"` and an `aria-label`.
   - Video, for now: render a PNG (`render ... --out label.png --height <about 4.5% of the shorter
     side>`) and overlay it for the whole video, away from the player controls:
     `ffmpeg -i in.mp4 -i label.png -filter_complex "overlay=24:24" -c:a copy out.mp4`.
     Labels that change with the timeline are not built yet.
   - Audio: put the visual label on the player, cover or page, and tell the user to add a short
     spoken disclaimer at the start. Audio alone cannot carry a visual label.
4. **Publish the alt text** that `decide`, `render` or `stamp` returns with the content: in `alt`,
   `aria-label` or the caption. Text burned into pixels is invisible to screen readers.
5. **Report back** in a few lines: what you labelled and where the files are, whether the label is
   required or voluntary and on what basis, and anything you assumed.

## Which label

| Situation | Options |
|---|---|
| All of it made by AI | `--kind generated` |
| Real or human-made content changed by AI (a swapped face, added objects, a replaced voice) | `--kind modified` |
| AI was involved and you want your own wording | `--kind basic --text "Voice generated with AI"` |
| Made by a person, confirmed by the user | `--kind human --media text,image` |
| AI image with a human-written text | `--kind generated --media image --human text` |

- `--media` lists only the parts that are AI (or, with `--kind human`, the parts made by a person).
- Match the language of the content: `--lang pl` for Polish. Only `en` and `pl` are built in; for
  another language pass `--text` in that language (plain words, no abbreviation other than "AI").
- `--short` gives the compact wording ("Generated"), useful for two labels side by side.
- `--minimal` drops the text: the author mark (EU "AI" disc or a hand) plus the content-type icons.
  Use it only when the user asks for it or the spot is too small for text (thumbnails, avatars, UI
  chips). When `decide` says the label is required, keep the full form, or use the minimal one and
  put the label sentence in a visible caption. Without text, "generated" and "modified" look the
  same, so the alt text must carry the difference.
- The untouched EU files: `eu generated --variant black --out ai-generated.svg` (also `basic`,
  `modified`; variants `black`, `white`, `black-transparent`, `white-transparent`).

## Do not

- Do not call labelled content "AI Act compliant". Say the label follows the EU icon guidance;
  `decide` is a checklist, not legal advice.
- Do not put a human-made label on anything generative AI produced or changed, and do not infer it.
- Do not use the EU transparent variants on top of photos; their letters can drop below WCAG
  contrast there. Labels drawn by this tool keep 4.5:1 text contrast on any backdrop.
- Do not shrink a stamped label below its automatic size, cover it with other UI, or animate it.
- Stamping changes the pixels, so an existing C2PA manifest stops verifying. If the file had one,
  tell the user to sign it again after stamping.

The rules behind `decide`, with sources: `references/rules.md`.
