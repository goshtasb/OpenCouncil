// Prompts of `council build`. Kept apart from the engine so tests and replays can read them.
import { EXECUTION_CLAIMS_INSTRUCTION } from './claims.js';
import { Risk, RiskOutcome } from './build-risks.js';

export const RISK_LEDGER_FILE = 'RISKS.md';

/** The builder's first run: the task as given, with the few rules the harness needs. Close to what one agent alone gets. */
export function buildPrompt(input: { task: string; branch: string; testCommand: string; installArtifacts: string[] }): string {
  return [
    input.task.trim(),
    '',
    '---',
    `You are on branch ${input.branch} in an isolated clone of the repository. Commit your work to this branch with clear messages. Do not push and do not open a pull request.`,
    `Run the project's tests (\`${input.testCommand}\`) before you finish, and leave them passing.`,
    ...(input.installArtifacts.length ? [`The dependency install step created these untracked files; leave them uncommitted: ${input.installArtifacts.join(', ')}.`] : [])
  ].join('\n');
}

/** What each of the three seats is asked after the build: the ways this change can still be wrong, as testable risks. */
export function riskPrompt(input: {
  task: string;
  diff: string;
  diffTruncated: boolean;
  files: string[];
  testCommand: string;
  limit: number;
  round: number;
  earlier: Array<{ risk: Risk; outcome?: RiskOutcome }>;
}): string {
  const earlier = input.earlier.length
    ? [
        '## Risks already named and how they ended',
        'Do not name these again. If a test below does not really catch its risk, name the risk again as a new one and say which test misses it.',
        ...input.earlier.map(({ risk, outcome }) => `- ${risk.id} (${risk.vendor}): ${risk.title} -> ${!outcome ? 'not checked' : outcome.status === 'tested' ? `tested in ${outcome.files.join(', ')}` : outcome.status === 'rejected' ? `rejected, quoting "${outcome.quote}" (${outcome.source})` : 'not tested'}`),
        ''
      ]
    : [];
  return [
    `You are one of three reviewers, each from a different AI company. Another agent has already built the change below${input.round > 1 ? ' and written tests for the risks named so far' : ''}. Your job is to name the ways it can still be wrong. Every risk you name becomes a test the change must pass before it ships, so name only what a test in this repository can show.`,
    '',
    'You are in a read-only checkout of the repository with the change applied. Read the code: the files the change touches, every caller of what it changed, the tests, and the docs and comments that describe how things must behave.',
    '',
    'Look hardest at:',
    '- other code in this repository that calls what changed, or that runs it again later (a retry, a scheduled job, a second request, a rerun the next day), and what that caller expects;',
    '- edge cases the task implies: repeats and duplicates, concurrency, limits and empty values, time zones and dates, money rounding, pagination, old data next to new data;',
    '- rules written in docs, comments, schemas or existing tests that the change must keep.',
    '',
    `Name at most ${input.limit} risks, the most likely to be real first. Leave out style, naming, docs, refactors and features nobody asked for. Each EXPECT must follow from the task or from something in this repository: cite it in WHERE. A comment or doc that says something is handled elsewhere is a claim, not proof.`,
    '',
    'Answer in exactly this format, one block per risk, and nothing else:',
    '',
    'RISK: <one line: what goes wrong>',
    'WHEN: <the concrete inputs or sequence of calls that shows it>',
    'EXPECT: <what the code must do instead, as a test would assert it>',
    'WHERE: <file:line of the code at fault, and file:line of the evidence for EXPECT>',
    '',
    'If you find nothing a test could show, answer exactly: NO RISKS',
    '',
    ...earlier,
    '## Task the change was built for',
    input.task.trim(),
    '',
    `## The change (${input.files.length} file${input.files.length === 1 ? '' : 's'}: ${input.files.join(', ')})`,
    `The project's tests run with \`${input.testCommand}\`.${input.diffTruncated ? ' The diff below is cut short; read the rest from the checkout.' : ''}`,
    '',
    '```diff',
    input.diff,
    '```'
  ].join('\n');
}

/** The builder's run after a risk round: every risk becomes a required test, with no deferring. */
export function riskTestPrompt(input: { risks: Risk[]; testCommand: string; branch: string; feedback: string[] }): string {
  return [
    'Three reviewers, each from a different AI company, read your change and named the risks below. Every one of them is now a required test.',
    '',
    'For each risk:',
    `1. Write a test that fails if the risk is real. Put the risk id in square brackets in the test's name, for example: test('[${input.risks[0]?.id || 'R1'}] a renewal retried the next day is charged once', ...). One test may cover several risks: '[R2][R5] ...'.`,
    `2. Run the tests with \`${input.testCommand}\`. If a risk test fails, fix the code, not the test, until it passes. If it passes on the code as it is, the risk was already handled: keep the test anyway.`,
    '',
    'No deferring. Do not skip a test, mark it todo, comment it out, or leave a risk for a follow-up, a later ticket or another team. A risk that seems unlikely, out of scope or expensive still gets its test.',
    `The one exception: a risk that demands behaviour the task or this repository contradicts. For that risk only, add a line to ${RISK_LEDGER_FILE} at the root of the repository (the harness keeps it out of git):`,
    '',
    'R4: REJECTED: "<words copied exactly from the task or from a file that was in the repository before your change>" (<task, or the file\'s path>)',
    '',
    'The harness checks that quote word for word against the task and the repository as they were before your change, so quote the sentence that contradicts the risk, not your own summary.',
    '',
    `Put the tests where \`${input.testCommand}\` runs them. Keep every test the project already had, and keep them passing. ${EXECUTION_CLAIMS_INSTRUCTION}`,
    `Commit everything to ${input.branch}. Do not push.`,
    '',
    ...input.feedback,
    ...(input.feedback.length ? [''] : []),
    '## Risks',
    '',
    ...input.risks.map(r => [`### ${r.id} (named by ${r.vendor})`, `RISK: ${r.title}`, `WHEN: ${r.when}`, `EXPECT: ${r.expect}`, `WHERE: ${r.where}`, ''].join('\n'))
  ].join('\n');
}
