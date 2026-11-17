// The risk ledger of `council build`: how the three seats' risk lists are read, and how the harness checks that
// every risk ended as a test or as a rejection backed by a quote. Pure functions, no model calls.
import { SeatName } from '../utils/prompts.js';

export interface Risk {
  /** R1, R2, ... in the order the risks were named, across seats and rounds. */
  id: string;
  seat: SeatName;
  /** "Claude", "Gemini", "Grok": the company whose model named the risk. */
  vendor: string;
  round: number;
  title: string;
  when: string;
  expect: string;
  where: string;
}

export type RiskOutcome =
  | { id: string; status: 'tested'; files: string[] }
  | { id: string; status: 'rejected'; quote: string; source: string }
  | { id: string; status: 'missing'; reason: string };

/** The ledger line a builder writes for a risk it may not test: `R4: REJECTED: "<quote>" (<task or path>)`. */
export const REJECTION_LINE = /^\s*[-*]?\s*\[?(R\d+)\]?\s*[:\-—–]\s*REJECTED\s*[:\-—–]?\s*["“](.+?)["”]\s*\(([^)]+)\)\s*$/i;
/** A quote shorter than this proves nothing: "the task" or "retry" appears everywhere. */
export const MIN_QUOTE_CHARS = 25;

const FIELD = (name: string) => new RegExp(`^\\s*(?:[-*>]\\s*)?(?:\\d+[.)]\\s*)?\\**\\s*${name}\\s*\\**\\s*:\\s*\\**\\s*(.*)$`, 'i');
const RISK_START = FIELD('RISK');
const FIELDS: Array<['when' | 'expect' | 'where', RegExp]> = [['when', FIELD('WHEN')], ['expect', FIELD('EXPECT')], ['where', FIELD('WHERE')]];

/**
 * Reads a seat's risk list. Each risk starts with a `RISK:` line, followed by `WHEN:`, `EXPECT:` and `WHERE:` lines
 * (markdown bullets, numbering and bold are tolerated). A risk without a WHEN or an EXPECT is not testable and is
 * dropped. Returns at most `limit` risks; ids are given later, when the lists are merged.
 */
export function parseRiskList(reply: string, limit: number): Array<Omit<Risk, 'id' | 'seat' | 'vendor' | 'round'>> {
  const out: Array<Omit<Risk, 'id' | 'seat' | 'vendor' | 'round'>> = [];
  let current: { title: string; when: string; expect: string; where: string; last: 'title' | 'when' | 'expect' | 'where' } | null = null;
  const flush = () => {
    if (current && current.title && current.when && current.expect) {
      out.push({ title: clean(current.title), when: clean(current.when), expect: clean(current.expect), where: clean(current.where) || '-' });
    }
    current = null;
  };
  for (const raw of reply.split('\n')) {
    const line = raw.replace(/`/g, '');
    const start = RISK_START.exec(line);
    if (start) {
      flush();
      current = { title: start[1], when: '', expect: '', where: '', last: 'title' };
      continue;
    }
    if (!current) continue;
    const field = FIELDS.find(([, re]) => re.test(line));
    if (field) {
      const value = field[1].exec(line)![1];
      current[field[0]] = value;
      current.last = field[0];
      continue;
    }
    if (!line.trim()) continue;
    // A continuation line of the field above (models wrap long sentences).
    if (/^\s{2,}\S/.test(raw) || !/^\s*([A-Z][A-Z ]+:|#)/.test(line)) {
      const key = current.last;
      current[key] = `${current[key]} ${line.trim()}`.trim();
    }
  }
  flush();
  return out.slice(0, Math.max(0, limit));
}

function clean(s: string): string {
  return s.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
}

/** Whether a reply says the seat found nothing, so an empty list is an answer rather than a format failure. */
export function saysNoRisks(reply: string): boolean {
  return /^\s*\**\s*NO RISKS\b/im.test(reply);
}

/** Paths that are test files in the usual layouts of JavaScript, TypeScript, Python, Go, Rust, Ruby and Java projects. */
export const TEST_PATH = /(^|\/)(test|tests|__tests__|spec|specs)\/|[._-](test|spec)\.[cm]?[jt]sx?$|_test\.(go|py|rb)$|(^|\/)test_[^/]*\.py$|Tests?\.(java|kt|cs)$/i;

/** A test that does not run: skipped, todo, xit, pytest skip/xfail, Go t.Skip, Rust #[ignore]. */
export const SKIP_MARKER = /\b(it|test|describe|suite|context)\s*\.\s*(skip|todo|fixme)\s*\(|\bx(it|test|describe)\s*\(|[{,]\s*(skip|todo)\s*:\s*(true|['"`])|@pytest\.mark\.(skip|skipif|xfail)\b|\bpytest\.skip\s*\(|\bt\.Skip(Now|f)?\s*\(|#\[ignore\]|@(Disabled|Ignore)\b/;

/** The risk ids a piece of text tags, as `[R3]`, `[R3][R5]` or `[R3, R5]`. */
export function taggedIds(text: string): Set<string> {
  const ids = new Set<string>();
  for (const m of text.matchAll(/\[\s*(R\d+(?:\s*[,/ ]\s*R\d+)*)\s*\]/gi)) {
    for (const id of m[1].split(/[,/ ]+/)) if (id.trim()) ids.add(id.trim().toUpperCase());
  }
  return ids;
}

/** Collapses whitespace and quote styles so a quote copied across a line break still matches. */
export function normalizeForQuote(s: string): string {
  return s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[*`]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

export interface LedgerInput {
  risks: Risk[];
  /** RISKS.md as the builder left it ('' when there is none). */
  ledger: string;
  /** Test files changed or added since the base commit, with their current content. */
  testFiles: Array<{ path: string; content: string }>;
  /** Text a rejection may quote: the task, and every text file tracked at the base commit. */
  quotable: Array<{ source: string; text: string }>;
  /** Everything the gates printed, to confirm each tagged test ran. Empty when the gates did not run. */
  gateOutput: string;
}

/**
 * Decides, for every risk, whether it ended as a required test, a rejection whose quote the harness found word for word
 * in the task or the repository, or neither. Neither blocks the build.
 *
 * A risk is "tested" when a test file changed since the base commit tags its id, and the gates' output shows that file
 * or the tag (so the test was actually run by the project's test command).
 */
export function checkLedger(input: LedgerInput): RiskOutcome[] {
  const rejections = new Map<string, { quote: string; source: string }>();
  for (const line of input.ledger.split('\n')) {
    const m = REJECTION_LINE.exec(line);
    if (m) rejections.set(m[1].toUpperCase(), { quote: m[2], source: m[3].trim() });
  }
  const output = input.gateOutput;
  const outcomes: RiskOutcome[] = [];
  for (const risk of input.risks) {
    const files = input.testFiles.filter(f => taggedIds(f.content).has(risk.id));
    if (files.length > 0) {
      const ran = output.includes(`[${risk.id}]`) || new RegExp(`\\[[^\\]]*\\b${risk.id}\\b[^\\]]*\\]`).test(output)
        || files.some(f => output.includes(f.path) || output.includes(f.path.split('/').pop()!));
      if (!output || ran) {
        outcomes.push({ id: risk.id, status: 'tested', files: files.map(f => f.path) });
      } else {
        outcomes.push({ id: risk.id, status: 'missing', reason: `a test tags [${risk.id}] in ${files.map(f => f.path).join(', ')}, but the test command's output never shows that test or its file, so it may not run` });
      }
      continue;
    }
    const rejection = rejections.get(risk.id);
    if (rejection) {
      const quote = normalizeForQuote(rejection.quote);
      if (quote.length < MIN_QUOTE_CHARS) {
        outcomes.push({ id: risk.id, status: 'missing', reason: `the rejection quotes only ${quote.length} characters; quote at least ${MIN_QUOTE_CHARS}, word for word, from the task or a file in the repository` });
        continue;
      }
      const found = input.quotable.find(q => normalizeForQuote(q.text).includes(quote));
      if (found) {
        outcomes.push({ id: risk.id, status: 'rejected', quote: rejection.quote, source: found.source });
      } else {
        outcomes.push({ id: risk.id, status: 'missing', reason: `the rejection's quote ("${rejection.quote.slice(0, 80)}") is not in the task or in any file of the repository at the base commit` });
      }
      continue;
    }
    outcomes.push({ id: risk.id, status: 'missing', reason: `no test tags [${risk.id}], and RISKS.md has no rejection for it` });
  }
  return outcomes;
}

/** Added lines of a unified diff that skip a test, as "file: line". */
export function skippedTests(diff: string): string[] {
  const hits: string[] = [];
  let file = '';
  for (const line of diff.split('\n')) {
    const header = /^\+\+\+ b\/(.*)$/.exec(line);
    if (header) { file = header[1]; continue; }
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    if (TEST_PATH.test(file) && SKIP_MARKER.test(line)) hits.push(`${file}: ${line.slice(1).trim().slice(0, 120)}`);
  }
  return hits;
}

/** One Markdown table of the ledger, for the build report and the pull request body. */
export function ledgerTable(risks: Risk[], outcomes: RiskOutcome[]): string {
  if (risks.length === 0) return 'No seat named a risk.';
  const byId = new Map(outcomes.map(o => [o.id, o]));
  const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
  const rows = risks.map(r => {
    const o = byId.get(r.id);
    const status = !o ? 'not checked' : o.status === 'tested' ? `test in ${o.files.map(f => `\`${f}\``).join(', ')}` : o.status === 'rejected' ? `rejected, quoting ${o.source}: "${cell(o.quote).slice(0, 100)}"` : `MISSING: ${o.reason}`;
    return `| ${r.id} | ${r.vendor} | ${cell(r.title)} | ${cell(status)} |`;
  });
  return ['| Risk | Named by | What could go wrong | How it ended |', '| :--- | :--- | :--- | :--- |', ...rows].join('\n');
}
