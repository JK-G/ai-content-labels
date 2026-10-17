// ai-content-labels as a Node library: import { labelImage, decide, renderLabel } from 'ai-content-labels'.
// Stamping and PNG output need the optional dependency sharp; everything else has no dependencies.
export { decide, nextStep, SOURCES } from './decide.mjs';
export { renderLabel, officialIcon, labelSentence, composeAlt, POSITIONS, EU_ICONS, EU_VARIANTS } from './render.mjs';
export { renderHtml, LABEL_CSS } from './html.mjs';
export { stampImage, stampBuffer, labelledAs, autoHeight } from './stamp.mjs';
export { labelImage, NeedsAnswer } from './label.mjs';
export { render, stamp, stampFrom, alt, eu, icons, doctor } from './api.mjs';
export { fetchImage, decodeBase64, isPrivateAddress, MAX_BYTES } from './source.mjs';
export { KINDS, MEDIA, EU_LANGS, UsageError } from './i18n.mjs';
export { agentInstructions } from './init.mjs';
export { VERSION } from './version.mjs';
