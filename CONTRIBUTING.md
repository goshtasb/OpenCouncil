# Contributing

Thanks for taking a look. This is a young project and the most useful contributions right now are provider adapters, verification gates, and evidence that the council behaves (or misbehaves) on real work.

## Getting set up

```bash
git clone https://github.com/goshtasb/OpenCouncil.git
cd OpenCouncil
npm ci
npm run build
npm test            # 66 tests, no model calls, no network
```

macOS or Linux, Node 18+. Windows is not supported: gates and project commands run through a POSIX shell (use WSL).

To use it elsewhere without cloning, install from npm (`npm install -g open-council`) or the release tarball on the [releases page](https://github.com/goshtasb/OpenCouncil/releases); both ship the compiled `dist/`, so nothing is built on your machine.

Installing from a git URL (`npm i -g github:goshtasb/OpenCouncil`) does **not** work: the package has no install-time build step, by design (npm 11 refuses install scripts for global installs). Use npm, the tarball or a clone.

To try it against a repository:

```bash
node bin/council.js init      # detects installed CLIs; --solo puts every seat on Claude Code
node bin/council.js doctor    # asks each configured seat for a live reply; prints the fix for each failure
```

`doctor` is the fastest way to find out whether your CLIs and model ids are right before spending a session.

## How it fits together

```
src/adapters/    one file per provider CLI (claude-code, grok-cli, antigravity, gemini-cli, ollama); registry wraps each in a one-shot retry
src/engine/      council loop, sign-off gate, execution, verification gates, session state
src/commands/    CLI surface, grouped by area
src/setup.ts     seat planning for `init`: which CLIs exist, which seat each holds, how config.yml is rendered
templates/       personas, reply contracts, engineering standards copied into a project by `init`
skills/          the `council` skill: the Claude Code plugin command and what `npx skills add` installs
.claude-plugin/  plugin and marketplace manifests (the repository is its own marketplace)
test/            node:test suite; seats are scripted fakes, so tests are deterministic and free
```

Two rules the code holds to:

1. **Nothing reaches the Operator without unanimous, hash-bound sign-off.** `checkAllSignoffs` is the single place that decides, and both `finalize` and `approve` consult it. If you touch that path, add a test that proves a document with an open objection or an unresolved concern cannot be approved.
2. **Never report success that did not happen.** Failed gates, failed pushes and missing commits end as `BLOCKED`, never `DONE`. This is the project's oldest bug class — the harness used to mark sessions done when the pull request had failed.

## Tests

`npm test` runs everything against scripted seats (`test/helpers.cjs`), so a contribution never needs API credit to be reviewable. Use `setup({ pm: [...], eng: [...], arch: [...] })` to script a council, and assert on what the seats were sent, not just the outcome.

If you change something a model sees — a persona, a contract, the standards — add an assertion to `test/standards-coverage.test.cjs` so it cannot be dropped silently later.

## Adding a provider adapter

Implement `AgentAdapter` in `src/adapters/`, register it in `registry.ts`, and set `canDisableTools` from what the CLI *actually does*, not what its flags claim. Verify it: ask the CLI, with tools nominally disabled, to read a file and report the contents. `agy` and `gemini-cli` fail this, which is why neither may hold the Chief Architect seat.

Adapters must honor `permissionMode`: `plan` is read-only research, `exec` may edit, `auto` is full autonomy (only ever used inside the isolated execution clone), and no mode at all means no tools.

## Adding a verification gate

Gates are commands in `.council/config.yml` — no code needed:

```yaml
verification:
  gates:
    - name: "dependency-audit"
      command: "npm audit --audit-level=high"
      standard: "12-point #3 Software Supply Chain"
```

Gate recipes for other stacks (Python, Go, Rust) are welcome in the commented catalogue that `init` ships.

## Reporting a council that went wrong

The most valuable bug report includes the session directory from `~/.council/projects/<repo>-<hash>/sessions/<id>/`: it holds every prompt, every reply, the verdicts, the rulings and the verification evidence. Redact anything private first — prompts contain your repository's contents.

Useful things to say: which seats and models, how many rounds, and whether it stalled, looped, or agreed on something wrong.

## Honest state of the project

- Full councils have run end to end, including opening a real pull request, but the live sample is small (single digits). Before v0.2.0 one run in five stalled without producing a document; v0.2.0 keeps the last draft and open objections on a stall, arbitrates early when objections stop dropping, and retries a seat that returns nothing. The effect on the stall rate is not yet measured.
- Solo mode (every seat on Claude Code) is new in v0.2.0 and has fewer live runs than the three-CLI council.
- A full run takes roughly 10–40 minutes and consumes real subscription quota; the quick profile is bounded at 4 rounds.
- `gemini-cli` is unusable on current individual Gemini tiers; use the Antigravity CLI (`agy`) for Gemini seats.
- The Ollama adapter is implemented but experimental: it has never completed a live council.
- `signoff_revisions` (extra rounds to answer sign-off concerns) is covered by tests but has not yet fired in a live run.

If you hit any of these, saying so in an issue is a contribution.
