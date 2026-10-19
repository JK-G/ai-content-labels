# "Made by a human" labels

Ready-made labels for work you made without generative AI. Download them and put them on your image, page or document yourself. No agent and no install needed.

![The labels in English and Polish, light and dark: "Made by a human", "Human-made", the hand alone, and versions with an image or text icon](preview.png)

**Download:** every file in one ZIP, `human-made-labels.zip`, from the [latest release](https://github.com/JK-G/ai-content-labels/releases/latest), or pick single files from the folders below.

## Use them honestly

- Only on work, or the part of it, that no generative AI produced or changed. The label is a claim to your audience. Towards consumers, a false "made by a human" can be an unfair commercial practice (EU Directive 2005/29/EC).
- It is not an EU icon and has no meaning under the AI Act. For AI content, use the AI labels from this project, which are built on the official EU icon.
- Mixed work is fine when you say so. An AI image next to a text you wrote yourself gets both labels: `ai-labels render --kind generated --media image --human text`.

## What is in the pack

Two languages, `en/` ("Made by a human") and `pl/` ("Stworzone przez człowieka"), each in `light/` and `dark/`.

| File | What it shows |
|---|---|
| `human-made` | The label with text |
| `human-made-short` (English only) | "Human-made" |
| `human-made-<type>` | The label with one content-type icon: `image`, `text`, `audio`, `voice`, `music`, `video` |
| `human-made-mark` | The hand alone, for tight spots |
| `human-made-mark-<type>` | The hand and one content-type icon |

Every label comes as `.svg` (scales to any size), `-48.png` (web) and `-128.png` (print and social media), on a transparent background.

## Placing it

- A light label stands out on dark or busy images, a dark one on light images. Either keeps its text at 4.5:1 contrast or better on any background.
- Put it where nothing covers it, for example in a corner. Keep the hand and labels with words at least 18 px tall where people see them, 20 px for `human-made-mark-<type>`.
- Text inside an image is invisible to screen readers. Add the sentence to the alt text: "Made by a human: image." or "Stworzone przez człowieka: obraz."
- To burn a label into a photo instead of placing it by hand: `ai-labels stamp photo.jpg --kind human --media image --description "what it shows"`.

## Credits

The hand is the Heroicons "hand-raised" icon (MIT licence, Tailwind Labs). The content-type icons are Lucide (ISC licence) and the text is Inter (SIL Open Font License 1.1), drawn as outlines. All three licences allow you to use the labels in your own work, commercial work included. Full notices: [NOTICE.md](../../NOTICE.md).
