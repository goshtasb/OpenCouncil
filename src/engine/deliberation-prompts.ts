// Functional core of the deliberation loop: pure prompt construction and reply splitting (no I/O).
import * as fs from 'fs';
import { hasHeading } from './verdicts.js';

export const REVISED_DOCUMENT_MARKER = '=== REVISED DOCUMENT ===';

export interface LeadDraftPromptInput {
  sessionId: string;
  version: number;
  task: string;
  previousPlan: string | null;
  feedback: string[];
  rulings: string[];
  worktreePath: string;
  baseSha: string;
}

export const ASK_ARCHITECT_INSTRUCTION =
  'If a rule you need is not defined by the standards, the constitution or an earlier Chief Architect ruling, do not assume and do not ask the Operator: add a line `QUESTION FOR ARCHITECT: <question>`. The Chief Architect\'s ruling is binding and will be given to every seat.';

export function buildLeadDraftPrompt(input: LeadDraftPromptInput): string {
  return [
    `# Council Draft v${input.version} — Session ${input.sessionId}`,
    '',
    '## Task (from the Operator)',
    input.task,
    '',
    ...(input.previousPlan ? [`## Your Previous Draft (v${input.version - 1})`, input.previousPlan, ''] : []),
    ...input.feedback,
    ...input.rulings,
    '## Instructions',
    `Your working directory (${input.worktreePath}) is a clean, read-only checkout of the repository at commit ${input.baseSha}. Research it before writing.`,
    `${ASK_ARCHITECT_INSTRUCTION} Put such lines before the document.`,
    input.previousPlan
      ? `Revise the draft. For every objection, ruling or concern above: adopt it and change the draft, or rebut it with cited evidence. Output a section headed "# Response to Objections" addressing each item by number, then a line containing exactly ${REVISED_DOCUMENT_MARKER}, then the complete revised document.`
      : 'Write the complete deliverable.',
    'The document must use exactly these top-level headings, in this order: "# Product Brief", "# PRD", "# Executive Summary". Output only Markdown, with no preamble.',
    'Print the complete document in your reply. Do not save it to a file, do not use plan-saving tooling, and do not reply with a summary or a path — only the text you print is read.'
  ].join('\n');
}

export interface EngineerRoundPromptInput {
  sessionId: string;
  round: number;
  maxRounds: number;
  task: string;
  plan: string;
  changes: string | null;
  feedback: string[];
  rulings: string[];
  worktreePath: string;
  baseSha: string;
}

export function buildEngineerRoundPrompt(input: EngineerRoundPromptInput): string {
  return [
    `# Council Round ${input.round} of at most ${input.maxRounds} — Session ${input.sessionId}`,
    '',
    '## Task (from the Operator)',
    input.task,
    '',
    `## Draft v${input.round} from the Council Lead`,
    input.plan,
    '',
    ...(input.changes ? ["## The Lead's Response to Your Previous Objections", input.changes, ''] : []),
    ...input.feedback,
    ...input.rulings,
    '## Instructions',
    `Your working directory (${input.worktreePath}) is a clean, read-only checkout at commit ${input.baseSha}. Verify the draft against the code, then reply per the advisory contract: the first two lines must be "VERDICT: ..." and "OPEN OBJECTIONS: <integer>".`,
    `${ASK_ARCHITECT_INSTRUCTION} A reply containing such a question does not converge.`
  ].join('\n');
}

export function splitLeadReply(reply: string): { changes: string | null; document: string } {
  let changes: string | null = null;
  let document = reply;
  const markerIndex = reply.indexOf(REVISED_DOCUMENT_MARKER);
  if (markerIndex !== -1) {
    changes = reply.slice(0, markerIndex).trim() || null;
    document = reply.slice(markerIndex + REVISED_DOCUMENT_MARKER.length);
  }
  // Drop any chatter before the first required heading.
  const lines = document.split('\n');
  const start = lines.findIndex(line => hasHeading(line, '# Product Brief'));
  if (start > 0) document = lines.slice(start).join('\n');
  // Drop a trailing code fence left by models that wrapped the document.
  document = document.replace(/\n```\s*$/, '\n');
  return { changes, document: document.trim() + '\n' };
}

/**
 * Some CLIs (Claude Code in plan mode) save the document and reply with a summary plus a path.
 * If the reply carries no document but names a readable Markdown file that does, use that file.
 */
export function recoverSavedDocument(reply: string): string {
  if (hasHeading(reply, '# Product Brief')) return reply;
  const paths = reply.match(/(?:^|[\s`'"(])(\/[^\s`'")]+\.md)/g) || [];
  for (const raw of paths) {
    const file = raw.trim().replace(/^[`'"(]/, '');
    try {
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
      const content = fs.readFileSync(file, 'utf8');
      if (hasHeading(content, '# Product Brief') && hasHeading(content, '# PRD')) {
        return reply.includes(REVISED_DOCUMENT_MARKER)
          ? `${reply.split(REVISED_DOCUMENT_MARKER)[0]}${REVISED_DOCUMENT_MARKER}\n${content}`
          : `${reply}\n${REVISED_DOCUMENT_MARKER}\n${content}`;
      }
    } catch {
      continue;
    }
  }
  return reply;
}
