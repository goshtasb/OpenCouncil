# Security

## What this tool does on your machine

Open Council drives AI CLIs that you have already authenticated. Two things are worth understanding before you run it:

- **During deliberation**, seats run read-only: the Lead PM and Chief Engineer research a clean, detached worktree; the Chief Architect runs with tools disabled entirely.
- **After you approve a PRD**, the Chief Engineer runs with full tool permissions (`bypassPermissions` for Claude Code, equivalent elsewhere) inside an **isolated clone** under `~/.council/projects/<repo>-<hash>/exec/<session>/` — not your working tree. It commits there. The harness pushes and opens a pull request only after your configured verification gates pass.

Your repository's contents are sent to whichever model providers you configure. Session directories under `~/.council/` contain full prompts and replies: treat them as sensitive and redact before sharing.

## Prompt injection

Repository content, dependency manifests, issue text and tool output are treated as data, never instructions — this is stated in every seat's contract and in the project constitution. It is a mitigation, not a guarantee: a sufficiently convincing instruction embedded in a file could still influence a model. The structural defenses are that deliberation is read-only, execution happens in a throwaway clone, gates are commands rather than model claims, and no code is pushed without your typed approval of the PRD.

## Reporting a vulnerability

Open a [security advisory](https://github.com/goshtasb/OpenCouncil/security/advisories/new), or an issue if it is not sensitive. Please include the session evidence if a council's behaviour is involved.

Particularly interested in: a path that reaches execution without the Operator's typed approval, a way to make the harness report DONE when a gate failed, and anything that escapes the isolated execution clone.
