---
name: council
description: 'Run an Open Council on a task. Three AI seats (Lead PM, Chief Engineer, Chief Architect) deliberate a PRD until all three sign off the same document, the human approves it, then the Chief Engineer implements it in an isolated clone and the harness opens a verified pull request. Use when the user asks to convene the council, run a council on something, deliberate a spec, or wants a spec argued out and shipped as a PR.'
argument-hint: '[task description] [--quick]'
allowed-tools: 'Bash(council:*) Bash(npx open-council-cli:*) Bash(git:*) Bash(gh:*) Read'
---

# Open Council

You drive the `council` CLI for the user. The council has four seats and only one of them is the user:
the **Lead PM** writes and revises the Product Brief + PRD, the **Chief Engineer** verifies every claim
against the code and objects with `file:line`, the **Chief Architect** rules on deadlocks and audits the
agreed document against named standards, and the **human Operator** approves the final PRD. Nothing is
written to the repository before that approval, and the harness never reports "done" unless the
verification gates passed and the pull request exists.

## Rules you must keep

1. **Never run `council approve` yourself.** The approval token is the Operator's decision. Show the PRD
   path and the exact approve command and stop; continue only after the user tells you they approved.
2. Never bypass a stall or a BLOCKED result. Report it with the reason and the partial-result file.
3. Do not edit the repository during deliberation. The Chief Engineer seat implements after approval, in
   its own clone.

## Task

The user asked for: $ARGUMENTS

If the arguments are empty, ask the user for one sentence describing what to build or fix, then continue.
If the arguments contain `--quick`, use the quick profile (at most 4 rounds, six-point review) and strip the flag from the task text.

## Steps

Run each command with Bash, show the user the relevant output, and stop at the approval step.

1. **Find the CLI.** Run `council --version`. If it is not installed, use `npx -y open-council-cli@latest` in
   place of `council` for every command below, or install it with `npm install -g open-council-cli`.
2. **Initialize once.** If the repository has no `.council/` directory, run `council init` (add `--quick` if
   requested). It detects which provider CLIs are installed; with only Claude Code present every seat runs on
   Claude Code. Then run `council doctor` and show the user any seat that failed together with the fix command it printed. Do not continue until every seat answers.
3. **Queue the task.** Run `council backlog add "<task>" --priority 1` and note the item id it prints (for example `001`).
4. **Open and deliberate.** Choose a lowercase-dash slug from the task and run
   `SESSION=$(council open <slug> --item <id>)` (append `--quick` for the quick profile), then
   `council deliberate "$SESSION"`. This takes 5 to 40 minutes. Do not interrupt it. Summarize what the
   seats did from its output: how many rounds, what the Chief Engineer objected to, what the Architect ruled.
5. **Hand over for approval.** On success the output names the PRD (Markdown and PDF) and the approve
   command `council approve <session> "APPROVE <sha8>"`. Show the user the PRD path, a short summary of what
   it commits to, and that exact command. **Stop here.** Do not run it.
   If the result is `STALLED`, show the reason and the `stalled-draft-and-objections.md` path and stop.
6. **After the user confirms they ran the approve command**, run `council handoff "$SESSION"` then
   `council run "$SESSION"`. Report the outcome exactly as printed: `DONE` with the pull request URL, or
   `BLOCKED` with the reason (failed gate, no commits, push failure). Never describe a BLOCKED run as done.

## Useful extras

- `council status "$SESSION"` shows the session state and round count.
- `council prd "$SESSION"` prints the signed-off PRD; `council gates` previews the verification gates.
- `council office` opens the pixel-art dashboard at http://localhost:4321 while a session runs.
