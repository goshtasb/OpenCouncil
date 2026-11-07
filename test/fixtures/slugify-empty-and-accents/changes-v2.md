# Response to Objections

**1. `npm test` is broken at baseline: adopted.** I did not run `npm test` for v1, so the claim that it ran the 2 tests was unverified and wrong. The draft now changes as follows:
- A first commit changes the `package.json:8` script to `"node --test"`, with no new dependency.
- The Verified Baseline states that `npm test` fails at a1908f9 with MODULE_NOT_FOUND.
- The README line is moved to "In scope, verified, no edit needed". The README already documents `npm test`, and the fix makes that instruction true.
- The Test Plan runs the repro tests through the fixed `npm test` against the old `src/slug.js` and records the failures. It then applies the slug change and records the passes.
- A guardrail is added: `npm test` exits 0 with `fail 0` and at least 8 tests.

**Notes adopted:**
- Test 6 is now tied to FR-1b.
- Ligatures and compatibility characters (`ﬁ ǅ Ⅻ`) are added to the known-gaps comment, and NFKD stays out of scope.
- Tests assert the `TypeError` type, not the message text.

**Still unverified:** other Node versions, and CI (none found).