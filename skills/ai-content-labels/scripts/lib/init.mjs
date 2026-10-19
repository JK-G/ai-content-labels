import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// A short block for the instruction files agents read (AGENTS.md, GEMINI.md, CLAUDE.md,
// .github/copilot-instructions.md), so an agent that makes images labels them without being asked.

export const START = '<!-- ai-content-labels:start -->';
export const END = '<!-- ai-content-labels:end -->';

// voluntary: the project wants voluntary labels too, so the command carries --voluntary.
const body = ({ voluntary = false } = {}) => `## Labelling AI images

When you generate or edit an image that will be published, run this before you hand it over:

\`\`\`
ai-labels label <image> --realistic --description "what the image shows"${voluntary ? ' --voluntary' : ''}
\`\`\`

If \`ai-labels\` is not installed, run \`npx -y -p github:JK-G/ai-content-labels ai-labels label ...\` with the same options. If the ai-content-labels MCP server is connected, call its \`label_image\` tool instead${voluntary ? ', with `voluntary: true`' : ''}.

- ${
  voluntary
    ? 'This project labels every AI image it publishes: the command stamps the label where the EU AI Act requires it, where the answer is unsure, and, because of `--voluntary`, where it is only voluntary.'
    : 'The command stamps a label only where the EU AI Act requires one, or where the answer is unsure. Where the label is only voluntary it adds nothing and writes no file: publish the original. Add `--voluntary` only when the user wants voluntary labels too.'
}
- Answer the realism question honestly. Use \`--realistic\` when people could take the image for a real photo or event (a person, product or place that does not exist but could counts). Use \`--no-realistic\` for images that are clearly illustrated, stylised or impossible. If you cannot tell, ask the user. If you cannot ask, or the user does not know, use \`--realistic unsure\`: the label is then added as a precaution.
- Add \`--modified\` when AI changed a real photo or a human-made image instead of making it from scratch.
- The label is the EU "AI" icon alone, as small as stays legible on a phone, in the least invasive spot (bottom right first). Add \`--short\` when the user wants the word "Generated" next to it. If only part of the image is AI, such as a generated photo inside a designed graphic, add \`--region x,y,width,height\` with that part's box. For a pill in brand colours, \`--color #hex\` or \`--color auto\` (this gives the label with the word).
- Look at the image first and add \`--avoid x,y,width,height\` for every face, person, product or block of text the label must not cover: the automatic spot sees only texture.
- Publish the alt text the command returns with the image: what the image shows, then the label sentence when there is a label.
- Never put a human-made label on anything AI generated or changed.`;

export const agentInstructions = (opts = {}) => `${START}\n${body(opts)}\n${END}\n`;

// Appends the block to file, or replaces an older copy between the markers. Running it twice changes
// nothing. Returns what happened: "created", "added", "updated" or "unchanged".
export function writeInstructions(file = 'AGENTS.md', opts = {}) {
  const path = resolve(file);
  const block = agentInstructions(opts);
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, block);
    return { file: path, status: 'created' };
  }
  const text = readFileSync(path, 'utf8');
  // Write the block with the file's own line endings (CRLF in a Windows-made file), and leave the
  // rest of the file untouched, so a second run finds an identical block and no line ends mixed.
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const own = eol === '\n' ? block : block.replace(/\n/g, '\r\n');
  const start = text.indexOf(START);
  const end = start >= 0 ? text.indexOf(END, start) : -1;
  if (start >= 0 && end >= 0) {
    const after = text.startsWith('\r\n', end + END.length) ? 2 : text.startsWith('\n', end + END.length) ? 1 : 0;
    const next = text.slice(0, start) + own + text.slice(end + END.length + after);
    if (next === text) return { file: path, status: 'unchanged' };
    writeFileSync(path, next);
    return { file: path, status: 'updated' };
  }
  const sep = !text.length ? '' : text.endsWith(eol + eol) ? '' : text.endsWith(eol) ? eol : eol + eol;
  writeFileSync(path, text + sep + own);
  return { file: path, status: 'added' };
}
