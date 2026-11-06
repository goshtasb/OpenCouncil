# Replay: slugify: empty string and accented letters (signed off, gate passed)

Session `20261106190450-slugify-empty-and-accents`, quick profile, base commit `a1908f9`, round budget 4 plus 1 sign-off revision. Outcome: **BLOCKED**.

Solo mode (every seat on Claude Code: Lead PM sonnet, Chief Engineer opus, Chief Architect sonnet with tools off), Open Council 0.2.1, run on 2026-11-06 against a local copy with no GitHub remote, so the run could not open a pull request.

Every quoted block below is the seat's reply exactly as the harness saved it. Nothing is summarised.

## The task

> slugify('') throws; make it return '' (keep throwing for non-strings), and transliterate accented Latin letters (é→e, ü→u, ñ→n) instead of dropping them. Keep the two existing tests passing, add tests, no new dependencies.

## Timeline

| Time | Event |
|---|---|
| 00:00 | Created session slugify-empty-and-accents on commit a1908f9dbb82a796413470f325b0228639e11fb3 |
| 00:44 | Saved plan-v1 (7e4047eacb45dac6af119fae74f49df740948704495bedfe1242b518755c8b48) |
| 01:32 | Round 1 finished: SHIP WITH CHANGES, objections: 1, converged: false |
| 02:04 | Saved changes-v2 (2d9367a8b74c09990093c5ccdab516e2adf16b8bbc67a1e8df53b13b1270241f) |
| 02:04 | Saved plan-v2 (e23ad52208ab6d850bb88b9a80f2bfea21e7657a537d4e5988866979e0290145) |
| 02:46 | Round 2 finished: SHIP WITH CHANGES, objections: 2, converged: false |
| 03:16 | Saved changes-v3 (3cb94776666f2952a43a961473dbe20a42a3d1ebb9bc4a881938abb3cd35bb62) |
| 03:16 | Saved plan-v3 (bba83210643831cbc2575bb5e72e4c917edac2da82c8fb7ad0a99919f2da12cb) |
| 03:45 | Round 3 finished: SHIP IT, objections: 0, converged: true |
| 04:53 | Architecture review finished: SIGN-OFF WITH CONCERNS (Required: 0, Advisory: 4) |
| 05:26 | Saved changes-v4 (ff8f6ec71876c50e13f209f62c90a8e02b27747298f3949435989f0bcfa1f7a5) |
| 05:26 | Saved plan-v4 (47d99f766e0e840a5871b1220c214c2713688498add521700ff206585be5d4f1) |
| 05:58 | Round 4 finished: SHIP IT, objections: 0, converged: true |
| 06:22 | Architecture review finished: SIGN-OFF (Required: 0, Advisory: 0) |
| 06:37 | Council Lead sign-off on v4: SIGN-OFF |
| 06:37 | Status changed to AWAITING_APPROVAL |
| 06:37 | Status changed to APPROVED |
| 06:38 | Status changed to IN_EXECUTION |
| 07:54 | Status changed to IN_EXECUTION |
| 07:54 | Verification passed at 1dab67c2458ac9e709de8ba0c6153c4522916aae: test=pass |
| 07:54 | Status changed to BLOCKED |

## Round 1

<details>
<summary>Lead PM: draft v1 (full text)</summary>

````markdown
# Product Brief

## Executive Summary
`slugify` has two gaps its own header comment lists (`src/slug.js:4-7`). It throws on `''`, and it drops accented letters, so `'Café'` becomes `caf`. We fix both with a few lines of pure JavaScript and no new dependencies.

## Problem Statement & Impact
- `slugify('')` throws at `src/slug.js:9-11`. Callers with an optional or blank title must wrap the call in try/catch.
- `.replace(/[^a-z0-9]+/g, '-')` at line 14 turns `é`, `ü` and `ñ` into separators. `'Crème brûlée'` becomes `cr-me-br-l-e`, and `'Año'` becomes `a-o`.
- Impact is on any non-English title. No usage telemetry exists. The repo is a test bed (`package.json` description), and the only callers are the 2 tests.

## Solution & Scope
**In scope**
- `slugify('')` returns `''`.
- Non-string input keeps throwing `TypeError`.
- Accented Latin letters are transliterated to their base letter. Unicode NFD normalization separates each letter from its combining marks (`\u0300-\u036f`), and the marks are removed.
- The stale "Known gaps" comment is updated.
- New tests.

**Explicitly out of scope**
- Letters with no NFD decomposition: `ß ø æ œ đ ł þ`. They still become separators, as today, and are listed as a known gap in the comment.
- Non-Latin scripts.
- Length limiting.
- Any new dependency.
- README changes. It documents only `npm test`.

## User Journeys & Jobs-to-be-Done
- A developer slugifies a user-supplied title that may be blank. They get `''` and can decide for themselves what to do with it.
- A developer slugifies `'Año Nuevo'`. They get `ano-nuevo`, not `a-o-nuevo`.

## Success Metrics
- **North Star:** correct outputs for the specified inputs, measured as 100% of the new and existing tests passing under `npm test`.
- **Guardrails:**
  - The 2 existing tests are unchanged and pass.
  - `package.json` gains no dependency.
  - `src/slug.js` stays at or under 250 lines (S-02 §3).
- **Baseline → target:** 2 tests, 2 passing, 2 known behavior gaps → at least 8 tests passing, 0 gaps in scope.
- **Instrumentation:** the `node --test` output.

## Risks & Mitigations
- **Behavior change.** `''` previously threw. This is a deliberate relaxation, and any caller that relied on the throw would no longer get it. The repo has no other callers (grep finds none). Mitigation: a test pins the new contract.
- **Unexpected input shapes.** NFD plus mark-stripping also strips marks from non-Latin scripts, for example Devanagari or Arabic. Those scripts are already dropped entirely by `[^a-z0-9]`, so output is unchanged.
- **Dependency and vendor risk.** None. `String.prototype.normalize` is built into Node (v22.23.4 here).
- **Compliance.** N/A: the function handles no personal data.

## Key Assumptions & Chief Architect Rulings
- A whitespace-only or punctuation-only string returns `''` through the existing regex path. It is not treated as an error.
- `'ß'` and similar letters are out of scope. Operator examples cover only decomposable letters, and a hand-built map would invite shadow data models (Constitution §1).
- No rulings have been requested. The standards and constitution cover everything needed.

# PRD

## Verified Baseline
- `src/slug.js` (18 lines): CommonJS, exports `{ slugify }`. The non-string and empty guard is at lines 9-11. The transform chain is at lines 12-15.
- `test/slug.test.js` (10 lines): 2 tests, run via `npm test` = `node --test test/` (`package.json`).
- HEAD is a1908f9. `package.json` has zero dependencies.
- The repo has no `src/features/` tree, so the Vertical Slice layout in S-01 does not apply. The single-module layout stays as is.

## Functional Requirements
**FR-1.** `slugify` MUST return `''` for the empty string `''`.
- Given `''`, when `slugify('')` is called, then the result is `''` and nothing is thrown.

**FR-2.** `slugify` MUST throw `TypeError` for any non-string input, including `undefined`, `null`, `42`, `{}` and `[]`.
- Given `undefined` (or each other value), when `slugify(value)` is called, then a `TypeError` is thrown.

**FR-3.** `slugify` MUST transliterate accented Latin letters to their ASCII base letter before the dash-collapsing step.
- Given `'Café'`, when `slugify` is called, then the result is `cafe`.
- Given `'Über Straße'`, when `slugify` is called, then the result is `uber-stra-e`, because `ß` is documented out of scope.
- Given `'Año Nuevo'`, when `slugify` is called, then the result is `ano-nuevo`.
- Given `'Crème brûlée'`, when `slugify` is called, then the result is `creme-brulee`.

**FR-4.** The existing behavior MUST be unchanged for ASCII input.
- Given `'Hello World'`, when `slugify` is called, then the result is `hello-world`.
- Given `'Add Stripe: webhook idempotency!'`, when `slugify` is called, then the result is `add-stripe-webhook-idempotency`.

**FR-5.** The "Known gaps" comment MUST be updated. It drops the empty-title and accent gaps and adds "letters without a Unicode decomposition (ß, ø, æ, đ, ł) are still treated as separators".

**Implementation (smallest change, `src/slug.js` only):**
```js
if (typeof title !== 'string') {
  throw new TypeError('slugify: title must be a string');
}
return title
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '');
```
`''` flows through the chain and returns `''`, so no special case is needed. This fixes the whole class of "non-ASCII letters dropped" for decomposable characters rather than patching individual characters (Constitution §3).

## Non-Functional Requirements
- **Performance:** O(n) in input length, with 4 linear passes. N/A as a budget: there is no latency-sensitive caller.
- **Security and privacy:** pure function, no I/O, no secrets, no data stored. The input is treated as data only (Constitution §9).
- **Accessibility and i18n:** WCAG N/A (no UI). i18n improves for Latin-script languages (French, German, Spanish, Portuguese and others).
- **Cost:** zero.

## Invariants & Architecture Compliance
- The function stays pure and keeps a single source of truth. There is no parallel character map (Constitution §1).
- The guard still fails closed on non-strings (§2).
- The exported signature is unchanged. The one contract relaxation (`''` no longer throws) is additive for callers, because no caller can have depended on the throw in a way that breaks (§7).

## Engineering Standards Compliance
- **02 Coding Practices §2:** a pure functional core with no side effects.
- **02 Coding Practices §3:** the file stays far under 250 lines.
- **02 Coding Practices §4:** camelCase naming is kept.
- **02 Coding Practices §5:** typed `TypeError` at the boundary, which is the existing pattern.
- **02 Coding Practices §6:** tests sit adjacent to the code, in `test/slug.test.js`, the repo's existing convention.
- **01 Architecture / 03 Documentation:** N/A: the playground has no feature modules or ADR-worthy decision.

## Standards & Compliance
- **Security, privacy:** N/A: pure string function.
- **Reliability:** deterministic.
- **Rollback:** revert the single commit. The change has no persisted state, so a revert cannot corrupt data (Constitution §8).

## Test Plan
All tests are unit level and deterministic, with no I/O. They go in `test/slug.test.js` using `node:test`.
1. Existing 2 tests, unchanged (FR-4).
2. `empty string returns empty string` (FR-1). This is a repro test: it fails before the change because `''` throws, and passes after (Constitution §5).
3. `non-strings still throw TypeError` (FR-2), using `assert.throws` over `undefined`, `null`, `42`, `{}` and `[]`.
4. `accented letters are transliterated`, covering `é→e`, `ü→u`, `ñ→n` (FR-3). It uses `Café`, `Über`, `Año Nuevo` and `Crème brûlée`. It fails before the change because the accents are dropped.
5. `decomposition-free letters still separate` (FR-3), pinning `Über Straße` to `uber-stra-e` so the documented gap is explicit.
6. `whitespace and punctuation only returns empty string`, with `'  !! '` giving `''`.

**Regression gate:** the full `npm test` suite passes before the PR is marked ready.

## Traceability
| Requirement | Proving test |
|---|---|
| FR-1 | `empty string returns empty string` |
| FR-2 | `non-strings still throw TypeError` |
| FR-3 | `accented letters are transliterated`, `decomposition-free letters still separate` |
| FR-4 | the 2 existing tests |
| FR-5 | review check of the comment diff |

## Observability & Operability
N/A: a library function with no runtime telemetry, SLO or alerting.

## Rollout, Flagging & Rollback
- Ships as one commit, with no flag and no migration.
- Rollback is `git revert`.
- Revert if any existing test regresses or a consumer reports a changed slug for ASCII input. Such a change should not be possible, since the ASCII path is unchanged.

## Dependencies & Supply Chain
No new dependencies. `String.prototype.normalize` is built in, so there is no license or vulnerability exposure.

# Executive Summary
We make `slugify('')` return `''` and keep `TypeError` for non-strings. We transliterate accented Latin letters (`é→e`, `ü→u`, `ñ→n`) by normalizing to NFD and removing combining marks. The change touches `src/slug.js` and adds tests to `test/slug.test.js`. It adds no dependency and leaves the 2 existing tests untouched. Letters with no Unicode decomposition (`ß ø æ đ ł`) are explicitly out of scope and documented as a known gap. Rollback is a single revert.
````

</details>

**Chief Engineer: review of v1**

> VERDICT: SHIP WITH CHANGES
> OPEN OBJECTIONS: 1
>
> 1. **The regression gate and the North Star metric can't be measured: `npm test` already fails at the baseline.** `package.json:8` defines `"test": "node --test test/"`. On the repo's Node v22.23.4, `node --test` treats `test/` as a module path, not a directory. It fails with `Error: Cannot find module '.../worktree/test'` (MODULE_NOT_FOUND) and reports `# tests 1 / # pass 0 / # fail 1`. Neither existing test runs.
>
>    This breaks several parts of the draft:
>    - The Verified Baseline says the 2 tests are "run via `npm test`". That is false.
>    - The North Star ("100% … passing under `npm test`") can't be met.
>    - The regression gate (Constitution §5) can't be met either.
>    - Test Plan items 2 and 4 say they "fail before the change". Nobody can show that through the project's own runner.
>
>    I checked two working alternatives. Both report `tests 2 / pass 2 / fail 0`:
>    - bare `node --test`, which finds `test/slug.test.js` by default discovery
>    - `node --test 'test/**/*.test.js'`
>
>    **Change required:**
>    - Add to scope: change the `test` script to `"node --test"`, as its own first commit (`fix(test): make npm test discover test files on Node 22`). This is a one-line change to `package.json` and adds no dependency.
>    - Correct the Verified Baseline to say that `npm test` is broken at a1908f9 and that the 2 tests pass only when the file is run directly.
>    - Change the "Explicitly out of scope / README changes" line. The README still documents `npm test`, and after this fix that instruction works again.
>    - Test Plan: run the repro tests (items 2 and 4) through the fixed `npm test` against the old `src/slug.js` and record that they fail. Then apply the slug change and record that they pass.
>    - Add a guardrail: `npm test` exits 0 and reports `fail 0` with at least 8 tests.
>
> Notes (not objections):
> - I ran the proposed chain (NFD, strip `\u0300-\u036f`, lowercase, regex) against every input the draft names. All outputs match the draft: `''`→`''`, `Café`→`cafe`, `Über Straße`→`uber-stra-e`, `Año Nuevo`→`ano-nuevo`, `Crème brûlée`→`creme-brulee`, `'  !! '`→`''`. Both existing ASCII cases are unchanged. An already-decomposed `Cafe\u0301` also gives `cafe`.
> - Test 6 (whitespace or punctuation only returns `''`) has no FR in the Traceability table. Add it as FR-1b or tie it to the Key Assumption.
> - Under NFD, ligatures and compatibility characters (`ﬁ`, `ǅ`, `Ⅻ`) still become `''`. NFKD would map them to letters, but that goes beyond the Operator's ask. Optionally list them in the known-gaps comment next to `ß ø æ đ ł`.
> - The `TypeError` message changes from "non-empty string" to "string". Tests should assert on the error type, not the message text.
> - `grep` across the repo finds no callers of `slugify` outside `test/`, which confirms the draft's risk claim.
>
> Not checked:
> - `.council/` contents (config, personas, references) beyond confirming they exist.
> - Node versions other than v22.23.4. Whether `node --test test/` ever worked on another Node version is unverified.
> - Any CI configuration. None was found at the repo root.
> - Lint or format tooling. None is configured in `package.json`, so none was run.

## Round 2

**Lead PM: what changed in v2**

> # Response to Objections
>
> **1. `npm test` is broken at baseline: adopted.** I did not run `npm test` for v1, so the claim that it ran the 2 tests was unverified and wrong. The draft now changes as follows:
> - A first commit changes the `package.json:8` script to `"node --test"`, with no new dependency.
> - The Verified Baseline states that `npm test` fails at a1908f9 with MODULE_NOT_FOUND.
> - The README line is moved to "In scope, verified, no edit needed". The README already documents `npm test`, and the fix makes that instruction true.
> - The Test Plan runs the repro tests through the fixed `npm test` against the old `src/slug.js` and records the failures. It then applies the slug change and records the passes.
> - A guardrail is added: `npm test` exits 0 with `fail 0` and at least 8 tests.
>
> **Notes adopted:**
> - Test 6 is now tied to FR-1b.
> - Ligatures and compatibility characters (`ﬁ ǅ Ⅻ`) are added to the known-gaps comment, and NFKD stays out of scope.
> - Tests assert the `TypeError` type, not the message text.
>
> **Still unverified:** other Node versions, and CI (none found).

<details>
<summary>Draft v2 (full text)</summary>

````markdown
# Product Brief

## Executive Summary
`slugify` has two gaps its own header comment lists (`src/slug.js:4-7`). It throws on `''`, and it drops accented letters, so `'Café'` becomes `caf`. A prerequisite is also broken: `npm test` cannot run any test on Node 22. We fix all three with a few lines and no new dependencies.

## Problem Statement & Impact
- `slugify('')` throws (`src/slug.js:9-11`), so callers with blank titles need try/catch.
- `.replace(/[^a-z0-9]+/g, '-')` (line 14) turns `é ü ñ` into separators. `'Crème brûlée'` becomes `cr-me-br-l-e`.
- `package.json:8` has `"test": "node --test test/"`. On Node v22.23.4 it fails with MODULE_NOT_FOUND (`tests 1 / fail 1`), so neither existing test runs through the project's runner (Chief Engineer's finding; bare `node --test` gives `tests 2 / pass 2`).
- No usage telemetry exists. The only callers of `slugify` are the tests (grep).

## Solution & Scope
**In scope**
1. Commit 1, `fix(test): make npm test discover test files on Node 22`: change the script to `"node --test"`.
2. Commit 2: `slugify('')` returns `''`, and non-strings still throw `TypeError`.
3. Accented Latin letters are transliterated through NFD normalization plus removal of combining marks `\u0300-\u036f`.
4. The "Known gaps" comment is updated, and new tests are added.

**Out of scope**
- Letters without an NFD decomposition (`ß ø æ œ đ ł þ`).
- Ligatures and compatibility characters (`ﬁ ǅ Ⅻ`). NFKD would handle them, but that goes beyond the ask.
- Non-Latin scripts and length limiting.
- New dependencies.
- README edits. It already documents `npm test`, which works again after commit 1.

## User Journeys & Jobs-to-be-Done
- A developer slugifies a possibly blank title and gets `''`, then decides what to do with it.
- A developer slugifies `'Año Nuevo'` and gets `ano-nuevo`, not `a-o-nuevo`.
- A contributor runs `npm test` and sees real results.

## Success Metrics
- **North Star:** `npm test` exits 0 and reports `fail 0` with at least 8 tests.
- **Guardrails:**
  - The 2 existing tests are unchanged and pass.
  - `package.json` gains no dependency.
  - `src/slug.js` stays at or under 250 lines (S-02 §3).
- **Baseline → target:** 0 tests runnable via `npm test` → at least 8 passing, with 0 in-scope gaps.
- **Instrumentation:** `node --test` output.

## Risks & Mitigations
- **Contract relaxation.** `''` no longer throws. Grep finds no other callers, and a test pins the new contract.
- **Non-Latin marks.** Mark stripping also affects scripts such as Devanagari, but those are already dropped by `[^a-z0-9]`, so output is unchanged.
- **Node-version behavior.** `normalize` is built in. The test-script fix is verified only on v22.23.4 (unverified elsewhere).
- **Dependency, vendor and compliance risk.** None. The function handles no personal data (N/A).

## Key Assumptions & Chief Architect Rulings
- Whitespace-only or punctuation-only input returns `''` through the existing regex path (FR-1b).
- Letters without a decomposition stay out of scope. A hand-built map would create a shadow data model (Constitution §1).
- The `TypeError` message changes from "non-empty string" to "string". Tests assert the type only.
- No Architect rulings were requested.

# PRD

## Verified Baseline
- HEAD is a1908f9.
- `src/slug.js` is 18 lines, CommonJS, and exports `{ slugify }`. The guard is at lines 9-11 and the transform chain at lines 12-15.
- `test/slug.test.js` has 2 tests and `package.json` has zero dependencies.
- **`npm test` is broken at a1908f9.** The script `node --test test/` fails on Node v22.23.4. The 2 tests pass only through `node --test` or `node --test 'test/**/*.test.js'`.
- There is no `src/features/` tree, so S-01 layout rules do not apply. There is no CI and no lint configuration.

## Functional Requirements
**FR-0.** `npm test` MUST discover and run `test/*.test.js`.
- Given a clean checkout, when `npm test` runs, then it exits 0 and runs all tests.

**FR-1.** `slugify('')` MUST return `''` without throwing.

**FR-1b.** Input containing only whitespace or punctuation MUST return `''`.
- Given `'  !! '`, when `slugify` is called, then the result is `''`.

**FR-2.** Non-string input MUST throw `TypeError`.
- Given `undefined`, `null`, `42`, `{}` or `[]`, when `slugify` is called, then a `TypeError` is thrown.

**FR-3.** Accented Latin letters MUST be transliterated to their ASCII base letter.
- `'Café'` → `cafe`
- `'Año Nuevo'` → `ano-nuevo`
- `'Crème brûlée'` → `creme-brulee`
- `'Über Straße'` → `uber-stra-e` (`ß` is a documented gap)
- Decomposed `'Cafe\u0301'` → `cafe`

**FR-4.** ASCII behavior MUST be unchanged.
- `'Hello World'` → `hello-world`
- `'Add Stripe: webhook idempotency!'` → `add-stripe-webhook-idempotency`

**FR-5.** The "Known gaps" comment MUST drop the empty-title and accent gaps. It MUST add: letters without a decomposition (`ß ø æ đ ł`) and ligatures or compatibility characters (`ﬁ ǅ Ⅻ`) are still treated as separators.

**Implementation:**
```js
if (typeof title !== 'string') {
  throw new TypeError('slugify: title must be a string');
}
return title
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '');
```
`''` flows through the chain and returns `''`. This addresses the whole class of decomposable characters rather than patching individual payloads (Constitution §3). The Chief Engineer ran this chain on every named input and confirmed the outputs.

## Non-Functional Requirements
- **Performance:** O(n), 4 linear passes. There is no latency-sensitive caller, so no budget applies.
- **Security and privacy:** pure function, no I/O, no secrets, input treated as data (Constitution §9).
- **Accessibility and i18n:** WCAG N/A (no UI). Latin-script i18n improves.
- **Cost:** zero.

## Invariants & Architecture Compliance
- The function stays pure with no parallel character map (§1).
- The guard still fails closed on non-strings (§2).
- The exported signature is unchanged and the change is additive for callers (§7).
- Each commit reverts independently (§8).

## Engineering Standards Compliance
- **02 Coding Practices §2:** pure functional core.
- **02 Coding Practices §3:** file stays far under 250 lines.
- **02 Coding Practices §4:** camelCase naming.
- **02 Coding Practices §5:** typed `TypeError` at the boundary.
- **02 Coding Practices §6:** tests adjacent in `test/slug.test.js`, the repo's existing convention.
- **01 Architecture and 03 Documentation:** N/A: no feature modules or ADR-worthy decision.

## Standards & Compliance
N/A: security and privacy are not applicable to a pure string function. Reliability is deterministic. Rollback is `git revert` of either commit, with no persisted state (§8).

## Test Plan
All tests are deterministic unit tests using `node:test`, with no I/O.
1. The 2 existing tests stay unchanged (FR-4).
2. `empty string returns empty string` (FR-1).
3. `whitespace and punctuation only returns empty string` (FR-1b).
4. `non-strings throw TypeError`, asserting the type only (FR-2).
5. `accented letters are transliterated` (FR-3).
6. `decomposition-free letters still separate` (FR-3).

**Repro procedure (Constitution §5):**
1. Apply commit 1.
2. Add the new tests.
3. Run `npm test` against the old `src/slug.js`. Record that tests 2, 3 and 5 fail. Tests 4 and 6 pin existing behavior and pass.
4. Apply the slug change.
5. Run `npm test` again. Record `fail 0`, at least 8 tests, and exit 0.

## Traceability
| Requirement | Proving test |
|---|---|
| FR-0 | `npm test` runs and reports the tests (gate) |
| FR-1 | `empty string returns empty string` |
| FR-1b | `whitespace and punctuation only returns empty string` |
| FR-2 | `non-strings throw TypeError` |
| FR-3 | `accented letters are transliterated`, `decomposition-free letters still separate` |
| FR-4 | the 2 existing tests |
| FR-5 | review of the comment diff |

## Observability & Operability
N/A: a library function with no runtime telemetry, SLO or alerting.

## Rollout, Flagging & Rollback
- Two commits, no flag and no migration.
- Rollback is `git revert` of either commit.
- Revert if any existing test regresses or an ASCII slug changes.

## Dependencies & Supply Chain
No new dependencies. `String.prototype.normalize` is built in.

# Executive Summary
We fix `npm test` first, because `node --test test/` fails on Node 22 and no test currently runs through the project's runner. We then make `slugify('')` return `''` and keep `TypeError` for non-strings. Accented Latin letters (`é→e`, `ü→u`, `ñ→n`) are transliterated through NFD normalization and removal of combining marks. The changes touch `package.json`, `src/slug.js` and `test/slug.test.js`. There are no new dependencies, and the 2 existing tests are unchanged. Letters and ligatures without a decomposition (`ß ø æ đ ł ﬁ`) are a documented gap. The repro tests are shown failing before the change and passing after. Rollback is a revert of either commit.
````

</details>

**Chief Engineer: review of v2**

> VERDICT: SHIP WITH CHANGES
> OPEN OBJECTIONS: 2
>
> 1. **The test-count gate can't be met with the planned tests.** The Test Plan lists the 2 existing tests (item 1) and 5 new ones (items 2–6), which makes 7. The North Star metric, the "Baseline → target" line and Repro step 5 all require "at least 8 tests". The baseline has 2 tests in `test/slug.test.js:5-11`. If the plan is followed exactly, the gate fails. Under Constitution §5 a PR isn't ready until the gate passes, so this blocks the PR.
>    **Change:** In all three places, set the gate to `tests 7 / pass 7 / fail 0`, the exact count. An exact count also catches a test that silently goes missing. The other option is to name an 8th test with its FR.
>
> 2. **The repro record expects a failure that won't happen.** Repro step 3 says tests 2, 3 and 5 fail against the old `src/slug.js`. Test 3 (FR-1b, input `'  !! '`) passes on the old code. The guard at `src/slug.js:9` rejects only length 0, and the regex chain at lines 12-15 already returns `''` for this input. I confirmed this with `node -e`: the old code returns `""`. An engineer following step 3 would get a result that contradicts the record. Constitution §5 needs an honest before/after record.
>    **Change:**
>    - Expected failures before the fix: test 2 (`''` throws) and test 5 (`Café` gives `caf` on old code).
>    - Expected passes before the fix: tests 3 and 4, which pin existing behavior.
>    - Test 6: say whether it asserts `'Über Straße'` → `uber-stra-e`. That input fails on old code (`ber-stra-e`). A ß-only input such as `'Straße'` → `stra-e` passes. Record whichever one is chosen.
>    - Fix the numbering: the Response to Objections says "Test 6 is now tied to FR-1b", but in the draft test 3 is the FR-1b test and test 6 traces to FR-3. Make the two agree.
>
> **What I verified** (read-only, at a1908f9, Node v22.23.4):
> - **Test script:** `npm test` (`node --test test/`) gives `tests 1 / fail 1`. Bare `node --test` gives `tests 2 / pass 2`. Running `find` shows `test/slug.test.js` is the only file the default discovery picks up, so FR-0's change to `"node --test"` is correct.
> - **New chain:** I ran the proposed implementation chain on every FR-3 and FR-4 input. All outputs match the draft: `cafe`, `ano-nuevo`, `creme-brulee`, `uber-stra-e`, `cafe`, `hello-world`, `add-stripe-webhook-idempotency`, and `''` for both `''` and `'  !! '`.
> - **Decomposed input:** `'Cafe\u0301'` already gives `cafe` on the old code. This is fine as a regression pin, but it doesn't prove the fix. It is not an objection.
> - **Repo facts:**
>   - No dependencies in `package.json`.
>   - `src/slug.js` is 18 lines.
>   - No CI and no lint config in the tree.
>   - No callers outside the tests, based on the file listing. The repo is only `src/`, `test/`, `README.md` and `package.json`.
>
> Notes (not objections):
> - `[\u0300-\u036f]` covers only the Combining Diacritical Marks block. That is enough for the Latin scope; marks outside it are already dropped by `[^a-z0-9]`.
>
> Not checked:
> - Node versions other than v22.23.4.
> - `README.md` content (I didn't re-read it this round).
> - `.council/` contents. These are council config, not product code, and I treated them as data.

## Round 3

**Lead PM: what changed in v3**

> # Response to Objections
>
> 1. **Adopted.** The plan has 2 existing tests plus 5 new ones, which is 7 tests. The North Star, the Baseline → target line and Repro step 5 now all say exactly `tests 7 / pass 7 / fail 0`. An exact count also catches a test that silently goes missing.
> 2. **Adopted.** I confirm that the FR-1b input `'  !! '` already returns `''` on the old code, because the guard at `src/slug.js:9` rejects only length 0. The repro record is rewritten:
>    - **Fail before the fix:** test 2 (`''` throws), test 5 (`Café` gives `caf`) and test 6 (`'Über Straße'` gives `ber-stra-e`).
>    - **Pass before the fix:** the 2 existing tests, test 3 and test 4. These pin existing behavior.
>    - **Test 6 input:** it asserts `'Über Straße'` → `uber-stra-e`, which fails on old code, so it proves the fix. The `ß` gap is pinned in the same assertion.
>    - **Numbering:** test 3 is the FR-1b test and tests 5 and 6 trace to FR-3. The Traceability table now uses the same numbers.

<details>
<summary>Draft v3 (full text)</summary>

````markdown
# Product Brief

## Executive Summary
`slugify` has two gaps its own header comment lists (`src/slug.js:4-7`). It throws on `''`, and it drops accented letters, so `'Café'` becomes `caf`. A prerequisite is also broken: `npm test` cannot run any test on Node 22. We fix all three with a few lines and no new dependencies.

## Problem Statement & Impact
- `slugify('')` throws (`src/slug.js:9-11`), so callers with blank titles need try/catch.
- `.replace(/[^a-z0-9]+/g, '-')` (line 14) turns `é ü ñ` into separators. `'Crème brûlée'` becomes `cr-me-br-l-e`.
- `package.json:8` has `"test": "node --test test/"`. On Node v22.23.4 it fails with MODULE_NOT_FOUND (`tests 1 / fail 1`), so neither existing test runs through the project's runner. Bare `node --test` gives `tests 2 / pass 2` (Chief Engineer, reproduced).
- No usage telemetry exists. The only callers of `slugify` are the tests.

## Solution & Scope
**In scope**
1. Commit 1, `fix(test): make npm test discover test files on Node 22`: change the script to `"node --test"`.
2. Commit 2: `slugify('')` returns `''`, and non-strings still throw `TypeError`.
3. Accented Latin letters are transliterated through NFD normalization plus removal of combining marks `\u0300-\u036f`.
4. The "Known gaps" comment is updated, and 5 new tests are added.

**Out of scope**
- Letters without an NFD decomposition (`ß ø æ œ đ ł þ`).
- Ligatures and compatibility characters (`ﬁ ǅ Ⅻ`).
- Non-Latin scripts and length limiting.
- New dependencies.
- README edits. It already documents `npm test`, which works again after commit 1.

## User Journeys & Jobs-to-be-Done
- A developer slugifies a possibly blank title and gets `''`, then decides what to do with it.
- A developer slugifies `'Año Nuevo'` and gets `ano-nuevo`, not `a-o-nuevo`.
- A contributor runs `npm test` and sees real results.

## Success Metrics
- **North Star:** `npm test` exits 0 and reports exactly `tests 7 / pass 7 / fail 0`.
- **Guardrails:**
  - The 2 existing tests are unchanged and pass.
  - `package.json` gains no dependency.
  - `src/slug.js` stays at or under 250 lines (S-02 §3).
- **Baseline → target:** 0 tests runnable via `npm test` → 7 passing.
- **Instrumentation:** `node --test` output.

## Risks & Mitigations
- **Contract relaxation.** `''` no longer throws. Grep finds no other callers, and a test pins the new contract.
- **Non-Latin marks.** Mark stripping also affects scripts such as Devanagari, but those are already dropped by `[^a-z0-9]`, so output is unchanged.
- **Node-version behavior.** `normalize` is built in. The test-script fix is verified only on v22.23.4 (unverified elsewhere).
- **Dependency, vendor and compliance risk.** None. The function handles no personal data (N/A).

## Key Assumptions & Chief Architect Rulings
- Whitespace-only or punctuation-only input already returns `''` through the existing regex path (FR-1b).
- Letters without a decomposition stay out of scope. A hand-built map would create a shadow data model (Constitution §1).
- The `TypeError` message changes from "non-empty string" to "string". Tests assert the type only.
- No Architect rulings were requested.

# PRD

## Verified Baseline
- HEAD is a1908f9.
- `src/slug.js` is 18 lines, CommonJS, and exports `{ slugify }`. The guard is at lines 9-11 and the transform chain at lines 12-15.
- `test/slug.test.js` has 2 tests (lines 5-11) and `package.json` has zero dependencies.
- `npm test` is broken at a1908f9. The script `node --test test/` fails on Node v22.23.4. Bare `node --test` discovers only `test/slug.test.js`.
- There is no `src/features/` tree, so S-01 layout rules do not apply. There is no CI and no lint configuration.

## Functional Requirements
**FR-0.** `npm test` MUST discover and run `test/*.test.js`.
- Given a clean checkout, when `npm test` runs, then it exits 0 and reports `tests 7 / pass 7 / fail 0`.

**FR-1.** `slugify('')` MUST return `''` without throwing.

**FR-1b.** Input containing only whitespace or punctuation MUST return `''`.
- Given `'  !! '`, when `slugify` is called, then the result is `''`.

**FR-2.** Non-string input MUST throw `TypeError`.
- Given `undefined`, `null`, `42`, `{}` or `[]`, when `slugify` is called, then a `TypeError` is thrown.

**FR-3.** Accented Latin letters MUST be transliterated to their ASCII base letter.
- `'Café'` → `cafe`
- `'Año Nuevo'` → `ano-nuevo`
- `'Crème brûlée'` → `creme-brulee`
- `'Über Straße'` → `uber-stra-e` (`ß` is a documented gap)
- Decomposed `'Cafe\u0301'` → `cafe` (a regression pin, since old code already passes)

**FR-4.** ASCII behavior MUST be unchanged.
- `'Hello World'` → `hello-world`
- `'Add Stripe: webhook idempotency!'` → `add-stripe-webhook-idempotency`

**FR-5.** The "Known gaps" comment MUST drop the empty-title and accent gaps. It MUST add: letters without a decomposition (`ß ø æ đ ł`) and ligatures or compatibility characters (`ﬁ ǅ Ⅻ`) are still treated as separators.

**Implementation:**
```js
if (typeof title !== 'string') {
  throw new TypeError('slugify: title must be a string');
}
return title
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '');
```
`''` flows through the chain and returns `''`. This addresses the whole class of decomposable characters rather than patching individual payloads (Constitution §3). The Chief Engineer ran this chain on every FR-1b, FR-3 and FR-4 input and confirmed the outputs.

## Non-Functional Requirements
- **Performance:** O(n), 4 linear passes. There is no latency-sensitive caller, so no budget applies.
- **Security and privacy:** pure function, no I/O, no secrets, input treated as data (Constitution §9).
- **Accessibility and i18n:** WCAG N/A (no UI). Latin-script i18n improves.
- **Cost:** zero.

## Invariants & Architecture Compliance
- The function stays pure with no parallel character map (§1).
- The guard still fails closed on non-strings (§2).
- The exported signature is unchanged and the change is additive for callers (§7).
- Each commit reverts independently (§8).

## Engineering Standards Compliance
- **02 Coding Practices §2:** pure functional core.
- **02 Coding Practices §3:** file stays far under 250 lines.
- **02 Coding Practices §4:** camelCase naming.
- **02 Coding Practices §5:** typed `TypeError` at the boundary.
- **02 Coding Practices §6:** tests adjacent in `test/slug.test.js`, the repo's existing convention.
- **01 Architecture and 03 Documentation:** N/A: no feature modules or ADR-worthy decision.

## Standards & Compliance
N/A: security and privacy are not applicable to a pure string function. Reliability is deterministic. Rollback is `git revert` of either commit, with no persisted state (§8).

## Test Plan
All tests are deterministic unit tests using `node:test`, with no I/O. There are 7 tests in total.
1. The 2 existing tests stay unchanged (FR-4).
2. `empty string returns empty string` (FR-1).
3. `whitespace and punctuation only returns empty string` (FR-1b).
4. `non-strings throw TypeError`, asserting the type only (FR-2).
5. `accented letters are transliterated`: `Café`, `Año Nuevo`, `Crème brûlée` and decomposed `Cafe\u0301` (FR-3).
6. `letters without decomposition still separate`: `'Über Straße'` → `uber-stra-e` (FR-3).

**Repro procedure (Constitution §5):**
1. Apply commit 1.
2. Add the new tests.
3. Run `npm test` against the old `src/slug.js`.
   - **Expected fail:** test 2 (`''` throws), test 5 (`Café` gives `caf`) and test 6 (`'Über Straße'` gives `ber-stra-e`).
   - **Expected pass:** the 2 existing tests, test 3 and test 4. These pin existing behavior.
4. Apply the slug change.
5. Run `npm test` again. Record exit 0 and `tests 7 / pass 7 / fail 0`.

## Traceability
| Requirement | Proving test |
|---|---|
| FR-0 | `npm test` reports `tests 7 / pass 7 / fail 0` (gate) |
| FR-1 | test 2 |
| FR-1b | test 3 |
| FR-2 | test 4 |
| FR-3 | tests 5 and 6 |
| FR-4 | the 2 existing tests |
| FR-5 | review of the comment diff |

## Observability & Operability
N/A: a library function with no runtime telemetry, SLO or alerting.

## Rollout, Flagging & Rollback
- Two commits, no flag and no migration.
- Rollback is `git revert` of either commit.
- Revert if any existing test regresses or an ASCII slug changes.

## Dependencies & Supply Chain
No new dependencies. `String.prototype.normalize` is built in.

# Executive Summary
We fix `npm test` first, because `node --test test/` fails on Node 22 and no test currently runs through the project's runner. We then make `slugify('')` return `''` and keep `TypeError` for non-strings. Accented Latin letters (`é→e`, `ü→u`, `ñ→n`) are transliterated through NFD normalization and removal of combining marks. The changes touch `package.json`, `src/slug.js` and `test/slug.test.js`. There are no new dependencies, and the 2 existing tests are unchanged. Letters and ligatures without a decomposition (`ß ø æ đ ł ﬁ`) are a documented gap. The gate is exactly `tests 7 / pass 7 / fail 0`. The repro record shows tests 2, 5 and 6 failing before the change and all 7 passing after. Rollback is a revert of either commit.
````

</details>

**Chief Engineer: review of v3**

> VERDICT: SHIP IT
> OPEN OBJECTIONS: 0
>
> Both objections from round 2 are fixed in v3. The test count is pinned at exactly `tests 7 / pass 7 / fail 0` everywhere it appears. The repro record now correctly says tests 3 and 4 pass on the old code and tests 2, 5 and 6 fail on it.
>
> **What I checked at a1908f9, Node v22.23.4:**
> 1. **Baseline.** `src/slug.js` is 18 lines. The guard is at `src/slug.js:9-11` and the transform chain at `src/slug.js:12-15`. The "Known gaps" comment is at `src/slug.js:4-6`; the draft cites lines 4-7, but line 7 is the closing `*/`, so it makes no difference. `test/slug.test.js` has 2 tests (lines 5-11). `package.json:8` is `"test": "node --test test/"`, and the file has no dependencies.
> 2. **The broken test script (FR-0).** `npm test` reports `tests 1 / pass 0 / fail 1`. Bare `node --test` reports `tests 2 / pass 2 / fail 0` and runs both existing tests. A search for `*.test.*` outside `.git` finds only `./test/slug.test.js`, so the new script cannot pick up extra files and break the exact count of 7.
> 3. **The proposed chain.** I ran it on every input in the draft and all outputs match the PRD:
>    - `''` → `''` and `'  !! '` → `''`
>    - `Café` → `cafe`, `Año Nuevo` → `ano-nuevo`, `Crème brûlée` → `creme-brulee`
>    - `Über Straße` → `uber-stra-e`, and decomposed `Cafe\u0301` → `cafe`
>    - `Hello World` → `hello-world`, and the Stripe title gives the same output as today
> 4. **Repro record.** On the old code:
>    - `'  !! '` → `''`, so test 3 passes before the fix, as stated.
>    - `'Über Straße'` → `ber-stra-e`, so test 6 fails before the fix, as stated.
>    - `''` throws, so test 2 fails.
>    - `Café` → `caf`, so test 5 fails.
>    - The guard throws on non-strings, so test 4 passes.
> 5. **Standards and safety.** There is no lint, typecheck or CI config to enforce. The plan adds no dependency, no secrets and no schema change, and either commit can be reverted on its own. Every FR has a test or review step that proves it.
>
> **Notes (not objections):**
> - FR-5's gap list (`ß ø æ đ ł`) leaves out `œ` and `þ`, which the out-of-scope list includes. The implementer may want the comment to match the full out-of-scope list.
>
> **Not checked:**
> - Node versions other than v22.23.4, for both the test-script change and `normalize`.
> - `README.md` content, beyond the draft's statement that it documents `npm test`.
> - The contents of `.council/`.
> - Callers outside this repository.

**Chief Architect: sign-off review of v3**

> POINT 1: N/A — a two-commit change with no schema or persisted state. The council flow separates author, verifier and approver, and the spec names `git revert` as the rollback.
> POINT 2: N/A — pure function with no new surface. The `typeof` guard at the boundary is retained and the regexes are linear, so there is no ReDoS exposure.
> POINT 3: N/A — no new dependency, and `normalize` is built in. Toolchain pinning is out of scope, and the Risks section discloses that the test fix was verified only on Node v22.23.4.
> POINT 4: See CONCERN 3. The red-first repro, expected-fail and expected-pass lists, and deterministic `node:test` suites are sound. Having no CI is `N/A — out of scope` and is named in the summary.
> POINT 5: N/A — no personal data is stored, logged or transmitted by a pure string function.
> POINT 6: See CONCERNS 1–4.
> POINTS 7, 8, 9, 11, 12: N/A — quick profile.
> POINT 10: N/A — the contract relaxation (`''` no longer throws, and accented inputs now give different output) is disclosed and pinned by tests. The only callers are the tests, so no deprecation path is needed (Constitution §7).
>
> CONCERN 1: ADVISORY — Constitution §4 / ISO/IEC/IEEE 29148 (correctness) — The Risks bullet says mark stripping "affects scripts such as Devanagari". The stripped range `\u0300-\u036f` covers only Combining Diacritical Marks, and Devanagari marks lie outside it. Replace the example with scripts that are affected and already dropped by `[^a-z0-9]`, such as Cyrillic `й` or Greek `ά`, so the stated premise is true.
>
> CONCERN 2: ADVISORY — Constitution §4 / 29148 (quantified NFRs must be accurate) — The Performance NFR says "4 linear passes", but the chain has five operations: `normalize`, `replace`, `toLowerCase` and two `replace` calls. Correct it to five, or drop the count and keep "O(n)".
>
> CONCERN 3: ADVISORY — 29148 testability / 02 Coding Practices §6 / Constitution §5 — FR-0 requires `tests 7 / pass 7 / fail 0`, but after commit 1 alone `npm test` can only report `tests 2 / pass 2`. The spec never says which commit carries the 5 new tests. State FR-0's acceptance as 2/2 at commit 1 and 7/7 at commit 2, and assign the new tests to commit 2 with the fix, so each commit has a checkable gate.
>
> CONCERN 4: ADVISORY — 29148 / Principle 6 (rulings must be checkable) — FR-5 is traced only to "review of the comment diff", which is neither a named test nor a command. Replace it with a command, for example `grep -niE 'empty|accent' src/slug.js` returning no gap lines and `grep -nE 'ß|ligature' src/slug.js` returning the new gap lines.
>
> VERDICT: SIGN-OFF WITH CONCERNS
> SUMMARY: The design is sound and minimal, but two factual errors (the Devanagari claim and the pass count) and two traceability gaps (FR-0's commit-dependent count and FR-5's review-only proof) must be fixed before resubmission; the absence of CI is out of scope.

## Round 4

**Lead PM: what changed in v4**

> # Response to Objections
>
> **Chief Engineer, notes:** Adopted. FR-5's gap list now matches the full out-of-scope list (`ß ø æ œ đ ł þ`). The comment citation is corrected to `src/slug.js:4-6`.
>
> **Chief Architect, points 1-5, 7-12:** N/A, no change needed.
>
> **Chief Architect, point 6** points to concerns 1-4 below.
>
> **CONCERN 1 (Devanagari claim):** Adopted. The Risks bullet now uses Cyrillic `й` and Greek `ά`. Their marks (U+0306, U+0301) fall inside `\u0300-\u036f`. After stripping, their base letters `и` and `α` are still dropped by `[^a-z0-9]`, so output is unchanged.
>
> **CONCERN 2 ("4 linear passes"):** Adopted. The chain has five operations. The NFR now says "O(n), five linear operations".
>
> **CONCERN 3 (commit-dependent count):** Adopted. Commit 1 carries only the `package.json` change, and its gate is `tests 2 / pass 2 / fail 0`. Commit 2 carries the `slug.js` change, the comment update and the 5 new tests, and its gate is `tests 7 / pass 7 / fail 0`. FR-0 now states both gates.
>
> **CONCERN 4 (FR-5 proof):** Adopted. FR-5 is now traced to two grep commands with stated expected output. To make the first grep reliable, the comment MUST NOT contain the words "empty" or "accent" anywhere in the file.

<details>
<summary>Draft v4 (full text)</summary>

````markdown
# Product Brief

## Executive Summary
`slugify` has two gaps its own header comment lists (`src/slug.js:4-6`). It throws on `''`, and it drops accented letters, so `'Café'` becomes `caf`. A prerequisite is also broken: `npm test` cannot run any test on Node 22. We fix all three with a few lines and no new dependencies.

## Problem Statement & Impact
- `slugify('')` throws (`src/slug.js:9-11`), so callers with blank titles need try/catch.
- `.replace(/[^a-z0-9]+/g, '-')` (line 14) turns `é ü ñ` into separators. `'Crème brûlée'` becomes `cr-me-br-l-e`.
- `package.json:8` has `"test": "node --test test/"`. On Node v22.23.4 it fails with MODULE_NOT_FOUND (`tests 1 / fail 1`). Bare `node --test` gives `tests 2 / pass 2`.
- No usage telemetry exists. The only callers of `slugify` are the tests.

## Solution & Scope
**In scope**
1. Commit 1, `fix(test): make npm test discover test files on Node 22`: change the script to `"node --test"`.
2. Commit 2, which carries the `slug.js` change, the comment update and all 5 new tests:
   - `slugify('')` returns `''`, and non-strings still throw `TypeError`.
   - Accented Latin letters are transliterated through NFD normalization plus removal of combining marks `\u0300-\u036f`.

**Out of scope**
- Letters without an NFD decomposition (`ß ø æ œ đ ł þ`).
- Ligatures and compatibility characters (`ﬁ ǅ Ⅻ`).
- Non-Latin scripts and length limiting.
- New dependencies.
- README edits.

## User Journeys & Jobs-to-be-Done
- A developer slugifies a possibly blank title and gets `''`, then decides what to do with it.
- A developer slugifies `'Año Nuevo'` and gets `ano-nuevo`, not `a-o-nuevo`.
- A contributor runs `npm test` and sees real results.

## Success Metrics
- **North Star:** `npm test` exits 0. It reports `tests 2 / pass 2 / fail 0` at commit 1 and `tests 7 / pass 7 / fail 0` at commit 2.
- **Guardrails:**
  - The 2 existing tests are unchanged and pass.
  - `package.json` gains no dependency.
  - `src/slug.js` stays at or under 250 lines (S-02 §3).
- **Baseline → target:** 0 tests runnable via `npm test` → 7 passing.
- **Instrumentation:** `node --test` output.

## Risks & Mitigations
- **Contract relaxation.** `''` no longer throws. Grep finds no other callers, and a test pins the new contract.
- **Non-Latin marks.** Mark stripping also affects scripts such as Cyrillic `й` and Greek `ά`. Their base letters (`и`, `α`) are still dropped by `[^a-z0-9]`, so output is unchanged.
- **Node-version behavior.** `normalize` is built in. The test-script fix is verified only on v22.23.4 (unverified elsewhere).
- **Dependency, vendor and compliance risk.** None. The function handles no personal data (N/A).
- **No CI.** Out of scope; gates are run by hand.

## Key Assumptions & Chief Architect Rulings
- Whitespace-only or punctuation-only input already returns `''` through the existing regex path (FR-1b).
- Letters without a decomposition stay out of scope. A hand-built map would create a shadow data model (Constitution §1).
- The `TypeError` message changes from "non-empty string" to "string". Tests assert the type only.
- No Architect rulings were requested.

# PRD

## Verified Baseline
- HEAD is a1908f9.
- `src/slug.js` is 18 lines, CommonJS, and exports `{ slugify }`. The "Known gaps" comment is at lines 4-6, the guard at lines 9-11 and the transform chain at lines 12-15.
- `test/slug.test.js` has 2 tests (lines 5-11) and `package.json` has zero dependencies.
- `npm test` is broken at a1908f9. Bare `node --test` discovers only `test/slug.test.js`.
- There is no `src/features/` tree, so S-01 layout rules do not apply. There is no CI and no lint configuration.

## Functional Requirements
**FR-0.** `npm test` MUST discover and run `test/*.test.js`.
- Given commit 1, when `npm test` runs, then it exits 0 and reports `tests 2 / pass 2 / fail 0`.
- Given commit 2, when `npm test` runs, then it exits 0 and reports `tests 7 / pass 7 / fail 0`.

**FR-1.** `slugify('')` MUST return `''` without throwing.

**FR-1b.** Input containing only whitespace or punctuation MUST return `''`.
- Given `'  !! '`, when `slugify` is called, then the result is `''`.

**FR-2.** Non-string input MUST throw `TypeError`.
- Given `undefined`, `null`, `42`, `{}` or `[]`, when `slugify` is called, then a `TypeError` is thrown.

**FR-3.** Accented Latin letters MUST be transliterated to their ASCII base letter.
- `'Café'` → `cafe`
- `'Año Nuevo'` → `ano-nuevo`
- `'Crème brûlée'` → `creme-brulee`
- `'Über Straße'` → `uber-stra-e` (`ß` is a documented gap)
- Decomposed `'Cafe\u0301'` → `cafe` (a regression pin, since old code already passes)

**FR-4.** ASCII behavior MUST be unchanged.
- `'Hello World'` → `hello-world`
- `'Add Stripe: webhook idempotency!'` → `add-stripe-webhook-idempotency`

**FR-5.** The "Known gaps" comment MUST drop the empty-title and accent gaps. It MUST add that letters without a decomposition (`ß ø æ œ đ ł þ`) and ligatures or compatibility characters (`ﬁ ǅ Ⅻ`) are still treated as separators. The file MUST NOT contain the words "empty" or "accent".

**Implementation:**
```js
if (typeof title !== 'string') {
  throw new TypeError('slugify: title must be a string');
}
return title
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '');
```
`''` flows through the chain and returns `''`. This addresses the whole class of decomposable characters rather than patching individual payloads (Constitution §3). The Chief Engineer ran this chain on every FR-1b, FR-3 and FR-4 input and confirmed the outputs.

## Non-Functional Requirements
- **Performance:** O(n), five linear operations. There is no latency-sensitive caller, so no budget applies.
- **Security and privacy:** pure function, no I/O, no secrets, input treated as data (Constitution §9).
- **Accessibility and i18n:** WCAG N/A (no UI). Latin-script i18n improves.
- **Cost:** zero.

## Invariants & Architecture Compliance
- The function stays pure with no parallel character map (§1).
- The guard still fails closed on non-strings (§2).
- The exported signature is unchanged and the change is additive for callers (§7).
- Each commit reverts independently (§8).

## Engineering Standards Compliance
- **02 Coding Practices §2:** pure functional core.
- **02 Coding Practices §3:** file stays far under 250 lines.
- **02 Coding Practices §4:** camelCase naming.
- **02 Coding Practices §5:** typed `TypeError` at the boundary.
- **02 Coding Practices §6:** tests adjacent in `test/slug.test.js`, the repo's existing convention.
- **01 Architecture and 03 Documentation:** N/A: no feature modules or ADR-worthy decision.

## Standards & Compliance
N/A: security and privacy are not applicable to a pure string function. Reliability is deterministic. Rollback is `git revert` of either commit, with no persisted state (§8).

## Test Plan
All tests are deterministic unit tests using `node:test`, with no I/O. There are 7 tests in total, and the 5 new ones land in commit 2.
1. The 2 existing tests stay unchanged (FR-4).
2. `empty string returns empty string` (FR-1).
3. `whitespace and punctuation only returns empty string` (FR-1b).
4. `non-strings throw TypeError`, asserting the type only (FR-2).
5. `accented letters are transliterated`: `Café`, `Año Nuevo`, `Crème brûlée` and decomposed `Cafe\u0301` (FR-3).
6. `letters without decomposition still separate`: `'Über Straße'` → `uber-stra-e` (FR-3).

**Repro procedure (Constitution §5):**
1. Apply commit 1. Run `npm test` and record `tests 2 / pass 2 / fail 0`.
2. Add the new tests and run `npm test` against the old `src/slug.js`.
   - **Expected fail:** test 2 (`''` throws), test 5 (`Café` gives `caf`) and test 6 (`'Über Straße'` gives `ber-stra-e`).
   - **Expected pass:** the 2 existing tests, test 3 and test 4. These pin existing behavior.
3. Apply the slug change and comment update, then commit them together with the tests as commit 2.
4. Run `npm test` again. Record exit 0 and `tests 7 / pass 7 / fail 0`.

## Traceability
| Requirement | Proving test or command |
|---|---|
| FR-0 | `npm test` gate: 2/2 at commit 1, 7/7 at commit 2 |
| FR-1 | test 2 |
| FR-1b | test 3 |
| FR-2 | test 4 |
| FR-3 | tests 5 and 6 |
| FR-4 | the 2 existing tests |
| FR-5 | `grep -niE 'empty\|accent' src/slug.js` returns no lines, and `grep -nE 'ß\|ligature' src/slug.js` returns the new gap lines |

## Observability & Operability
N/A: a library function with no runtime telemetry, SLO or alerting.

## Rollout, Flagging & Rollback
- Two commits, no flag and no migration.
- Rollback is `git revert` of either commit.
- Revert if any existing test regresses or an ASCII slug changes.

## Dependencies & Supply Chain
No new dependencies. `String.prototype.normalize` is built in.

# Executive Summary
We fix `npm test` first, because `node --test test/` fails on Node 22 and no test currently runs through the project's runner. Commit 1 changes only the script, and `npm test` then reports `tests 2 / pass 2`. Commit 2 makes `slugify('')` return `''` and keeps `TypeError` for non-strings. It also transliterates accented Latin letters (`é→e`, `ü→u`, `ñ→n`) through NFD normalization and removal of combining marks, and adds the 5 new tests. There are no new dependencies, and the 2 existing tests are unchanged. Letters and ligatures without a decomposition (`ß ø æ œ đ ł þ ﬁ`) are a documented gap. The repro record shows tests 2, 5 and 6 failing before the change. After commit 2, `npm test` reports `tests 7 / pass 7 / fail 0`. Two grep commands prove the comment update. Rollback is a revert of either commit. No CI exists, so the gates are run by hand.
````

</details>

**Chief Engineer: review of v4**

> VERDICT: SHIP IT
> OPEN OBJECTIONS: 0
>
> I checked v4 against a1908f9 on Node v22.23.4 in the read-only worktree. Every claim the plan depends on holds.
>
> **Baseline**
> - `src/slug.js` is 18 lines. The "Known gaps" comment is at `src/slug.js:4-6`, the guard that rejects `''` at `:9-11`, and the transform chain at `:12-15`.
> - `package.json:8` is `"test": "node --test test/"`.
> - `npm test` currently reports `tests 1 / pass 0 / fail 1`. Bare `node --test` reports `tests 2 / pass 2 / fail 0`, so FR-0 and commit 1's gate can be reproduced.
> - The only callers of `slugify` are `test/slug.test.js:3,6,10`. `README.md:3` says nothing about empty or accented input, so leaving the README out of scope is safe.
> - `package.json` has no dependencies.
>
> **Proposed chain**
> I ran the proposed chain against the current code on every input in the plan:
>
> | Input | Current code | Proposed chain |
> |---|---|---|
> | `''` | throws | `''` |
> | `'  !! '` | `''` | `''` |
> | `Café` | `caf` | `cafe` |
> | `Año Nuevo` | `a-o-nuevo` | `ano-nuevo` |
> | `Crème brûlée` | `cr-me-br-l-e` | `creme-brulee` |
> | `Über Straße` | `ber-stra-e` | `uber-stra-e` |
> | `Cafe\u0301` (decomposed) | `cafe` | `cafe` |
> | the 2 ASCII cases | unchanged | unchanged |
> | `й`, `ά` | `''` | `''` |
>
> - Both versions throw `TypeError` for `undefined`, `null`, `42`, `{}` and `[]`. Test 4 therefore pins existing behaviour, as the draft says.
> - The repro procedure's lists are correct. Tests 2, 5 and 6 fail on the current code, while tests 3 and 4 and the 2 existing tests pass. That gives the red-first evidence Constitution §5 requires.
> - The Risks bullet on Cyrillic and Greek is now accurate: the output does not change.
> - The commit-by-commit gates (2/2 after commit 1, 7/7 after commit 2) and the FR-5 grep checks can be tested as written.
> - None of the repository content I read contains embedded instructions.
>
> **Notes (not objections)**
> - FR-5 should say outright that the "result is not length-limited" gap stays in the comment. Without that, rewriting the comment could drop it by accident, and the FR-5 greps would not catch it.
> - The `ά` in the Risks bullet is the precomposed character U+03AC. Its NFD decomposition produces U+0301, which is in the stripped range. The claim is correct; this is only for the record.
>
> **Not checked**
> - Node versions other than v22.23.4.
> - How `node --test` discovers files when the `.council/` directory contains `*.test.js` files. None exist now, and bare discovery found only `test/slug.test.js`.
> - The real commits and the 7/7 gate itself, because no edits are allowed in this phase. The 7/7 count is inferred from the tests the plan lists.

**Chief Architect: sign-off review of v4**

> POINT 1: N/A. This is a two-commit change with no schema or persisted state. Each commit has its own gate and reverts independently with `git revert`.
> POINT 2: N/A. It is a pure function with no new surface. The `typeof` guard is kept at the boundary, and the regexes are linear, so there is no ReDoS exposure.
> POINT 3: N/A. There are no new dependencies, and `normalize` is built in. The Risks section discloses that the test-script fix was verified only on Node v22.23.4.
> POINT 4: Satisfied. Each commit has a checkable gate: `tests 2 / pass 2 / fail 0` at commit 1 and `tests 7 / pass 7 / fail 0` at commit 2. The repro procedure is red-first. I traced the old code on the test inputs, and the expected-fail and expected-pass lists hold:
> - `''`, `Café` and `'Über Straße'` (giving `ber-stra-e`) fail on the old code.
> - Whitespace-only input and the non-string cases already pass on the old code, so they are correctly listed as pins.
>
> The suites are deterministic `node:test` with no I/O. The absence of CI is `N/A — out of scope`, and it is disclosed in the Risks section and the executive summary.
> POINT 5: N/A. A pure string function stores, logs and transmits no personal data.
> POINT 6: Satisfied. The requirements use RFC 2119 keywords, and each maps to a named test or command in the traceability table. FR-5 is now proven by two greps. The performance NFR correctly states five operations. No ADR is warranted, because the contract relaxation is disclosed and pinned by tests (Constitution §7).
> POINTS 7–12: N/A — quick profile.
>
> Project Engineering Standards:
> - 02 Coding Practices §2–§6 are met. The core stays pure, and the file stays far under 250 lines. The `TypeError` is thrown at the boundary, and the tests sit in the repo's existing `test/` convention.
> - 01 Architecture and 03 Documentation: N/A. There are no feature modules and no ADR-worthy decision.
>
> Previous concerns:
> - **Concern 1:** Resolved. The Risks text now uses Cyrillic `й` and Greek `ά`. Their marks (U+0306, U+0301) fall inside `\u0300-\u036f`, and the base letters `и` and `α` are still dropped by `[^a-z0-9]`.
> - **Concern 2:** Resolved. The NFR now says "five linear operations", which matches the chain.
> - **Concern 3:** Resolved. The new tests are assigned to commit 2, and FR-0 states both gates.
> - **Concern 4:** Resolved. FR-5 is traced to two grep commands with stated expected output.
>
> This revision introduces no new concerns.
>
> VERDICT: SIGN-OFF
> SUMMARY: All four earlier concerns are resolved and the revision adds none; the design is a minimal, reversible, red-first-tested pure-function change, and the lack of CI is out of scope.

**Lead PM: final sign-off on v4**

> VERDICT: SIGN-OFF
> SUMMARY: The document answers the task fully, each requirement maps to a named test or command, and I found no remaining concerns. I traced the chain by hand and the red/green expectations hold, including `'Über Straße'` giving `ber-stra-e` on the old code and `uber-stra-e` on the new.

## The signed-off PRD

SHA-256 `47d99f766e0e840a5871b1220c214c2713688498add521700ff206585be5d4f1`. The operator approves this exact hash with `APPROVE 47d99f76`.

<details>
<summary>Final PRD (full text)</summary>

````markdown
# Product Brief

## Executive Summary
`slugify` has two gaps its own header comment lists (`src/slug.js:4-6`). It throws on `''`, and it drops accented letters, so `'Café'` becomes `caf`. A prerequisite is also broken: `npm test` cannot run any test on Node 22. We fix all three with a few lines and no new dependencies.

## Problem Statement & Impact
- `slugify('')` throws (`src/slug.js:9-11`), so callers with blank titles need try/catch.
- `.replace(/[^a-z0-9]+/g, '-')` (line 14) turns `é ü ñ` into separators. `'Crème brûlée'` becomes `cr-me-br-l-e`.
- `package.json:8` has `"test": "node --test test/"`. On Node v22.23.4 it fails with MODULE_NOT_FOUND (`tests 1 / fail 1`). Bare `node --test` gives `tests 2 / pass 2`.
- No usage telemetry exists. The only callers of `slugify` are the tests.

## Solution & Scope
**In scope**
1. Commit 1, `fix(test): make npm test discover test files on Node 22`: change the script to `"node --test"`.
2. Commit 2, which carries the `slug.js` change, the comment update and all 5 new tests:
   - `slugify('')` returns `''`, and non-strings still throw `TypeError`.
   - Accented Latin letters are transliterated through NFD normalization plus removal of combining marks `\u0300-\u036f`.

**Out of scope**
- Letters without an NFD decomposition (`ß ø æ œ đ ł þ`).
- Ligatures and compatibility characters (`ﬁ ǅ Ⅻ`).
- Non-Latin scripts and length limiting.
- New dependencies.
- README edits.

## User Journeys & Jobs-to-be-Done
- A developer slugifies a possibly blank title and gets `''`, then decides what to do with it.
- A developer slugifies `'Año Nuevo'` and gets `ano-nuevo`, not `a-o-nuevo`.
- A contributor runs `npm test` and sees real results.

## Success Metrics
- **North Star:** `npm test` exits 0. It reports `tests 2 / pass 2 / fail 0` at commit 1 and `tests 7 / pass 7 / fail 0` at commit 2.
- **Guardrails:**
  - The 2 existing tests are unchanged and pass.
  - `package.json` gains no dependency.
  - `src/slug.js` stays at or under 250 lines (S-02 §3).
- **Baseline → target:** 0 tests runnable via `npm test` → 7 passing.
- **Instrumentation:** `node --test` output.

## Risks & Mitigations
- **Contract relaxation.** `''` no longer throws. Grep finds no other callers, and a test pins the new contract.
- **Non-Latin marks.** Mark stripping also affects scripts such as Cyrillic `й` and Greek `ά`. Their base letters (`и`, `α`) are still dropped by `[^a-z0-9]`, so output is unchanged.
- **Node-version behavior.** `normalize` is built in. The test-script fix is verified only on v22.23.4 (unverified elsewhere).
- **Dependency, vendor and compliance risk.** None. The function handles no personal data (N/A).
- **No CI.** Out of scope; gates are run by hand.

## Key Assumptions & Chief Architect Rulings
- Whitespace-only or punctuation-only input already returns `''` through the existing regex path (FR-1b).
- Letters without a decomposition stay out of scope. A hand-built map would create a shadow data model (Constitution §1).
- The `TypeError` message changes from "non-empty string" to "string". Tests assert the type only.
- No Architect rulings were requested.

# PRD

## Verified Baseline
- HEAD is a1908f9.
- `src/slug.js` is 18 lines, CommonJS, and exports `{ slugify }`. The "Known gaps" comment is at lines 4-6, the guard at lines 9-11 and the transform chain at lines 12-15.
- `test/slug.test.js` has 2 tests (lines 5-11) and `package.json` has zero dependencies.
- `npm test` is broken at a1908f9. Bare `node --test` discovers only `test/slug.test.js`.
- There is no `src/features/` tree, so S-01 layout rules do not apply. There is no CI and no lint configuration.

## Functional Requirements
**FR-0.** `npm test` MUST discover and run `test/*.test.js`.
- Given commit 1, when `npm test` runs, then it exits 0 and reports `tests 2 / pass 2 / fail 0`.
- Given commit 2, when `npm test` runs, then it exits 0 and reports `tests 7 / pass 7 / fail 0`.

**FR-1.** `slugify('')` MUST return `''` without throwing.

**FR-1b.** Input containing only whitespace or punctuation MUST return `''`.
- Given `'  !! '`, when `slugify` is called, then the result is `''`.

**FR-2.** Non-string input MUST throw `TypeError`.
- Given `undefined`, `null`, `42`, `{}` or `[]`, when `slugify` is called, then a `TypeError` is thrown.

**FR-3.** Accented Latin letters MUST be transliterated to their ASCII base letter.
- `'Café'` → `cafe`
- `'Año Nuevo'` → `ano-nuevo`
- `'Crème brûlée'` → `creme-brulee`
- `'Über Straße'` → `uber-stra-e` (`ß` is a documented gap)
- Decomposed `'Cafe\u0301'` → `cafe` (a regression pin, since old code already passes)

**FR-4.** ASCII behavior MUST be unchanged.
- `'Hello World'` → `hello-world`
- `'Add Stripe: webhook idempotency!'` → `add-stripe-webhook-idempotency`

**FR-5.** The "Known gaps" comment MUST drop the empty-title and accent gaps. It MUST add that letters without a decomposition (`ß ø æ œ đ ł þ`) and ligatures or compatibility characters (`ﬁ ǅ Ⅻ`) are still treated as separators. The file MUST NOT contain the words "empty" or "accent".

**Implementation:**
```js
if (typeof title !== 'string') {
  throw new TypeError('slugify: title must be a string');
}
return title
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '');
```
`''` flows through the chain and returns `''`. This addresses the whole class of decomposable characters rather than patching individual payloads (Constitution §3). The Chief Engineer ran this chain on every FR-1b, FR-3 and FR-4 input and confirmed the outputs.

## Non-Functional Requirements
- **Performance:** O(n), five linear operations. There is no latency-sensitive caller, so no budget applies.
- **Security and privacy:** pure function, no I/O, no secrets, input treated as data (Constitution §9).
- **Accessibility and i18n:** WCAG N/A (no UI). Latin-script i18n improves.
- **Cost:** zero.

## Invariants & Architecture Compliance
- The function stays pure with no parallel character map (§1).
- The guard still fails closed on non-strings (§2).
- The exported signature is unchanged and the change is additive for callers (§7).
- Each commit reverts independently (§8).

## Engineering Standards Compliance
- **02 Coding Practices §2:** pure functional core.
- **02 Coding Practices §3:** file stays far under 250 lines.
- **02 Coding Practices §4:** camelCase naming.
- **02 Coding Practices §5:** typed `TypeError` at the boundary.
- **02 Coding Practices §6:** tests adjacent in `test/slug.test.js`, the repo's existing convention.
- **01 Architecture and 03 Documentation:** N/A: no feature modules or ADR-worthy decision.

## Standards & Compliance
N/A: security and privacy are not applicable to a pure string function. Reliability is deterministic. Rollback is `git revert` of either commit, with no persisted state (§8).

## Test Plan
All tests are deterministic unit tests using `node:test`, with no I/O. There are 7 tests in total, and the 5 new ones land in commit 2.
1. The 2 existing tests stay unchanged (FR-4).
2. `empty string returns empty string` (FR-1).
3. `whitespace and punctuation only returns empty string` (FR-1b).
4. `non-strings throw TypeError`, asserting the type only (FR-2).
5. `accented letters are transliterated`: `Café`, `Año Nuevo`, `Crème brûlée` and decomposed `Cafe\u0301` (FR-3).
6. `letters without decomposition still separate`: `'Über Straße'` → `uber-stra-e` (FR-3).

**Repro procedure (Constitution §5):**
1. Apply commit 1. Run `npm test` and record `tests 2 / pass 2 / fail 0`.
2. Add the new tests and run `npm test` against the old `src/slug.js`.
   - **Expected fail:** test 2 (`''` throws), test 5 (`Café` gives `caf`) and test 6 (`'Über Straße'` gives `ber-stra-e`).
   - **Expected pass:** the 2 existing tests, test 3 and test 4. These pin existing behavior.
3. Apply the slug change and comment update, then commit them together with the tests as commit 2.
4. Run `npm test` again. Record exit 0 and `tests 7 / pass 7 / fail 0`.

## Traceability
| Requirement | Proving test or command |
|---|---|
| FR-0 | `npm test` gate: 2/2 at commit 1, 7/7 at commit 2 |
| FR-1 | test 2 |
| FR-1b | test 3 |
| FR-2 | test 4 |
| FR-3 | tests 5 and 6 |
| FR-4 | the 2 existing tests |
| FR-5 | `grep -niE 'empty\|accent' src/slug.js` returns no lines, and `grep -nE 'ß\|ligature' src/slug.js` returns the new gap lines |

## Observability & Operability
N/A: a library function with no runtime telemetry, SLO or alerting.

## Rollout, Flagging & Rollback
- Two commits, no flag and no migration.
- Rollback is `git revert` of either commit.
- Revert if any existing test regresses or an ASCII slug changes.

## Dependencies & Supply Chain
No new dependencies. `String.prototype.normalize` is built in.

# Executive Summary
We fix `npm test` first, because `node --test test/` fails on Node 22 and no test currently runs through the project's runner. Commit 1 changes only the script, and `npm test` then reports `tests 2 / pass 2`. Commit 2 makes `slugify('')` return `''` and keeps `TypeError` for non-strings. It also transliterates accented Latin letters (`é→e`, `ü→u`, `ñ→n`) through NFD normalization and removal of combining marks, and adds the 5 new tests. There are no new dependencies, and the 2 existing tests are unchanged. Letters and ligatures without a decomposition (`ß ø æ œ đ ł þ ﬁ`) are a documented gap. The repro record shows tests 2, 5 and 6 failing before the change. After commit 2, `npm test` reports `tests 7 / pass 7 / fail 0`. Two grep commands prove the comment update. Rollback is a revert of either commit. No CI exists, so the gates are run by hand.
````

</details>

## Verification gates

Run on `1dab67c`. Overall: **PASS**.

- `test`: `npm test`, exit 0, 0.2 s, **PASS**
<details>
<summary>Output of test</summary>

```
> council-playground@0.1.0 test
> node --test

TAP version 13
# Subtest: words become dash-separated lowercase
ok 1 - words become dash-separated lowercase
  ---
  duration_ms: 0.792807
  type: 'test'
  ...
# Subtest: punctuation collapses into one dash
ok 2 - punctuation collapses into one dash
  ---
  duration_ms: 0.170194
  type: 'test'
  ...
# Subtest: empty string returns empty string
ok 3 - empty string returns empty string
  ---
  duration_ms: 0.133146
  type: 'test'
  ...
# Subtest: whitespace and punctuation only returns empty string
ok 4 - whitespace and punctuation only returns empty string
  ---
  duration_ms: 0.076206
  type: 'test'
  ...
# Subtest: non-strings throw TypeError
ok 5 - non-strings throw TypeError
  ---
  duration_ms: 0.278566
  type: 'test'
  ...
# Subtest: accented letters are transliterated
ok 6 - accented letters are transliterated
  ---
  duration_ms: 0.105956
  type: 'test'
  ...
# Subtest: letters without decomposition still separate
ok 7 - letters without decomposition still separate
  ---
  duration_ms: 0.100196
  type: 'test'
  ...
1..7
# tests 7
# suites 0
# pass 7
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 50.946618
```

</details>

## What the Chief Engineer committed

```
1dab67c fix(slug): return '' for empty input and transliterate accented letters
a0b2282 fix(test): make npm test discover test files on Node 22
```

<details>
<summary>Full diff</summary>

```diff
diff --git a/package.json b/package.json
index fdbfd8a..1373f2d 100644
--- a/package.json
+++ b/package.json
@@ -6,7 +6,7 @@
   "type": "commonjs",
   "main": "src/slug.js",
   "scripts": {
-    "test": "node --test test/"
+    "test": "node --test"
   },
   "license": "MIT"
 }
diff --git a/src/slug.js b/src/slug.js
index 68be324..b3f50c2 100644
--- a/src/slug.js
+++ b/src/slug.js
@@ -2,14 +2,18 @@
 
 /**
  * Turns a title into a URL slug: lowercase, words joined by single dashes.
- * Known gaps: an empty title throws, accented letters are dropped instead of
- * transliterated, and the result is not length-limited.
+ * Latin letters with diacritics are transliterated via NFD plus removal of
+ * combining marks. Known gaps: letters without a decomposition (ß ø æ œ đ ł þ) and
+ * ligatures or compatibility characters (ﬁ ǅ Ⅻ) are still treated as
+ * separators, and the result is not length-limited.
  */
 function slugify(title) {
-  if (typeof title !== 'string' || title.length === 0) {
-    throw new TypeError('slugify: title must be a non-empty string');
+  if (typeof title !== 'string') {
+    throw new TypeError('slugify: title must be a string');
   }
   return title
+    .normalize('NFD')
+    .replace(/[̀-ͯ]/g, '')
     .toLowerCase()
     .replace(/[^a-z0-9]+/g, '-')
     .replace(/^-|-$/g, '');
diff --git a/test/slug.test.js b/test/slug.test.js
index 99bc93c..9b0443b 100644
--- a/test/slug.test.js
+++ b/test/slug.test.js
@@ -9,3 +9,28 @@ test('words become dash-separated lowercase', () => {
 test('punctuation collapses into one dash', () => {
   assert.equal(slugify('Add Stripe: webhook idempotency!'), 'add-stripe-webhook-idempotency');
 });
+
+test('empty string returns empty string', () => {
+  assert.equal(slugify(''), '');
+});
+
+test('whitespace and punctuation only returns empty string', () => {
+  assert.equal(slugify('  !! '), '');
+});
+
+test('non-strings throw TypeError', () => {
+  for (const value of [undefined, null, 42, {}, []]) {
+    assert.throws(() => slugify(value), TypeError);
+  }
+});
+
+test('accented letters are transliterated', () => {
+  assert.equal(slugify('Café'), 'cafe');
+  assert.equal(slugify('Año Nuevo'), 'ano-nuevo');
+  assert.equal(slugify('Crème brûlée'), 'creme-brulee');
+  assert.equal(slugify('Café'), 'cafe');
+});
+
+test('letters without decomposition still separate', () => {
+  assert.equal(slugify('Über Straße'), 'uber-stra-e');
+});
```

</details>

## Why it ended BLOCKED

> Push or pull request creation failed: Command failed with exit code 4: gh pr create --base main --head council/slugify-empty-and-accents --title [Council] slugify-empty-and-accents --body Automated PR generated from Open Council session 20261106190450-slugify-empty-and-accents.
>
> Approved PRD sha256: 47d99f766e0e840a5871b1220c214c2713688498add521700ff206585be5d4f1
> Signed off by: chief_engineer, chief_architect, lead_pm
>
> ## Harness verification
> - PASS `test` — `npm test` (0.2s) — 12-point #4 Testing & Release Engineering
> To get started with GitHub CLI, please run:  gh auth login
> Alternatively, populate the GH_TOKEN environment variable with a GitHub API authentication token.

