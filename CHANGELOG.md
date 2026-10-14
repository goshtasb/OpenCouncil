# Changelog

All notable changes to Open Council. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [SemVer](https://semver.org/). Get notified of new versions with **Watch → Custom → Releases**.

## [Unreleased]

## [0.2.0] — 2026-10-14

The entry ticket drops from three CLIs to one, and the project ships through npm, the Claude Code plugin marketplace and the skills ecosystem.

### Added
- **Published as `open-council` on npm**: `npx open-council init`. Install-time scripts removed from the package.
- **Claude Code plugin**: `/plugin marketplace add goshtasb/OpenCouncil`, `/plugin install open-council@open-council`, then `/open-council:council "<task>"` drives backlog → open → deliberate, stops for the human approval, then handoff → run.
- **Agent skill**: `npx skills add goshtasb/OpenCouncil` installs the same `council` skill for other agents.
- **Solo mode.** `council init` detects which provider CLIs are installed and assigns seats from what it finds.
  With only Claude Code present every seat runs on Claude Code (Lead PM on sonnet, Chief Engineer on opus,
  Chief Architect on sonnet with all tools disabled). `--solo` and `--full` force a plan; `--force` rewrites
  an existing `config.yml` and keeps customized personas, contracts and standards.
- **Quick profile.** `council init --quick` or `council open --quick`: at most 4 rounds, tie-break from round 3,
  one sign-off revision, the six starred review points, and documents capped at 1,200 words.
- **Partial result on a stall.** A council that stalls, or dies on a seat failure, writes
  `stalled-draft-and-objections.md` (task, last draft, open objections, unresolved rulings and concerns) into the
  session instead of leaving nothing. It is never approvable.
- **Resubmission rule for the Architect review.** On a resubmitted document the Chief Architect sees its previous
  review and the council's response, and a concern that could have been raised on the previous version and was not
  is waived. Found on the first live solo run: the Engineer ratified every revision while the Architect raised a
  different advisory concern each round until the budget ran out.
- **Early arbitration.** When open objections have not dropped for `no_progress_rounds` (default 3) consecutive
  rounds the Chief Architect arbitrates immediately instead of at `tiebreak_round`.
- **One retry on transient seat failures.** An empty reply, a dropped connection or a transient 5xx from a seat
  is retried once after 5 s; timeouts are not retried.
- `council doctor` prints the one command that fixes each failing seat (install, login or model list) and
  suggests `council init --solo --force` when only Claude Code works.
- `ROADMAP.md`, this changelog, and GitHub Discussions for ideas, questions and council run reports.
- Issue and pull request templates, and a security policy.
- `docs/office.gif`: the pixel office replaying the seat states of the session that built PR #1; `docs/showcase/` case studies.

### Changed
- Project renamed from Open Councilmen to **Open Council**.
- README rewritten outcome-first: one-liner, one-line install, five-minute run, how it differs from an LLM council, showcases, honest limits.
- The Charm announcement moved out of the README into `ROADMAP.md`.
- CLI `--version` reads `package.json`.

### Fixed
- This repository's own `.council/` config is no longer tracked in git.
- The stale `open-councilmen-0.1.0.tgz` is no longer tracked; packed tarballs are ignored everywhere.
- The repository description and homepage on GitHub pointed at the pre-rename name.
- CI runs one macOS job instead of three, after repeated 15-minute runner-acquisition failures.

## [0.1.0] — 2026-09-18

First public release.

### Added
- Adversarial deliberation: Lead PM (Gemini), Chief Engineer (Claude) and Chief Architect (Grok) debate a PRD
  until the Engineer ratifies with zero objections.
- Unanimous, zero-concern, SHA-256-bound sign-off before anything reaches the human Operator.
- 12-point industry standards review on every specification.
- Machine-enforced verification gates before any pull request; `council gates` previews them offline
  (written by the council itself in [PR #1](https://github.com/goshtasb/OpenCouncil/pull/1)).
- Final PRD delivered to the Operator as a PDF, with sign-off revision rounds.
- Retro pixel-art office dashboard (`council office`).
- Providers: Claude Code, Grok CLI, Antigravity, gemini-cli, Ollama.

### Fixed
- Gates now run against the merge with the base branch, not the branch alone.
- Documents a seat saves instead of printing are recovered.
- The zero-tool Architect seat stays tool-free across providers.

[Unreleased]: https://github.com/goshtasb/OpenCouncil/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/goshtasb/OpenCouncil/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/goshtasb/OpenCouncil/releases/tag/v0.1.0
