# Mixed council vs one agent on real pull requests (pre-registration)

This folder fixes the question, the task set, the arms, the scoring and the analysis **before any run counts**. It is merged before the benchmark is run, so the plan can't be changed to fit the results. Anything changed after the merge is listed under "Changes after pre-registration" at the end, with the date and the reason.

## The question

OpenCouncil's argument is that three different models check each other's work and catch more because they think differently. This benchmark tests that on real code review:

> On pull requests whose bugs actually shipped in open-source projects, does a council of Gemini (Lead PM), Claude (Chief Engineer) and Grok (Chief Architect) find more of the known issues than one Claude agent given the same change and the same instructions?

**Primary hypothesis (H1):** the mixed council finds a larger share of the known core issues than the single agent.

**Null result we will report as such:** if the mixed council does not find more, or the difference is not significant at the test below, the write-up says so.

## Why real bugs, and what was dropped first

The first draft used 7 synthetic review tasks written for this benchmark (an over-refund note, an idempotency key, cross-file units, cursor ties, a coupon race, a cache key and a clean control). Before pre-registering, a pilot ran one Claude Opus agent on them: it caught the planted bug in 12 of 12 runs and passed the clean control in 2 of 2. Harder versions of two tasks were also caught 6 of 6. A task set the single agent always solves can't show a council doing better, so it was dropped. The pilot files are kept outside this repo with the project's working notes; they are not part of this benchmark.

## Task set

**Source:** the offline set of the [Martian code review benchmark](https://github.com/withmartian/code-review-benchmark), pinned at commit `e616e849755441da38f18bf3adba2c9583b03803` (MIT licence, copied in `golden/LICENSE-martian.txt`). It holds 50 pull requests from Sentry, Grafana, Keycloak, Discourse and Cal.com, each with human-written "golden comments": the known issues in that PR, with a severity and a category. The PR code is in the public `ai-code-review-evaluation` forks that benchmark reviewed.

**Selection rule (fixed before any run):** in each of the five golden files, in file order, take the first two PRs that have at least one High or Critical golden comment, skipping a PR whose code is identical to one already taken. One PR was skipped: `sentry-greptile` PR 2 has the same head commit as PR 1, so the second Sentry PR is PR 4.

That gives 10 PRs in 5 languages, with 33 known issues: 29 in the core categories below, and 13 rated High or Critical.

| Task | Language | Known issues (core) | High or Critical |
| --- | --- | --- | --- |
| sentry-audit-log-pagination | Python | 4 (4) | 3 |
| sentry-github-oauth-state | Python | 3 (3) | 1 |
| grafana-anonymous-device-limit | Go | 5 (5) | 2 |
| grafana-authz-caching | Go | 3 (3) | 1 |
| keycloak-idp-login-cache | Java | 2 (2) | 1 |
| keycloak-authz-crypto-provider | Java | 4 (3) | 1 |
| discourse-topic-unsubscribe | Ruby | 2 (1) | 1 |
| discourse-blocked-email | Ruby | 3 (3) | 1 |
| calcom-async-appstore-import | TypeScript | 2 (1) | 1 |
| calcom-2fa-backup-codes | TypeScript | 5 (4) | 1 |

`tasks.json` holds, for each task, the fork, PR number, base and head commits, and the golden comments copied unchanged. **Core categories** are Martian's default scoring profile: bug, security, concurrency, data, api, perf, test_gap and doc_defect.

**Checkout:** for each run, `lib/fixture.sh` builds a local repository whose `main` is the base commit and whose `pr` branch is the base plus the PR's diff as one commit. It checks that the `pr` tree is identical to the PR's head commit, so the reviewer sees exactly the change that was reviewed in the original benchmark. Commit messages and history from the PR are not included; the one commit is titled with the PR's title. All 10 checkouts were built and matched their head commits before this was submitted.

## Arms

All arms review the same checkout with `open-council-cli` 0.3.2 from the public npm registry, or the same review instructions for the single agent. Every seat runs on its CLI's own plan sign-in; API keys in the environment are ignored for the run.

| Arm | Lead PM | Chief Engineer | Chief Architect |
| --- | --- | --- | --- |
| **mixed** (primary) | Gemini `gemini-4-argon-high` (Antigravity CLI, plan mode) | Claude `opus` (Claude Code) | Grok, newest plain `grok-N.N` the Grok CLI lists, tools off |
| **single** (primary) | one Claude Code agent on `opus`, plan mode, `single-agent-prompt.md` | | |
| **solo** (secondary, optional) | Claude `sonnet` | Claude `opus` | Claude `sonnet`, tools off |

- The council arms run `council review --base main --no-open`, the same command a user runs.
- The single agent gets the diff, the list of changed files and the same instruction the council's review carries: that notes saying something is handled elsewhere are unverified claims. It answers with Blocking and Non-blocking findings.
- **Nothing in the reviewed code is run.** Claude seats run in plan mode, the Grok seat has every tool denied, Gemini runs in plan mode, and the council's install and test gates are empty. Seats read the checkout; they don't execute it.
- The **solo** arm (an all-Claude council) separates "a council" from "different models". It is not run by default because it doubles the run time; if it is run, it is reported with the rest and its comparisons are secondary.

**Runs:** 3 per task per arm (30 mixed, 30 single). The schedule runs run 1 of every task and arm before any run 2, so a batch stopped early is still balanced.

**Is 10 runs worth it?** Not up front. With 29 core issues, 3 runs per arm gives each issue a hit rate of 0, 1/3, 2/3 or 1 per arm, which is enough for the per-issue sign test below to detect a large gap (for example, the council finding an issue more often on 10 issues and less often on 2 gives p = 0.04). Ten runs would mostly narrow the estimate of a gap we may not have, at about three times the run time and plan usage. If the result is close, a later extension to more runs will be reported as an extension, with the 3-run result alongside it.

## Scoring

**Labelled review.** `lib/review-text.cjs` turns each run's output into labelled sections (`S1`, `S2`, …) and records which seat wrote each and whether it was raised as blocking:

- single: each Blocking and each Non-blocking item.
- council: the Lead PM's first and final drafts; each Chief Engineer round, with each open objection as its own blocking section; each Chief Architect review, with each REQUIRED concern blocking and each ADVISORY concern not; the tie-break and question rounds; and each finding in the "What the council found" list of the review the user is shown.

**Judge.** A Claude Opus judge (`lib/judge-prompt.md`) reads the labelled review and the task's known issues and decides, for each issue, whether the review identifies the same underlying issue, following Martian's judging rule. A match must be raised as a problem, risk or needed fix; describing the code, or a general remark that would fit many problems, doesn't count. The judge lists every section that raises it, quotes the review, and counts the distinct problems the review raises. It runs through the Claude CLI on the same plan with no tools, no MCP servers and an empty folder. An answer whose sections don't exist in the review is not counted as found.

**Cross-check judge.** Gemini (`gemini-4-argon-high`, plan mode) grades every run with the same prompt. Its scores are secondary; the agreement rate between the two judges is reported.

**Primary metric:** pooled core recall per arm: core known issues found divided by core known issues, over all scored runs.

**Primary test:** for each of the 29 core issues, compare the share of mixed runs that found it with the share of single runs that found it. Count the issues where mixed is higher and where single is higher, drop ties, and apply an exact two-sided sign test. H1 is supported if mixed is higher and p < 0.05.

**Secondary measures,** reported for every arm:

- High or Critical recall, all-category recall, and core issues raised as blocking.
- The same comparison under the Gemini judge, and judge agreement.
- For the mixed arm, which seat raised each issue it found, and how many found issues no Claude seat raised (the direct test of "different models catch different things"). The final draft is not credited to a seat, and the user-facing findings list counts for the seat it names only when no round raised the issue, since it repeats earlier rounds.
- Median distinct problems raised, known issues found per problem raised (a rough precision proxy), and median review length, because a longer review has more chances to match.
- Wall time per run, Claude tokens and the API-price cost Claude Code reports. Gemini and Grok don't report usage, so their cost is not measured; their call counts are.

**Runs that fail.** A run that errors, times out or hits a usage limit is not scored and never counts as a miss. The script stops the batch at a usage limit; running the same command again resumes and re-runs unscored runs. A judge answer that can't be parsed is re-judged on the next resume, without re-running the review. All of these are listed in the summary.

**Hand audit.** Before results are published, a person reads every run where the two judges disagree, plus five other runs per arm picked at random, and reports any decision they would change. Judge scores are not edited; disagreements are reported alongside them.

## Known limits

- **Reference result.** Martian's published results already include Claude Code on these PRs: an older Claude Code version found 14 of these 33 known issues. Their mixed multi-model entry scored below Claude Code across all 50 PRs (35% vs 48% recall). So a mixed council winning here is not the expected result.
- **Contamination.** These PRs and their golden comments have been public since 2025; any model may have seen them in training. That affects every arm.
- **Judge bias.** The primary judge is Claude, and two of the three arms are mostly Claude. The Gemini cross-check and the hand audit are there to catch that.
- **Length.** A council produces far more text than one agent. Blocking-only recall, distinct problems raised and review length are reported so a win from volume alone is visible.
- **Golden comments are incomplete.** A review can find a real problem that isn't in the list; it gets no credit here. Distinct problems raised is reported for that reason.
- **Model versions.** Seat models are aliases (`opus`, `sonnet`, Grok's newest) as each CLI resolves them on the day; the summary records the models each run actually used.
- **Smoke test.** Before submission, the single arm was run once on two tasks to test the scoring end to end (it found 3 of 5 known issues). Those runs are not part of the results.

## How to run

Requirements: macOS or Linux, Node 18+, git, and the Claude Code, Antigravity (`agy`) and Grok CLIs, each signed in with a plan. Disk: about 3 GB for the repository cache.

```bash
bash benchmarks/mixed-council-2026-11/run.sh
```

- `PREFLIGHT_ONLY=1` checks that each CLI is signed in and answers, prints each seat's model, then stops.
- `ARMS="mixed single solo"` adds the all-Claude council.
- `RUNS=5`, or `RUNS_MIXED`, `RUNS_SINGLE`, `RUNS_SOLO`, change the runs per arm.
- `PARALLEL=2` is the number of runs at once (default 2).
- Results go to `~/oc-bench/results`, and the summary to `~/oc-bench/summary.md` and `summary.json`. Ctrl-C stops; the same command resumes.

Nothing is pushed, posted or published by the script.

## Changes after pre-registration

None yet.
