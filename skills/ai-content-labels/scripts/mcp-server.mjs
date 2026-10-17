#!/usr/bin/env node
// MCP server (stdio) for ai-content-labels. No dependencies: newline-delimited JSON-RPC 2.0.
import { createInterface } from 'node:readline';
import { render, stamp, decideLabel, eu } from './lib/api.mjs';
import { KINDS, MEDIA, LANGS } from './lib/i18n.mjs';
import { POSITIONS, EU_ICONS, EU_VARIANTS } from './lib/render.mjs';
import { VERSION } from './lib/version.mjs';

const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const labelProps = {
  kind: { type: 'string', enum: KINDS, description: 'generated (fully AI), modified (real content changed by AI), basic (AI involved, use with text), human (made by a person)' },
  media: { type: 'array', items: { type: 'string', enum: MEDIA }, description: 'What was made with AI (or by a human for kind=human); shown as icons' },
  human: { type: 'array', items: { type: 'string', enum: MEDIA }, description: 'Parts made by a human, shown as a second label next to the AI one' },
  lang: { type: 'string', enum: Object.keys(LANGS), description: 'Label language, default en' },
  text: { type: 'string', description: 'Own label text instead of the default wording' },
  human_text: { type: 'string', description: 'Own text for the human-made part' },
  short: { type: 'boolean', description: 'Compact wording, e.g. "Generated"' },
  uppercase: { type: 'boolean', description: 'Upper case with letter spacing, like the EU icons' },
  minimal: { type: 'boolean', description: 'No text: only the author mark (EU "AI" disc or a hand) and the content-type icons. For tight spots, or where a caption already says it in words' },
  height: { type: 'number', description: 'Label height in px' },
};

const TOOLS = [
  {
    name: 'decide_label',
    description:
      'Decide which AI label a piece of content needs and whether Article 50(4) of the EU AI Act requires it (deep fakes, public-interest text without editorial review). Returns the label to use, the EU icon, placement and accessibility rules, and alt text. A checklist, not legal advice. Call this before render_label or stamp_image.',
    inputSchema: {
      type: 'object',
      properties: {
        media: { type: 'string', enum: ['image', 'video', 'audio', 'text'] },
        origin: { type: 'string', enum: ['generated', 'modified', 'assisted', 'human'], description: 'generated = fully by AI; modified = real content changed by AI; assisted = only standard edits; human = no generative AI' },
        realistic: { type: 'boolean', description: 'Resembles real persons, objects, places, entities or events and could pass as authentic' },
        creative: { type: 'boolean', description: 'Evidently artistic, creative, satirical or fictional work' },
        public_interest: { type: 'boolean', description: 'Text published to inform the public on matters of public interest' },
        editorial_review: { type: 'boolean', description: 'A human reviewed the text and someone holds editorial responsibility' },
        lang: { type: 'string', enum: Object.keys(LANGS) },
      },
      required: ['media', 'origin'],
    },
  },
  {
    name: 'render_label',
    description:
      'Draw a label (official EU "AI" icon + text + content-type icons, or a human-made label) as SVG. Returns the SVG and the alt-text sentence, or writes it to `out` (.svg, .png, .webp). Text contrast is at least 4.5:1 on any backdrop.',
    inputSchema: {
      type: 'object',
      properties: { ...labelProps, theme: { type: 'string', enum: ['light', 'dark'] }, out: { type: 'string', description: 'Optional output path' }, scale: { type: 'number', description: 'PNG pixel density, default 1' } },
    },
  },
  {
    name: 'stamp_image',
    description:
      'Burn a label into an image file (jpg, png, webp, avif, tiff) so it stays visible after download and reshare, add an IPTC DigitalSourceType XMP tag, and return the alt text to publish with the image.',
    inputSchema: {
      type: 'object',
      properties: {
        input: { type: 'string', description: 'Path of the image to label' },
        out: { type: 'string', description: 'Output path, default <name>.ai-label.<ext>' },
        ...labelProps,
        theme: { type: 'string', enum: ['auto', 'light', 'dark'], description: 'auto (default) picks the label colour from the image' },
        position: { type: 'string', enum: POSITIONS, description: 'Default top-left' },
        metadata: { type: 'boolean', description: 'Write the XMP tag, default true' },
      },
      required: ['input'],
    },
  },
  {
    name: 'eu_icon',
    description: 'Get one of the official EU icons for labelling AI-generated content, unchanged. Returns the SVG or writes it to `out` (.svg, .png).',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', enum: EU_ICONS },
        variant: { type: 'string', enum: EU_VARIANTS },
        out: { type: 'string' },
        height: { type: 'number', description: 'PNG height in px' },
      },
      required: ['name'],
    },
  },
];

const camel = (o) => Object.fromEntries(Object.entries(o ?? {}).map(([k, v]) => [k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), v]));

async function callTool(name, args) {
  const a = camel(args);
  switch (name) {
    case 'decide_label':
      return decideLabel(a);
    case 'render_label':
      return render(a);
    case 'stamp_image':
      return stamp(a.input, a);
    case 'eu_icon':
      return eu(a.name, a);
    default:
      throw Object.assign(new Error(`unknown tool ${name}`), { rpc: -32602 });
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
        instructions: 'Label AI-generated and human-made content with the official EU icon. Call decide_label first, then stamp_image for image files or render_label for web and UI labels, and publish the returned alt text with the content.',
      };
    case 'ping':
      return {};
    case 'tools/list':
      return { tools: TOOLS };
    case 'tools/call':
      try {
        const result = await callTool(params?.name, params?.arguments);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        if (err.rpc) throw err;
        return { content: [{ type: 'text', text: err.message }], isError: true };
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
