# Showcase: the first solo-mode councils, on council-playground

- **Repository:** [goshtasb/council-playground](https://github.com/goshtasb/council-playground), a 18-line `slugify` utility with two tests, created as a public test bed.
- **Task:** `slugify('')` throws; make it return `''` (keep throwing for non-strings), and transliterate accented Latin letters (é→e, ü→u, ñ→n) instead of dropping them. Keep the two existing tests passing, add tests, no new dependencies.
- **Seats:** every seat on Claude Code (solo mode): Lead PM `sonnet`, Chief Engineer `opus`, Chief Architect `sonnet` with all tools disabled. Quick profile: at most 4 rounds, tie-break from round 3, one sign-off revision.
- **Date:** 2026-10-14, Open Council v0.2.0 (pre-release build from PR #10).

Two sessions were run on the same task. The first stalled and changed the harness; the second shipped.

## Session 1: stalled at 5 rounds, 14 minutes

1. The Lead drafted v1 in 3 minutes. It asked the Architect one undefined-rule question and answered it itself in the same breath; the Architect ruled "no ruling required".
2. The Chief Engineer replied `SHIP WITH CHANGES`, 2 objections, both with `file:line`:
   - FR-2 (non-string input keeps throwing) was left untested, and the draft's reason ("no code path affecting them changes") was wrong: the guard at `src/slug.js:9` is exactly the line FR-1 edits. It asked for a test asserting `TypeError` for `undefined`, `null` and `123`, and for `'Über'` as a second fixture because the task named ü.
   - The new doc comment and the Solution text claimed "any NFD-decomposable accented Latin letter" while ß, Ø, Ł, æ and œ are still dropped. It had run the proposed pipeline itself to show it.
3. The Lead adopted both. Round 2: `SHIP IT`, zero objections.
4. The Chief Architect then reviewed v2, v3, v4 and v5 and returned a different concern each time: one advisory (add a regression test for the documented gap), then one required (state in the Test Plan that each new test fails on the baseline), then three advisory (name the verifier role, list three asserts separately, put the Unicode range inside FR-3), then one advisory (a Constitution clause was cited by the wrong number). The Lead adopted every one; the Engineer ratified every revision.
5. After 5 rounds (4 plus the one sign-off revision) the harness stopped the session as `STALLED` and wrote `stalled-draft-and-objections.md`: the task, the Engineer's last reply, the Architect's last concern and the full v5 draft, marked unapproved.

What it changed: every concern after round 2 was about text already present in the version before. The review prompt on a resubmission now carries the previous review and the council's response, and states that a concern which could have been raised on the previous version and was not is waived. The legacy transcripts of the three-CLI council show the same loop ("architecture concerns to fix, going round again") 953 times.

## Session 2: signed off in 1 round, 5 minutes 20 seconds

Same task, same seats, run after the resubmission rule landed. The rule did not fire, because there was no resubmission:

1. The Lead drafted v1 in 3 min 26 s, with four MUST requirements in Given/When/Then form and a three-test plan.
2. The Chief Engineer: `SHIP IT`, zero objections, after reproducing both bugs, confirming the 18-line and 11-line baselines, running the existing suite, and running the proposed `normalize('NFD')` pipeline in a throwaway `node -e` without editing a file.
3. The Chief Architect walked the six starred points (1, 3, 4, 6 satisfied; 2 and 5 N/A with reasons; 7 to 12 N/A under the quick profile) and signed off with zero concerns.
4. The Lead signed off last after re-verifying every claim against the worktree. The PRD and its PDF were presented; the operator typed `APPROVE 66611acb`.
5. Execution: see below.

Two runs on one task is not a stall rate. It is one stall and one clean run, and the difference between them is as likely to be sampling variance as the fix. The numbers go in the README once there are enough runs to say.

## Execution and pull request

`council run` took 59 seconds: the Chief Engineer (opus, full permissions inside the clone only) edited `src/slug.js` and `test/slug.test.js`, the harness found no uncommitted work, ran the one configured gate (`npm test`, 5 tests, 0.2 s, pass), pushed `council/slugify-empty-and-accents-2` and opened [PR #1](https://github.com/goshtasb/council-playground/pull/1). The PR body carries the approved PRD's SHA-256, the three sign-offs and the gate result.

The diff does what the PRD says: the empty-string guard is gone, non-strings still throw `TypeError`, `normalize('NFD')` plus a combining-mark strip runs before the existing chain, the doc comment states the remaining gaps, and the three planned tests are added.

Two warts, stated plainly:

- The combining-mark regex was written with literal U+0300 and U+036F characters instead of `\u0300-\u036f` escapes. It works and the tests prove it, but it is hard to read and easy to break in an editor. The PRD gave the range in escaped form; the Engineer did not.
- The Engineer added a second commit, "chore: commit npm lockfile", committing a `package-lock.json` that the harness's own `npm install` step had generated. The harness already knew that file was its own (it is listed as an install artifact and ignored by the clean-tree check); the Engineer was simply never told. The execution prompt now names those files and says to leave them uncommitted.

The PR was left open for a human review, as every council PR should be.
