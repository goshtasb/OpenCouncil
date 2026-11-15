You are grading one code review of a pull request against the list of known issues in that pull request.
You are not reviewing the code yourself. Judge only from the review text and the known issues below.

For each known issue, decide whether the review identifies the SAME underlying issue.
- Accept a semantic match: different wording is fine if it is the same problem in the same code.
- The review must raise it as a problem, a risk or a needed fix. A passage that only describes the code, or says that part is fine, does not count.
- A general remark that would fit many problems (for example "add more error handling") does not count unless it points at this specific problem.
- List every section id where the review raises it, not only the first.

Also count how many distinct problems the review raises in total, counting each problem once however many sections repeat it.

Known issues:
{{GOLDEN}}

The review, in labelled sections:
{{REVIEW}}

Answer with only this JSON object and nothing else:
{"issues": [{"id": "g1", "found": true, "sections": ["S2"], "quote": "a short exact quote from the review", "reasoning": "one sentence"}], "distinct_problems_raised": 0}
Give one entry per known issue, in the order listed. When found is false, give sections [] and quote "".
