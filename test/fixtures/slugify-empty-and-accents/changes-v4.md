# Response to Objections

**Chief Engineer, notes:** Adopted. FR-5's gap list now matches the full out-of-scope list (`ß ø æ œ đ ł þ`). The comment citation is corrected to `src/slug.js:4-6`.

**Chief Architect, points 1-5, 7-12:** N/A, no change needed.

**Chief Architect, point 6** points to concerns 1-4 below.

**CONCERN 1 (Devanagari claim):** Adopted. The Risks bullet now uses Cyrillic `й` and Greek `ά`. Their marks (U+0306, U+0301) fall inside `\u0300-\u036f`. After stripping, their base letters `и` and `α` are still dropped by `[^a-z0-9]`, so output is unchanged.

**CONCERN 2 ("4 linear passes"):** Adopted. The chain has five operations. The NFR now says "O(n), five linear operations".

**CONCERN 3 (commit-dependent count):** Adopted. Commit 1 carries only the `package.json` change, and its gate is `tests 2 / pass 2 / fail 0`. Commit 2 carries the `slug.js` change, the comment update and the 5 new tests, and its gate is `tests 7 / pass 7 / fail 0`. FR-0 now states both gates.

**CONCERN 4 (FR-5 proof):** Adopted. FR-5 is now traced to two grep commands with stated expected output. To make the first grep reliable, the comment MUST NOT contain the words "empty" or "accent" anywhere in the file.