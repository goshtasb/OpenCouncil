# Full loop: mixed council vs one agent on vague build tasks (pre-registration)

This folder fixes the question, the tasks, the arms, the pass rule and the analysis **before any run counts**. It is merged before the benchmark is run, so the plan can't be changed to fit the results. Anything changed after the merge goes under "Changes after pre-registration" at the end, with the date and the reason.

## The question

OpenCouncil's argument is that three different models plan, build and check each other's work, and get more right because they think differently. The review benchmark next door (`../mixed-council-2026-11`) tests the review step alone. This one tests the whole loop:

> Given a short, vague request in a small codebase, does a council of Gemini (Lead PM), Claude (Chief Engineer) and Grok (Chief Architect), running OpenCouncil's full plan → approve → build → verify loop, ship a change that passes the hidden acceptance tests more often than one Claude Code agent given the same request?

**Primary hypothesis (H1):** the mixed council passes every hidden test on a larger share of runs than the single agent.

**Null result we will report as such:** if the mixed council does not pass more often, or the difference is not significant at the test below, the write-up says so, and the next step is to change what the seats do before any more promotion.

## Tasks

Five small Node.js repos (no dependencies, `node --test`), each with a one- or two-sentence request written the way a busy product owner would write it. Each request leaves out something the codebase or its docs make clear, and the hidden tests check that thing. Nothing in the request, the repo or the visible tests names what the hidden tests check.

| Task | The request | What it leaves out (checked by the hidden tests) |
| --- | --- | --- |
| `charge-retries` (idempotency key) | Make `chargeCustomer` retry gateway timeouts, up to 3 times. | A timeout can follow a charge that went through (`docs/gateway.md`), so a retry must reuse one idempotency key. The renewal job retries a failed renewal on the next day's run, so its key must be per subscription and period, not per call. Declines must not be retried. |
| `late-fees` (misleading notes) | Add a 1.5% late fee to invoices unpaid 30 days after the due date, as its own line. | The README and a code comment are wrong about units (seconds vs milliseconds, dollars vs cents). The nightly job can run more than once a day, so the fee must be added once. Disputed invoices are on hold. The month-end ledger export throws on an unknown line kind, so the fee needs an account (`docs/chart-of-accounts.md` lists one). |
| `event-pagination` | Paginate `listEvents` the way `listUsers` does. | Imported history has many events with the same timestamp, so a cursor on time alone skips or repeats them. New events arrive while clients page. The route and the compliance CSV export also call `listEvents`, and the export must still contain every event. |
| `daily-usage` | Add `dailyUsage(store, accountId, days, now)`: one entry per day for the last `days` days, oldest first. | Days are the account's local days (time zone from the account, else its region), including across daylight saving changes. Days with no usage still get an entry. Synthetic probe events are not usage. Raw events are kept for 7 days; older days come from daily rollups. |
| `coupon-redeem` | Add `redeemCoupon(kv, code, userId, now)`; respect the coupon's usage limits. | Checkouts run concurrently, so a read-then-write lets a 5-use coupon be used more than 5 times; the store has an atomic `update`. A null limit means no limit. Codes are case-insensitive. Coupons from the new admin tool store `expiresAt` as an ISO date string. Refusals follow the `{ ok, reason }` convention of `wallet.js` instead of throwing. |

Each task folder holds `repo/` (what the agent gets), `task.md` (the request, word for word), `hidden/` (the acceptance tests, never shown to any agent) and `reference/` (a solution, used only to check that the hidden tests can be passed). Before pre-registering, every task was checked both ways: the untouched repo fails its hidden tests, and the repo with `reference/` copied over passes all of them. Wrong-but-plausible variants were also checked to fail: an offset cursor and a timestamp-only cursor on `event-pagination`, and 24-hour steps instead of calendar days on `daily-usage`.

## Arms

| Arm | What runs | Runs per task |
| --- | --- | --- |
| **mixed** (the council) | `open-council-cli` 0.4.0, full loop, `--full` project setup. Lead PM: Antigravity CLI, `gemini-4-argon-high`. Chief Engineer: Claude Code, `opus`. Chief Architect: Grok CLI, the newest plain `grok-N.N` model it lists (recorded in `meta.txt`). | 3 |
| **single** (the baseline) | One Claude Code agent, `opus`, given the request as its whole prompt, with `--permission-mode acceptEdits` and only file, search, `node`, `npm test`/`npm run` and read-only git tools. | 10 |
| solo (secondary, optional) | The same council loop with every seat on Claude Code (side seats `sonnet`). Run only with `ARMS="mixed single solo"`. It separates "three seats" from "three different models". | 3 |

**Council settings (fixed):** the council profile is set in `run.sh` (`PROFILE`, see "Council profile" below). One gate, `npm test`. No dependency install, no seat failover to another provider (a failed seat makes the run unscored rather than quietly changing the arm), no auto-merge. The benchmark acts as a hands-off user: when the council asks for approval it approves the signed-off plan unread, then hands off and runs execution. The council's "open a pull request" step is pointed at a stand-in for `gh` that only records the call, so nothing is pushed anywhere.

**Sign-ins only:** every seat uses its CLI's own plan sign-in. `run.sh` unsets any API key in the environment for the run.

### Council profile

The pre-registered run uses the **full** profile, which is what `council init` sets up unless you pass `--quick`: up to 10 rounds, tie-break from round 7, 15-minute round timeout, 2 sign-off revisions. The quick profile (4 rounds) was tried in the pilot and stalled before building every time (see "Pilot"), so a quick-profile run would mostly measure stalls. `PROFILE=quick` is kept in `run.sh` for anyone who wants that comparison; it is not part of this pre-registration.

## Pass rule (primary metric)

A run **passes** when, on the run's final working tree, the task's original tests and every hidden test pass. Before scoring, the tree is copied, the task's original test files are put back over any edits the agent made to them, and the hidden tests are added (`lib/score.cjs`).

- The final tree is the single agent's folder when it finishes, and the council's execution worktree when execution ends (done or blocked).
- **A council that stalls in planning, or blocks in execution, is scored on whatever its tree holds.** A stall built nothing, so it is scored on the untouched repo and counts as a miss. Stalling is the council's own outcome, not an error.
- **Not scored, and re-run:** a crash of the harness or a CLI, a run killed by the time limit (council 2 hours, single agent 30 minutes), a usage limit (the run stops so it can resume later), or a seat that failed to answer. These say nothing about either arm's work.
- **How a usage limit is detected:** only from what the CLIs report about themselves: Claude's error results in the call log, and the stderr of Claude Code, Antigravity and Grok (`lib/limits.cjs`). Model text is never read for this, so a task about quotas or rate limits can't trip it. A limit anywhere in a run, even one the run recovered from, makes the run unscored and stops the batch after the runs in flight; an Antigravity sign-in prompt does the same. A limit hit by the late sign-off judge keeps the run's score and judges it again on the next run.

### If the pre-registered Lead PM has no quota

`gemini-4-argon-high` may be out of its Antigravity quota when the batch runs (it was for days in the 10-PR benchmark). `run.sh` then takes `LEAD_CANDIDATES`, Lead PM models to try in order, and uses the first that answers the same plan-mode call the seat makes (`auto` adds every other Gemini model `agy models` lists, never the retired `gemini-3.1-pro-high`). With no candidates it uses only the pre-registered model. A swap is written to `results/deviations.txt` and shown at the top of `summary.md`; each mixed run records the model it ran on (`lead-model`), and the summary sets each Lead PM model's mixed runs against the single agent on the same tasks only.

## Analysis (fixed now)

1. **Primary:** passes / scored runs for mixed and for single, over all five tasks. Test: one-sided Fisher's exact test on the pooled counts, mixed > single, at p < 0.05. With 15 mixed runs and 50 single runs this only detects a large difference, and the write-up says so.
2. **Per task:** the same share for each task and arm, reported without a test.
3. **Per hidden test:** the share of runs passing each hidden test, per arm (which trap each arm falls into).
4. **How council runs ended:** stalled in planning, blocked in execution, done, and **false done** (the council reported done but failed a hidden test).
5. **Late sign-offs that would have flipped the gate:** for each council run that failed a hidden test, did a concern raised at sign-off (the Chief Architect's review or the Lead PM's sign-off, after the Chief Engineer ratified the plan) name the problem that test checks? Judged by Claude Opus with no tools, from the sign-off text and the hidden test source only (`lib/flip.cjs`). A concern that names it "would have flipped the gate": had it blocked sign-off, the problem was on the table. The same judge also says whether the council's **final plan** (the signed-off brief, or the stalled draft) described the problem, so a run that never saw it is told apart from one that saw it and ruled it out of scope.
6. **Time and cost:** median wall time per run, Claude's reported API-price cost per run (nothing is billed per call on a plan), and Gemini and Grok calls per run.

The solo arm, if run, gets rows 2 to 6 and the same comparison against single, as secondary results.

**Decision rule, agreed before running:** if H1 holds, the full loop's pass rate is the pitch. If it doesn't, the seats' roles change before any more promotion, and this result is posted as it came out.

## Pilot (here, before pre-registering; not counted)

The brief was to make sure the set isn't too easy for one agent. Single-agent pilots (Claude Code, `opus`, same settings as the single arm) ran in a cloud session:

| Round | Change before the round | Single agent passed |
| --- | --- | --- |
| 0 | First draft of the five tasks | 10/10 |
| 1 | Hardened: misleading README and comment in `late-fees`, rollups and region fallback in `daily-usage`, ISO dates in `coupon-redeem`, the next-day renewal in `charge-retries` | 6/10 |
| 2 | Added `docs/chart-of-accounts.md` to `late-fees` (round 1 agents correctly refused to ship a fee with no ledger account; that was a trap with no fair answer, so it was removed) | 12/15 |

In round 2 the single agent passed `late-fees`, `event-pagination`, `daily-usage` and `coupon-redeem` 3 of 3 each and `charge-retries` 0 of 3 (every miss was the next-day renewal charging twice). So the set is near the ceiling for one agent on four tasks, with room on one. That is the honest shape of it: the council has little room to win on pass rate except `charge-retries`, and can lose by stalling or over-building. Hardening further until the single agent fails more would tune the tasks against the baseline, so it was stopped here.

Two all-Claude council runs were also tried here (quick profile, not counted): on `late-fees` and `charge-retries` both stalled after 4 rounds without building. The `charge-retries` plan did raise the renewal risk ("a renewal run never recharges an ambiguous outcome") but planned retries off by default. One all-Claude council run on `charge-retries` with the full profile (not counted) took 36 minutes: 10 rounds, then sign-off, build and a passing `npm test` gate. It failed the same hidden test as the single agent (the next-day renewal), which the single agent reached in under a minute. Its 13,000-word plan described that exact double charge and then ruled it out of scope ("persisting a per-period key needs its own PRD"). That run also showed a harness bug, now fixed: the task repo had no `origin`, so the council's push step failed and a finished run read as blocked. Each task repo now gets a local bare repo as `origin`.

No mixed-council pilot ran here: Antigravity and Grok are signed in only on the owner's Mac.

## Running it

```
bash benchmarks/full-loop-2026-11/run.sh
```

It checks every CLI is signed in and answers, installs `open-council-cli@0.4.0` into its own folder, then runs every task × arm and writes `summary.md` into `$BENCH_ROOT` (default `~/oc-full-loop`). Re-running resumes; finished runs are kept. `PREFLIGHT_ONLY=1` checks sign-ins and stops. Expect about 5 to 6 hours: the one full-profile council run in the pilot took 36 minutes, so 15 mixed runs two at a time take about 4.5 hours, and 50 single-agent runs (1 to 3 minutes each) about an hour. A plan usage limit stops the batch cleanly and says which plan hit it; running it again later resumes. Only one copy runs at a time. The header of `run.sh` lists the other settings.

## Files

- `tasks/<task>/` the five tasks, as above
- `run.sh` the runner; `lib/score.cjs` scoring, `lib/config.cjs` the council config per arm, `lib/flip.cjs` the late sign-off judge, `lib/summarize.cjs` the summary, `lib/claude-json.cjs` call logging, `lib/limits.cjs` usage-limit and sign-in detection

## Changes after pre-registration

None yet.
