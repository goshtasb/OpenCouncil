# Replay: slugify: letters NFD can't split (signed off, gate failed, BLOCKED)

Session `20261106195121-slugify-special-letters`, quick profile, base commit `a1908f9`, round budget 4 plus 1 sign-off revision. Outcome: **BLOCKED**.

Solo mode (every seat on Claude Code: Lead PM sonnet, Chief Engineer opus, Chief Architect sonnet with tools off), Open Council 0.2.1, run on 2026-11-06 against a local copy with no GitHub remote, so the run could not open a pull request.

Every quoted block below is the seat's reply exactly as the harness saved it. Nothing is summarised.

## The task

> slugify drops letters that Unicode NFD does not decompose. Transliterate these: ß→ss, ø/Ø→o, æ/Æ→ae, œ/Œ→oe, đ/Đ→d, ł/Ł→l, þ/Þ→th. Keep every existing behaviour and test, add tests, no new dependencies.

## Timeline

| Time | Event |
|---|---|
| 00:00 | Created session slugify-special-letters on commit a1908f9dbb82a796413470f325b0228639e11fb3 |
| 00:38 | Saved plan-v1 (6843c2e44016ea54259260f92eb988442d8b48e827f78ee3c66378c1c469f7c7) |
| 01:30 | Round 1 finished: SHIP WITH CHANGES, objections: 2, converged: false |
| 02:02 | Saved changes-v2 (f9e05c3c810012fb38707ef5f954e6d00d1a630dd5bae0dac6509a77d5716555) |
| 02:02 | Saved plan-v2 (99aa5e147900f21dbdbf4540db465748ce9c270f552287e2298d31aadef3bcb3) |
| 02:33 | Round 2 finished: SHIP IT, objections: 0, converged: true |
| 03:00 | Architecture review finished: SIGN-OFF (Required: 0, Advisory: 0) |
| 03:20 | Council Lead sign-off on v2: SIGN-OFF |
| 03:20 | Status changed to AWAITING_APPROVAL |
| 03:20 | Status changed to APPROVED |
| 03:20 | Status changed to IN_EXECUTION |
| 04:11 | Status changed to IN_EXECUTION |
| 04:11 | Verification failed at 2ff06eb7b5622d3331ce7ad53f5970a21262613b: test=fail |
| 04:54 | Chief Architect issued 1 ruling(s) for chief_engineer (execution attempt 2). |
| 05:30 | Status changed to IN_EXECUTION |
| 05:30 | Verification failed at 2ff06eb7b5622d3331ce7ad53f5970a21262613b: test=fail |
| 05:30 | Status changed to BLOCKED |

## Binding rulings from the Chief Architect

**Ruling 1** (asked by chief_engineer, execution attempt 2)

> Q: The required harness gate npm test fails because of the baseline package.json script defect, which the approved PRD explicitly excludes (A3, "package.json is untouched"). May I change scripts.test in package.json from node --test test/ to node --test in a separate, atomic fix(test) commit on this branch? Or should the harness gate for this session be replaced by the PRD's stated gate, node --test test/slug.test.js?

> Ruling: No. Do not touch package.json, because the approved PRD fixes scope and A3 excludes the scripts.test fix. For this session the gate is the PRD's node --test test/slug.test.js, which must report 7 pass, 0 fail. Record npm test as a pre-existing baseline failure, identical on a1908f9 (exit 1, 0 tests run), and never report it as green. The fix goes in a separate follow-up change under its own PRD. Compliance checks: git diff --name-only a1908f9..HEAD lists only src/slug.js and test/slug.test.js, and the PR description names the npm test defect as a known baseline issue. — Constitution §4 (no simulated success) requires stating the failure honestly. Scope is fixed during execution, and a one-line package.json edit is still an unapproved scope expansion. Constitution §5's "entire regression suite passes" is met by the PRD's gate, which runs every test in the repo (the 2 original tests plus the 5 new ones).

## Round 1

<details>
<summary>Lead PM: draft v1 (full text)</summary>

```markdown
# Product Brief

## Executive Summary (Brief)
`slugify` turns "Straße" into "stra" and "Łódź" into "d". Seven Latin letters that have no decomposition (ß ø æ œ đ ł þ, plus uppercase forms) are lost, so slugs are truncated or split. This change transliterates them as specified. It is a small, additive change to one function, with no new dependencies.

## Problem Statement & Impact
- `src/slug.js:14` replaces every character outside `[a-z0-9]` with a dash. A letter such as `ß` becomes `-`, so "Straße" becomes `stra` and "Łódź" becomes `d`. This is verified by reading the code. I did not run it.
- **Correction to the task premise:** the code contains no NFD step. The header comment (`src/slug.js:3-7`) says all accented letters are dropped. So `é` is also dropped today. This change does not alter that.

## Solution & Scope
- **In scope:** map `ß→ss`, `ø→o`, `æ→ae`, `œ→oe`, `đ→d`, `ł→l`, `þ→th`. Uppercase forms are handled by the existing `toLowerCase()`.
- **Out of scope:**
  - NFD or accent stripping for `é`, `ü` and similar (existing behaviour is kept).
  - The empty-title throw.
  - Length limiting.
  - Any new dependency.

## User Journeys & Jobs-to-be-Done
A content author titles a post "Þórr på Øvre Ærø". They expect a readable slug, `thorr-p-ovre-aero`. The `å` is still dropped, which is out of scope. The author can still tell what the slug refers to.

## Success Metrics
- **North Star:** the 7 specified letters, in both cases, each produce their target in the slug. The measure is the new tests passing.
- **Guardrails:** the 2 existing tests stay green, and output for ASCII-only input is byte-identical to before. A property check can confirm this.
- **Baseline → target:** 0 of 7 letters transliterated → 7 of 7.
- **Instrumentation:** `npm test` in CI. Telemetry is N/A for a pure library function.

## Risks & Mitigations
- **Behaviour change for affected titles:** they now get longer or different slugs. This is intended, and existing stored slugs are not recomputed by this change. Callers that regenerate slugs from titles may see URL changes. Mitigation: flag this in the PR description.
- **Dependency, vendor and compliance risk:** N/A: no dependencies or data are added.

## Key Assumptions & Chief Architect Rulings
- **A1 (assumption):** the task's NFD premise is inaccurate (see Problem Statement). "Keep every existing behaviour" is read literally, so no NFD is added and `é` stays dropped.
- **A2:** the mapping runs after `toLowerCase()`, so only lowercase keys are needed. `toLowerCase()` maps `Ø→ø`, `Æ→æ`, `Œ→œ`, `Đ→đ`, `Ł→ł`, `Þ→þ` and `ẞ→ß`. Unverified until the test runs.
- No Architect rulings are required.

# PRD

## Verified Baseline
- Commit `a1908f9`. Files: `src/slug.js` (18 lines), `test/slug.test.js` (2 tests), `package.json` (`npm test` = `node --test test/`, zero dependencies, CommonJS).
- Current pipeline (`src/slug.js:12-15`): `toLowerCase` → `replace(/[^a-z0-9]+/g,'-')` → trim edge dashes.
- The `typeof`/empty check (`src/slug.js:9`) throws `TypeError` and stays unchanged.

## Functional Requirements
- **FR1.** `slugify` MUST replace each of ß, ø, æ, œ, đ, ł, þ with ss, o, ae, oe, d, l, th respectively, before the non-alphanumeric collapse.
  - Given "Straße", when slugified, then the result is `strasse`.
  - Given "Ærø", then `aero`.
  - Given "Œuvre", then `oeuvre`.
  - Given "Đorđe", then `dorde`.
  - Given "Łódź", then `l-d`. `ó` and `ź` are still dropped under existing behaviour.
  - Given "Þing", then `thing`.
- **FR2.** Uppercase forms MUST behave the same as lowercase.
  - Given "ØÆŒĐŁÞ", then `oaeoedlth`.
  - Given "STRAẞE", then `strasse`.
- **FR3.** Mapped output MUST join the surrounding letters without inserting a dash.
  - Given "Weiß-Bier", then `weiss-bier`.
- **FR4.** All other behaviour MUST be unchanged.
  - The 2 existing tests pass unmodified.
  - Empty and non-string input still throws `TypeError`.
  - Non-listed non-ASCII letters (`é`, `ü`) still collapse to a dash.
- **Implementation (smallest change):**
  - Add a module-level `const TRANSLITERATIONS = { 'ß': 'ss', 'ø': 'o', 'æ': 'ae', 'œ': 'oe', 'đ': 'd', 'ł': 'l', 'þ': 'th' }` as the single source of truth.
  - Insert `.replace(/[ßøæœđłþ]/g, c => TRANSLITERATIONS[c])` between `toLowerCase()` and the collapse.
  - Build the regex from the map's keys rather than repeating the letters (Constitution §1).
  - Update the header comment at `src/slug.js:3-7` so it no longer lists these letters as dropped.

## Non-Functional Requirements
- **Performance:** one extra linear pass; no budget change, and no measurable cost for titles under 1 KB.
- **Security and privacy:** pure function, no I/O or data. N/A beyond that.
- **Accessibility, i18n:** the change is an i18n improvement. Full Unicode coverage is out of scope.
- **Cost:** none.

## Invariants & Architecture Compliance
- Constitution §1: one map, with the regex derived from it.
- Constitution §5: the new tests are the proof for this behaviour change. Strictly, this is a feature rather than a bug fix, but the same test discipline applies.
- Constitution §7: the public signature is unchanged. Output changes only for inputs containing the 7 letters.
- Constitution §8: reversible by reverting a single commit.

## Engineering Standards Compliance
- 01 Architecture: N/A, single-file library with no feature slices.
- 02 Coding Practices §2: a pure function stays in the functional core.
- 02 Coding Practices §3: the file stays well under 250 lines, and the test file is also under 250.
- 02 Coding Practices §4.2: `TRANSLITERATIONS` follows UPPER_SNAKE_CASE for constants.
- 02 Coding Practices §6: unit tests sit adjacent in `test/`, matching the existing layout.
- 03 Documentation: the header comment is updated. The README needs no change.

## Standards & Compliance
- No secrets and no new inputs.
- Rollback: `git revert` of the single commit. No data is migrated.

## Test Plan
Add to `test/slug.test.js`, using `node:test` and deterministic assertions with no I/O:
- T1: each of the 7 letters in lowercase (FR1).
- T2: uppercase forms, including `ẞ` (FR2).
- T3: a mapped letter adjacent to a hyphen, and one inside a word (FR3).
- T4: regression, covering unchanged `é` handling and the `TypeError` for `''` and non-strings (FR4).
- Gate: `npm test` is fully green, including the 2 original tests.
- The T1 and T2 cases must fail on the baseline commit and pass after the change.

## Traceability
- FR1 → T1.
- FR2 → T2.
- FR3 → T3.
- FR4 → T4 plus the 2 existing tests.

## Observability & Operability
N/A: pure library function with no runtime telemetry, SLO or alerting surface.

## Rollout, Flagging & Rollback
- Ship as a normal library change. No flag is warranted for a deterministic pure function.
- Rollback: revert the commit.
- Judged by CI green. Revert if a downstream consumer reports unexpected slug churn.

## Dependencies & Supply Chain
N/A: no new dependencies, and `package.json` is untouched.

# Executive Summary
`slugify` silently drops ß, ø, æ, œ, đ, ł and þ, which truncates slugs such as "Straße" to `stra`. We add one small lookup map and one `replace` step (about 6 lines) that transliterates the seven letters. Uppercase forms are covered by the existing lowercasing step. Existing behaviour, the 2 existing tests and the zero-dependency setup are kept.

The task said the code relies on Unicode NFD, but the repo has no NFD step. Accents like `é` are dropped today, and this change leaves that alone. If the Operator wants accents stripped too, that is a separate follow-up.

Proof is new unit tests for each letter, uppercase forms and regression cases, run with `npm test`. Rollback is a single revert.
```

</details>

**Chief Engineer: review of v1**

> VERDICT: SHIP WITH CHANGES
> OPEN OBJECTIONS: 2
>
> 1. **The test gate as written can't pass, and the CI it relies on doesn't exist.**
>    - The Test Plan says "Gate: `npm test` is fully green" and Success Metrics says "`npm test` in CI". `package.json:9` defines `"test": "node --test test/"`.
>    - On the local toolchain (Node v22.23.4), that command fails on the baseline commit `a1908f9`. It prints `Error: Cannot find module '.../worktree/test'` and reports `not ok 1 - test`, `# fail 1`. Node 22 no longer accepts a directory as a `--test` argument.
>    - So today the 2 existing tests never run under `npm test`. The "2 existing tests stay green" guardrail can't be measured with the stated command.
>    - I found no CI configuration in the checkout: there is no `.github/` and no other CI file at the root (`ls -a`).
>    - Two commands do work. `node --test test/slug.test.js` and bare `node --test` both report `# tests 2`, `# pass 2`, `# fail 0`.
>    - **Change required:**
>      - Make the gate `node --test test/slug.test.js`, run locally on Node 22. That keeps `package.json` untouched, as the draft promises.
>      - Drop the "in CI" wording from Success Metrics and Rollout.
>      - Record the broken `npm test` script as a known baseline defect and an out-of-scope follow-up.
>    - Fixing the script inside this change would mean touching `package.json`, which contradicts the Dependencies section. That's a scope decision for the Lead; I don't recommend folding it in silently.
>
> 2. **Several current and expected outputs in the draft are wrong.** I ran them in memory on the baseline and with the proposed implementation:
>    - "Straße" becomes `stra-e` today, not `stra`. The `e` after `ß` survives. This error appears in both the Executive Summary (Brief) and the final Executive Summary.
>    - "Þórr på Øvre Ærø" becomes `rr-p-vre-r` today.
>    - With the change, that title becomes `th-rr-p-ovre-aero`, not `thorr-p-ovre-aero` as the User Journey claims. The `ó` is dropped under the existing behaviour, which leaves a dash between `th` and `rr`.
>    - A test written from the journey text would fail.
>    - **Change required:** correct these three strings. If the journey example becomes a test, its expected value must be `th-rr-p-ovre-aero`.
>
> **Verified, no objection:**
> - Every FR1–FR3 example produces exactly the stated output with the proposed map-then-collapse pipeline. These are: `strasse`, `aero`, `oeuvre`, `dorde`, `l-d`, `thing`, `oaeoedlth`, `strasse` (from "STRAẞE") and `weiss-bier`.
> - A2 holds. `toLowerCase()` maps Ø→ø (U+00F8), Æ→æ, Œ→œ, Đ→đ, Ł→ł, Þ→þ and ẞ→ß (U+00DF), so lowercase-only keys are enough.
> - The baseline code matches the draft. The pipeline is at `src/slug.js:12-15`, the TypeError check is at `:9`, and the header comment is at `:3-7`. There are no dependencies, and the module is CommonJS.
> - The "correction to the task premise" is accurate. I found no NFD or `normalize` call in `src/slug.js`.
>
> **Notes (not objections):**
> - The Implementation section shows a hard-coded regex `/[ßøæœđłþ]/g`, then says to derive the regex from the map keys. Keep only the derived form, e.g. `new RegExp('[' + Object.keys(TRANSLITERATIONS).join('') + ']', 'g')`, so the letters aren't listed twice (Constitution §1).
> - T4 should also assert that the `TypeError` message is unchanged, to fully cover "keep every existing behaviour".
>
> **Not checked:**
> - `.council/` config and persona files, beyond confirming the standards exist there.
> - Behaviour on Node versions other than v22.23.4.
> - Any downstream consumers of `slugify`. None are in this repository.

## Round 2

**Lead PM: what changed in v2**

> # Response to Objections
>
> 1. **Test gate and CI: adopted.**
>    - The gate is now `node --test test/slug.test.js`, run locally on Node 22. It reports `# tests 2`, `# pass 2` on the baseline, per the Chief Engineer's run.
>    - All "in CI" wording is removed from Success Metrics and Rollout.
>    - The broken `npm test` script (`package.json:9`, a directory argument that Node 22 rejects) is recorded as a known baseline defect. Fixing it is an out-of-scope follow-up, so `package.json` stays untouched.
>    - Assumption A3 (new) records this scope decision.
> 2. **Wrong strings: adopted.**
>    - "Straße" becomes `stra-e` today, not `stra`. The Executive Summary (Brief), the Problem Statement and the final Executive Summary are corrected.
>    - "Þórr på Øvre Ærø" becomes `rr-p-vre-r` today and `th-rr-p-ovre-aero` after the change. The User Journey is corrected and is now also test T3b.
> 3. **Note on derived regex: adopted.** Only the derived form remains in the Implementation section.
> 4. **Note on TypeError message: adopted.** T4 asserts the message is unchanged.

<details>
<summary>Draft v2 (full text)</summary>

```markdown
# Product Brief

## Executive Summary (Brief)
`slugify` drops seven Latin letters that have no decomposition (ß ø æ œ đ ł þ, plus uppercase forms). "Straße" becomes `stra-e` and "Łódź" becomes `d`. This change transliterates them as specified. It is a small, additive change to one function, with no new dependencies.

## Problem Statement & Impact
- `src/slug.js:14` replaces every character outside `[a-z0-9]` with a dash. So `ß` becomes `-`, giving `stra-e` for "Straße" and `d` for "Łódź". Confirmed by the Chief Engineer running the baseline.
- **Correction to the task premise:** the code has no NFD step. The header comment (`src/slug.js:3-7`) says accented letters are dropped, so `é` is also dropped today. This change does not alter that.

## Solution & Scope
- **In scope:** map `ß→ss`, `ø→o`, `æ→ae`, `œ→oe`, `đ→d`, `ł→l`, `þ→th`. Uppercase forms are handled by the existing `toLowerCase()`.
- **Out of scope:**
  - NFD or accent stripping for `é`, `ü` and similar.
  - The empty-title throw.
  - Length limiting.
  - New dependencies.
  - Fixing the broken `npm test` script (see A3).

## User Journeys & Jobs-to-be-Done
A content author titles a post "Þórr på Øvre Ærø". Today the slug is `rr-p-vre-r`. After the change it is `th-rr-p-ovre-aero`. The `ó` and `å` are still dropped, which is out of scope, but the title is recognizable again.

## Success Metrics
- **North Star:** the 7 letters, in both cases, each produce their target in the slug. Measured by the new tests passing.
- **Guardrails:** the 2 existing tests stay green, and output for ASCII-only input is unchanged.
- **Baseline → target:** 0 of 7 letters transliterated → 7 of 7.
- **Instrumentation:** `node --test test/slug.test.js`, run locally. No CI exists in the repo. Telemetry is N/A for a pure function.

## Risks & Mitigations
- **Slug churn:** titles containing these letters get different slugs. Stored slugs are not recomputed by this change, but callers that regenerate slugs from titles may see URL changes. Mitigation: flag this in the PR description.
- **Dependency, vendor and compliance risk:** N/A: nothing is added.

## Key Assumptions & Chief Architect Rulings
- **A1:** the task's NFD premise is inaccurate. "Keep every existing behaviour" is read literally, so no NFD is added.
- **A2:** the mapping runs after `toLowerCase()`, so lowercase keys suffice. The Chief Engineer verified that Ø, Æ, Œ, Đ, Ł, Þ and ẞ lowercase to ø, æ, œ, đ, ł, þ and ß.
- **A3:** `npm test` fails on Node 22 on the baseline (`node --test test/` is rejected). It is a known baseline defect and a separate follow-up. Fixing it would touch `package.json`, so it is excluded from this change.
- No Architect rulings are required.

# PRD

## Verified Baseline
- Commit `a1908f9`. Files: `src/slug.js` (18 lines), `test/slug.test.js` (2 tests), `package.json` (zero dependencies, CommonJS).
- Pipeline (`src/slug.js:12-15`): `toLowerCase` → `replace(/[^a-z0-9]+/g,'-')` → trim edge dashes.
- The `TypeError` check (`src/slug.js:9`) stays unchanged.
- Verified by the Chief Engineer on Node v22.23.4: `node --test test/slug.test.js` reports 2 pass and 0 fail. `npm test` fails (A3).

## Functional Requirements
- **FR1.** `slugify` MUST replace ß, ø, æ, œ, đ, ł, þ with ss, o, ae, oe, d, l, th before the non-alphanumeric collapse.
  - Given "Straße", then `strasse`.
  - Given "Ærø", then `aero`.
  - Given "Œuvre", then `oeuvre`.
  - Given "Đorđe", then `dorde`.
  - Given "Łódź", then `l-d`.
  - Given "Þing", then `thing`.
- **FR2.** Uppercase forms MUST behave the same as lowercase.
  - Given "ØÆŒĐŁÞ", then `oaeoedlth`.
  - Given "STRAẞE", then `strasse`.
- **FR3.** Mapped output MUST join the surrounding letters without a dash.
  - Given "Weiß-Bier", then `weiss-bier`.
  - Given "Þórr på Øvre Ærø", then `th-rr-p-ovre-aero`.
- **FR4.** All other behaviour MUST be unchanged.
  - The 2 existing tests pass unmodified.
  - Empty and non-string input still throws `TypeError` with the same message.
  - `é` and `ü` still collapse to a dash.
- **Implementation:**
  - Add a module-level `const TRANSLITERATIONS = { 'ß': 'ss', 'ø': 'o', 'æ': 'ae', 'œ': 'oe', 'đ': 'd', 'ł': 'l', 'þ': 'th' }` as the single source of truth.
  - Derive the pattern from it: `const TRANSLITERATION_PATTERN = new RegExp('[' + Object.keys(TRANSLITERATIONS).join('') + ']', 'g')`. The letters are not listed twice.
  - Insert `.replace(TRANSLITERATION_PATTERN, c => TRANSLITERATIONS[c])` between `toLowerCase()` and the collapse.
  - Update the header comment at `src/slug.js:3-7`.

## Non-Functional Requirements
- **Performance:** one extra linear pass, with no measurable cost for titles under 1 KB.
- **Security and privacy:** N/A: pure function with no I/O or data.
- **Accessibility, i18n:** the change is an i18n improvement. Full Unicode coverage is out of scope.
- **Cost:** none.

## Invariants & Architecture Compliance
- Constitution §1: one map, with the pattern derived from it.
- Constitution §5: the new tests are the proof. T1 and T2 fail on the baseline and pass after the change.
- Constitution §7: the signature is unchanged. Output changes only for inputs containing the 7 letters.
- Constitution §8: reversible by reverting one commit.

## Engineering Standards Compliance
- 01 Architecture: N/A: single-file library with no feature slices.
- 02 Coding Practices §2: the function stays pure.
- 02 Coding Practices §3: both files stay under 250 lines.
- 02 Coding Practices §4.2: `TRANSLITERATIONS` and `TRANSLITERATION_PATTERN` use UPPER_SNAKE_CASE.
- 02 Coding Practices §6: unit tests stay in the existing `test/` layout.
- 03 Documentation: the header comment is updated. The README needs no change.

## Standards & Compliance
- No secrets and no new inputs.
- Rollback: `git revert` of the single commit. No data is migrated.

## Test Plan
Add to `test/slug.test.js` using `node:test`, with deterministic assertions and no I/O:
- T1: the 7 lowercase letters (FR1).
- T2: uppercase forms, including `ẞ` (FR2).
- T3a: a mapped letter next to a hyphen ("Weiß-Bier").
- T3b: the journey title, expecting `th-rr-p-ovre-aero` (FR3).
- T4: `é` still dropped, and `TypeError` for `''` and non-strings with the message asserted (FR4).
- Gate: `node --test test/slug.test.js` is fully green, including the 2 original tests.

## Traceability
- FR1 → T1.
- FR2 → T2.
- FR3 → T3a, T3b.
- FR4 → T4 plus the 2 existing tests.

## Observability & Operability
N/A: pure library function with no telemetry, SLO or alerting surface.

## Rollout, Flagging & Rollback
- Ship as a normal change with no flag, since the function is deterministic and pure.
- The gate is the local test run. The repo has no CI.
- Rollback: revert the commit. Revert if a downstream consumer reports unexpected slug churn.

## Dependencies & Supply Chain
N/A: no new dependencies, and `package.json` is untouched.

# Executive Summary
`slugify` silently drops ß, ø, æ, œ, đ, ł and þ. "Straße" becomes `stra-e` and "Łódź" becomes `d`. We add one small lookup map and one `replace` step, with the pattern derived from the map. The step transliterates the seven letters. Existing lowercasing covers the uppercase forms. Existing behaviour, the 2 existing tests and the zero-dependency setup are kept.

The task said the code relies on NFD, but the repo has no NFD step. Accents like `é` are dropped today, and this change leaves that alone.

Proof is new unit tests, run with `node --test test/slug.test.js`. The `npm test` script is broken on Node 22 and there is no CI. We record that as a separate follow-up and do not touch `package.json`. Rollback is a single revert.
```

</details>

**Chief Engineer: review of v2**

> VERDICT: SHIP IT
> OPEN OBJECTIONS: 0
>
> I checked this at `a1908f9` on Node v22.23.4. I made no changes to the repo.
>
> **What I verified**
> - **Baseline:** `src/slug.js:12-15` runs `toLowerCase` → `/[^a-z0-9]+/g` → trim, as the PRD says. `node --test test/slug.test.js` gives 2 tests, 2 pass, 0 fail. `package.json:9` (`node --test test/`) is the broken script recorded under A3. Both round 1 objections are resolved as described.
> - **Every FR example:** I ran the proposed implementation (the map, the derived `RegExp` and the `replace` after `toLowerCase()`) against the baseline. All of them match:
>   - **FR1:** `strasse`, `aero`, `oeuvre`, `dorde`, `l-d`, `thing`.
>   - **FR2:** `oaeoedlth`, and `STRAẞE` → `strasse`.
>   - **FR3:** `weiss-bier`, and `th-rr-p-ovre-aero`.
>   - **FR4:** `hello-world` and `add-stripe-webhook-idempotency` are unchanged.
> - **Baseline strings in the brief:** these are also correct: `stra-e`, `d` and `rr-p-vre-r`.
> - **Uppercase claim (A2):** `ẞ` lowercases to `ß`. Ø Æ Œ Đ Ł Þ lowercase to their mapped keys, as A2 says. Lowercase `ß` stays `ß`, so the order of the steps is safe.
> - **Other checks:**
>   - The function stays pure.
>   - No dependency is added.
>   - No secrets are involved.
>   - Both files stay well under 250 lines (02 Coding Practices §3).
>   - The constants are named in UPPER_SNAKE_CASE (02 Coding Practices §4.2).
>   - The letters are listed only once (Constitution §1).
>   - Rollback is a single revert (Constitution §8).
> - **Linting and CI:** the repo has no linter, typecheck or formatter configured, and no CI. The test run is the only gate.
>
> **Notes (not objections)**
> 1. **T4 example:** FR4 says "`é` and `ü` still collapse to a dash". On its own, `slugify('é')` returns `''` because the edge dashes are trimmed. T4 should test the letter between other characters, for example `slugify('café au lait') === 'caf-au-lait'` (verified on the baseline). A lone `'é'` would make the assertion ambiguous.
> 2. **README:** `README.md` tells readers to run `npm test`, which is broken (A3). That should go into the same follow-up as A3, not this change. "The README needs no change" is still correct for this scope.
>
> **Not checked**
> - Engines other than Node v22.23.4.
> - Downstream consumers of `slugify`. None are in this repo, so the impact of slug churn is unknown.
> - The contents of `.council/` beyond listing it.
> - Mutation or property-based testing, which isn't needed for a 7-entry map.

**Chief Architect: sign-off review of v2**

> POINT 1: OK. The change is one commit and reverts with `git revert`. Git history is the audit trail, and the slug-churn rollback trigger is named.
> POINT 2: N/A. The function is pure, with no new trust boundary, I/O or secrets. The pattern is a fixed character class derived from literal keys, so there is no ReDoS or injection surface. The `TypeError` guard is unchanged.
> POINT 3: N/A. `package.json` is untouched and no dependency is added, so there is no lockfile or SBOM impact.
> POINT 4: OK. T1, T2 and T3a fail on the baseline and pass after the change, which satisfies Constitution §5. T4 and the 2 existing tests guard against regressions. The tests are deterministic and need no I/O.
> - The missing CI is out of scope. The local `node --test test/slug.test.js` gate is acceptable at this blast radius.
> - The broken `npm test` (A3) is also out of scope and recorded as a follow-up.
> POINT 5: N/A. No personal data is stored or processed.
> POINT 6: OK. The requirements use RFC 2119 keywords and each is traceable to a named test (FR1→T1, FR2→T2, FR3→T3a/T3b, FR4→T4 plus the 2 existing tests). I checked the worked examples by hand:
> - "Łódź" gives `l-d`.
> - "Đorđe" gives `dorde`.
> - "Þórr på Øvre Ærø" gives `th-rr-p-ovre-aero`.
> - "STRAẞE" gives `strasse`, since `ẞ` lowercases to `ß`.
>
> The single map with a derived pattern satisfies Constitution §1. An ADR is not warranted for a reversible one-function change.
> POINT 7: N/A — quick profile
> POINT 8: N/A — quick profile
> POINT 9: N/A — quick profile
> POINT 10: N/A — quick profile
> POINT 11: N/A — quick profile
> POINT 12: N/A — quick profile
>
> Project Engineering Standards:
> - 02 Coding Practices §2, §3 and §4.2: compliant.
> - 03 Documentation: compliant. The header comment is updated and no feature README applies.
> - 01 Architecture: N/A, because this is a single-file library with no feature slices.
> - 02 Coding Practices §6 prefers tests adjacent to the code. Relocating the existing `test/` layout would break "existing tests unmodified" and expand scope, so I rule it N/A — out of scope.
>
> VERDICT: SIGN-OFF
> SUMMARY: The change is a single-map, pure-function addition with red-first tests and a one-commit rollback; the broken `npm test` script, the missing CI and the `test/` layout are out of scope and named as follow-ups.

**Lead PM: final sign-off on v2**

> VERDICT: SIGN-OFF
> SUMMARY: I checked the document against `src/slug.js`, the tests and `package.json`, and it holds. Every worked example comes out as stated, and I have no remaining concerns.
>
> - **Baseline:**
>   - There is no NFD step. The pipeline at `src/slug.js:12-15` is `toLowerCase`, then `replace(/[^a-z0-9]+/g,'-')`, then an edge-dash trim.
>   - The header comment at `src/slug.js:3-7` says accented letters are dropped.
>   - The only tests are the two named in the document.
>   - `package.json` has zero dependencies, and `scripts.test` is `node --test test/`, which A3 flags as broken on Node 22.
>   - HEAD is `a1908f9`, as stated.
> - **Worked examples:** I traced each one by hand through the pipeline, with the new map applied after lowercasing.
>   - "Łódź" gives `l-d`.
>   - "Þórr på Øvre Ærø" gives `th-rr-p-ovre-aero`.
>   - "Đorđe" gives `dorde`.
>   - "Weiß-Bier" gives `weiss-bier`.
>   - "ØÆŒĐŁÞ" gives `oaeoedlth`.
>   - "STRAẞE" gives `strasse`, because `ẞ` lowercases to `ß`.
> - **Scope:** the document corrects the task's NFD premise and keeps "existing behaviour" literal. The derived single map, the fixed character class, the unchanged `TypeError` guard, the red-first tests and the one-commit rollback all hold up. The broken `npm test`, the missing CI and the test layout are excluded and named as follow-ups.

## The signed-off PRD

SHA-256 `99aa5e147900f21dbdbf4540db465748ce9c270f552287e2298d31aadef3bcb3`. The operator approves this exact hash with `APPROVE 99aa5e14`.

<details>
<summary>Final PRD (full text)</summary>

```markdown
# Product Brief

## Executive Summary (Brief)
`slugify` drops seven Latin letters that have no decomposition (ß ø æ œ đ ł þ, plus uppercase forms). "Straße" becomes `stra-e` and "Łódź" becomes `d`. This change transliterates them as specified. It is a small, additive change to one function, with no new dependencies.

## Problem Statement & Impact
- `src/slug.js:14` replaces every character outside `[a-z0-9]` with a dash. So `ß` becomes `-`, giving `stra-e` for "Straße" and `d` for "Łódź". Confirmed by the Chief Engineer running the baseline.
- **Correction to the task premise:** the code has no NFD step. The header comment (`src/slug.js:3-7`) says accented letters are dropped, so `é` is also dropped today. This change does not alter that.

## Solution & Scope
- **In scope:** map `ß→ss`, `ø→o`, `æ→ae`, `œ→oe`, `đ→d`, `ł→l`, `þ→th`. Uppercase forms are handled by the existing `toLowerCase()`.
- **Out of scope:**
  - NFD or accent stripping for `é`, `ü` and similar.
  - The empty-title throw.
  - Length limiting.
  - New dependencies.
  - Fixing the broken `npm test` script (see A3).

## User Journeys & Jobs-to-be-Done
A content author titles a post "Þórr på Øvre Ærø". Today the slug is `rr-p-vre-r`. After the change it is `th-rr-p-ovre-aero`. The `ó` and `å` are still dropped, which is out of scope, but the title is recognizable again.

## Success Metrics
- **North Star:** the 7 letters, in both cases, each produce their target in the slug. Measured by the new tests passing.
- **Guardrails:** the 2 existing tests stay green, and output for ASCII-only input is unchanged.
- **Baseline → target:** 0 of 7 letters transliterated → 7 of 7.
- **Instrumentation:** `node --test test/slug.test.js`, run locally. No CI exists in the repo. Telemetry is N/A for a pure function.

## Risks & Mitigations
- **Slug churn:** titles containing these letters get different slugs. Stored slugs are not recomputed by this change, but callers that regenerate slugs from titles may see URL changes. Mitigation: flag this in the PR description.
- **Dependency, vendor and compliance risk:** N/A: nothing is added.

## Key Assumptions & Chief Architect Rulings
- **A1:** the task's NFD premise is inaccurate. "Keep every existing behaviour" is read literally, so no NFD is added.
- **A2:** the mapping runs after `toLowerCase()`, so lowercase keys suffice. The Chief Engineer verified that Ø, Æ, Œ, Đ, Ł, Þ and ẞ lowercase to ø, æ, œ, đ, ł, þ and ß.
- **A3:** `npm test` fails on Node 22 on the baseline (`node --test test/` is rejected). It is a known baseline defect and a separate follow-up. Fixing it would touch `package.json`, so it is excluded from this change.
- No Architect rulings are required.

# PRD

## Verified Baseline
- Commit `a1908f9`. Files: `src/slug.js` (18 lines), `test/slug.test.js` (2 tests), `package.json` (zero dependencies, CommonJS).
- Pipeline (`src/slug.js:12-15`): `toLowerCase` → `replace(/[^a-z0-9]+/g,'-')` → trim edge dashes.
- The `TypeError` check (`src/slug.js:9`) stays unchanged.
- Verified by the Chief Engineer on Node v22.23.4: `node --test test/slug.test.js` reports 2 pass and 0 fail. `npm test` fails (A3).

## Functional Requirements
- **FR1.** `slugify` MUST replace ß, ø, æ, œ, đ, ł, þ with ss, o, ae, oe, d, l, th before the non-alphanumeric collapse.
  - Given "Straße", then `strasse`.
  - Given "Ærø", then `aero`.
  - Given "Œuvre", then `oeuvre`.
  - Given "Đorđe", then `dorde`.
  - Given "Łódź", then `l-d`.
  - Given "Þing", then `thing`.
- **FR2.** Uppercase forms MUST behave the same as lowercase.
  - Given "ØÆŒĐŁÞ", then `oaeoedlth`.
  - Given "STRAẞE", then `strasse`.
- **FR3.** Mapped output MUST join the surrounding letters without a dash.
  - Given "Weiß-Bier", then `weiss-bier`.
  - Given "Þórr på Øvre Ærø", then `th-rr-p-ovre-aero`.
- **FR4.** All other behaviour MUST be unchanged.
  - The 2 existing tests pass unmodified.
  - Empty and non-string input still throws `TypeError` with the same message.
  - `é` and `ü` still collapse to a dash.
- **Implementation:**
  - Add a module-level `const TRANSLITERATIONS = { 'ß': 'ss', 'ø': 'o', 'æ': 'ae', 'œ': 'oe', 'đ': 'd', 'ł': 'l', 'þ': 'th' }` as the single source of truth.
  - Derive the pattern from it: `const TRANSLITERATION_PATTERN = new RegExp('[' + Object.keys(TRANSLITERATIONS).join('') + ']', 'g')`. The letters are not listed twice.
  - Insert `.replace(TRANSLITERATION_PATTERN, c => TRANSLITERATIONS[c])` between `toLowerCase()` and the collapse.
  - Update the header comment at `src/slug.js:3-7`.

## Non-Functional Requirements
- **Performance:** one extra linear pass, with no measurable cost for titles under 1 KB.
- **Security and privacy:** N/A: pure function with no I/O or data.
- **Accessibility, i18n:** the change is an i18n improvement. Full Unicode coverage is out of scope.
- **Cost:** none.

## Invariants & Architecture Compliance
- Constitution §1: one map, with the pattern derived from it.
- Constitution §5: the new tests are the proof. T1 and T2 fail on the baseline and pass after the change.
- Constitution §7: the signature is unchanged. Output changes only for inputs containing the 7 letters.
- Constitution §8: reversible by reverting one commit.

## Engineering Standards Compliance
- 01 Architecture: N/A: single-file library with no feature slices.
- 02 Coding Practices §2: the function stays pure.
- 02 Coding Practices §3: both files stay under 250 lines.
- 02 Coding Practices §4.2: `TRANSLITERATIONS` and `TRANSLITERATION_PATTERN` use UPPER_SNAKE_CASE.
- 02 Coding Practices §6: unit tests stay in the existing `test/` layout.
- 03 Documentation: the header comment is updated. The README needs no change.

## Standards & Compliance
- No secrets and no new inputs.
- Rollback: `git revert` of the single commit. No data is migrated.

## Test Plan
Add to `test/slug.test.js` using `node:test`, with deterministic assertions and no I/O:
- T1: the 7 lowercase letters (FR1).
- T2: uppercase forms, including `ẞ` (FR2).
- T3a: a mapped letter next to a hyphen ("Weiß-Bier").
- T3b: the journey title, expecting `th-rr-p-ovre-aero` (FR3).
- T4: `é` still dropped, and `TypeError` for `''` and non-strings with the message asserted (FR4).
- Gate: `node --test test/slug.test.js` is fully green, including the 2 original tests.

## Traceability
- FR1 → T1.
- FR2 → T2.
- FR3 → T3a, T3b.
- FR4 → T4 plus the 2 existing tests.

## Observability & Operability
N/A: pure library function with no telemetry, SLO or alerting surface.

## Rollout, Flagging & Rollback
- Ship as a normal change with no flag, since the function is deterministic and pure.
- The gate is the local test run. The repo has no CI.
- Rollback: revert the commit. Revert if a downstream consumer reports unexpected slug churn.

## Dependencies & Supply Chain
N/A: no new dependencies, and `package.json` is untouched.

# Executive Summary
`slugify` silently drops ß, ø, æ, œ, đ, ł and þ. "Straße" becomes `stra-e` and "Łódź" becomes `d`. We add one small lookup map and one `replace` step, with the pattern derived from the map. The step transliterates the seven letters. Existing lowercasing covers the uppercase forms. Existing behaviour, the 2 existing tests and the zero-dependency setup are kept.

The task said the code relies on NFD, but the repo has no NFD step. Accents like `é` are dropped today, and this change leaves that alone.

Proof is new unit tests, run with `node --test test/slug.test.js`. The `npm test` script is broken on Node 22 and there is no CI. We record that as a separate follow-up and do not touch `package.json`. Rollback is a single revert.
```

</details>

## Verification gates

Run on `2ff06eb`. Overall: **FAIL**.

- `test`: `npm test`, exit 1, 0.1 s, **FAIL**
<details>
<summary>Output of test</summary>

```
> council-playground@0.1.0 test
> node --test test/

TAP version 13
# node:internal/modules/cjs/loader:1433
#   throw err;
#   ^
# Error: Cannot find module '~/.council/projects/playground-19507a48/exec/20261106195121-slugify-special-letters/test'
#     at Function._resolveFilename (node:internal/modules/cjs/loader:1430:15)
#     at defaultResolveImpl (node:internal/modules/cjs/loader:1040:19)
#     at resolveForCJSWithHooks (node:internal/modules/cjs/loader:1045:22)
#     at Function._load (node:internal/modules/cjs/loader:1216:25)
#     at wrapModuleLoad (node:internal/modules/cjs/loader:254:19)
#     at Function.executeUserEntryPoint [as runMain] (node:internal/modules/run_main:171:5)
#     at node:internal/main/run_main_module:36:49 {
#   code: 'MODULE_NOT_FOUND',
#   requireStack: []
# }
# Node.js v22.23.4
# Subtest: test
not ok 1 - test
  ---
  duration_ms: 28.149744
  type: 'test'
  location: '~/.council/projects/playground-19507a48/exec/20261106195121-slugify-special-letters/test:1:1'
  failureType: 'testCodeFailure'
  exitCode: 1
  signal: ~
  error: 'test failed'
  code: 'ERR_TEST_FAILURE'
  ...
1..1
# tests 1
# suites 0
# pass 0
# fail 1
# cancelled 0
# skipped 0
# todo 0
# duration_ms 33.375862
```

</details>

## What the Chief Engineer committed

```
2ff06eb fix(slug): transliterate ß ø æ œ đ ł þ instead of dropping them
```

<details>
<summary>Full diff</summary>

```diff
diff --git a/src/slug.js b/src/slug.js
index 68be324..1900d3c 100644
--- a/src/slug.js
+++ b/src/slug.js
@@ -2,15 +2,23 @@
 
 /**
  * Turns a title into a URL slug: lowercase, words joined by single dashes.
- * Known gaps: an empty title throws, accented letters are dropped instead of
- * transliterated, and the result is not length-limited.
+ * The letters ß ø æ œ đ ł þ (and their uppercase forms, via toLowerCase) are
+ * transliterated to ss o ae oe d l th, because they have no decomposition.
+ * Known gaps: an empty title throws, other accented letters (é, ü) are dropped
+ * instead of transliterated, and the result is not length-limited.
  */
+const TRANSLITERATIONS = {
+  'ß': 'ss', 'ø': 'o', 'æ': 'ae', 'œ': 'oe', 'đ': 'd', 'ł': 'l', 'þ': 'th',
+};
+const TRANSLITERATION_PATTERN = new RegExp('[' + Object.keys(TRANSLITERATIONS).join('') + ']', 'g');
+
 function slugify(title) {
   if (typeof title !== 'string' || title.length === 0) {
     throw new TypeError('slugify: title must be a non-empty string');
   }
   return title
     .toLowerCase()
+    .replace(TRANSLITERATION_PATTERN, c => TRANSLITERATIONS[c])
     .replace(/[^a-z0-9]+/g, '-')
     .replace(/^-|-$/g, '');
 }
diff --git a/test/slug.test.js b/test/slug.test.js
index 99bc93c..b2a6d62 100644
--- a/test/slug.test.js
+++ b/test/slug.test.js
@@ -9,3 +9,34 @@ test('words become dash-separated lowercase', () => {
 test('punctuation collapses into one dash', () => {
   assert.equal(slugify('Add Stripe: webhook idempotency!'), 'add-stripe-webhook-idempotency');
 });
+
+test('T1: lowercase special Latin letters are transliterated (FR1)', () => {
+  assert.equal(slugify('Straße'), 'strasse');
+  assert.equal(slugify('Ærø'), 'aero');
+  assert.equal(slugify('Œuvre'), 'oeuvre');
+  assert.equal(slugify('Đorđe'), 'dorde');
+  assert.equal(slugify('Łódź'), 'l-d');
+  assert.equal(slugify('Þing'), 'thing');
+});
+
+test('T2: uppercase forms behave like lowercase, including capital sharp s (FR2)', () => {
+  assert.equal(slugify('ØÆŒĐŁÞ'), 'oaeoedlth');
+  assert.equal(slugify('STRAẞE'), 'strasse');
+});
+
+test('T3a: a mapped letter next to a hyphen joins its word without a dash (FR3)', () => {
+  assert.equal(slugify('Weiß-Bier'), 'weiss-bier');
+});
+
+test('T3b: the journey title becomes recognizable (FR3)', () => {
+  assert.equal(slugify('Þórr på Øvre Ærø'), 'th-rr-p-ovre-aero');
+});
+
+test('T4: other behaviour is unchanged (FR4)', () => {
+  assert.equal(slugify('café'), 'caf');
+  assert.equal(slugify('über cool'), 'ber-cool');
+  const message = 'slugify: title must be a non-empty string';
+  assert.throws(() => slugify(''), { name: 'TypeError', message });
+  assert.throws(() => slugify(42), { name: 'TypeError', message });
+  assert.throws(() => slugify(undefined), { name: 'TypeError', message });
+});
```

</details>

## Why it ended BLOCKED

> 1 required verification gate(s) failed: test
>
> ### Gate 'test' failed (exit 1)
> Standard: 12-point #4 Testing & Release Engineering
> Command: npm test
>
>
> > council-playground@0.1.0 test
> > node --test test/
>
> TAP version 13
> # node:internal/modules/cjs/loader:1433
> #   throw err;
> #   ^
> # Error: Cannot find module '~/.council/projects/playground-19507a48/exec/20261106195121-slugify-special-letters/test'
> #     at Function._resolveFilename (node:internal/modules/cjs/loader:1430:15)
> #     at defaultResolveImpl (node:internal/modules/cjs/loader:1040:19)
> #     at resolveForCJSWithHooks (node:internal/modules/cjs/loader:1045:22)
> #     at Function._load (node:internal/modules/cjs/loader:1216:25)
> #     at wrapModuleLoad (node:internal/modules/cjs/loader:254:19)
> #     at Function.executeUserEntryPoint [as runMain] (node:internal/modules/run_main:171:5)
> #     at node:internal/main/run_main_module:36:49 {
> #   code: 'MODULE_NOT_FOUND',
> #   requireStack: []
> # }
> # Node.js v22.23.4
> # Subtest: test
> not ok 1 - test
>   ---
>   duration_ms: 28.149744
>   type: 'test'
>   location: '~/.council/projects/playground-19507a48/exec/20261106195121-slugify-special-letters/test:1:1'
>   failureType: 'testCodeFailure'
>   exitCode: 1
>   signal: ~
>   error: 'test failed'
>   code: 'ERR_TEST_FAILURE'
>   ...
> 1..1
> # tests 1
> # suites 0
> # pass 0
> # fail 1
> # cancelled 0
> # skipped 0
> # todo 0
> # duration_ms 33.375862

