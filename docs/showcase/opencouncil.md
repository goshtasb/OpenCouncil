# Showcase: Open Council builds `council gates` for itself

- **Repository:** [goshtasb/OpenCouncil](https://github.com/goshtasb/OpenCouncil)
- **Task:** add a `council gates` command that prints the verification gates a project would run, in resolution order, without running them ([issue #5](https://github.com/goshtasb/OpenCouncil/issues/5) grew out of it).
- **Seats:** Lead PM on Gemini (Antigravity), Chief Engineer on Claude Code, Chief Architect on Grok.
- **Outcome:** [PR #1](https://github.com/goshtasb/OpenCouncil/pull/1), opened by the harness; the feature shipped in [v0.1.0](https://github.com/goshtasb/OpenCouncil/releases/tag/v0.1.0).

## What the council did

1. The Lead PM researched the repository and drafted the Product Brief + PRD.
2. The Chief Engineer read the real source and replied `SHIP WITH CHANGES` with six objections, each citing `file:line`. One of them pointed out that a ruling the Chief Architect had issued on an undefined-rule question was itself wrong against the code.
3. The Lead revised. Rounds two and three came back with three objections each; the draft moved on every one.
4. Round four: `SHIP IT`, zero objections. The Chief Architect audited the agreed document against the 12-point checklist and signed off with zero required and zero advisory concerns. The Lead signed off last on the same SHA-256.
5. A PDF landed for the human. One typed approval token, then the Chief Engineer implemented the feature in an isolated clone, the harness ran `npm run build` and `npm test`, pushed `council/gates-command` and opened the pull request.

The event sequence of this run is what [`docs/demo.svg`](../demo.svg) and [`docs/office.gif`](../office.gif) replay.

## What went wrong, and what it changed

CI failed the pull request. The branch built on its own and `main` built on its own; the merge of the two did not, because `main` had moved while the council deliberated. The harness had verified the branch in isolation, while GitHub verifies the merge.

The fix shipped with the feature: before the gates run, the harness now merges the current tip of the base branch into the execution branch, and a merge conflict blocks the pull request instead of pushing a broken merge. That behaviour has a regression test (`gates run against the merge with the base branch, not the branch alone`).

## Why it is here

It is the smallest honest example of the loop: a disagreement that improved the specification, a sign-off bound to a hash, a pull request the harness opened, and a failure the harness learned from.
