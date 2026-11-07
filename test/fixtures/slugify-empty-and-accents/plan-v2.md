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
