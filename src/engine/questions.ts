import * as fs from 'fs';
import * as path from 'path';
import { ArchitectRuling, CouncilConfig } from '../types.js';
import { SessionManager } from './session.js';
import { getAdapter } from '../adapters/registry.js';
import { buildSystemPrompt, FIELD_SEPARATOR, protocolLines } from '../utils/prompts.js';
import { logger } from '../utils/logger.js';

/** Lines of the form `QUESTION FOR ARCHITECT: <question>` (optionally numbered) in any seat's reply. */
export function extractArchitectQuestions(text: string): string[] {
  return protocolLines(text)
    .map(line => line.match(/^QUESTION FOR ARCHITECT(?:\s+\d+)?\s*:\s*(.+)$/i))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map(m => m[1].trim())
    .filter(Boolean);
}

export function parseArchitectAnswers(reply: string): Map<number, string> {
  const answers = new Map<number, string>();
  const re = new RegExp(`^ANSWER\\s+(\\d+)\\s*:\\s*(.+)$`, 'i');
  for (const line of protocolLines(reply)) {
    const m = line.match(re);
    if (m && !answers.has(parseInt(m[1], 10))) answers.set(parseInt(m[1], 10), m[2].replace(new RegExp(`^(?:${FIELD_SEPARATOR})`), '').trim());
  }
  return answers;
}

/** Renders every binding ruling of the session for inclusion in any seat's prompt. */
export function formatArchitectRulings(rulings: ArchitectRuling[]): string[] {
  if (rulings.length === 0) return [];
  return [
    '## Binding Chief Architect Rulings on Undefined Rules',
    'These answer questions that no standard, constitution rule or earlier ruling settled. Every seat must follow them.',
    ...rulings.map(r => `- R${r.id} (asked by ${r.askedBy}, ${r.stage}): ${r.question}\n  RULING: ${r.ruling}`),
    ''
  ];
}

/**
 * Routes questions about undefined rules to the Chief Architect — never to the Operator.
 * Rulings are appended to the session and shown to every seat from then on.
 */
export class ArchitectQuestionEngine {
  private config: CouncilConfig;
  private sessionManager: SessionManager;

  constructor(config: CouncilConfig, sessionManager?: SessionManager) {
    this.config = config;
    this.sessionManager = sessionManager || new SessionManager();
  }

  async ask(sessionId: string, askedBy: string, stage: string, questions: string[], context: string): Promise<ArchitectRuling[]> {
    if (questions.length === 0) return [];
    const meta = this.sessionManager.loadMeta(sessionId);
    const sessionDir = this.sessionManager.getSessionPath(sessionId);
    const seq = fs.readdirSync(sessionDir).filter(d => /^questions-\d{2}$/.test(d)).length + 1;
    const dir = path.join(sessionDir, `questions-${String(seq).padStart(2, '0')}`);
    fs.mkdirSync(dir, { recursive: true });

    const basePrompt = [
      `# Undefined-Rule Questions — Session ${sessionId}`,
      `Asked by: ${askedBy} (${stage})`,
      '',
      '## Task (from the Operator)',
      this.sessionManager.loadTask(sessionId) || '(No task statement recorded.)',
      '',
      '## Context',
      context,
      '',
      ...formatArchitectRulings(this.sessionManager.loadArchitectRulings(sessionId)),
      '## Questions',
      ...questions.map((q, i) => `QUESTION ${i + 1}: ${q}`),
      '',
      '## Instructions',
      'Answer every question per the Undefined-Rule contract: one line each, `ANSWER <n>: <binding rule> — <reason>`.'
    ].join('\n');

    const architect = this.config.seats.chief_architect;
    const adapter = getAdapter(architect.provider);
    const answers = new Map<number, string>();
    for (let attempt = 1; attempt <= 2 && answers.size < questions.length; attempt++) {
      const missing = questions.map((_, i) => i + 1).filter(n => !answers.has(n));
      const prompt = attempt === 1 ? basePrompt : `${basePrompt}\n\n## Correction\nNo parseable answer was given for question(s) ${missing.join(', ')}. Answer them now.`;
      fs.writeFileSync(path.join(dir, `prompt${attempt > 1 ? `-${attempt}` : ''}.md`), prompt, 'utf8');
      logger.council('CHIEF ARCHITECT', `Ruling on ${missing.length} undefined-rule question(s) from ${askedBy}...`);
      this.sessionManager.setActivity('chief_architect', 'busy', `Ruling on questions from ${askedBy}`);
      let reply: string;
      try {
        reply = await adapter.runPrompt(prompt, {
          cwd: sessionDir,
          model: architect.model,
          systemPrompt: buildSystemPrompt(this.config, 'chief_architect', 'question', meta.repoPath),
          timeoutSeconds: this.config.council.round_timeout_seconds
        });
      } finally {
        this.sessionManager.setActivity('chief_architect', 'idle', 'Guarding standards');
      }
      fs.writeFileSync(path.join(dir, `reply${attempt > 1 ? `-${attempt}` : ''}.md`), reply, 'utf8');
      for (const [n, text] of parseArchitectAnswers(reply)) {
        if (n >= 1 && n <= questions.length && !answers.has(n)) answers.set(n, text);
      }
    }
    if (answers.size < questions.length) {
      throw new Error(`Chief Architect did not answer every question (see ${dir}). The session stays open; re-run to retry.`);
    }

    const added = this.sessionManager.appendArchitectRulings(
      sessionId,
      questions.map((question, i) => ({ askedBy, stage, question, ruling: answers.get(i + 1)! }))
    );
    this.sessionManager.logEvent(sessionId, `Chief Architect issued ${added.length} ruling(s) for ${askedBy} (${stage}).`);
    return added;
  }
}
