# council build vs one agent on the full-loop tasks (pre-registration)

This folder fixes the question, the arms, the pass rule and the analysis **before any run counts**. Anything changed after this file is merged goes under "Changes after pre-registration" at the end, with the date and the reason.

## Why this benchmark

The full-loop benchmark next door (`../full-loop-2026-11`) lost. The debate design (three seats argue over a plan, one builds, the gates run) passed every hidden test in 6 of 14 runs counting crashes, against 16 of 20 for one Claude Code agent, and took 67.8 minutes and $6.44 per run against 1.1 minutes and $0.34. The one useful signal: on `charge-retries` the council's final plan named the next-day renewal double charge in 3 of 3 runs and then deferred it, while the single agent missed it 4 of 4.

So the council's job changed. `council build` (this branch) has one agent build the task the way the single agent would. Then Claude, Gemini and Grok each read the built change in a read-only checkout and name up to five ways it can still be wrong, as a testable scenario. Every risk becomes a test the builder must write and pass; the harness checks that each risk's test exists, is tagged with its id, is not skipped and was run by `npm test`. The only way out is a rejection that quotes the task or the repository word for word. Nothing can be deferred.

## The question

> On the same five vague tasks, does `council build` pass every hidden test more often than one Claude Code agent given the same request?

**H1:** the build arm passes on a larger share of runs than the single arm.

**Null result we will report as such:** if it does not, or the difference is not significant at the test below, the write-up says so and the council is not promoted on pass rate.

## Tasks

The five tasks of `../full-loop-2026-11/tasks`, unchanged and used in place: `charge-retries`, `late-fees`, `event-pagination`, `daily-usage`, `coupon-redeem`. The scoring is that benchmark's `lib/score.cjs`, unchanged.

## Arms

| Arm | What runs | Runs per task |
| --- | --- | --- |
| **build** | `council build --task-file task.md --no-branch --no-check`, from this checkout (`npm ci && npm run build`). Builder: Claude Code `opus`. Risk seats: Claude Code `opus`, Antigravity `gemini-4-argon-high`, Grok (the newest plain `grok-N.N` that `grok models` lists, kept for the whole batch). One risk round, at most 5 risks per seat, 600 s per risk call, 3 builder tries, `npm test` as the only gate, no failover to another company. | 3 |
| **single** | One Claude Code agent, `opus`, the request as its whole prompt, exactly as in the full-loop benchmark. | 5 |

Every seat runs on its CLI's own plan sign-in; `run.sh` unsets API keys for the run. Nothing is pushed.

If `gemini-4-argon-high` has no quota, `LEAD_CANDIDATES` picks another Gemini model the same way as the full-loop benchmark, and the swap is written to `results/deviations.txt` and shown at the top of the summary. A risk seat that fails during a run (for any reason other than a usage limit or a sign-in) is a gap that `council build` records and works around; such runs are scored as they are, and the summary counts the gaps.

## Pass rule (primary metric)

A run **passes** when the task's original tests and every hidden test pass on its final tree (`../full-loop-2026-11/lib/score.cjs`: the original tests are put back over any edits first).

- The build arm's final tree is its isolated checkout when `council build` ends, `DONE` or `BLOCKED`. A blocked build is scored on what its checkout holds.
- **A crash or a timeout counts as a miss, in both arms.** The user got nothing from it. Time limits: build 60 minutes, single 30 minutes.
- **Not counted, and re-run:** a usage limit or a sign-in prompt anywhere in the run (detected only from what the CLIs report about themselves, `../full-loop-2026-11/lib/limits.cjs`; the batch stops so it can resume later), and a harness error setting up the task repo.

## Analysis (fixed now)

1. **Primary:** passes / counted runs, build vs single, over all five tasks. One-sided Fisher's exact test on the pooled counts, build > single, at p < 0.05. With 15 build runs and 25 single runs only a large difference can show, and the write-up says so.
2. Per task, the same share, reported without a test. The same table without crashes and timeouts, as a secondary view.
3. Per hidden test, the share of scored runs passing it, per arm.
4. How build runs ended: done, blocked, crashed or timed out, and **false done** (done but failed a hidden test).
5. The risk ledger: risks named per company, how many ended as tests, rejected with a quote or missing, and seat gaps.
6. Time and cost: median wall time per run, Claude's reported API-price cost per run (nothing is billed per call on a plan), Gemini and Grok calls per run, and the median time of each build step.

**Decision rule, agreed before running:** if H1 holds, `council build`'s pass rate is the pitch. If the build arm only ties the single agent, the next question is cost: a tie at several times the time is not worth promoting. If it loses, the result is posted as it came out.

## Running it

```
bash benchmarks/risk-tests-2026-11/run.sh
```

It checks every CLI is signed in and answers, then runs every task × arm, two at a time, and writes `summary.md` to `$BENCH_ROOT` (default `~/oc-risk-tests`) and a copy to `~/Desktop/council-build-results.md`. Re-running resumes; finished runs are kept. `PREFLIGHT_ONLY=1` checks sign-ins and stops. The header of `run.sh` lists the other settings.

The runner was smoke-tested in a cloud session with stand-in CLIs that replay each task's reference solution (no model calls): preflight, the build command, the risk ledger, scoring and the summary all ran end to end. No real run has been made.

## Files

- `run.sh` the runner; `lib/config.cjs` the build arm's `.council/config.yml`; `lib/summarize.cjs` the summary
- From `../full-loop-2026-11`: `tasks/`, `lib/score.cjs`, `lib/limits.cjs`, `lib/claude-json.cjs`

## Changes after pre-registration

None yet.
