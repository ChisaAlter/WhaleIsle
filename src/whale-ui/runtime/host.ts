import { validateWhaleDocument } from './validate.ts';
import type { SourceLanguage } from '../viewer/protocol.ts';

function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
const languages = new Set<SourceLanguage>(['whale-ui', 'openui', 'openui-lang', 'dsh-ui']);

/** A complete program is persisted as tool-owned presentation metadata for replay. */
export const renderUiTool = {
  name: 'render_ui',
  description: 'Display a self-contained interactive interface in the current conversation. Pass a complete Whale UI program or an existing declarative spec. Use real data already obtained with the available tools. Local controls run locally; message actions return to this conversation.',
  parameters: { type: 'object', properties: {
    program: { type: 'string', description: 'A complete Whale UI language program, starting with root = Col(...).' },
    language: { type: 'string', enum: ['whale-ui', 'openui', 'openui-lang', 'dsh-ui'], description: 'Defaults to whale-ui for a program and dsh-ui for a spec.' },
    spec: { type: 'object', description: 'An existing declarative interface specification. Supply exactly one of program or spec.', additionalProperties: true },
  }, additionalProperties: false },
  output: {
    schema: { type: 'object', properties: { version: { type: 'integer', const: 1 }, language: { type: 'string' }, program: { type: 'string' } }, required: ['version', 'language', 'program'], additionalProperties: false },
    render(_args: unknown, _value: unknown) { return [{ type: 'text', text: 'The interactive interface is ready in this conversation.' }]; },
    presentationMeta(_args: unknown, value: unknown) { return { whaleUi: value }; },
  },
  async execute(args: unknown) {
    if (!record(args) || (typeof args.program === 'string') === record(args.spec)) throw new Error('Supply exactly one complete program or declarative spec.');
    const program = typeof args.program === 'string' ? args.program : JSON.stringify(args.spec);
    const language = args.language === undefined ? (record(args.spec) ? 'dsh-ui' : 'whale-ui') : args.language;
    if (typeof language !== 'string' || !languages.has(language as SourceLanguage)) throw new Error('The interface language is unsupported.');
    const result = validateWhaleDocument(program, language as SourceLanguage);
    if (!result.complete) throw new Error(`The interface is incomplete or invalid:\n${result.errors.join('\n')}`);
    return { version: 1, language, program };
  },
  isConcurrencySafe() { return true; },
  presentCall() { return { card: 'generic', title: 'Whale UI', kind: 'other' }; },
};
