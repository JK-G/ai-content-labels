# Changelog

## 0.1.0 (2026-10-17)

First public version: images.

- `decide`: the Article 50(4) checklist (deep fakes, public-interest text, editorial review, creative works, audio) with the EU icon to use, placement, accessibility notes and alt text.
- `render`: labels with the official basic EU icon, text in English or Polish, content-type icons and an optional "Made by a human" part; SVG, PNG or WebP; 4.5:1 text contrast on any backdrop.
- `stamp`: burns a label into JPG, PNG, WebP, AVIF and TIFF files, sized and coloured for the image (never below 20 px). Keeps the EXIF, colour profile and XMP of the original and adds an IPTC DigitalSourceType to the XMP.
- `--minimal`: no text, only the author mark (EU "AI" disc, or a hand in the same disc) and the content-type icons.
- `eu`: the official EU icons, unchanged. `icons`: the content-type icons.
- MCP server (`decide_label`, `render_label`, `stamp_image`, `eu_icon`), Claude Code plugin and skill.
