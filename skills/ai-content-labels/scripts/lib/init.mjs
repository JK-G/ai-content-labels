import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// A short block for the instruction files agents read (AGENTS.md, GEMINI.md, CLAUDE.md,
// .github/copilot-instructions.md), so an agent that makes images labels them without being asked.

export const START = '<!-- ai-content-labels:start -->';
export const END = '<!-- ai-content-labels:end -->';

const BODY = `## Labelling AI images

When you generate or edit an image that will be published, label it before you hand it over:

\`\`\`
ai-labels label <image> --realistic --description "what the image shows"
\`\`\`

If \`ai-labels\` is not installed, run \`npx -y -p github:JK-G/ai-content-labels ai-labels label ...\` with the same options. If the ai-content-labels MCP server is connected, call its \`label_image\` tool instead.

- Answer the realism question honestly. Use \`--realistic\` when people could take the image for a real photo or event (a person, product or place that does not exist but could counts). Use \`--no-realistic\` for images that are clearly illustrated, stylised or impossible. If you cannot tell, ask the user.
- Add \`--modified\` when AI changed a real photo or a human-made image instead of making it from scratch.
- The command picks the smallest legible label and the least invasive spot (bottom right first). If only part of the image is AI, such as a generated photo inside a designed graphic, add \`--region x,y,width,height\` with that part's box. For a branded graphic, \`--color auto\` matches the label to its colours.
- Publish the alt text the command returns (what the image shows, then the label sentence) with the image.
- Never put a human-made label on anything AI generated or changed.`;

export const agentInstructions = () => `${START}\n${BODY}\n${END}\n`;

// Appends the block to file, or replaces an older copy between the markers. Running it twice changes
// nothing. Returns what happened: "created", "added", "updated" or "unchanged".
export function writeInstructions(file = 'AGENTS.md') {
  const path = resolve(file);
  const block = agentInstructions();
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
