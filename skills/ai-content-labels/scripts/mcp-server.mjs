#!/usr/bin/env node
// MCP server (stdio) for ai-content-labels. No dependencies: newline-delimited JSON-RPC 2.0.
import { createInterface } from 'node:readline';
import { render, stamp, decideLabel, eu } from './lib/api.mjs';
import { KINDS, MEDIA, EU_LANGS } from './lib/i18n.mjs';
import { POSITIONS, EU_ICONS, EU_VARIANTS } from './lib/render.mjs';
import { VERSION } from './lib/version.mjs';

const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const PATH_NOTE = "Absolute path recommended; a relative path resolves against the server's working directory, which may not be your project.";

const labelProps = {
  kind: { type: 'string', enum: KINDS, description: 'generated (fully AI), modified (real content changed by AI), basic (AI involved, use with text), human (made by a person)' },
  media: { type: 'array', items: { type: 'string', enum: MEDIA }, description: 'What was made with AI (or by a human for kind=human); shown as icons' },
  human: { type: 'array', items: { type: 'string', enum: MEDIA }, description: 'Parts made by a human, shown as a second label next to the AI one' },
  lang: { type: 'string', enum: EU_LANGS, description: 'Label language, default en. Built-in wording: en, pl; other EU languages need text (and human_text)' },
  text: { type: 'string', description: 'Own label text instead of the default wording' },
  human_text: { type: 'string', description: 'Own text for the human-made part' },
  description: { type: 'string', description: 'What the image shows, one short phrase; it goes before the label sentence in the alt text' },
  short: { type: 'boolean', description: 'Compact wording, e.g. "Generated"' },
  uppercase: { type: 'boolean', description: 'Upper case with letter spacing, like the EU icons' },
  minimal: { type: 'boolean', description: 'No text: only the author mark (EU "AI" disc, or a hand in the same disc) and the content-type icons. For tight spots, or where a caption already says it in words' },
  height: { type: 'integer', description: 'Label height in whole px: at least 24 with text, 20 with minimal' },
};

const TOOLS = [
  {
    name: 'decide_label',
    description:
      'Decide which AI label a piece of content needs and whether Article 50(4) of the EU AI Act requires it (deep fakes, public-interest text without editorial review). Returns a short verdict, the label to use, the EU icon, placement and accessibility rules, the label sentence (disclosure) and the next call in `next`: tool (stamp_image or render_label), arguments to pass unchanged, fill (the arguments you still supply, such as input and description) and the same step as a CLI line (cli). When a deciding fact is missing (realistic for image, video and audio; public_interest, or editorial_review for public-interest text) it returns required:"unknown", the argument in `missing` and one question: ask the user, never guess. A checklist, not legal advice. Call this before render_label or stamp_image.',
    inputSchema: {
      type: 'object',
      properties: {
        media: { type: 'string', enum: ['image', 'video', 'audio', 'text'] },
        origin: { type: 'string', enum: ['generated', 'modified', 'assisted', 'human'], description: 'generated = fully by AI; modified = real content changed by AI; assisted = only standard edits; human = no generative AI' },
        realistic: {
          type: 'boolean',
          description: 'Required for image, video and audio: would the foreseeable audience take it for a genuine photo, recording or event? Photorealism alone does not decide it; a person, product or place that does not exist but plausibly could counts.',
        },
        creative: {
          type: 'boolean',
          description: 'An evidently artistic, satirical or fictional work, obvious to its audience; read strictly, news or a product shot does not count, and an advertisement only in specific cases',
        },
        public_interest: { type: 'boolean', description: 'Required for text: published to inform the public on matters of public interest' },
        editorial_review: {
          type: 'boolean',
          description:
            'A person with relevant knowledge checked the substance (at least fact-checked it; a spell-check or quick approval does not count), no AI changes after sign-off, and a named person or company holds editorial responsibility',
        },
        lang: { type: 'string', enum: EU_LANGS, description: 'Built-in wording: en, pl; for other EU languages disclosure is null and you write the sentence' },
      },
      required: ['media', 'origin'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'render_label',
    description:
      'Draw a label (official EU "AI" icon + text + content-type icons, or a human-made label). format svg (default) writes `out` (.svg, .png, .webp) or, with inline:true, returns the SVG text; format html returns a snippet with real text plus its CSS, for web pages. Text contrast is at least 4.5:1 on any backdrop (wcag: true in the result).',
    inputSchema: {
      type: 'object',
      properties: {
        ...labelProps,
        theme: { type: 'string', enum: ['light', 'dark'] },
        format: { type: 'string', enum: ['svg', 'html'], description: "html: real text that zooms, reflows, translates and follows the page's color-scheme; use it for web pages and UI" },
        out: { type: 'string', description: `Optional output path. ${PATH_NOTE}` },
        inline: { type: 'boolean', description: 'Without out: return the SVG text in the result' },
        scale: { type: 'number', description: 'PNG and WebP pixel density, 0.5 to 16, default 1' },
      },
      required: ['kind'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'stamp_image',
    description:
      'Burn a label into one image file (jpg, png, webp, avif, tiff) so it stays visible after download and reshare, add an IPTC DigitalSourceType XMP tag, and return the alt text and label sentence to publish with the image. Refuses to overwrite or to stamp an already labelled file unless force is true.',
    inputSchema: {
      type: 'object',
      properties: {
        input: { type: 'string', description: `Path of the image to label. ${PATH_NOTE}` },
        out: { type: 'string', description: `Output path, default <name>.ai-label.<ext>. ${PATH_NOTE}` },
        ...labelProps,
        theme: { type: 'string', enum: ['auto', 'light', 'dark'], description: 'auto (default) picks the label colour from the image' },
        position: { type: 'string', enum: POSITIONS, description: 'Default top-left' },
        display_width: {
          type: 'integer',
          description:
            'How wide the image will be shown, in CSS px; the label is made at least 28 px tall at that width. Use 390 for an image shown full width on a phone (feed posts, stories). The result always reports label.minDisplayWidth, the narrowest display width at which the label stays 24 px tall',
        },
        metadata: { type: 'boolean', description: 'Write the IPTC DigitalSourceType tag, default true; the ai-content-labels marker that prevents double stamping is always written' },
        force: { type: 'boolean', description: 'Overwrite an existing output, or stamp a file that is already labelled' },
      },
      required: ['input', 'kind'],
      additionalProperties: false,
    },
    annotations: { destructiveHint: false, idempotentHint: false },
  },
  {
    name: 'eu_icon',
    description: 'Get one of the official EU icons for labelling AI-generated content, unchanged. Returns the SVG and its alt text, or writes it to `out` (.svg, .png).',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', enum: EU_ICONS },
        variant: { type: 'string', enum: EU_VARIANTS },
        out: { type: 'string', description: `Optional output path. ${PATH_NOTE}` },
        height: { type: 'integer', description: 'PNG height in whole px' },
      },
      required: ['name'],
      additionalProperties: false,
    },
    // Read-only without `out`; with `out` it writes a copy of the icon and nothing else.
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
];

const camel = (o) => Object.fromEntries(Object.entries(o ?? {}).map(([k, v]) => [k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), v]));

// The schema says what is allowed; check it here too, so a mistyped argument is refused instead of ignored.
function checkArgs(tool, args) {
  const allowed = Object.keys(tool.inputSchema.properties);
  const unknown = Object.keys(args).filter((k) => !allowed.includes(k));
  if (unknown.length) return `unknown argument "${unknown[0]}"; allowed: ${allowed.join(', ')}`;
  const missing = (tool.inputSchema.required ?? []).filter((k) => args[k] == null);
  if (!missing.length) return null;
  if (tool.name === 'stamp_image' && missing.includes('kind')) return 'stamp_image needs kind; call decide_label first';
  return `${tool.name} needs ${missing.join(' and ')}`;
}

async function callTool(name, args) {
  const a = camel(args);
  switch (name) {
    case 'decide_label':
      return decideLabel(a);
    case 'render_label': {
      const result = await render(a);
      if (result.svg && a.inline !== true) {
        delete result.svg;
        result.hint = 'pass out to write a file, or inline:true to get the SVG text';
      }
      return result;
    }
    case 'stamp_image':
      return stamp(a.input, a);
    case 'eu_icon':
      return eu(a.name, a);
  }
}

async function handle(msg) {
  const { id, method, params } = msg;
  switch (method) {
    case 'initialize':
      return {
        protocolVersion: PROTOCOLS.includes(params?.protocolVersion) ? params.protocolVersion : PROTOCOLS[0],
        capabilities: { tools: {} },
        serverInfo: { name: 'ai-content-labels', version: VERSION },
        instructions:
          'Label AI-generated and human-made content with the official EU icon. Call decide_label first; if it returns required:"unknown", ask the user its question and call it again. ' +
          "Then make the call in decide_label's next: next.tool with next.arguments unchanged, plus the arguments named in next.fill (stamp_image for image files, render_label with format html for web pages and UI). " +
          'Alt text = a short description of what the image shows, then the label sentence (disclosure); pass description so the result has it composed as alt. alt is null until you pass description; never publish disclosure as the alt of the image. ' +
          'render_label also returns labelAlt, the alt of an <img> that shows the label on its own. ' +
          'When the label is a legal duty, also put the sentence in a visible caption. If stamp_image fails with NO_SHARP, show the user the install command from the error.',
      };
    case 'ping':
      return {};
    case 'tools/list':
      return { tools: TOOLS };
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === params?.name);
      if (!tool) throw Object.assign(new Error(`unknown tool ${params?.name}`), { rpc: -32602 });
      const args = params?.arguments ?? {};
      const problem = typeof args === 'object' && !Array.isArray(args) ? checkArgs(tool, args) : 'arguments must be an object';
      if (problem) return { content: [{ type: 'text', text: problem }], isError: true };
      try {
        const result = await callTool(tool.name, args);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        if (err.rpc) throw err;
        return { content: [{ type: 'text', text: err.code ? `${err.code}: ${err.message}` : err.message }], isError: true };
      }
    }
    default:
      if (id === undefined) return undefined; // notifications need no answer
      throw Object.assign(new Error(`method not found: ${method}`), { rpc: -32601 });
  }
}

const send = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');

createInterface({ input: process.stdin }).on('line', async (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
  }
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
    return send({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'invalid request' } });
  }
  try {
    const result = await handle(msg);
    if (msg.id !== undefined && result !== undefined) send({ jsonrpc: '2.0', id: msg.id, result });
  } catch (err) {
    if (msg.id !== undefined) send({ jsonrpc: '2.0', id: msg.id, error: { code: err.rpc ?? -32603, message: err.message } });
  }
});
