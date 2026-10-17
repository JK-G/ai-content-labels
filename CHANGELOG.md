# Changelog

## 0.1.0 (2026-10-17)

First public version: images.

- `decide`: the Article 50(4) checklist (deep fakes, public-interest text, editorial review, creative works, audio) with the EU icon to use, placement, accessibility notes and alt text.
- `render`: labels with the official basic EU icon, text in English or Polish, content-type icons and an optional "Made by a human" part; SVG, PNG or WebP; 4.5:1 text contrast on any backdrop.
- `stamp`: burns a label into JPG, PNG, WebP, AVIF and TIFF files, sized and coloured for the image, with an IPTC DigitalSourceType XMP tag.
- `eu`: the official EU icons, unchanged. `icons`: the content-type and compact icons.
- Compact icon set: image-ai, text-ai, audio-ai, video-ai, universal-ai.
- MCP server (`decide_label`, `render_label`, `stamp_image`, `eu_icon`), Claude Code plugin and skill.
