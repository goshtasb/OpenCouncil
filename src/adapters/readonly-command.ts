// Decides whether a shell command a read-only seat asks to run only reads. Used to answer an agent's
// "may I run this?" ask, never to run anything ourselves. A seat that cannot list or search the repo
// cannot review it, so plain read commands are allowed; everything else is refused.
//
// It is an allow-list, and deliberately narrow: a command passes only when every part of it is one of
// the commands below, with no argument that writes, runs another program or changes state. Anything
// the parser does not fully understand (redirection, command substitution, chaining, globs that
// expand to options, environment assignments, a path to a binary) is refused. A refused read costs
// the seat one tool call; an allowed write would break the read-only promise.

const SIMPLE = new Set(['ls', 'cat', 'head', 'tail', 'wc', 'pwd', 'grep', 'egrep', 'fgrep', 'stat', 'du']);

const FIND_FORBIDDEN = new Set(['-exec', '-execdir', '-ok', '-okdir', '-delete', '-fprint', '-fprint0', '-fprintf', '-fls']);

const GIT_READ_SUBCOMMANDS = new Set(['log', 'show', 'diff', 'status', 'ls-files', 'blame', 'grep', 'rev-parse', 'shortlog', 'cat-file', 'ls-tree']);
// Arguments that write a file or run another program, even under a read subcommand.
const GIT_FORBIDDEN = /^(--output|-o$|--ext-diff|--textconv|--exec|--upload-pack|--open-files-in-pager|-O)/;

// Characters that mean more than one command, redirection, substitution or escaping.
const SHELL_META = /[><;&`$(){}\\\n\r*?[\]!#]/;

/** Splits one pipeline segment into words, honouring plain single and double quotes. Null if unclear. */
function words(segment: string): string[] | null {
  const out: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let inWord = false;
  for (const ch of segment) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; inWord = true; continue; }
    if (ch === ' ' || ch === '\t') {
      if (inWord) { out.push(current); current = ''; inWord = false; }
      continue;
    }
    current += ch;
    inWord = true;
  }
  if (quote) return null;
  if (inWord) out.push(current);
  return out;
}

/** Removes quoted text so SHELL_META only sees what the shell would interpret. Null if unclear. */
function unquoted(command: string): string | null {
  let out = '';
  let quote: '"' | "'" | null = null;
  for (const ch of command) {
    if (quote) {
      // Inside double quotes the shell still expands $ and `.
      if (quote === '"' && (ch === '$' || ch === '`' || ch === '\\')) return null;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    out += ch;
  }
  return quote ? null : out;
}

function segmentIsReadOnly(argv: string[]): boolean {
  const [cmd, ...args] = argv;
  if (!cmd || cmd.includes('/') || cmd.includes('=')) return false;
  // A leading ~ is the home directory, outside the workspace (HEAD~1 is fine).
  if (args.some(a => a.startsWith('~'))) return false;
  if (SIMPLE.has(cmd)) return true;
  // --pre and --hostname-bin make rg run another program.
  if (cmd === 'rg') return !args.some(a => a.startsWith('--pre') || a.startsWith('--hostname-bin'));
  if (cmd === 'find') return !args.some(a => FIND_FORBIDDEN.has(a));
  if (cmd === 'git') {
    let i = 0;
    while (args[i] === '--no-pager') i++;
    const sub = args[i];
    if (!sub || !GIT_READ_SUBCOMMANDS.has(sub)) return false;
    return !args.slice(i + 1).some(a => GIT_FORBIDDEN.test(a));
  }
  return false;
}

/** True only when the command is a pipeline of allow-listed read commands. */
export function isReadOnlyCommand(command: string | undefined): boolean {
  if (!command || !command.trim()) return false;
  const bare = unquoted(command);
  if (bare === null || SHELL_META.test(bare) || /\|\|/.test(bare)) return false;
  // Split on the pipes outside quotes.
  const segments: string[] = [];
  let current = '';
  let quote: string | null = null;
  for (const ch of command) {
    if (quote) { if (ch === quote) quote = null; current += ch; continue; }
    if (ch === '"' || ch === "'") { quote = ch; current += ch; continue; }
    if (ch === '|') { segments.push(current); current = ''; continue; }
    current += ch;
  }
  segments.push(current);
  return segments.every(segment => {
    const argv = words(segment.trim());
    return !!argv && argv.length > 0 && segmentIsReadOnly(argv);
  });
}
