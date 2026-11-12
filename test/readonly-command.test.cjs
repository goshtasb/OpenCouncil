const test = require('node:test');
const assert = require('node:assert/strict');
const { isReadOnlyCommand } = require('../dist/adapters/readonly-command.js');

test('read-only commands a reviewing seat needs are allowed', () => {
  for (const cmd of [
    "find . -type f -not -path './.git/*' | head -200", // the exact ask a real agy plan seat made (Nov 2026)
    'ls -la',
    'ls src',
    'cat README.md',
    'head -n 40 src/index.ts',
    'wc -l src/a.ts src/b.ts',
    'grep -rn "TODO" src',
    "rg -n 'runPrompt' src | head -20",
    'git log --oneline -5',
    'git --no-pager diff HEAD~1',
    'git show HEAD:src/a.ts',
    'git status --short',
    'pwd',
  ]) assert.equal(isReadOnlyCommand(cmd), true, cmd);
});

test('anything that writes, runs another program, chains or the parser cannot read is refused', () => {
  for (const cmd of [
    'echo hi > x', 'cat a >> b', 'cat < a', 'rm -rf .', 'touch x', 'mkdir x', 'mv a b', 'cp a b', 'tee x',
    'sed -i s/a/b/ f', 'sort -o out in', 'ls | xargs rm', 'ls; rm x', 'cat x && rm y', 'ls || rm x', 'ls & rm x',
    'cat $(rm x)', 'cat `rm x`', 'grep "$(rm x)" f', 'grep "\\x" f',
    'find . -delete', 'find . -exec rm {} ;', 'find . -execdir sh -c x ;', 'find . -fprint out',
    'git commit -m x', 'git checkout -- .', 'git push', 'git -c core.pager=sh log', 'git -C /tmp log',
    'git diff --output=x', 'git log --ext-diff', 'git branch -D main', 'git config user.name x',
    'rg --pre sh foo', 'rg --hostname-bin=sh foo', '/bin/rm x', './script.sh', 'FOO=1 ls', 'node -e x', 'sh -c ls',
    'ls *.ts', 'cat ~/.ssh/id_rsa', "cat 'unterminated", '', '   ',
  ]) assert.equal(isReadOnlyCommand(cmd), false, cmd);
  assert.equal(isReadOnlyCommand(undefined), false);
});
