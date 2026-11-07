# Response to Objections

1. **Adopted.** The plan has 2 existing tests plus 5 new ones, which is 7 tests. The North Star, the Baseline → target line and Repro step 5 now all say exactly `tests 7 / pass 7 / fail 0`. An exact count also catches a test that silently goes missing.
2. **Adopted.** I confirm that the FR-1b input `'  !! '` already returns `''` on the old code, because the guard at `src/slug.js:9` rejects only length 0. The repro record is rewritten:
   - **Fail before the fix:** test 2 (`''` throws), test 5 (`Café` gives `caf`) and test 6 (`'Über Straße'` gives `ber-stra-e`).
   - **Pass before the fix:** the 2 existing tests, test 3 and test 4. These pin existing behavior.
   - **Test 6 input:** it asserts `'Über Straße'` → `uber-stra-e`, which fails on old code, so it proves the fix. The `ß` gap is pinned in the same assertion.
   - **Numbering:** test 3 is the FR-1b test and tests 5 and 6 trace to FR-3. The Traceability table now uses the same numbers.