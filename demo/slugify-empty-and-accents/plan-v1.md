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
