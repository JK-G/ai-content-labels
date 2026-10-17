# Changelog

## 0.1.0 (unreleased)

First public version: images and labels for web pages.

- `decide`: the Article 50(4) checklist (deep fakes, public-interest text, editorial review, creative works, audio) with the EU icon to use, placement, accessibility notes and the label sentence. Based on the AI Act, the Commission's Article 50 Guidelines (20 July 2026) and the Code of Practice on Transparency of AI-Generated Content. When the deciding fact is missing (`--realistic` for image, video and audio, `--public-interest` for text) it returns `UNKNOWN` with one question and exits with code 2 instead of guessing.
- `render`: labels with the official basic EU icon, text in English or Polish, content-type icons and an optional "Made by a human" part; SVG (with `lang`), PNG or WebP; 4.5:1 text contrast on any backdrop. `--format html` writes the label as real text with a stylesheet (`--css`) that follows dark mode and forced colours.
- `stamp`: burns a label into one JPG, PNG, WebP, AVIF or TIFF file, sized for the image (about 6% of the shorter side, at least 2.5% of the longer side, 28 to 512 px) and in the theme that stands out more from the image. Keeps the EXIF, colour profile and XMP of the original and adds an IPTC DigitalSourceType to the XMP. Refuses to overwrite an output or to stamp a labelled file again unless you pass `--force`.
- Alt text: `--description` puts what the image shows before the label sentence; results carry both `alt` and `disclosure` (the sentence alone).
- `--minimal`: no text, only the author mark (EU "AI" disc, or a hand in the same disc) and the content-type icons, down to 20 px. Labels with text are at least 24 px tall.
- `eu`: the official EU icons, unchanged. `icons`: the content-type icons.
- MCP server (`decide_label`, `render_label`, `stamp_image`, `eu_icon`) with strict arguments and tool annotations, Claude Code plugin and skill.
