const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const bin = path.join(__dirname, '..', 'bin', 'council.js');
const windowsMessage = 'Open Council needs macOS or Linux; on Windows, run it inside WSL\n';
const commands = [[], ['--help'], ['--version'], ['init'], ['doctor'], ['run'], ['not-a-command']];

function assertWindowsRejection(result) {
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, windowsMessage);
}

// Copy only the launcher; the CLI sentinel proves import without loading real commands or models.
function launcherFixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-platform-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'bin'));
  fs.mkdirSync(path.join(dir, 'dist'));
  const entry = path.join(dir, 'bin', 'council.js');
  fs.copyFileSync(bin, entry);
  fs.writeFileSync(path.join(dir, 'dist', 'cli.js'), 'process.stdout.write("CLI imported\\n");\n');
  return entry;
}

function runAs(platform, entry, args = []) {
  const script = `Object.defineProperty(process, 'platform', { value: ${JSON.stringify(platform)} });
    require(${JSON.stringify(entry)});`;
  return spawnSync(process.execPath, ['-e', script, '--', ...args], { encoding: 'utf8' });
}

test('native Windows rejects every command with the WSL message', { skip: process.platform !== 'win32' }, () => {
  for (const args of commands) {
    assertWindowsRejection(spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8' }));
  }
});

test('win32 exits before importing the CLI', (t) => {
  const entry = launcherFixture(t);
  for (const args of commands) {
    assertWindowsRejection(runAs('win32', entry, args));
  }
});

for (const platform of ['darwin', 'linux', 'freebsd']) {
  test(`${platform} reaches the CLI import`, (t) => {
    const result = runAs(platform, launcherFixture(t));
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'CLI imported\n');
    assert.equal(result.stderr, '');
  });
}
