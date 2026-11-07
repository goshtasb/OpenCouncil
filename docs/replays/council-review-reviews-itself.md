## Council review: review-feat-council-review

Outcome: **STALLED** after 3 rounds: the seats did not all sign off, so it would not ship as is (quick profile, base `82bfec6`).

### What the council found

1. **A review can reset the worktree under a session that is still running.** (`src/engine/council.ts:58`)  
   - Evidence: there is one research worktree per repo (`src/engine/council.ts:58`). Concurrent use is only prevented by the backlog WIP limit (`src/engine/pipeline.ts:71-77`), and that check runs only when `backlogItem` is set (`council.ts:48-50`). `runReview` calls `council.open` with no backlog item (`quick-review.ts`, in `runReview`).
   _Chief Engineer, round 1_

2. **The temporary worktree is never removed, so the reworded claim required by ruling R2 is false today.** (`src/engine/council.ts:59-60`)  
   - Evidence: `CouncilEngine.open` registers a worktree at `projectStateDir(repo)/worktree` (`src/engine/council.ts:59-60`). `createWorktree` only runs `git worktree prune` and then adds or resets that worktree (`src/utils/git.ts:31-43`). I found no `git worktree remove` anywhere in `src/` (grep of `src`).
   _Chief Engineer, round 1_

3. **The `--rounds` help text is wrong, and its behaviour (FR7) is untested.** (`src/setup.ts:115`)  
   - Evidence: `reviewConfig` clamps rounds to at least 2, but `CouncilEngine.open` with profile `quick` then also caps them at `QUICK_COUNCIL.max_rounds = 4` (`src/setup.ts:115`, `council.ts:71`). So `--rounds 10` silently runs at most 4 rounds, while the help says only "Round budget (default 3)" (`review.ts:34`).
   _Chief Engineer, round 1_

4. **Untracked files go to third-party providers whole, with no notice.**  
   - Evidence: `collectChange` adds a `--no-index` diff of every untracked file that `.gitignore` does not exclude, up to 16 MB each (`quick-review.ts`, `collectChange`: the `ls-files --others` loop). Before this change, seats only saw committed content through the worktree. This is the first path that ships uncommitted and untracked content such as a `.env` that is not gitignored.
   _Chief Engineer, round 1_

5. **Ruling R1 is not implemented: the shim and the rename are untested and not in the changelog.**  
   - Untested: I found no test that calls `council review <existing-session-id>` or `council architect-review` (grep of `test/review.test.cjs` and `test/`).
   _Chief Engineer, round 1_

### Every round

<details>
<summary>Chief Engineer, round 1: SHIP WITH CHANGES</summary>

```markdown
VERDICT: SHIP WITH CHANGES
OPEN OBJECTIONS: 5

**What I checked.** I built and tested a scratch copy of 82bfec6 with `git archive`, `npm ci`, `npm run build` and `npm test`. The build passed and tsc reported no type errors. 90 tests passed, 1 was skipped and 1 failed. All 9 tests in `test/review.test.cjs` passed. The one failure is `test/replay.test.cjs:132`, which asserts that `HISTORY.log` is tracked by git; it fails because my archive copy has no git index, not because of this change. I confirmed `chalk` is a declared dependency (`package.json:54`), so the Lead's "unverified" note on it can be closed. I also confirmed that `renderMarkdown` escapes raw HTML: `<img onerror>` comes out as `&lt;img…&gt;`. So the model-written headlines that `html.ts` passes through `renderInline` cannot inject markup.

1. **The temporary worktree is never removed, so the reworded claim required by ruling R2 is false today.**
   - Evidence: `CouncilEngine.open` registers a worktree at `projectStateDir(repo)/worktree` (`src/engine/council.ts:59-60`). `createWorktree` only runs `git worktree prune` and then adds or resets that worktree (`src/utils/git.ts:31-43`). I found no `git worktree remove` anywhere in `src/` (grep of `src`).
   - Result: after every `council review`, whether it completes or stalls, `git worktree list` in the user's repo shows the entry. The R2 measurement therefore already has an answer: a stale entry remains.
   - Required change: either remove the worktree at the end of `runReview` (in a `finally`, so a STALLED run or an error also cleans up), or say in `src/commands/review.ts:32` and `:79` that a git worktree stays registered at that path.
   - Test: R2 also requires a test asserting that `git status --porcelain` **and** `git for-each-ref` are identical before and after `runReview`. The current test checks only `status --porcelain` (`test/review.test.cjs`, in the runReview uncommitted test). Add `for-each-ref`, and also assert on `git worktree list` for whichever option is chosen.

2. **A review can reset the worktree under a session that is still running.**
   - Evidence: there is one research worktree per repo (`src/engine/council.ts:58`). Concurrent use is only prevented by the backlog WIP limit (`src/engine/pipeline.ts:71-77`), and that check runs only when `backlogItem` is set (`council.ts:48-50`). `runReview` calls `council.open` with no backlog item (`quick-review.ts`, in `runReview`).
   - Result: `createWorktree` then runs `git reset --hard`, `git clean -qfdx` and `git checkout --detach <HEAD>` on the worktree that a deliberating or executing session in the same repo is reading (`git.ts:34-36`).
   - Why it matters now: `council open` without a backlog item has the same exposure, but a zero-setup command that is meant to be re-run often makes the overlap likely.
   - Required change: give review sessions their own worktree path, for example `…/review-worktree/<sessionId>`, removed afterwards. That also resolves objection 1. The alternative is to refuse to start while another session for the repo is in a non-terminal state.
   - Test: start a session, then run `runReview` on the same repo, and assert the first session's worktree HEAD has not moved.

3. **Untracked files go to third-party providers whole, with no notice.**
   - Evidence: `collectChange` adds a `--no-index` diff of every untracked file that `.gitignore` does not exclude, up to 16 MB each (`quick-review.ts`, `collectChange`: the `ls-files --others` loop). Before this change, seats only saw committed content through the worktree. This is the first path that ships uncommitted and untracked content such as a `.env` that is not gitignored.
   - What the user sees: the `onSession` line reports only a file count (`src/commands/review.ts:52-55`).
   - Required change:
     - Print the full list of files whose content will be sent, and say that it goes to the configured providers. Do this before `DeliberationEngine.run`, not after.
     - Exclude untracked files that match common secret patterns (`.env*`, `*.pem`, `*.key`, `id_*`) and name the excluded files.
   - Test: an untracked `.env` in the repo is absent from `ctx.adapters.pm.calls[0].prompt` and is named in the output.
   - Also: the 120 KB cap is checked only after every untracked file has been read in full. Checking the size with `fs.statSync` first avoids reading a 16 MB file just to reject it.

4. **Ruling R1 is not implemented: the shim and the rename are untested and not in the changelog.**
   - Untested: I found no test that calls `council review <existing-session-id>` or `council architect-review` (grep of `test/review.test.cjs` and `test/`).
   - Not documented: `CHANGELOG.md` `[Unreleased]` has no entry for `review`, the rename, or the shim removal version.
   - Required change:
     - Add a CLI test: with a session created in `COUNCIL_HOME`, `council review <id>` exits 0, its stdout equals the stdout of `council architect-review <id>`, and its stderr contains the deprecation warning.
     - Confirm that `logger.warn` writes to stderr, as R1 requires; if it does not, switch the shim to `console.error`.
     - Add a changelog entry that names the release in which the shim is removed.

5. **The `--rounds` help text is wrong, and its behaviour (FR7) is untested.**
   - Evidence: `reviewConfig` clamps rounds to at least 2, but `CouncilEngine.open` with profile `quick` then also caps them at `QUICK_COUNCIL.max_rounds = 4` (`src/setup.ts:115`, `council.ts:71`). So `--rounds 10` silently runs at most 4 rounds, while the help says only "Round budget (default 3)" (`review.ts:34`).
   - Also: `--rounds abc` parses to NaN and silently falls back to 3 (`review.ts:47`).
   - Required change: state the 2–4 range in the help text, reject input that is not a number, and add tests for 1 → 2 and 10 → 4, asserting on the session meta's `maxRounds`.

**Notes (not objections)**
- On the Lead's S-01 point: this repo does not use the `features/` layout. The `replay` → `review` dependency is type-only (`import type`). Moving `TopObjection` into the `replay` module is still the cleaner fix.
- On S-02 §3: `quick-review.ts` has 268 lines. That is a review trigger, not a failure. Add a one-line justification at the top, or move `detectGates` into its own file.
- Lead gap 2 (a repo with no commits): `council.open` already fails earlier, at `getHeadSha`, so the wording of that error is cosmetic.
- Lead gap 6: `ReviewResult.outcome` reflects the type that `DeliberationEngine.run` returns. I did not confirm that the engine has no other terminal state.
- Further tests the Lead listed and that I agree with: `--base` through the CLI, `--out`, and the plain-numbered fallback in `engineerObjections`.

**Not checked:**
- Windows behaviour: `/dev/null` with `--no-index`, and the `cmd /c start` opener.
- A live review with real providers, including the p90 duration.
- `logger.warn` routing to stderr (left open in objection 4).
- `DeliberationEngine` terminal states beyond the declared type.
- Every `test/` file other than the full-suite run.
```

</details>

<details>
<summary>Lead PM: what changed in v2</summary>

```markdown
# Response to Objections

**R1 (shim ruling): adopted.**
- FR6 now requires a CLI test: `review <existing-id>` exits 0, its stdout equals `architect-review` stdout, and the warning appears on stderr.
- A changelog entry MUST name the minor release that removes the shim.
- The shim currently uses `logger.warn` (`src/commands/review.ts:~27`). Whether that writes to stderr is unverified. If it doesn't, switch to `console.error`.

**R2 (worktree wording): adopted.**
- The description (`review.ts:~32`) and the closing line (`~79`) MUST be reworded. They may claim only: "working tree, index, branches and config are not modified; a temporary git worktree is used."
- The test MUST compare `git status --porcelain` and `git for-each-ref` before and after.

**Objection 1 (worktree never removed): adopted.**
- Evidence accepted: `src/engine/council.ts:59-60` and `src/utils/git.ts:31-43`, with no `git worktree remove` in `src/`.
- `runReview` MUST remove its worktree in a `finally`, so a STALLED run or an error also cleans up.
- Until the removal ships, the wording MUST say a worktree stays registered.
- The test asserts on `git worktree list`.

**Objection 2 (reset of a live session's worktree): adopted.**
- Review sessions get their own worktree path, `…/review-worktree/<sessionId>`.
- Fallback if `CouncilEngine.open` cannot take a path without engine changes: refuse to start while another session for the repo is non-terminal. I have not verified which is smaller; the Chief Engineer should pick.
- The test starts a session, runs `runReview`, and asserts the first session's worktree HEAD has not moved.

**Objection 3 (egress and untracked files): adopted.** I had listed egress as a gap; it is now a requirement (FR8, below).
- The `fs.statSync` pre-check is adopted.

**Objection 4:** see R1 above.

**Objection 5 (`--rounds`): adopted.**
- Evidence accepted: the `quick` cap of 4 at `src/setup.ts:115` and `council.ts:71`, and the NaN fallback at `review.ts:47`.

**Notes**
- S-01 `TopObjection`: kept as a required change.
- S-02 §3: the one-line justification is adopted, or move `detectGates` out.
- Repo with no commits: cosmetic, since `getHeadSha` fails first. Dropped from the gaps.
- `chalk` is a declared dependency (`package.json:54`). Closed.
```

</details>

<details>
<summary>Chief Engineer, round 2: SHIP WITH CHANGES</summary>

```markdown
VERDICT: SHIP WITH CHANGES
OPEN OBJECTIONS: 2

1. **FR8 promises a disclosure the tool cannot keep, and its exclusion list misses tracked files.**
   - **Evidence:**
     - Every seat runs with `cwd: meta.worktreePath` (`src/engine/deliberation.ts:254`, `src/engine/signoff.ts:119`).
     - The prompt tells the seats to research the checkout (`src/engine/deliberation-prompts.ts:46,85`).
     - So any tracked file at HEAD can be read and sent to a provider, not just the files in the diff. "The full list of files whose content will be sent" cannot be known ahead of the run.
     - The exclusion also covers only untracked files. A modified tracked `.env` still goes into the quoted diff through `git diff HEAD` (`src/review/quick-review.ts:99`).
   - **Change required. Reword FR8 so that, before `DeliberationEngine.run` (the `onSession` callback at `quick-review.ts:258` is the right hook), the command:**
     - (a) lists the files whose content is quoted in the prompt;
     - (b) names the providers: `config.seats.*.provider` when a config exists, otherwise `plan.seats`;
     - (c) states that the seats can also read any file tracked at HEAD;
     - (d) applies the `.env*`, `*.pem`, `*.key` and `id_*` exclusions to tracked and untracked files alike. Each excluded file is named, and its hunk is dropped from the diff.
   - **Tests to add:** a modified tracked `.env` and an untracked `.env` are both absent from `pm.calls[0].prompt`, and both are named in the output.

2. **FR7 contradicts its own test, so nobody can tell what to build.**
   - **The conflict:**
     - FR7 says "MUST accept an integer from 2 to 4".
     - The test plan says `1 → maxRounds 2` and `10 → 4`, which is clamping.
     - Today's code does clamp: `Math.max(2, …)` at `quick-review.ts:67`, and the quick cap is `Math.min(…, 4)` (`src/setup.ts:115`, `src/engine/council.ts:71`).
     - Separately, `parseInt('abc')` gives NaN, and `options.rounds || REVIEW_ROUNDS` (`src/commands/review.ts:47`) silently falls back to the default.
   - **Change required:** pick one rule. I recommend this one: reject anything that is not an integer from 2 to 4, using commander's `InvalidArgumentError` in the parser at `review.ts:33`, and say "2–4" in the help text.
   - **Tests:** `--rounds 1`, `--rounds 10` and `--rounds abc` each exit 1 with one clean line, and `--rounds 4` gives session `maxRounds` 4. If the Lead keeps clamping instead, FR7 must say "clamped to 2–4", the clamp must be reported on stderr, and the clamping tests stay.

**Answers to the Lead's open points**
- **FR9: I pick the per-review path.** Add an optional `worktreePath` field to `OpenSessionOptions`. `council.ts:59` uses it when given and otherwise falls back to `projectStateDir(absRepo)/worktree`. That is a one-parameter engine change, which the Out-of-scope clause allows. Drop the "refuse while another session is live" fallback.
  - The cleanup in `finally` is `git worktree remove --force <path>` run in the repo. I found no remove helper in `src/utils/git.ts:31-43`, so a new `removeWorktree` helper goes there.
  - Afterwards `meta.worktreePath` points at a deleted path. Review sessions end AWAITING_APPROVAL or STALLED, and nothing in this diff resumes them. A follow-on `council deliberate` or `signoff` on a review session is untested; see the note below.
- **Shim warning: verified that it goes to stdout, not stderr.** `logger.warn` writes through `out`, which is `console.log` (`src/utils/logger.ts:4,11`) until `useStderr()` is called. `commands/review.ts` never calls it.
  - So FR6's "stdout identical" test fails today, and the PRD's "if it doesn't, switch" condition is now settled: it must switch.
  - Use `console.error` for that one line, not `logger.useStderr()`, which would also move every progress line to stderr.
- **Changelog:** `CHANGELOG.md` exists and has an `[Unreleased]` section, so the R1 entry goes there.

**Notes (not objections)**
- After FR9, a later `council signoff` or `deliberate` on a review session would run with a dead `cwd`. One way to handle it is to mark review sessions as not resumable in the closing line.
- The FR4 clause "while FR9 is unmet" can be dropped once FR9 is a merge requirement, as it now is.

**Not checked:**
- I did not re-run build, typecheck or tests this round. The baseline counts are the Lead's, from round 1.
- Windows behaviour: `--no-index /dev/null` and the `cmd /c start` opener.
- The other uses of `meta.worktreePath` (`council.ts:134`, execution handoff), beyond confirming where they are.
- `loadSessionReplay`'s use of the worktree after it is removed. I assumed it reads only the session directory.
```

</details>

<details>
<summary>Lead PM: what changed in v3</summary>

```markdown
# Response to Objections

**CE-1 (FR8 disclosure and exclusions): adopted.** FR8 is reworded as the Chief Engineer specified, and the Chief Architect's Ruling 1 binds it. The hook is `onSession` (`quick-review.ts:258`). Excluded hunks are dropped from the diff in `collectChange`, so the secret-pattern exclusion covers tracked and untracked files alike.

**CE-2 (FR7 contradiction): adopted.** FR7 now rejects anything that is not an integer from 2 to 4, using `InvalidArgumentError` in the parser at `review.ts:33`. The clamping tests are dropped, which also removes the NaN fallback at `review.ts:47`.

**Ruling 1: adopted.** It is incorporated into FR8 as written.

**Ruling 2: adopted.** It is incorporated into FR7 as written.

**Addenda:**
- **FR9 path:** adopted. An optional `worktreePath` goes on `OpenSessionOptions`, and `council.ts:59` falls back to `projectStateDir(absRepo)/worktree`. A new `removeWorktree` helper goes in `src/utils/git.ts`.
- **Shim warning:** adopted. It uses `console.error`.
- **Resumability:** adopted as FR10.
- **FR4:** the "while FR9 is unmet" clause is dropped.

**Notes and unchecked items:** I accept the notes. I have not verified that `loadSessionReplay` reads only the session directory, so this document keeps that as a test, not as an assumption. Windows behaviour stays advisory.

No new `QUESTION FOR ARCHITECT`.
```

</details>

<details>
<summary>Chief Engineer, round 3: SHIP WITH CHANGES</summary>

```markdown
VERDICT: SHIP WITH CHANGES
OPEN OBJECTIONS: 2

1. **FR9 cannot be built as written: the caller does not know `<sessionId>` until `open` returns.** FR9 has `runReview` pass `worktreePath: …/review-worktree/<sessionId>` on `OpenSessionOptions`. But `open` builds the session ID itself from the clock (`src/engine/council.ts:53-54`). It then creates the worktree inside the same call (`council.ts:59-60`) and writes it to meta (`council.ts:67`). The caller would have to guess the timestamp, and a guess goes wrong when the second ticks over. The fallback is to pick a name that does not match the session ID, which breaks the FR9 path and its test.
   **Required change:** replace `worktreePath?: string` with `isolatedWorktree?: boolean`. When it is true, `open` uses `path.join(projectStateDir(absRepo), 'review-worktree', sessionId)`; otherwise it keeps `…/worktree`. `runReview` then reads the path from `sessions.loadMeta(sessionId).worktreePath` for `removeWorktree` in `finally`.
   **Ordering:** the `finally` has to start right after `open` returns. If `open` throws inside `createWorktree`, nothing was registered.
   **Test:** assert the meta path ends in `/review-worktree/<sessionId>`. Also keep the ruled MEASURE: `git worktree list` is clean after a completed run and after a STALLED run.
   This stays within the "minimal engine change" the Architect allowed.

2. **FR6 / R1 test cannot be deterministic as a CLI subprocess.** `architect-review` really calls a model. `ArchitectureReviewEngine.runReview` uses `getAdapter(config.seats.chief_architect.provider)` (`src/engine/review.ts:5`). It also needs the session to be `OPEN` with a converged round (`review.ts:34-46`). A spawned `bin/council.js` cannot see the `ScriptedAdapter`s, which are registered in-process (`test/helpers.cjs:48-50`). So "exit 0, stdout identical to `architect-review`" would hit a live provider twice and compare non-deterministic text. That breaks the Deterministic Tests standard (stub the network) and leaves R1's test unbuildable.
   **Required change:** test it in-process, without a subprocess:
   - Build a `Command` and call `registerCouncilCommands` and `registerReviewCommands` with a `CliContext` whose config uses the scripted arch adapter.
   - Put a converged `OPEN` session in place (the `engines`/`approvedSession` helpers in `helpers.cjs:110`).
   - Run `parseAsync(['node','council','review',id])` and then `['…','architect-review',id]`, capturing `console.log` and `console.error`.
   - Assert that:
     - the captured stdout is equal for both runs;
     - the deprecation warning appears only on the captured stderr;
     - `process.exitCode` is not 1, since `action()` signals failure only through `process.exitCode = 1` (`src/commands/shared.ts:18`).
   - Keep the subprocess-level FR1 test as it is.

Notes (not objections):
- **FR7 is feasible:** `--rounds 4` → `maxRounds` 4 works. The quick cap is `QUICK_COUNCIL.max_rounds: 4` (`src/setup.ts:115`), and `open` applies `Math.min` (`council.ts:70`). Any later rise above 4 would be clamped silently, so the 2–4 bound matches.
- **FR10 needs no new meta field.** The cleanest behavioural check is that `meta.worktreePath` no longer exists. Put it in the shared precondition path for `deliberate` and `signoff` (they use it as `cwd` at `deliberation.ts:254` and `signoff.ts:119`), and give a one-line error. `architect-review` on a finished review session already fails cleanly on status (`review.ts:35`).
- **`loadSessionReplay` reads only the session directory and `execWorktree`** (`src/replay/session-replay.ts:165`), so removing the worktree before rendering is safe. That answers the Lead's open item.
- **`CHANGELOG.md:6` already has an `[Unreleased]` section** for the R1 entry.

Not checked:
- I did not run the build, typecheck or test suite this round. I relied on the round-1 counts and on reading the code.
- Windows behaviour.
- `src/utils/logger.ts` stream routing beyond what the draft cites.
- Whether `git worktree remove --force` leaves `.git/worktrees/<name>` behind when the directory was already deleted. The MEASURE test will show this.
- Commander's `InvalidArgumentError` output format.
```

</details>

<details>
<summary>Stalled: last draft and open objections</summary>

````markdown
# Council stalled: partial result for session 20261107114308-review-feat-council-review

> This document is NOT signed off and NOT approved. No seat agreed to it; `council approve` will refuse it.
> It is the last draft the council produced plus the objections and concerns still open against it, so the
> work spent is not lost: fix the task statement or the draft and open a new session.

- Reason: No unanimous zero-concern sign-off after 3 rounds (max_rounds 3, sign-off revisions 1); nothing was presented to the Operator.
- Rounds completed: 3
- Latest draft: plan-v3.md

## Task

Review this change before it ships.
Lead PM: write the brief and PRD that this change implies: what it is for, what it claims to do, and how we would know it works. Do not invent scope the diff does not show.
Chief Engineer: check every claim against the repository and the diff. Object, with file:line, wherever the change is wrong, incomplete, untested, or breaks something that depends on it.
Chief Architect: rule on whether it should ship as is.

Your checkout is this branch with the change applied; it is the diff from 2ba308b.
Files changed (8): src/cli.ts, src/commands/council.ts, src/commands/review.ts, src/index.ts, src/replay/html.ts, src/replay/markdown-replay.ts, src/review/quick-review.ts, test/review.test.cjs

```diff
diff --git a/src/cli.ts b/src/cli.ts
index a6c1db2..8569706 100644
--- a/src/cli.ts
+++ b/src/cli.ts
@@ -9,6 +9,7 @@ import { registerProjectCommands } from './commands/project.js';
 import { registerCouncilCommands } from './commands/council.js';
 import { registerExecutionCommands } from './commands/execution.js';
 import { registerReplayCommands } from './commands/replay.js';
+import { registerReviewCommands } from './commands/review.js';
 
 const repoRoot = resolveRepoRoot();
 
@@ -34,5 +35,6 @@ registerProjectCommands(program, context);
 registerCouncilCommands(program, context);
 registerExecutionCommands(program, context);
 registerReplayCommands(program, context);
+registerReviewCommands(program, context);
 
 program.parseAsync(process.argv);
diff --git a/src/commands/council.ts b/src/commands/council.ts
index fcc39b2..5e96f39 100644
--- a/src/commands/council.ts
+++ b/src/commands/council.ts
@@ -1,4 +1,5 @@
 import { Command } from 'commander';
+import { CouncilConfig } from '../types.js';
 import * as fs from 'fs';
 import { CouncilEngine } from '../engine/council.js';
 import { DeliberationEngine } from '../engine/deliberation.js';
@@ -8,6 +9,15 @@ import { LeadSignoffEngine } from '../engine/signoff.js';
 import { logger } from '../utils/logger.js';
 import { CliContext, action, readStdin } from './shared.js';
 
+/** Prints the Chief Architect's 12-point review of a session's latest draft. */
+export async function printArchitectReview(config: CouncilConfig, sessionId: string): Promise<void> {
+  const res = await new ArchitectureReviewEngine(config).runReview(sessionId);
+  console.log(`\nArchitecture Review Verdict: ${res.verdict}`);
+  console.log(`Required Concerns: ${res.requiredConcerns}, Advisory Concerns: ${res.advisoryConcerns}`);
+  for (const c of res.concerns) console.log(`CONCERN ${c.id}: ${c.type} — ${c.principle} — ${c.description}`);
+  console.log(`SUMMARY: ${res.summary}`);
+}
+
 export function registerCouncilCommands(program: Command, ctx: CliContext): void {
   program
     .command('open <slug>')
@@ -76,15 +86,9 @@ export function registerCouncilCommands(program: Command, ctx: CliContext): void
     }));
 
   program
-    .command('review <session>')
-    .description('Invoke the Chief Architect for 12-point industry standards sign-off')
-    .action(action(async (sessionId: string) => {
-      const res = await new ArchitectureReviewEngine(ctx.config).runReview(sessionId);
-      console.log(`\nArchitecture Review Verdict: ${res.verdict}`);
-      console.log(`Required Concerns: ${res.requiredConcerns}, Advisory Concerns: ${res.advisoryConcerns}`);
-      for (const c of res.concerns) console.log(`CONCERN ${c.id}: ${c.type} — ${c.principle} — ${c.description}`);
-      console.log(`SUMMARY: ${res.summary}`);
-    }));
+    .command('architect-review <session>')
+    .description('Invoke the Chief Architect for 12-point industry standards sign-off (was `council review <session>`)')
+    .action(action(async (sessionId: string) => printArchitectReview(ctx.config, sessionId)));
 
   program
     .command('signoff <session>')
diff --git a/src/commands/review.ts b/src/commands/review.ts
new file mode 100644
index 0000000..0c30e12
--- /dev/null
+++ b/src/commands/review.ts
@@ -0,0 +1,82 @@
+import { Command } from 'commander';
+import * as fs from 'fs';
+import * as path from 'path';
+import chalk from 'chalk';
+import { spawn } from 'child_process';
+import { REVIEW_ROUNDS, reviewConfig, runReview } from '../review/quick-review.js';
+import { resolveRepoRoot } from '../utils/paths.js';
+import { logger } from '../utils/logger.js';
+import { SessionManager } from '../engine/session.js';
+import { printArchitectReview } from './council.js';
+import { CliContext, action } from './shared.js';
+
+function openInBrowser(file: string): void {
+  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
+  const args = process.platform === 'win32' ? ['/c', 'start', '', file] : [file];
+  try {
+    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
+    child.on('error', () => { /* no opener on this machine: the path is printed anyway */ });
+    child.unref();
+  } catch { /* ignore */ }
+}
+
+function isSessionId(words: string[]): boolean {
+  if (words.length !== 1 || !/^\d{14}-/.test(words[0])) return false;
+  try { new SessionManager().loadMeta(words[0]); return true; } catch { return false; }
+}
+
+export function registerReviewCommands(program: Command, ctx: CliContext): void {
+  program
+    .command('review [task...]')
+    .description('Have the council tear into your current change (or a one-line plan) and get a page of its objections. No setup; nothing in your repo is written or run.')
+    .option('--base <ref>', 'Review the commits ahead of this ref instead of uncommitted changes (default: uncommitted, else ahead of origin/main)')
+    .option('--rounds <n>', `Round budget (default ${REVIEW_ROUNDS})`, (v: string) => parseInt(v, 10))
+    .option('-o, --out <dir>', 'Also copy review.html and review.md into this directory')
+    .option('--no-open', 'Do not open the page in a browser when it is done')
+    .action(action(async (taskWords: string[], options: { base?: string; rounds?: number; out?: string; open: boolean }) => {
+      // Before 0.3 `council review <session>` ran the Chief Architect's review of a session. Keep that working.
+      if (isSessionId(taskWords)) {
+        logger.warn('`council review <session>` is now `council architect-review <session>`. Running that.');
+        await printArchitectReview(ctx.config, taskWords[0]);
+        return;
+      }
+      const repo = resolveRepoRoot();
+      if (!fs.existsSync(path.join(repo, '.git'))) {
+        throw new Error('council review runs inside a git repository. cd into one, or run `git init` and commit first.');
+      }
+      const task = taskWords.join(' ').trim() || undefined;
+      const { config, plan, gates } = await reviewConfig(repo, options.rounds || REVIEW_ROUNDS);
+      if (plan) logger.info(`Seats (${plan.mode}): ${Object.entries(plan.seats).map(([seat, p]) => `${seat} ${p.provider}/${p.model}`).join(', ')}`);
+      if (gates && gates.test) logger.info(`Gates from ${gates.source}: ${[gates.test, gates.lint].filter(Boolean).join(', ')} (read by the seats, not run)`);
+      const result = await runReview(repo, {
+        task, base: options.base, config,
+        onSession: (id, mode, change) => {
+          const what = mode === 'task' ? `the plan "${task}"` : mode === 'uncommitted' ? `your uncommitted change (${change!.files.length} file${change!.files.length === 1 ? '' : 's'})` : `${change!.files.length} file${change!.files.length === 1 ? '' : 's'} changed since ${change!.base}`;
+          logger.info(`Session ${id}: the council is reviewing ${what}. This takes a few minutes.`);
+        }
+      });
+      let html = result.htmlPath;
+      let md = result.mdPath;
+      if (options.out) {
+        fs.mkdirSync(options.out, { recursive: true });
+        html = path.join(options.out, 'review.html');
+        md = path.join(options.out, 'review.md');
+        fs.copyFileSync(result.htmlPath, html);
+        fs.copyFileSync(result.mdPath, md);
+      }
+      const mins = Math.floor(result.seconds / 60);
+      console.log('');
+      console.log(chalk.bold(`The council ${result.outcome === 'STALLED' ? 'could not agree' : 'signed off'} after ${result.rounds} round${result.rounds === 1 ? '' : 's'} (${mins ? `${mins} min ` : ''}${result.seconds % 60} s).`));
+      if (result.top.length) {
+        console.log(chalk.bold('\nWhat it found:'));
+        result.top.forEach((o, i) => console.log(`  ${i + 1}. ${o.headline.replace(/\*\*/g, '')}${o.location ? chalk.dim(` (${o.location})`) : ''}\n     ${chalk.dim(`${o.seat}, round ${o.round}`)}`));
+      } else {
+        console.log('\nThe council raised no objections.');
+      }
+      console.log(chalk.bold('\nShare it:'));
+      console.log(`  ${result.share}`);
+      console.log(`\nPage:     ${html}\nMarkdown: ${md} ${chalk.dim('(paste into a gist or a PR comment)')}`);
+      console.log(chalk.dim('Nothing in your repo was changed, executed or committed. `council init` sets up the full loop, where the council also builds it and runs your gates.'));
+      if (options.open && process.stdout.isTTY) openInBrowser(html);
+    }));
+}
diff --git a/src/index.ts b/src/index.ts
index bfed8df..42224c1 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -25,3 +25,5 @@ export * from './replay/session-replay.js';
 export * from './replay/markdown.js';
 export * from './replay/html.js';
 export * from './replay/play.js';
+export * from './replay/markdown-replay.js';
+export * from './review/quick-review.js';
diff --git a/src/replay/html.ts b/src/replay/html.ts
index a705bae..0d43289 100644
--- a/src/replay/html.ts
+++ b/src/replay/html.ts
@@ -1,5 +1,6 @@
 import { SessionReplay } from './session-replay.js';
 import { escapeHtml, renderMarkdown } from './markdown.js';
+import type { TopObjection } from '../review/quick-review.js';
 
 const SEATS = {
   pm: { name: 'Lead PM', cls: 'pm' },
@@ -20,6 +21,8 @@ function fold(summary: string, inner: string): string {
   return `<details><summary>${escapeHtml(summary)}</summary>${inner}</details>`;
 }
 
+const renderInline = (text: string) => renderMarkdown(text).replace(/^<p>|<\/p>$/g, '');
+
 const pre = (text: string) => `<pre><code>${escapeHtml(text)}</code></pre>`;
 
 const CSS = `
@@ -42,11 +45,13 @@ blockquote{margin:8px 0;padding-left:12px;border-left:3px solid var(--line);colo
 .table{overflow-x:auto}table{border-collapse:collapse;margin:8px 0;font-size:14px}th,td{border:1px solid var(--line);padding:4px 8px;text-align:left;vertical-align:top}
 details{margin:10px 0}summary{cursor:pointer;color:var(--muted);font-weight:600}details[open]>summary{margin-bottom:8px}
 .timeline td:first-child{font-family:ui-monospace,Menlo,monospace;color:var(--muted);white-space:nowrap}
+h2+.seat{margin-top:8px}.share{margin:20px 0;padding:12px 16px;border:1px dashed var(--line);border-radius:8px}.share .label{font-weight:600;margin-bottom:6px}
+.share textarea{width:100%;font:14px/1.45 ui-monospace,Menlo,monospace;background:var(--code);color:var(--fg);border:0;border-radius:6px;padding:8px;resize:vertical}
 footer{margin-top:48px;color:var(--muted);font-size:14px}a{color:var(--eng)}
 `;
 
 /** One self-contained HTML page for a session: no scripts, no external requests, every seat reply rendered from its file. */
-export function renderReplayHtml(r: SessionReplay, options: { note?: string } = {}): string {
+export function renderReplayHtml(r: SessionReplay, options: { note?: string; top?: TopObjection[]; share?: string } = {}): string {
   const outcomeClass = r.status === 'DONE' || r.status === 'MERGED' ? 'ok' : r.status === 'BLOCKED' || r.status === 'STALLED' ? 'bad' : 'warn';
   const parts: string[] = [];
   parts.push(`<h1>Council replay: ${escapeHtml(r.slug)}</h1>`);
@@ -54,6 +59,14 @@ export function renderReplayHtml(r: SessionReplay, options: { note?: string } =
     `round budget ${r.maxRounds}${r.signoffRevisions ? ` plus ${r.signoffRevisions} sign-off revision` : ''}.</p>`);
   parts.push(`<span class="outcome ${outcomeClass}">Outcome: ${escapeHtml(r.status)}</span>`);
   if (options.note) parts.push(`<div class="md">${renderMarkdown(options.note)}</div>`);
+  if (options.top && options.top.length) {
+    parts.push('<h2>What the council found</h2>' + options.top.map((o, i) =>
+      seatBlock(o.seat === 'Chief Engineer' ? 'eng' : 'arch', `objection ${i + 1}, round ${o.round}${o.location ? ` · ${o.location}` : ''}`,
+        `<p><strong>${renderInline(o.headline)}</strong></p>${o.evidence && o.evidence !== o.headline ? `<p>${renderInline(o.evidence)}</p>` : ''}`)).join(''));
+  }
+  if (options.share) {
+    parts.push(`<div class="share"><div class="label">Share it</div><textarea readonly rows="3" aria-label="Share line">${escapeHtml(options.share)}</textarea></div>`);
+  }
   parts.push('<p class="lede">Every seat reply below is the text the harness saved, rendered as written. Nothing is summarised.</p>');
 
   parts.push('<h2>The task</h2>' + `<blockquote>${renderMarkdown(r.task)}</blockquote>`);
diff --git a/src/replay/markdown-replay.ts b/src/replay/markdown-replay.ts
new file mode 100644
index 0000000..88fe6b7
--- /dev/null
+++ b/src/replay/markdown-replay.ts
@@ -0,0 +1,43 @@
+import { SessionReplay } from './session-replay.js';
+import type { TopObjection } from '../review/quick-review.js';
+
+const quote = (text: string) => text.trim().split('\n').map(l => (l.trim() ? `> ${l}` : '>')).join('\n');
+
+function details(summary: string, body: string, lang = ''): string {
+  const fence = body.includes('```') ? '````' : '```';
+  return `<details>\n<summary>${summary}</summary>\n\n${fence}${lang}\n${body.trim()}\n${fence}\n\n</details>\n`;
+}
+
+/**
+ * The same replay as Markdown, for places that render it: a GitHub gist, an issue, a pull request comment.
+ * Leads with what the council found; every seat reply follows, folded.
+ */
+export function renderReplayMarkdown(r: SessionReplay, options: { top?: TopObjection[]; share?: string } = {}): string {
+  const out: string[] = [];
+  out.push(`## Council review: ${r.slug}`, '');
+  const rounds = r.rounds.filter(x => x.engineer).length;
+  out.push(`Outcome: **${r.status}** after ${rounds} round${rounds === 1 ? '' : 's'} (${r.profile} profile, base \`${r.baseSha.slice(0, 7)}\`).`, '');
+  if (options.top && options.top.length) {
+    out.push('### What the council found', '');
+    options.top.forEach((o, i) => {
+      out.push(`${i + 1}. **${o.headline.replace(/\*\*/g, '')}**${o.location ? ` (\`${o.location}\`)` : ''}  `);
+      if (o.evidence && o.evidence !== o.headline) out.push(`   ${o.evidence.replace(/\n+/g, ' ')}`);
+      out.push(`   _${o.seat}, round ${o.round}_`, '');
+    });
+  } else {
+    out.push('The council raised no objections.', '');
+  }
+  out.push('### Every round', '');
+  for (const round of r.rounds) {
+    if (round.changes) out.push(details(`Lead PM: what changed in v${round.n}`, round.changes, 'markdown'));
+    if (round.engineer) out.push(details(`Chief Engineer, round ${round.n}: ${round.engineer.verdict || 'review'}`, round.engineer.reply, 'markdown'));
+    if (round.architect) out.push(details(`Chief Architect on v${round.n}: ${round.architect.verdict || 'review'}`, round.architect.reply, 'markdown'));
+    if (round.signoff) out.push(details(`Lead PM sign-off on v${round.n}: ${round.signoff.verdict || ''}`, round.signoff.reply, 'markdown'));
+  }
+  if (r.prd) out.push(details('The PRD all three seats signed off', r.prd.text, 'markdown'));
+  if (r.stalled) out.push(details('Stalled: last draft and open objections', r.stalled, 'markdown'));
+  out.push('', '<details><summary>The task</summary>', '', quote(r.task), '', '</details>', '');
+  if (options.share) out.push(`> ${options.share}`, '');
+  out.push('<sub>Reviewed with <a href="https://github.com/goshtasb/OpenCouncil">Open Council</a>: <code>npx open-council-cli review</code></sub>');
+  return out.join('\n') + '\n';
+}
diff --git a/src/review/quick-review.ts b/src/review/quick-review.ts
new file mode 100644
index 0000000..32c0b66
--- /dev/null
+++ b/src/review/quick-review.ts
@@ -0,0 +1,268 @@
+import * as fs from 'fs';
+import * as path from 'path';
+import { spawnSync } from 'child_process';
+import { CouncilConfig } from '../types.js';
+import { DEFAULT_CONFIG, findConfigFile, loadConfig } from '../config.js';
+import { PROVIDER_FIXES, SeatsPlan, detectProviders, planSeats } from '../setup.js';
+import { SessionReplay, loadSessionReplay, objectionHeadlines } from '../replay/session-replay.js';
+import { renderReplayHtml } from '../replay/html.js';
+import { renderReplayMarkdown } from '../replay/markdown-replay.js';
+import { SessionManager } from '../engine/session.js';
+import { PipelineManager } from '../engine/pipeline.js';
+import { CouncilEngine } from '../engine/council.js';
+import { DeliberationEngine } from '../engine/deliberation.js';
+
+/** Round budget for `council review`: short enough to finish in minutes, long enough for one revision. */
+export const REVIEW_ROUNDS = 3;
+/** Above this the diff is too big to argue about usefully in one sitting. */
+export const MAX_REVIEW_DIFF_BYTES = 120_000;
+
+function git(cwd: string, args: string[]): { ok: boolean; out: string } {
+  const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
+  return { ok: r.status === 0, out: r.stdout || '' };
+}
+
+export interface DetectedGates { install: string; test: string; lint: string; source: string }
+
+/** Works out how the project installs and tests itself from the files at its root. Nothing is run. */
+export function detectGates(repo: string): DetectedGates {
+  const has = (f: string) => fs.existsSync(path.join(repo, f));
+  if (has('package.json')) {
+    let scripts: Record<string, string> = {};
+    try { scripts = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8')).scripts || {}; } catch { /* unreadable package.json: no scripts */ }
+    const pm = has('pnpm-lock.yaml') ? 'pnpm' : has('yarn.lock') ? 'yarn' : has('bun.lockb') || has('bun.lock') ? 'bun' : 'npm';
+    const install = pm === 'npm' ? (has('package-lock.json') ? 'npm ci' : 'npm install') : `${pm} install`;
+    const run = (s: string) => (pm === 'npm' ? `npm run ${s}` : `${pm} run ${s}`);
+    const test = scripts.test && !/no test specified/.test(scripts.test) ? (pm === 'npm' ? 'npm test' : `${pm} test`) : '';
+    return { install, test, lint: scripts.lint ? run('lint') : '', source: 'package.json' };
+  }
+  if (has('Cargo.toml')) return { install: '', test: 'cargo test', lint: 'cargo clippy -- -D warnings', source: 'Cargo.toml' };
+  if (has('go.mod')) return { install: 'go mod download', test: 'go test ./...', lint: 'go vet ./...', source: 'go.mod' };
+  if (has('pyproject.toml') || has('setup.py') || has('requirements.txt')) {
+    const install = has('requirements.txt') ? 'pip install -r requirements.txt' : 'pip install -e .';
+    return { install, test: 'python -m pytest', lint: '', source: has('pyproject.toml') ? 'pyproject.toml' : has('setup.py') ? 'setup.py' : 'requirements.txt' };
+  }
+  return { install: '', test: '', lint: '', source: 'nothing recognised' };
+}
+
+/**
+ * The config a review runs with. A project's own .council/config.yml is used when it exists; otherwise the
+ * seats come from the provider CLIs on PATH and the gates from the project files, and nothing is written.
+ * Either way the round budget is cut to `rounds` so a review finishes in minutes.
+ */
+export async function reviewConfig(repo: string, rounds = REVIEW_ROUNDS, found?: Set<string>): Promise<{ config: CouncilConfig; plan: SeatsPlan | null; gates: DetectedGates | null }> {
+  let config: CouncilConfig;
+  let plan: SeatsPlan | null = null;
+  let gates: DetectedGates | null = null;
+  if (findConfigFile(repo)) {
+    config = loadConfig(repo);
+  } else {
+    plan = planSeats(found || await detectProviders());
+    if (plan.mode === 'none') {
+      throw new Error(`No AI CLI was found on PATH. A review needs at least Claude Code: ${PROVIDER_FIXES['claude-code'].install}, then run \`claude\` once to sign in.`);
+    }
+    gates = detectGates(repo);
+    const base = JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as CouncilConfig;
+    for (const seat of Object.keys(plan.seats) as (keyof CouncilConfig['seats'])[]) {
+      base.seats[seat] = { ...base.seats[seat], provider: plan.seats[seat].provider, model: plan.seats[seat].model };
+    }
+    base.project = { ...base.project, install_command: gates.install, test_command: gates.test, lint_command: gates.lint };
+    config = base;
+  }
+  const max = Math.max(2, Math.floor(rounds));
+  config.council = {
+    ...config.council,
+    profile: 'quick',
+    max_rounds: max,
+    tiebreak_round: Math.max(1, max - 1),
+    signoff_revisions: 1,
+    round_timeout_seconds: Math.min(config.council.round_timeout_seconds || 600, 600)
+  };
+  return { config, plan, gates };
+}
+
+export interface ReviewChange { kind: 'uncommitted' | 'branch'; diff: string; base: string; files: string[] }
+
+function defaultBase(repo: string): string | null {
+  const head = git(repo, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
+  const candidates = [head.ok ? head.out.trim() : '', 'origin/main', 'origin/master', 'main', 'master'].filter(Boolean);
+  for (const ref of candidates) if (git(repo, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).ok) return ref;
+  return null;
+}
+
+/**
+ * The change to review: uncommitted work if there is any (tracked edits plus new untracked files),
+ * otherwise this branch's commits since it left the base branch. Returns null when there is nothing.
+ */
+export function collectChange(repo: string, base?: string): ReviewChange | null {
+  if (!base) {
+    const tracked = git(repo, ['diff', 'HEAD', '--no-color']).out;
+    const untracked = git(repo, ['ls-files', '--others', '--exclude-standard']).out.split('\n').filter(Boolean);
+    let extra = '';
+    for (const file of untracked) {
+      const r = spawnSync('git', ['diff', '--no-color', '--no-index', '--', '/dev/null', file], { cwd: repo, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
+      extra += r.stdout || '';
+    }
+    const diff = tracked + extra;
+    if (diff.trim()) {
+      const files = git(repo, ['diff', 'HEAD', '--name-only']).out.split('\n').filter(Boolean).concat(untracked);
+      return { kind: 'uncommitted', diff, base: 'HEAD', files };
+    }
+  }
+  const ref = base || defaultBase(repo);
+  if (!ref) return null;
+  if (!git(repo, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).ok) throw new Error(`Unknown base '${ref}'.`);
+  const diff = git(repo, ['diff', '--no-color', `${ref}...HEAD`]).out;
+  if (!diff.trim()) return null;
+  const files = git(repo, ['diff', '--name-only', `${ref}...HEAD`]).out.split('\n').filter(Boolean);
+  return { kind: 'branch', diff, base: ref, files };
+}
+
+/** The task a change review gives the council. The diff is quoted whole; the seats read the repository for the rest. */
+export function changeReviewTask(change: ReviewChange): string {
+  const checkout = change.kind === 'uncommitted'
+    ? 'Your checkout is the last commit, before this change: the diff below is not applied to it.'
+    : `Your checkout is this branch with the change applied; it is the diff from ${change.base}.`;
+  return [
+    'Review this change before it ships.',
+    'Lead PM: write the brief and PRD that this change implies: what it is for, what it claims to do, and how we would know it works. Do not invent scope the diff does not show.',
+    'Chief Engineer: check every claim against the repository and the diff. Object, with file:line, wherever the change is wrong, incomplete, untested, or breaks something that depends on it.',
+    'Chief Architect: rule on whether it should ship as is.',
+    '',
+    checkout,
+    `Files changed (${change.files.length}): ${change.files.join(', ')}`,
+    '',
+    '```diff',
+    change.diff.trimEnd(),
+    '```'
+  ].join('\n');
+}
+
+/** A short session slug from the task or the branch. */
+export function reviewSlug(repo: string, task?: string): string {
+  const source = task || `review-${git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']).out.trim() || 'change'}`;
+  const slug = source.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').split('-').slice(0, 6).join('-');
+  return (task ? `review-${slug}` : slug).slice(0, 48).replace(/-+$/, '') || 'review';
+}
+
+export interface TopObjection { round: number; seat: 'Chief Engineer' | 'Chief Architect'; headline: string; evidence: string; location?: string }
+
+/** Numbered objections with a bold headline; failing that, plain numbered items whose first sentence is the headline. */
+function engineerObjections(reply: string): { headline: string; evidence: string }[] {
+  const bold = objectionHeadlines(reply);
+  if (bold.length) return bold;
+  const out: { headline: string; evidence: string }[] = [];
+  for (const line of reply.split('\n')) {
+    const m = /^\d+\.\s+(.+)$/.exec(line.trim());
+    if (!m) continue;
+    const headline = m[1].split(/(?<=[.!?])\s/)[0];
+    out.push({ headline, evidence: m[1] });
+  }
+  return out;
+}
+
+const LOCATION = /\b[\w./-]+\.[A-Za-z]{1,5}:\d+(?:-\d+)?\b/;
+
+/**
+ * The objections worth leading with: the Chief Engineer's, earliest round first, those that cite a file:line
+ * ahead of those that don't, then the Chief Architect's required concerns. Duplicates across rounds are dropped.
+ */
+export function topObjections(replay: SessionReplay, limit = 3): TopObjection[] {
+  const all: TopObjection[] = [];
+  for (const round of replay.rounds) {
+    if (round.engineer && (round.engineer.openObjections ?? 1) > 0) {
+      for (const o of engineerObjections(round.engineer.reply)) {
+        const where = LOCATION.exec(`${o.headline} ${o.evidence}`);
+        all.push({ round: round.n, seat: 'Chief Engineer', headline: o.headline, evidence: o.evidence, location: where?.[0] });
+      }
+    }
+    if (round.architect) {
+      for (const c of round.architect.concerns.filter(c => /REQUIRED/i.test(c.type))) {
+        const where = LOCATION.exec(c.description);
+        all.push({ round: round.n, seat: 'Chief Architect', headline: c.description.split(/(?<=\.)\s/)[0], evidence: c.description, location: where?.[0] });
+      }
+    }
+  }
+  const seen = new Set<string>();
+  const unique = all.filter(o => {
+    const key = o.headline.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 60);
+    if (seen.has(key)) return false;
+    seen.add(key);
+    return true;
+  });
+  const rank = (o: TopObjection) => (o.seat === 'Chief Engineer' ? 0 : 100) + (o.location ? 0 : 10) + o.round;
+  return unique.map((o, i) => ({ o, i })).sort((a, b) => rank(a.o) - rank(b.o) || a.i - b.i).slice(0, limit).map(x => x.o);
+}
+
+const clean = (s: string) => s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/\s+/g, ' ').trim();
+
+/** One line someone can paste anywhere: what the council found, in its own words, and how to run one. */
+export function shareLine(replay: SessionReplay, top: TopObjection[]): string {
+  const count = top.length;
+  if (!count) {
+    return `Three AI seats reviewed my ${/^Review this change before it ships\./.test(replay.task) ? 'change' : 'plan'} and found nothing to object to. Try it on yours: npx open-council-cli review`;
+  }
+  const first = clean(top[0].headline).replace(/[.:;]+$/, '');
+  const where = top[0].location ? ` (${top[0].location})` : '';
+  const what = /^Review this change before it ships\./.test(replay.task) ? 'my change before shipping it' : 'my plan before building it';
+  return `I had three AI seats argue over ${what}. First objection, from the ${top[0].seat}: "${first}"${where}. Try it on yours: npx open-council-cli review`;
+}
+
+export interface ReviewOptions {
+  task?: string;
+  base?: string;
+  rounds?: number;
+  /** Overrides for tests: a ready config and the managers the engines use. */
+  config?: CouncilConfig;
+  sessions?: SessionManager;
+  pipeline?: PipelineManager;
+  onSession?: (sessionId: string, mode: 'task' | ReviewChange['kind'], change: ReviewChange | null) => void;
+}
+
+export interface ReviewResult {
+  sessionId: string;
+  outcome: 'AWAITING_APPROVAL' | 'STALLED';
+  rounds: number;
+  seconds: number;
+  replay: SessionReplay;
+  top: TopObjection[];
+  share: string;
+  htmlPath: string;
+  mdPath: string;
+}
+
+/**
+ * One review: open a session on the change (or the one-line task), let the council argue it out, and write the
+ * replay as HTML and Markdown into the session directory. Nothing in the repository is written or executed;
+ * the seats read it in the harness's own worktree.
+ */
+export async function runReview(repo: string, options: ReviewOptions = {}): Promise<ReviewResult> {
+  const started = Date.now();
+  let change: ReviewChange | null = null;
+  let task = options.task && options.task.trim();
+  if (!task) {
+    change = collectChange(repo, options.base);
+    if (!change) {
+      throw new Error('Nothing to review: no uncommitted changes and no commits ahead of the base branch. Pass a task instead: council review "add rate limiting to the login route"');
+    }
+    if (Buffer.byteLength(change.diff) > MAX_REVIEW_DIFF_BYTES) {
+      throw new Error(`The change is ${Math.round(Buffer.byteLength(change.diff) / 1024)} KB of diff across ${change.files.length} files, more than one review can argue about well (${MAX_REVIEW_DIFF_BYTES / 1000} KB). Commit part of it and review the rest, or pass --base with a closer ref.`);
+    }
+    task = changeReviewTask(change);
+  }
+  const config = options.config || (await reviewConfig(repo, options.rounds)).config;
+  const sessions = options.sessions || new SessionManager();
+  const council = new CouncilEngine(config, sessions, options.pipeline);
+  const sessionId = await council.open(repo, reviewSlug(repo, options.task), { task, profile: 'quick' });
+  options.onSession?.(sessionId, change ? change.kind : 'task', change);
+  const result = await new DeliberationEngine(config, sessions, options.pipeline).run(sessionId);
+  const dir = sessions.getSessionPath(sessionId);
+  const replay = loadSessionReplay(dir);
+  const top = topObjections(replay);
+  const share = shareLine(replay, top);
+  const htmlPath = path.join(dir, 'review.html');
+  const mdPath = path.join(dir, 'review.md');
+  fs.writeFileSync(htmlPath, renderReplayHtml(replay, { top, share }), 'utf8');
+  fs.writeFileSync(mdPath, renderReplayMarkdown(replay, { top, share }), 'utf8');
+  return { sessionId, outcome: result.outcome, rounds: result.rounds, seconds: Math.round((Date.now() - started) / 1000), replay, top, share, htmlPath, mdPath };
+}
diff --git a/test/review.test.cjs b/test/review.test.cjs
new file mode 100644
index 0000000..543545f
--- /dev/null
+++ b/test/review.test.cjs
@@ -0,0 +1,154 @@
+const test = require('node:test');
+const assert = require('node:assert/strict');
+const fs = require('fs');
+const os = require('os');
+const path = require('path');
+const { spawnSync } = require('child_process');
+const { lib, home, git, makeRepo, setup, PLAN, SHIP, OBJECT, SIGNOFF, LEAD_OK, revision } = require('./helpers.cjs');
+
+const bin = path.join(__dirname, '..', 'bin', 'council.js');
+const fixture = path.join(__dirname, 'fixtures', 'slugify-empty-and-accents');
+
+test('detectGates reads the package manager and scripts, and skips npm\'s placeholder test script', () => {
+  const repo = makeRepo();
+  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }));
+  assert.deepEqual(lib.detectGates(repo), { install: 'npm install', test: '', lint: '', source: 'package.json' });
+  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ scripts: { test: 'vitest', lint: 'eslint .' } }));
+  fs.writeFileSync(path.join(repo, 'pnpm-lock.yaml'), '');
+  assert.deepEqual(lib.detectGates(repo), { install: 'pnpm install', test: 'pnpm test', lint: 'pnpm run lint', source: 'package.json' });
+  const rust = makeRepo();
+  fs.writeFileSync(path.join(rust, 'Cargo.toml'), '[package]\nname="x"\n');
+  assert.equal(lib.detectGates(rust).test, 'cargo test');
+  assert.equal(lib.detectGates(makeRepo()).source, 'nothing recognised');
+});
+
+test('collectChange takes uncommitted edits and new files first, then the branch since its base, else nothing', () => {
+  const repo = makeRepo();
+  assert.equal(lib.collectChange(repo), null, 'a clean main with no remote has nothing to review');
+
+  fs.appendFileSync(path.join(repo, 'README.md'), 'more\n');
+  fs.writeFileSync(path.join(repo, 'new.js'), 'module.exports = 1;\n');
+  const dirty = lib.collectChange(repo);
+  assert.equal(dirty.kind, 'uncommitted');
+  assert.deepEqual(dirty.files.sort(), ['README.md', 'new.js']);
+  assert.match(dirty.diff, /\+more/);
+  assert.match(dirty.diff, /\+module\.exports = 1;/);
+
+  git(repo, 'checkout', '-qb', 'feature');
+  git(repo, 'add', '.');
+  git(repo, 'commit', '-qm', 'feature');
+  const branch = lib.collectChange(repo);
+  assert.equal(branch.kind, 'branch');
+  assert.equal(branch.base, 'main');
+  assert.deepEqual(branch.files.sort(), ['README.md', 'new.js']);
+  assert.throws(() => lib.collectChange(repo, 'no-such-ref'), /Unknown base 'no-such-ref'/);
+});
+
+test('reviewConfig plans seats from what is installed, writes nothing, and cuts the round budget', async () => {
+  const repo = makeRepo();
+  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }));
+  const { config, plan, gates } = await lib.reviewConfig(repo, 3, new Set(['claude-code']));
+  assert.equal(plan.mode, 'solo');
+  assert.equal(config.seats.chief_engineer.provider, 'claude-code');
+  assert.equal(config.project.test_command, 'npm test');
+  assert.equal(gates.source, 'package.json');
+  assert.equal(config.council.profile, 'quick');
+  assert.equal(config.council.max_rounds, 3);
+  assert.equal(config.council.tiebreak_round, 2);
+  assert.ok(!fs.existsSync(path.join(repo, '.council')), 'a review leaves no config behind');
+  await assert.rejects(lib.reviewConfig(repo, 3, new Set()), /No AI CLI was found on PATH.*claude\.ai\/install\.sh/s);
+});
+
+test('the change task quotes the whole diff and tells the seats whether the checkout has it', () => {
+  const task = lib.changeReviewTask({ kind: 'uncommitted', base: 'HEAD', files: ['a.js'], diff: '+x\n' });
+  assert.match(task, /^Review this change before it ships\./);
+  assert.match(task, /not applied to it/);
+  assert.match(task, /```diff\n\+x\n```/);
+  assert.match(lib.changeReviewTask({ kind: 'branch', base: 'origin/main', files: ['a.js'], diff: '+x' }), /diff from origin\/main/);
+});
+
+test('topObjections leads with the Chief Engineer\'s file:line objections, earliest round first, no repeats', () => {
+  const replay = lib.loadSessionReplay(fixture);
+  const top = lib.topObjections(replay);
+  assert.equal(top.length, 3);
+  assert.match(top[0].headline, /npm test` already fails at the baseline/);
+  assert.equal(top[0].location, 'package.json:8');
+  assert.equal(top[0].round, 1);
+  assert.ok(top.every(o => o.seat === 'Chief Engineer'));
+  assert.equal(new Set(top.map(o => o.headline)).size, 3);
+  const share = lib.shareLine(replay, top);
+  assert.match(share, /First objection, from the Chief Engineer: "The regression gate .* already fails at the baseline" \(package\.json:8\)\. Try it on yours: npx open-council-cli review$/);
+  assert.doesNotMatch(share, /\*\*|`/);
+});
+
+test('the review page and Markdown lead with what the council found and the share line, before the rounds', () => {
+  const replay = lib.loadSessionReplay(fixture);
+  const top = lib.topObjections(replay);
+  const share = lib.shareLine(replay, top);
+  const html = lib.renderReplayHtml(replay, { top, share });
+  assert.ok(html.indexOf('What the council found') < html.indexOf('<h2>Round 1</h2>'));
+  assert.match(html, /objection 1, round 1 · package\.json:8/);
+  assert.match(html, /<textarea readonly[^>]*>I had three AI seats/);
+  assert.doesNotMatch(html, /<script/i);
+  const md = lib.renderReplayMarkdown(replay, { top, share });
+  assert.match(md, /^## Council review: slugify-empty-and-accents/);
+  assert.ok(md.indexOf('### What the council found') < md.indexOf('### Every round'));
+  assert.match(md, /1\. \*\*The regression gate.*\*\* \(`package\.json:8`\)/);
+  assert.match(md, /<summary>Chief Engineer, round 1: SHIP WITH CHANGES<\/summary>/);
+  assert.match(md, /npx open-council-cli review<\/code><\/sub>\n$/);
+});
+
+test('runReview argues over an uncommitted change and writes both pages without touching the repo', async () => {
+  const ctx = setup({ council: { max_rounds: 3, tiebreak_round: 2 } });
+  fs.writeFileSync(path.join(ctx.repo, 'login.js'), 'export const login = () => true;\n');
+  const before = git(ctx.repo, 'status', '--porcelain');
+  ctx.adapters.pm.responses.push(PLAN(1), revision(2), LEAD_OK);
+  ctx.adapters.eng.responses.push(OBJECT, SHIP);
+  ctx.adapters.arch.responses.push(SIGNOFF);
+  let seen;
+  const result = await lib.runReview(ctx.repo, { config: ctx.config, sessions: ctx.sessions, pipeline: ctx.pipeline, onSession: (id, mode, change) => { seen = { id, mode, files: change.files }; } });
+  assert.equal(result.outcome, 'AWAITING_APPROVAL');
+  assert.deepEqual(seen, { id: result.sessionId, mode: 'uncommitted', files: ['login.js'] });
+  assert.match(ctx.adapters.pm.calls[0].prompt, /\+export const login = \(\) => true;/, 'the diff reaches the seats');
+  assert.equal(result.top.length, 1);
+  assert.equal(result.top[0].headline, 'Missing test (README.md:1).');
+  assert.equal(result.top[0].location, 'README.md:1');
+  assert.match(fs.readFileSync(result.htmlPath, 'utf8'), /What the council found/);
+  assert.match(fs.readFileSync(result.mdPath, 'utf8'), /Missing test/);
+  assert.equal(git(ctx.repo, 'status', '--porcelain'), before, 'the repo is exactly as it was');
+});
+
+test('runReview with a task reviews the plan; with nothing to review or a huge diff it says what to do', async () => {
+  const ctx = setup();
+  ctx.adapters.pm.responses.push(PLAN(1), LEAD_OK);
+  ctx.adapters.eng.responses.push(SHIP);
+  ctx.adapters.arch.responses.push(SIGNOFF);
+  const result = await lib.runReview(ctx.repo, { task: 'add rate limiting to login', config: ctx.config, sessions: ctx.sessions, pipeline: ctx.pipeline });
+  assert.match(result.sessionId, /review-add-rate-limiting-to-login$/);
+  assert.equal(result.top.length, 0);
+  assert.match(result.share, /reviewed my plan and found nothing to object to/);
+
+  await assert.rejects(lib.runReview(makeRepo(), { config: ctx.config }), /Nothing to review.*council review "/s);
+  const big = makeRepo();
+  fs.writeFileSync(path.join(big, 'big.txt'), 'x'.repeat(lib.MAX_REVIEW_DIFF_BYTES + 10));
+  await assert.rejects(lib.runReview(big, { config: ctx.config }), /more than one review can argue about well/);
+});
+
+test('council review outside a git repo, or with no AI CLI on PATH, is one clean line', () => {
+  // A PATH with only node and git on it, so no AI CLI is found (claude often sits next to node).
+  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'council-bare-path-'));
+  fs.symlinkSync(process.execPath, path.join(bare, 'node'));
+  fs.symlinkSync(spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim(), path.join(bare, 'git'));
+  const env = { ...process.env, COUNCIL_HOME: home, PATH: bare };
+  const notRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'council-norepo-'));
+  const a = spawnSync(process.execPath, [bin, 'review'], { cwd: notRepo, env, encoding: 'utf8' });
+  assert.equal(a.status, 1);
+  assert.match(a.stderr, /runs inside a git repository/);
+  const repo = makeRepo();
+  fs.appendFileSync(path.join(repo, 'README.md'), 'x\n');
+  const b = spawnSync(process.execPath, [bin, 'review'], { cwd: repo, env, encoding: 'utf8' });
+  assert.equal(b.status, 1);
+  assert.match(b.stderr, /No AI CLI was found on PATH/);
+  assert.doesNotMatch(b.stderr, /\n\s+at /);
+  assert.ok(!fs.existsSync(path.join(repo, '.council')));
+});
```

## Chief Engineer's reply to v3 (open objections)

VERDICT: SHIP WITH CHANGES
OPEN OBJECTIONS: 2

1. **FR9 cannot be built as written: the caller does not know `<sessionId>` until `open` returns.** FR9 has `runReview` pass `worktreePath: …/review-worktree/<sessionId>` on `OpenSessionOptions`. But `open` builds the session ID itself from the clock (`src/engine/council.ts:53-54`). It then creates the worktree inside the same call (`council.ts:59-60`) and writes it to meta (`council.ts:67`). The caller would have to guess the timestamp, and a guess goes wrong when the second ticks over. The fallback is to pick a name that does not match the session ID, which breaks the FR9 path and its test.
   **Required change:** replace `worktreePath?: string` with `isolatedWorktree?: boolean`. When it is true, `open` uses `path.join(projectStateDir(absRepo), 'review-worktree', sessionId)`; otherwise it keeps `…/worktree`. `runReview` then reads the path from `sessions.loadMeta(sessionId).worktreePath` for `removeWorktree` in `finally`.
   **Ordering:** the `finally` has to start right after `open` returns. If `open` throws inside `createWorktree`, nothing was registered.
   **Test:** assert the meta path ends in `/review-worktree/<sessionId>`. Also keep the ruled MEASURE: `git worktree list` is clean after a completed run and after a STALLED run.
   This stays within the "minimal engine change" the Architect allowed.

2. **FR6 / R1 test cannot be deterministic as a CLI subprocess.** `architect-review` really calls a model. `ArchitectureReviewEngine.runReview` uses `getAdapter(config.seats.chief_architect.provider)` (`src/engine/review.ts:5`). It also needs the session to be `OPEN` with a converged round (`review.ts:34-46`). A spawned `bin/council.js` cannot see the `ScriptedAdapter`s, which are registered in-process (`test/helpers.cjs:48-50`). So "exit 0, stdout identical to `architect-review`" would hit a live provider twice and compare non-deterministic text. That breaks the Deterministic Tests standard (stub the network) and leaves R1's test unbuildable.
   **Required change:** test it in-process, without a subprocess:
   - Build a `Command` and call `registerCouncilCommands` and `registerReviewCommands` with a `CliContext` whose config uses the scripted arch adapter.
   - Put a converged `OPEN` session in place (the `engines`/`approvedSession` helpers in `helpers.cjs:110`).
   - Run `parseAsync(['node','council','review',id])` and then `['…','architect-review',id]`, capturing `console.log` and `console.error`.
   - Assert that:
     - the captured stdout is equal for both runs;
     - the deprecation warning appears only on the captured stderr;
     - `process.exitCode` is not 1, since `action()` signals failure only through `process.exitCode = 1` (`src/commands/shared.ts:18`).
   - Keep the subprocess-level FR1 test as it is.

Notes (not objections):
- **FR7 is feasible:** `--rounds 4` → `maxRounds` 4 works. The quick cap is `QUICK_COUNCIL.max_rounds: 4` (`src/setup.ts:115`), and `open` applies `Math.min` (`council.ts:70`). Any later rise above 4 would be clamped silently, so the 2–4 bound matches.
- **FR10 needs no new meta field.** The cleanest behavioural check is that `meta.worktreePath` no longer exists. Put it in the shared precondition path for `deliberate` and `signoff` (they use it as `cwd` at `deliberation.ts:254` and `signoff.ts:119`), and give a one-line error. `architect-review` on a finished review session already fails cleanly on status (`review.ts:35`).
- **`loadSessionReplay` reads only the session directory and `execWorktree`** (`src/replay/session-replay.ts:165`), so removing the worktree before rendering is safe. That answers the Lead's open item.
- **`CHANGELOG.md:6` already has an `[Unreleased]` section** for the R1 entry.

Not checked:
- I did not run the build, typecheck or test suite this round. I relied on the round-1 counts and on reading the code.
- Windows behaviour.
- `src/utils/logger.ts` stream routing beyond what the draft cites.
- Whether `git worktree remove --force` leaves `.git/worktrees/<name>` behind when the directory was already deleted. The MEASURE test will show this.
- Commander's `InvalidArgumentError` output format.

## Last draft (plan-v3, not approved)

# Product Brief

## Executive framing
`council review [task...]` needs no setup. It takes the user's uncommitted change, their branch since its base, or a one-line plan. It runs a short "quick" council deliberation (default 3 rounds) and writes `review.html` and `review.md` into the session directory. Both lead with the top three objections and a pasteable share line (`src/review/quick-review.ts` `topObjections`/`shareLine`; `src/commands/review.ts`).

## Problem
Trying the council today needs `council init`, a config file and a full loop. The change removes that barrier and makes the output shareable.

## Scope
**In scope:**
- The `review` command, with `--base`, `--rounds`, `--out` and `--no-open`.
- Gate detection, config synthesis and change collection.
- The objections and share blocks in the HTML renderer, and a new Markdown renderer.
- The rename `council review <session>` → `architect-review`, with a shim.
- Tests.
- A one-parameter engine change (`worktreePath`) and a `removeWorktree` helper.

**Out of scope:**
- Running gates.
- Posting to PRs or gists.
- Diffs over 120 KB.
- Any other engine change.

## Journeys
- A developer with a dirty tree runs `council review` and gets objections with `file:line` references.
- A developer runs `council review "add rate limiting"` and gets the plan reviewed.
- An old caller runs `council review <session-id>` and is redirected with a stderr warning.

## Success metrics
- **North Star:** reviews that complete with at least one objection citing a `file:line`.
- **Guardrails:**
  - The working tree, index, branches and config are unchanged.
  - `git worktree list` is clean after a run.
  - `architect-review` output is identical to the old `review` output.
  - p90 time to page is under 10 minutes (unmeasured).
- **Instrumentation:** none in the diff, so the metrics are unmeasured. This is a gap, not an exemption.

## Risks
- **Data egress.** Diff contents go to third-party providers, and the seats can read any file tracked at HEAD (`deliberation.ts:254`, `deliberation-prompts.ts:46,85`). This is the largest risk, addressed by FR8.
- **Overclaim.** "Nothing in your repo is written" is false while a worktree is registered under `.git`. Addressed by FR4.
- **Live-session interference.** The shared research worktree is reset. Addressed by FR9.
- **Silent break.** A script calling `council review <slug>` where the slug has no 14-digit prefix now sends its text to a model as a plan. Mitigated by the changelog.
- **Quality.** It depends on the provider CLIs on PATH.

## Assumptions and rulings
- **R1:** keep the shim. It prints to stderr, is tested, is listed in `CHANGELOG.md` `[Unreleased]`, and is removed no earlier than the next minor release, which the entry names.
- **R2:** the safety claim is reworded, and a test asserts `status --porcelain` and `for-each-ref` are unchanged.
- **Round 2 rulings:** FR8 disclosure and exclusions, FR7 rejection, per-review worktree, stderr shim and non-resumable review sessions are binding.

# PRD

## Verified baseline
- Build and types pass. 90 tests pass, 1 is skipped, and 1 fails for an environment reason (`test/replay.test.cjs:132`, unrelated). These counts are from round 1.
- All 9 tests in `review.test.cjs` pass.
- `renderMarkdown` escapes raw HTML.
- The shim warning goes through `logger.warn` to stdout (`logger.ts:4,11`). This is a defect and FR6 fixes it.

## Functional requirements
- **FR1.** The command MUST exit 1 with one clean line outside a git repo, and when no AI CLI is on PATH.
- **FR2.** With no task, it MUST review uncommitted changes (tracked plus untracked) first, else commits ahead of the base. Given a dirty tree, `kind` is `uncommitted`. Given a clean branch ahead of `main`, `kind` is `branch`.
- **FR3.** It MUST reject nothing-to-review and diffs over `MAX_REVIEW_DIFF_BYTES` with an actionable error. It MUST check untracked file sizes via `fs.statSync` before reading them.
- **FR4.** It MUST NOT modify the working tree, index, branches or config, and MUST NOT create `.council/`. The CLI description and closing line MUST say only: "your working tree, index, branches and config are not modified; a temporary git worktree is used."
- **FR5.** It MUST write `review.html` and `review.md` with the objections block and share line before the rounds. HTML MUST contain no `<script>`.
- **FR6.** `review <existing-session-id>` MUST print its deprecation warning with `console.error` (not `logger.useStderr()`). Stdout MUST be identical to `architect-review <id>`, and both MUST exit 0.
- **FR7.** `--rounds` MUST accept only an integer from 2 to 4. The parser at `review.ts:33` MUST throw `InvalidArgumentError` for anything else, and the help text MUST say "2–4". Given `--rounds 1`, `10` or `abc`, the command exits 1 with one clean line. Given `--rounds 4`, the session has `maxRounds` 4.
- **FR8.** Before `DeliberationEngine.run` (the `onSession` hook), the command MUST:
  - (a) list the files whose content is quoted in the prompt;
  - (b) name the providers (`config.seats.*.provider`, or `plan.seats` when no config exists);
  - (c) state that the seats can also read any file tracked at HEAD;
  - (d) exclude `.env*`, `*.pem`, `*.key` and `id_*` files, tracked and untracked alike, name each excluded file, and drop its hunk from the diff.
- **FR9.** `OpenSessionOptions` MUST gain an optional `worktreePath`, which `council.ts:59` uses when given. Each review MUST use `…/review-worktree/<sessionId>`. A new `removeWorktree` in `src/utils/git.ts` (`git worktree remove --force`) MUST run in a `finally`, including after STALLED or an error. It MUST NOT touch another session's worktree.
- **FR10.** The closing line MUST say review sessions cannot be resumed. `deliberate` or `signoff` on a review session MUST fail with one clean line, not a dead-`cwd` stack trace.

## Non-functional requirements
- **Performance:** worst case is 4 × 600 s, since `round_timeout_seconds` is capped at 600. Target p90 is under 10 minutes (unmeasured).
- **Privacy:** FR8.
- **Reliability:** opener failures are swallowed and the path is still printed.
- **Accessibility:** the share textarea has an `aria-label`.
- **Cost:** N/A: bounded by the round cap and the provider's billing.

## Invariants and standards
- **01 Architecture §2.2/§4:** `replay/html.ts` and `replay/markdown-replay.ts` import the type `TopObjection` from `review/`, which is the wrong direction. Move `TopObjection` into the replay module. The repo has no `features/` layout, so `commands/review.ts` importing `commands/council.ts` is accepted.
- **02 Coding Practices §3:** `quick-review.ts` has 268 lines. Move `detectGates` to its own file, or add a one-line justification at the top.
- **03 Documentation:** a `CHANGELOG.md` entry is required (R1).

## Test plan and traceability
| Req | Test |
|---|---|
| FR1 | existing CLI test (non-repo, no CLI) |
| FR2, FR3 | existing `collectChange` and `runReview` tests, plus a large untracked file rejected via stat |
| FR4 | `status --porcelain` and `for-each-ref` identical before and after |
| FR5 | existing page and Markdown test |
| FR6 | CLI test with a session in `COUNCIL_HOME`: stdout equal, warning on stderr, exit 0 |
| FR7 | CLI: `1`, `10` and `abc` exit 1; `4` gives `maxRounds` 4 |
| FR8 | modified tracked `.env` and untracked `.env` both absent from `pm.calls[0].prompt` and named in output; output names the providers and states the HEAD-readable caveat |
| FR9 | `git worktree list` clean after a completed run and after a STALLED run (MEASURE); a live session's worktree HEAD is unmoved |
| FR10 | `deliberate` and `signoff` on a review session each fail with one clean line |

Also add tests for `--base` through the CLI, `--out`, and the no-bold-headline fallback in `engineerObjections`.

## Observability and operability
N/A: no telemetry is added. This is a gap. The session directory is the audit trail.

## Rollout, flagging and rollback
- Ships in a normal release with no flag.
- The changelog names the release that removes the shim.
- Rollback is a revert, which restores `council review <session>`. No persisted data is affected.

## Dependencies and supply chain
N/A: no new dependencies. `chalk` is already declared (`package.json:54`).

# Executive Summary
The change adds a zero-setup `council review` that critiques a user's change or plan and produces shareable HTML and Markdown pages. The build is green and the core paths are tested. It should **ship with changes**, not as is.

**Required before merge:**
1. Disclose before sending which files are quoted, which providers receive them, and that the seats can read all tracked files. Exclude secret-pattern files, tracked and untracked, from the diff (FR8).
2. Use a per-review worktree and remove it in a `finally`. Make review sessions explicitly non-resumable (FR9, FR10).
3. Reword the safety claim to the R2 text (FR4).
4. Validate `--rounds` as 2–4 and reject anything else (FR7).
5. Send the shim warning to stderr, add a CLI test for it, and add the changelog entry that names the shim's removal release (FR6).
6. Test `--base`, `--out` and the fallback. Move `TopObjection`, and split or justify `quick-review.ts`.

**Advisory:**
- Check Windows behaviour (`/dev/null` with `--no-index`, the `cmd /c start` opener). It is unchecked.
- Add a metric hook.
````

</details>


<details><summary>The task</summary>

> Review this change before it ships.
> Lead PM: write the brief and PRD that this change implies: what it is for, what it claims to do, and how we would know it works. Do not invent scope the diff does not show.
> Chief Engineer: check every claim against the repository and the diff. Object, with file:line, wherever the change is wrong, incomplete, untested, or breaks something that depends on it.
> Chief Architect: rule on whether it should ship as is.
>
> Your checkout is this branch with the change applied; it is the diff from 2ba308b.
> Files changed (8): src/cli.ts, src/commands/council.ts, src/commands/review.ts, src/index.ts, src/replay/html.ts, src/replay/markdown-replay.ts, src/review/quick-review.ts, test/review.test.cjs
>
> ```diff
> diff --git a/src/cli.ts b/src/cli.ts
> index a6c1db2..8569706 100644
> --- a/src/cli.ts
> +++ b/src/cli.ts
> @@ -9,6 +9,7 @@ import { registerProjectCommands } from './commands/project.js';
>  import { registerCouncilCommands } from './commands/council.js';
>  import { registerExecutionCommands } from './commands/execution.js';
>  import { registerReplayCommands } from './commands/replay.js';
> +import { registerReviewCommands } from './commands/review.js';
>
>  const repoRoot = resolveRepoRoot();
>
> @@ -34,5 +35,6 @@ registerProjectCommands(program, context);
>  registerCouncilCommands(program, context);
>  registerExecutionCommands(program, context);
>  registerReplayCommands(program, context);
> +registerReviewCommands(program, context);
>
>  program.parseAsync(process.argv);
> diff --git a/src/commands/council.ts b/src/commands/council.ts
> index fcc39b2..5e96f39 100644
> --- a/src/commands/council.ts
> +++ b/src/commands/council.ts
> @@ -1,4 +1,5 @@
>  import { Command } from 'commander';
> +import { CouncilConfig } from '../types.js';
>  import * as fs from 'fs';
>  import { CouncilEngine } from '../engine/council.js';
>  import { DeliberationEngine } from '../engine/deliberation.js';
> @@ -8,6 +9,15 @@ import { LeadSignoffEngine } from '../engine/signoff.js';
>  import { logger } from '../utils/logger.js';
>  import { CliContext, action, readStdin } from './shared.js';
>
> +/** Prints the Chief Architect's 12-point review of a session's latest draft. */
> +export async function printArchitectReview(config: CouncilConfig, sessionId: string): Promise<void> {
> +  const res = await new ArchitectureReviewEngine(config).runReview(sessionId);
> +  console.log(`\nArchitecture Review Verdict: ${res.verdict}`);
> +  console.log(`Required Concerns: ${res.requiredConcerns}, Advisory Concerns: ${res.advisoryConcerns}`);
> +  for (const c of res.concerns) console.log(`CONCERN ${c.id}: ${c.type} — ${c.principle} — ${c.description}`);
> +  console.log(`SUMMARY: ${res.summary}`);
> +}
> +
>  export function registerCouncilCommands(program: Command, ctx: CliContext): void {
>    program
>      .command('open <slug>')
> @@ -76,15 +86,9 @@ export function registerCouncilCommands(program: Command, ctx: CliContext): void
>      }));
>
>    program
> -    .command('review <session>')
> -    .description('Invoke the Chief Architect for 12-point industry standards sign-off')
> -    .action(action(async (sessionId: string) => {
> -      const res = await new ArchitectureReviewEngine(ctx.config).runReview(sessionId);
> -      console.log(`\nArchitecture Review Verdict: ${res.verdict}`);
> -      console.log(`Required Concerns: ${res.requiredConcerns}, Advisory Concerns: ${res.advisoryConcerns}`);
> -      for (const c of res.concerns) console.log(`CONCERN ${c.id}: ${c.type} — ${c.principle} — ${c.description}`);
> -      console.log(`SUMMARY: ${res.summary}`);
> -    }));
> +    .command('architect-review <session>')
> +    .description('Invoke the Chief Architect for 12-point industry standards sign-off (was `council review <session>`)')
> +    .action(action(async (sessionId: string) => printArchitectReview(ctx.config, sessionId)));
>
>    program
>      .command('signoff <session>')
> diff --git a/src/commands/review.ts b/src/commands/review.ts
> new file mode 100644
> index 0000000..0c30e12
> --- /dev/null
> +++ b/src/commands/review.ts
> @@ -0,0 +1,82 @@
> +import { Command } from 'commander';
> +import * as fs from 'fs';
> +import * as path from 'path';
> +import chalk from 'chalk';
> +import { spawn } from 'child_process';
> +import { REVIEW_ROUNDS, reviewConfig, runReview } from '../review/quick-review.js';
> +import { resolveRepoRoot } from '../utils/paths.js';
> +import { logger } from '../utils/logger.js';
> +import { SessionManager } from '../engine/session.js';
> +import { printArchitectReview } from './council.js';
> +import { CliContext, action } from './shared.js';
> +
> +function openInBrowser(file: string): void {
> +  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
> +  const args = process.platform === 'win32' ? ['/c', 'start', '', file] : [file];
> +  try {
> +    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
> +    child.on('error', () => { /* no opener on this machine: the path is printed anyway */ });
> +    child.unref();
> +  } catch { /* ignore */ }
> +}
> +
> +function isSessionId(words: string[]): boolean {
> +  if (words.length !== 1 || !/^\d{14}-/.test(words[0])) return false;
> +  try { new SessionManager().loadMeta(words[0]); return true; } catch { return false; }
> +}
> +
> +export function registerReviewCommands(program: Command, ctx: CliContext): void {
> +  program
> +    .command('review [task...]')
> +    .description('Have the council tear into your current change (or a one-line plan) and get a page of its objections. No setup; nothing in your repo is written or run.')
> +    .option('--base <ref>', 'Review the commits ahead of this ref instead of uncommitted changes (default: uncommitted, else ahead of origin/main)')
> +    .option('--rounds <n>', `Round budget (default ${REVIEW_ROUNDS})`, (v: string) => parseInt(v, 10))
> +    .option('-o, --out <dir>', 'Also copy review.html and review.md into this directory')
> +    .option('--no-open', 'Do not open the page in a browser when it is done')
> +    .action(action(async (taskWords: string[], options: { base?: string; rounds?: number; out?: string; open: boolean }) => {
> +      // Before 0.3 `council review <session>` ran the Chief Architect's review of a session. Keep that working.
> +      if (isSessionId(taskWords)) {
> +        logger.warn('`council review <session>` is now `council architect-review <session>`. Running that.');
> +        await printArchitectReview(ctx.config, taskWords[0]);
> +        return;
> +      }
> +      const repo = resolveRepoRoot();
> +      if (!fs.existsSync(path.join(repo, '.git'))) {
> +        throw new Error('council review runs inside a git repository. cd into one, or run `git init` and commit first.');
> +      }
> +      const task = taskWords.join(' ').trim() || undefined;
> +      const { config, plan, gates } = await reviewConfig(repo, options.rounds || REVIEW_ROUNDS);
> +      if (plan) logger.info(`Seats (${plan.mode}): ${Object.entries(plan.seats).map(([seat, p]) => `${seat} ${p.provider}/${p.model}`).join(', ')}`);
> +      if (gates && gates.test) logger.info(`Gates from ${gates.source}: ${[gates.test, gates.lint].filter(Boolean).join(', ')} (read by the seats, not run)`);
> +      const result = await runReview(repo, {
> +        task, base: options.base, config,
> +        onSession: (id, mode, change) => {
> +          const what = mode === 'task' ? `the plan "${task}"` : mode === 'uncommitted' ? `your uncommitted change (${change!.files.length} file${change!.files.length === 1 ? '' : 's'})` : `${change!.files.length} file${change!.files.length === 1 ? '' : 's'} changed since ${change!.base}`;
> +          logger.info(`Session ${id}: the council is reviewing ${what}. This takes a few minutes.`);
> +        }
> +      });
> +      let html = result.htmlPath;
> +      let md = result.mdPath;
> +      if (options.out) {
> +        fs.mkdirSync(options.out, { recursive: true });
> +        html = path.join(options.out, 'review.html');
> +        md = path.join(options.out, 'review.md');
> +        fs.copyFileSync(result.htmlPath, html);
> +        fs.copyFileSync(result.mdPath, md);
> +      }
> +      const mins = Math.floor(result.seconds / 60);
> +      console.log('');
> +      console.log(chalk.bold(`The council ${result.outcome === 'STALLED' ? 'could not agree' : 'signed off'} after ${result.rounds} round${result.rounds === 1 ? '' : 's'} (${mins ? `${mins} min ` : ''}${result.seconds % 60} s).`));
> +      if (result.top.length) {
> +        console.log(chalk.bold('\nWhat it found:'));
> +        result.top.forEach((o, i) => console.log(`  ${i + 1}. ${o.headline.replace(/\*\*/g, '')}${o.location ? chalk.dim(` (${o.location})`) : ''}\n     ${chalk.dim(`${o.seat}, round ${o.round}`)}`));
> +      } else {
> +        console.log('\nThe council raised no objections.');
> +      }
> +      console.log(chalk.bold('\nShare it:'));
> +      console.log(`  ${result.share}`);
> +      console.log(`\nPage:     ${html}\nMarkdown: ${md} ${chalk.dim('(paste into a gist or a PR comment)')}`);
> +      console.log(chalk.dim('Nothing in your repo was changed, executed or committed. `council init` sets up the full loop, where the council also builds it and runs your gates.'));
> +      if (options.open && process.stdout.isTTY) openInBrowser(html);
> +    }));
> +}
> diff --git a/src/index.ts b/src/index.ts
> index bfed8df..42224c1 100644
> --- a/src/index.ts
> +++ b/src/index.ts
> @@ -25,3 +25,5 @@ export * from './replay/session-replay.js';
>  export * from './replay/markdown.js';
>  export * from './replay/html.js';
>  export * from './replay/play.js';
> +export * from './replay/markdown-replay.js';
> +export * from './review/quick-review.js';
> diff --git a/src/replay/html.ts b/src/replay/html.ts
> index a705bae..0d43289 100644
> --- a/src/replay/html.ts
> +++ b/src/replay/html.ts
> @@ -1,5 +1,6 @@
>  import { SessionReplay } from './session-replay.js';
>  import { escapeHtml, renderMarkdown } from './markdown.js';
> +import type { TopObjection } from '../review/quick-review.js';
>
>  const SEATS = {
>    pm: { name: 'Lead PM', cls: 'pm' },
> @@ -20,6 +21,8 @@ function fold(summary: string, inner: string): string {
>    return `<details><summary>${escapeHtml(summary)}</summary>${inner}</details>`;
>  }
>
> +const renderInline = (text: string) => renderMarkdown(text).replace(/^<p>|<\/p>$/g, '');
> +
>  const pre = (text: string) => `<pre><code>${escapeHtml(text)}</code></pre>`;
>
>  const CSS = `
> @@ -42,11 +45,13 @@ blockquote{margin:8px 0;padding-left:12px;border-left:3px solid var(--line);colo
>  .table{overflow-x:auto}table{border-collapse:collapse;margin:8px 0;font-size:14px}th,td{border:1px solid var(--line);padding:4px 8px;text-align:left;vertical-align:top}
>  details{margin:10px 0}summary{cursor:pointer;color:var(--muted);font-weight:600}details[open]>summary{margin-bottom:8px}
>  .timeline td:first-child{font-family:ui-monospace,Menlo,monospace;color:var(--muted);white-space:nowrap}
> +h2+.seat{margin-top:8px}.share{margin:20px 0;padding:12px 16px;border:1px dashed var(--line);border-radius:8px}.share .label{font-weight:600;margin-bottom:6px}
> +.share textarea{width:100%;font:14px/1.45 ui-monospace,Menlo,monospace;background:var(--code);color:var(--fg);border:0;border-radius:6px;padding:8px;resize:vertical}
>  footer{margin-top:48px;color:var(--muted);font-size:14px}a{color:var(--eng)}
>  `;
>
>  /** One self-contained HTML page for a session: no scripts, no external requests, every seat reply rendered from its file. */
> -export function renderReplayHtml(r: SessionReplay, options: { note?: string } = {}): string {
> +export function renderReplayHtml(r: SessionReplay, options: { note?: string; top?: TopObjection[]; share?: string } = {}): string {
>    const outcomeClass = r.status === 'DONE' || r.status === 'MERGED' ? 'ok' : r.status === 'BLOCKED' || r.status === 'STALLED' ? 'bad' : 'warn';
>    const parts: string[] = [];
>    parts.push(`<h1>Council replay: ${escapeHtml(r.slug)}</h1>`);
> @@ -54,6 +59,14 @@ export function renderReplayHtml(r: SessionReplay, options: { note?: string } =
>      `round budget ${r.maxRounds}${r.signoffRevisions ? ` plus ${r.signoffRevisions} sign-off revision` : ''}.</p>`);
>    parts.push(`<span class="outcome ${outcomeClass}">Outcome: ${escapeHtml(r.status)}</span>`);
>    if (options.note) parts.push(`<div class="md">${renderMarkdown(options.note)}</div>`);
> +  if (options.top && options.top.length) {
> +    parts.push('<h2>What the council found</h2>' + options.top.map((o, i) =>
> +      seatBlock(o.seat === 'Chief Engineer' ? 'eng' : 'arch', `objection ${i + 1}, round ${o.round}${o.location ? ` · ${o.location}` : ''}`,
> +        `<p><strong>${renderInline(o.headline)}</strong></p>${o.evidence && o.evidence !== o.headline ? `<p>${renderInline(o.evidence)}</p>` : ''}`)).join(''));
> +  }
> +  if (options.share) {
> +    parts.push(`<div class="share"><div class="label">Share it</div><textarea readonly rows="3" aria-label="Share line">${escapeHtml(options.share)}</textarea></div>`);
> +  }
>    parts.push('<p class="lede">Every seat reply below is the text the harness saved, rendered as written. Nothing is summarised.</p>');
>
>    parts.push('<h2>The task</h2>' + `<blockquote>${renderMarkdown(r.task)}</blockquote>`);
> diff --git a/src/replay/markdown-replay.ts b/src/replay/markdown-replay.ts
> new file mode 100644
> index 0000000..88fe6b7
> --- /dev/null
> +++ b/src/replay/markdown-replay.ts
> @@ -0,0 +1,43 @@
> +import { SessionReplay } from './session-replay.js';
> +import type { TopObjection } from '../review/quick-review.js';
> +
> +const quote = (text: string) => text.trim().split('\n').map(l => (l.trim() ? `> ${l}` : '>')).join('\n');
> +
> +function details(summary: string, body: string, lang = ''): string {
> +  const fence = body.includes('```') ? '````' : '```';
> +  return `<details>\n<summary>${summary}</summary>\n\n${fence}${lang}\n${body.trim()}\n${fence}\n\n</details>\n`;
> +}
> +
> +/**
> + * The same replay as Markdown, for places that render it: a GitHub gist, an issue, a pull request comment.
> + * Leads with what the council found; every seat reply follows, folded.
> + */
> +export function renderReplayMarkdown(r: SessionReplay, options: { top?: TopObjection[]; share?: string } = {}): string {
> +  const out: string[] = [];
> +  out.push(`## Council review: ${r.slug}`, '');
> +  const rounds = r.rounds.filter(x => x.engineer).length;
> +  out.push(`Outcome: **${r.status}** after ${rounds} round${rounds === 1 ? '' : 's'} (${r.profile} profile, base \`${r.baseSha.slice(0, 7)}\`).`, '');
> +  if (options.top && options.top.length) {
> +    out.push('### What the council found', '');
> +    options.top.forEach((o, i) => {
> +      out.push(`${i + 1}. **${o.headline.replace(/\*\*/g, '')}**${o.location ? ` (\`${o.location}\`)` : ''}  `);
> +      if (o.evidence && o.evidence !== o.headline) out.push(`   ${o.evidence.replace(/\n+/g, ' ')}`);
> +      out.push(`   _${o.seat}, round ${o.round}_`, '');
> +    });
> +  } else {
> +    out.push('The council raised no objections.', '');
> +  }
> +  out.push('### Every round', '');
> +  for (const round of r.rounds) {
> +    if (round.changes) out.push(details(`Lead PM: what changed in v${round.n}`, round.changes, 'markdown'));
> +    if (round.engineer) out.push(details(`Chief Engineer, round ${round.n}: ${round.engineer.verdict || 'review'}`, round.engineer.reply, 'markdown'));
> +    if (round.architect) out.push(details(`Chief Architect on v${round.n}: ${round.architect.verdict || 'review'}`, round.architect.reply, 'markdown'));
> +    if (round.signoff) out.push(details(`Lead PM sign-off on v${round.n}: ${round.signoff.verdict || ''}`, round.signoff.reply, 'markdown'));
> +  }
> +  if (r.prd) out.push(details('The PRD all three seats signed off', r.prd.text, 'markdown'));
> +  if (r.stalled) out.push(details('Stalled: last draft and open objections', r.stalled, 'markdown'));
> +  out.push('', '<details><summary>The task</summary>', '', quote(r.task), '', '</details>', '');
> +  if (options.share) out.push(`> ${options.share}`, '');
> +  out.push('<sub>Reviewed with <a href="https://github.com/goshtasb/OpenCouncil">Open Council</a>: <code>npx open-council-cli review</code></sub>');
> +  return out.join('\n') + '\n';
> +}
> diff --git a/src/review/quick-review.ts b/src/review/quick-review.ts
> new file mode 100644
> index 0000000..32c0b66
> --- /dev/null
> +++ b/src/review/quick-review.ts
> @@ -0,0 +1,268 @@
> +import * as fs from 'fs';
> +import * as path from 'path';
> +import { spawnSync } from 'child_process';
> +import { CouncilConfig } from '../types.js';
> +import { DEFAULT_CONFIG, findConfigFile, loadConfig } from '../config.js';
> +import { PROVIDER_FIXES, SeatsPlan, detectProviders, planSeats } from '../setup.js';
> +import { SessionReplay, loadSessionReplay, objectionHeadlines } from '../replay/session-replay.js';
> +import { renderReplayHtml } from '../replay/html.js';
> +import { renderReplayMarkdown } from '../replay/markdown-replay.js';
> +import { SessionManager } from '../engine/session.js';
> +import { PipelineManager } from '../engine/pipeline.js';
> +import { CouncilEngine } from '../engine/council.js';
> +import { DeliberationEngine } from '../engine/deliberation.js';
> +
> +/** Round budget for `council review`: short enough to finish in minutes, long enough for one revision. */
> +export const REVIEW_ROUNDS = 3;
> +/** Above this the diff is too big to argue about usefully in one sitting. */
> +export const MAX_REVIEW_DIFF_BYTES = 120_000;
> +
> +function git(cwd: string, args: string[]): { ok: boolean; out: string } {
> +  const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
> +  return { ok: r.status === 0, out: r.stdout || '' };
> +}
> +
> +export interface DetectedGates { install: string; test: string; lint: string; source: string }
> +
> +/** Works out how the project installs and tests itself from the files at its root. Nothing is run. */
> +export function detectGates(repo: string): DetectedGates {
> +  const has = (f: string) => fs.existsSync(path.join(repo, f));
> +  if (has('package.json')) {
> +    let scripts: Record<string, string> = {};
> +    try { scripts = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8')).scripts || {}; } catch { /* unreadable package.json: no scripts */ }
> +    const pm = has('pnpm-lock.yaml') ? 'pnpm' : has('yarn.lock') ? 'yarn' : has('bun.lockb') || has('bun.lock') ? 'bun' : 'npm';
> +    const install = pm === 'npm' ? (has('package-lock.json') ? 'npm ci' : 'npm install') : `${pm} install`;
> +    const run = (s: string) => (pm === 'npm' ? `npm run ${s}` : `${pm} run ${s}`);
> +    const test = scripts.test && !/no test specified/.test(scripts.test) ? (pm === 'npm' ? 'npm test' : `${pm} test`) : '';
> +    return { install, test, lint: scripts.lint ? run('lint') : '', source: 'package.json' };
> +  }
> +  if (has('Cargo.toml')) return { install: '', test: 'cargo test', lint: 'cargo clippy -- -D warnings', source: 'Cargo.toml' };
> +  if (has('go.mod')) return { install: 'go mod download', test: 'go test ./...', lint: 'go vet ./...', source: 'go.mod' };
> +  if (has('pyproject.toml') || has('setup.py') || has('requirements.txt')) {
> +    const install = has('requirements.txt') ? 'pip install -r requirements.txt' : 'pip install -e .';
> +    return { install, test: 'python -m pytest', lint: '', source: has('pyproject.toml') ? 'pyproject.toml' : has('setup.py') ? 'setup.py' : 'requirements.txt' };
> +  }
> +  return { install: '', test: '', lint: '', source: 'nothing recognised' };
> +}
> +
> +/**
> + * The config a review runs with. A project's own .council/config.yml is used when it exists; otherwise the
> + * seats come from the provider CLIs on PATH and the gates from the project files, and nothing is written.
> + * Either way the round budget is cut to `rounds` so a review finishes in minutes.
> + */
> +export async function reviewConfig(repo: string, rounds = REVIEW_ROUNDS, found?: Set<string>): Promise<{ config: CouncilConfig; plan: SeatsPlan | null; gates: DetectedGates | null }> {
> +  let config: CouncilConfig;
> +  let plan: SeatsPlan | null = null;
> +  let gates: DetectedGates | null = null;
> +  if (findConfigFile(repo)) {
> +    config = loadConfig(repo);
> +  } else {
> +    plan = planSeats(found || await detectProviders());
> +    if (plan.mode === 'none') {
> +      throw new Error(`No AI CLI was found on PATH. A review needs at least Claude Code: ${PROVIDER_FIXES['claude-code'].install}, then run \`claude\` once to sign in.`);
> +    }
> +    gates = detectGates(repo);
> +    const base = JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as CouncilConfig;
> +    for (const seat of Object.keys(plan.seats) as (keyof CouncilConfig['seats'])[]) {
> +      base.seats[seat] = { ...base.seats[seat], provider: plan.seats[seat].provider, model: plan.seats[seat].model };
> +    }
> +    base.project = { ...base.project, install_command: gates.install, test_command: gates.test, lint_command: gates.lint };
> +    config = base;
> +  }
> +  const max = Math.max(2, Math.floor(rounds));
> +  config.council = {
> +    ...config.council,
> +    profile: 'quick',
> +    max_rounds: max,
> +    tiebreak_round: Math.max(1, max - 1),
> +    signoff_revisions: 1,
> +    round_timeout_seconds: Math.min(config.council.round_timeout_seconds || 600, 600)
> +  };
> +  return { config, plan, gates };
> +}
> +
> +export interface ReviewChange { kind: 'uncommitted' | 'branch'; diff: string; base: string; files: string[] }
> +
> +function defaultBase(repo: string): string | null {
> +  const head = git(repo, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
> +  const candidates = [head.ok ? head.out.trim() : '', 'origin/main', 'origin/master', 'main', 'master'].filter(Boolean);
> +  for (const ref of candidates) if (git(repo, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).ok) return ref;
> +  return null;
> +}
> +
> +/**
> + * The change to review: uncommitted work if there is any (tracked edits plus new untracked files),
> + * otherwise this branch's commits since it left the base branch. Returns null when there is nothing.
> + */
> +export function collectChange(repo: string, base?: string): ReviewChange | null {
> +  if (!base) {
> +    const tracked = git(repo, ['diff', 'HEAD', '--no-color']).out;
> +    const untracked = git(repo, ['ls-files', '--others', '--exclude-standard']).out.split('\n').filter(Boolean);
> +    let extra = '';
> +    for (const file of untracked) {
> +      const r = spawnSync('git', ['diff', '--no-color', '--no-index', '--', '/dev/null', file], { cwd: repo, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
> +      extra += r.stdout || '';
> +    }
> +    const diff = tracked + extra;
> +    if (diff.trim()) {
> +      const files = git(repo, ['diff', 'HEAD', '--name-only']).out.split('\n').filter(Boolean).concat(untracked);
> +      return { kind: 'uncommitted', diff, base: 'HEAD', files };
> +    }
> +  }
> +  const ref = base || defaultBase(repo);
> +  if (!ref) return null;
> +  if (!git(repo, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).ok) throw new Error(`Unknown base '${ref}'.`);
> +  const diff = git(repo, ['diff', '--no-color', `${ref}...HEAD`]).out;
> +  if (!diff.trim()) return null;
> +  const files = git(repo, ['diff', '--name-only', `${ref}...HEAD`]).out.split('\n').filter(Boolean);
> +  return { kind: 'branch', diff, base: ref, files };
> +}
> +
> +/** The task a change review gives the council. The diff is quoted whole; the seats read the repository for the rest. */
> +export function changeReviewTask(change: ReviewChange): string {
> +  const checkout = change.kind === 'uncommitted'
> +    ? 'Your checkout is the last commit, before this change: the diff below is not applied to it.'
> +    : `Your checkout is this branch with the change applied; it is the diff from ${change.base}.`;
> +  return [
> +    'Review this change before it ships.',
> +    'Lead PM: write the brief and PRD that this change implies: what it is for, what it claims to do, and how we would know it works. Do not invent scope the diff does not show.',
> +    'Chief Engineer: check every claim against the repository and the diff. Object, with file:line, wherever the change is wrong, incomplete, untested, or breaks something that depends on it.',
> +    'Chief Architect: rule on whether it should ship as is.',
> +    '',
> +    checkout,
> +    `Files changed (${change.files.length}): ${change.files.join(', ')}`,
> +    '',
> +    '```diff',
> +    change.diff.trimEnd(),
> +    '```'
> +  ].join('\n');
> +}
> +
> +/** A short session slug from the task or the branch. */
> +export function reviewSlug(repo: string, task?: string): string {
> +  const source = task || `review-${git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']).out.trim() || 'change'}`;
> +  const slug = source.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').split('-').slice(0, 6).join('-');
> +  return (task ? `review-${slug}` : slug).slice(0, 48).replace(/-+$/, '') || 'review';
> +}
> +
> +export interface TopObjection { round: number; seat: 'Chief Engineer' | 'Chief Architect'; headline: string; evidence: string; location?: string }
> +
> +/** Numbered objections with a bold headline; failing that, plain numbered items whose first sentence is the headline. */
> +function engineerObjections(reply: string): { headline: string; evidence: string }[] {
> +  const bold = objectionHeadlines(reply);
> +  if (bold.length) return bold;
> +  const out: { headline: string; evidence: string }[] = [];
> +  for (const line of reply.split('\n')) {
> +    const m = /^\d+\.\s+(.+)$/.exec(line.trim());
> +    if (!m) continue;
> +    const headline = m[1].split(/(?<=[.!?])\s/)[0];
> +    out.push({ headline, evidence: m[1] });
> +  }
> +  return out;
> +}
> +
> +const LOCATION = /\b[\w./-]+\.[A-Za-z]{1,5}:\d+(?:-\d+)?\b/;
> +
> +/**
> + * The objections worth leading with: the Chief Engineer's, earliest round first, those that cite a file:line
> + * ahead of those that don't, then the Chief Architect's required concerns. Duplicates across rounds are dropped.
> + */
> +export function topObjections(replay: SessionReplay, limit = 3): TopObjection[] {
> +  const all: TopObjection[] = [];
> +  for (const round of replay.rounds) {
> +    if (round.engineer && (round.engineer.openObjections ?? 1) > 0) {
> +      for (const o of engineerObjections(round.engineer.reply)) {
> +        const where = LOCATION.exec(`${o.headline} ${o.evidence}`);
> +        all.push({ round: round.n, seat: 'Chief Engineer', headline: o.headline, evidence: o.evidence, location: where?.[0] });
> +      }
> +    }
> +    if (round.architect) {
> +      for (const c of round.architect.concerns.filter(c => /REQUIRED/i.test(c.type))) {
> +        const where = LOCATION.exec(c.description);
> +        all.push({ round: round.n, seat: 'Chief Architect', headline: c.description.split(/(?<=\.)\s/)[0], evidence: c.description, location: where?.[0] });
> +      }
> +    }
> +  }
> +  const seen = new Set<string>();
> +  const unique = all.filter(o => {
> +    const key = o.headline.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 60);
> +    if (seen.has(key)) return false;
> +    seen.add(key);
> +    return true;
> +  });
> +  const rank = (o: TopObjection) => (o.seat === 'Chief Engineer' ? 0 : 100) + (o.location ? 0 : 10) + o.round;
> +  return unique.map((o, i) => ({ o, i })).sort((a, b) => rank(a.o) - rank(b.o) || a.i - b.i).slice(0, limit).map(x => x.o);
> +}
> +
> +const clean = (s: string) => s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/\s+/g, ' ').trim();
> +
> +/** One line someone can paste anywhere: what the council found, in its own words, and how to run one. */
> +export function shareLine(replay: SessionReplay, top: TopObjection[]): string {
> +  const count = top.length;
> +  if (!count) {
> +    return `Three AI seats reviewed my ${/^Review this change before it ships\./.test(replay.task) ? 'change' : 'plan'} and found nothing to object to. Try it on yours: npx open-council-cli review`;
> +  }
> +  const first = clean(top[0].headline).replace(/[.:;]+$/, '');
> +  const where = top[0].location ? ` (${top[0].location})` : '';
> +  const what = /^Review this change before it ships\./.test(replay.task) ? 'my change before shipping it' : 'my plan before building it';
> +  return `I had three AI seats argue over ${what}. First objection, from the ${top[0].seat}: "${first}"${where}. Try it on yours: npx open-council-cli review`;
> +}
> +
> +export interface ReviewOptions {
> +  task?: string;
> +  base?: string;
> +  rounds?: number;
> +  /** Overrides for tests: a ready config and the managers the engines use. */
> +  config?: CouncilConfig;
> +  sessions?: SessionManager;
> +  pipeline?: PipelineManager;
> +  onSession?: (sessionId: string, mode: 'task' | ReviewChange['kind'], change: ReviewChange | null) => void;
> +}
> +
> +export interface ReviewResult {
> +  sessionId: string;
> +  outcome: 'AWAITING_APPROVAL' | 'STALLED';
> +  rounds: number;
> +  seconds: number;
> +  replay: SessionReplay;
> +  top: TopObjection[];
> +  share: string;
> +  htmlPath: string;
> +  mdPath: string;
> +}
> +
> +/**
> + * One review: open a session on the change (or the one-line task), let the council argue it out, and write the
> + * replay as HTML and Markdown into the session directory. Nothing in the repository is written or executed;
> + * the seats read it in the harness's own worktree.
> + */
> +export async function runReview(repo: string, options: ReviewOptions = {}): Promise<ReviewResult> {
> +  const started = Date.now();
> +  let change: ReviewChange | null = null;
> +  let task = options.task && options.task.trim();
> +  if (!task) {
> +    change = collectChange(repo, options.base);
> +    if (!change) {
> +      throw new Error('Nothing to review: no uncommitted changes and no commits ahead of the base branch. Pass a task instead: council review "add rate limiting to the login route"');
> +    }
> +    if (Buffer.byteLength(change.diff) > MAX_REVIEW_DIFF_BYTES) {
> +      throw new Error(`The change is ${Math.round(Buffer.byteLength(change.diff) / 1024)} KB of diff across ${change.files.length} files, more than one review can argue about well (${MAX_REVIEW_DIFF_BYTES / 1000} KB). Commit part of it and review the rest, or pass --base with a closer ref.`);
> +    }
> +    task = changeReviewTask(change);
> +  }
> +  const config = options.config || (await reviewConfig(repo, options.rounds)).config;
> +  const sessions = options.sessions || new SessionManager();
> +  const council = new CouncilEngine(config, sessions, options.pipeline);
> +  const sessionId = await council.open(repo, reviewSlug(repo, options.task), { task, profile: 'quick' });
> +  options.onSession?.(sessionId, change ? change.kind : 'task', change);
> +  const result = await new DeliberationEngine(config, sessions, options.pipeline).run(sessionId);
> +  const dir = sessions.getSessionPath(sessionId);
> +  const replay = loadSessionReplay(dir);
> +  const top = topObjections(replay);
> +  const share = shareLine(replay, top);
> +  const htmlPath = path.join(dir, 'review.html');
> +  const mdPath = path.join(dir, 'review.md');
> +  fs.writeFileSync(htmlPath, renderReplayHtml(replay, { top, share }), 'utf8');
> +  fs.writeFileSync(mdPath, renderReplayMarkdown(replay, { top, share }), 'utf8');
> +  return { sessionId, outcome: result.outcome, rounds: result.rounds, seconds: Math.round((Date.now() - started) / 1000), replay, top, share, htmlPath, mdPath };
> +}
> diff --git a/test/review.test.cjs b/test/review.test.cjs
> new file mode 100644
> index 0000000..543545f
> --- /dev/null
> +++ b/test/review.test.cjs
> @@ -0,0 +1,154 @@
> +const test = require('node:test');
> +const assert = require('node:assert/strict');
> +const fs = require('fs');
> +const os = require('os');
> +const path = require('path');
> +const { spawnSync } = require('child_process');
> +const { lib, home, git, makeRepo, setup, PLAN, SHIP, OBJECT, SIGNOFF, LEAD_OK, revision } = require('./helpers.cjs');
> +
> +const bin = path.join(__dirname, '..', 'bin', 'council.js');
> +const fixture = path.join(__dirname, 'fixtures', 'slugify-empty-and-accents');
> +
> +test('detectGates reads the package manager and scripts, and skips npm\'s placeholder test script', () => {
> +  const repo = makeRepo();
> +  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }));
> +  assert.deepEqual(lib.detectGates(repo), { install: 'npm install', test: '', lint: '', source: 'package.json' });
> +  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ scripts: { test: 'vitest', lint: 'eslint .' } }));
> +  fs.writeFileSync(path.join(repo, 'pnpm-lock.yaml'), '');
> +  assert.deepEqual(lib.detectGates(repo), { install: 'pnpm install', test: 'pnpm test', lint: 'pnpm run lint', source: 'package.json' });
> +  const rust = makeRepo();
> +  fs.writeFileSync(path.join(rust, 'Cargo.toml'), '[package]\nname="x"\n');
> +  assert.equal(lib.detectGates(rust).test, 'cargo test');
> +  assert.equal(lib.detectGates(makeRepo()).source, 'nothing recognised');
> +});
> +
> +test('collectChange takes uncommitted edits and new files first, then the branch since its base, else nothing', () => {
> +  const repo = makeRepo();
> +  assert.equal(lib.collectChange(repo), null, 'a clean main with no remote has nothing to review');
> +
> +  fs.appendFileSync(path.join(repo, 'README.md'), 'more\n');
> +  fs.writeFileSync(path.join(repo, 'new.js'), 'module.exports = 1;\n');
> +  const dirty = lib.collectChange(repo);
> +  assert.equal(dirty.kind, 'uncommitted');
> +  assert.deepEqual(dirty.files.sort(), ['README.md', 'new.js']);
> +  assert.match(dirty.diff, /\+more/);
> +  assert.match(dirty.diff, /\+module\.exports = 1;/);
> +
> +  git(repo, 'checkout', '-qb', 'feature');
> +  git(repo, 'add', '.');
> +  git(repo, 'commit', '-qm', 'feature');
> +  const branch = lib.collectChange(repo);
> +  assert.equal(branch.kind, 'branch');
> +  assert.equal(branch.base, 'main');
> +  assert.deepEqual(branch.files.sort(), ['README.md', 'new.js']);
> +  assert.throws(() => lib.collectChange(repo, 'no-such-ref'), /Unknown base 'no-such-ref'/);
> +});
> +
> +test('reviewConfig plans seats from what is installed, writes nothing, and cuts the round budget', async () => {
> +  const repo = makeRepo();
> +  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }));
> +  const { config, plan, gates } = await lib.reviewConfig(repo, 3, new Set(['claude-code']));
> +  assert.equal(plan.mode, 'solo');
> +  assert.equal(config.seats.chief_engineer.provider, 'claude-code');
> +  assert.equal(config.project.test_command, 'npm test');
> +  assert.equal(gates.source, 'package.json');
> +  assert.equal(config.council.profile, 'quick');
> +  assert.equal(config.council.max_rounds, 3);
> +  assert.equal(config.council.tiebreak_round, 2);
> +  assert.ok(!fs.existsSync(path.join(repo, '.council')), 'a review leaves no config behind');
> +  await assert.rejects(lib.reviewConfig(repo, 3, new Set()), /No AI CLI was found on PATH.*claude\.ai\/install\.sh/s);
> +});
> +
> +test('the change task quotes the whole diff and tells the seats whether the checkout has it', () => {
> +  const task = lib.changeReviewTask({ kind: 'uncommitted', base: 'HEAD', files: ['a.js'], diff: '+x\n' });
> +  assert.match(task, /^Review this change before it ships\./);
> +  assert.match(task, /not applied to it/);
> +  assert.match(task, /```diff\n\+x\n```/);
> +  assert.match(lib.changeReviewTask({ kind: 'branch', base: 'origin/main', files: ['a.js'], diff: '+x' }), /diff from origin\/main/);
> +});
> +
> +test('topObjections leads with the Chief Engineer\'s file:line objections, earliest round first, no repeats', () => {
> +  const replay = lib.loadSessionReplay(fixture);
> +  const top = lib.topObjections(replay);
> +  assert.equal(top.length, 3);
> +  assert.match(top[0].headline, /npm test` already fails at the baseline/);
> +  assert.equal(top[0].location, 'package.json:8');
> +  assert.equal(top[0].round, 1);
> +  assert.ok(top.every(o => o.seat === 'Chief Engineer'));
> +  assert.equal(new Set(top.map(o => o.headline)).size, 3);
> +  const share = lib.shareLine(replay, top);
> +  assert.match(share, /First objection, from the Chief Engineer: "The regression gate .* already fails at the baseline" \(package\.json:8\)\. Try it on yours: npx open-council-cli review$/);
> +  assert.doesNotMatch(share, /\*\*|`/);
> +});
> +
> +test('the review page and Markdown lead with what the council found and the share line, before the rounds', () => {
> +  const replay = lib.loadSessionReplay(fixture);
> +  const top = lib.topObjections(replay);
> +  const share = lib.shareLine(replay, top);
> +  const html = lib.renderReplayHtml(replay, { top, share });
> +  assert.ok(html.indexOf('What the council found') < html.indexOf('<h2>Round 1</h2>'));
> +  assert.match(html, /objection 1, round 1 · package\.json:8/);
> +  assert.match(html, /<textarea readonly[^>]*>I had three AI seats/);
> +  assert.doesNotMatch(html, /<script/i);
> +  const md = lib.renderReplayMarkdown(replay, { top, share });
> +  assert.match(md, /^## Council review: slugify-empty-and-accents/);
> +  assert.ok(md.indexOf('### What the council found') < md.indexOf('### Every round'));
> +  assert.match(md, /1\. \*\*The regression gate.*\*\* \(`package\.json:8`\)/);
> +  assert.match(md, /<summary>Chief Engineer, round 1: SHIP WITH CHANGES<\/summary>/);
> +  assert.match(md, /npx open-council-cli review<\/code><\/sub>\n$/);
> +});
> +
> +test('runReview argues over an uncommitted change and writes both pages without touching the repo', async () => {
> +  const ctx = setup({ council: { max_rounds: 3, tiebreak_round: 2 } });
> +  fs.writeFileSync(path.join(ctx.repo, 'login.js'), 'export const login = () => true;\n');
> +  const before = git(ctx.repo, 'status', '--porcelain');
> +  ctx.adapters.pm.responses.push(PLAN(1), revision(2), LEAD_OK);
> +  ctx.adapters.eng.responses.push(OBJECT, SHIP);
> +  ctx.adapters.arch.responses.push(SIGNOFF);
> +  let seen;
> +  const result = await lib.runReview(ctx.repo, { config: ctx.config, sessions: ctx.sessions, pipeline: ctx.pipeline, onSession: (id, mode, change) => { seen = { id, mode, files: change.files }; } });
> +  assert.equal(result.outcome, 'AWAITING_APPROVAL');
> +  assert.deepEqual(seen, { id: result.sessionId, mode: 'uncommitted', files: ['login.js'] });
> +  assert.match(ctx.adapters.pm.calls[0].prompt, /\+export const login = \(\) => true;/, 'the diff reaches the seats');
> +  assert.equal(result.top.length, 1);
> +  assert.equal(result.top[0].headline, 'Missing test (README.md:1).');
> +  assert.equal(result.top[0].location, 'README.md:1');
> +  assert.match(fs.readFileSync(result.htmlPath, 'utf8'), /What the council found/);
> +  assert.match(fs.readFileSync(result.mdPath, 'utf8'), /Missing test/);
> +  assert.equal(git(ctx.repo, 'status', '--porcelain'), before, 'the repo is exactly as it was');
> +});
> +
> +test('runReview with a task reviews the plan; with nothing to review or a huge diff it says what to do', async () => {
> +  const ctx = setup();
> +  ctx.adapters.pm.responses.push(PLAN(1), LEAD_OK);
> +  ctx.adapters.eng.responses.push(SHIP);
> +  ctx.adapters.arch.responses.push(SIGNOFF);
> +  const result = await lib.runReview(ctx.repo, { task: 'add rate limiting to login', config: ctx.config, sessions: ctx.sessions, pipeline: ctx.pipeline });
> +  assert.match(result.sessionId, /review-add-rate-limiting-to-login$/);
> +  assert.equal(result.top.length, 0);
> +  assert.match(result.share, /reviewed my plan and found nothing to object to/);
> +
> +  await assert.rejects(lib.runReview(makeRepo(), { config: ctx.config }), /Nothing to review.*council review "/s);
> +  const big = makeRepo();
> +  fs.writeFileSync(path.join(big, 'big.txt'), 'x'.repeat(lib.MAX_REVIEW_DIFF_BYTES + 10));
> +  await assert.rejects(lib.runReview(big, { config: ctx.config }), /more than one review can argue about well/);
> +});
> +
> +test('council review outside a git repo, or with no AI CLI on PATH, is one clean line', () => {
> +  // A PATH with only node and git on it, so no AI CLI is found (claude often sits next to node).
> +  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'council-bare-path-'));
> +  fs.symlinkSync(process.execPath, path.join(bare, 'node'));
> +  fs.symlinkSync(spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim(), path.join(bare, 'git'));
> +  const env = { ...process.env, COUNCIL_HOME: home, PATH: bare };
> +  const notRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'council-norepo-'));
> +  const a = spawnSync(process.execPath, [bin, 'review'], { cwd: notRepo, env, encoding: 'utf8' });
> +  assert.equal(a.status, 1);
> +  assert.match(a.stderr, /runs inside a git repository/);
> +  const repo = makeRepo();
> +  fs.appendFileSync(path.join(repo, 'README.md'), 'x\n');
> +  const b = spawnSync(process.execPath, [bin, 'review'], { cwd: repo, env, encoding: 'utf8' });
> +  assert.equal(b.status, 1);
> +  assert.match(b.stderr, /No AI CLI was found on PATH/);
> +  assert.doesNotMatch(b.stderr, /\n\s+at /);
> +  assert.ok(!fs.existsSync(path.join(repo, '.council')));
> +});
> ```

</details>

> I had three AI seats argue over my change before shipping it. First objection, from the Chief Engineer: "A review can reset the worktree under a session that is still running" (src/engine/council.ts:58). Try it on yours: npx open-council-cli review

<sub>Reviewed with <a href="https://github.com/goshtasb/OpenCouncil">Open Council</a>: <code>npx open-council-cli review</code></sub>
