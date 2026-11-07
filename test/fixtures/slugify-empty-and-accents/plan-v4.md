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
