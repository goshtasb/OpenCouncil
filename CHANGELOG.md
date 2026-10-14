# Changelog

All notable changes to Open Council. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [SemVer](https://semver.org/). Get notified of new versions with **Watch → Custom → Releases**.

## [Unreleased]

### Added
- **Solo mode.** `council init` detects which provider CLIs are installed and assigns seats from what it finds.
  With only Claude Code present every seat runs on Claude Code (Lead PM on sonnet, Chief Engineer on opus,
  Chief Architect on sonnet with all tools disabled). `--solo` and `--full` force a plan; `--force` rewrites
  an existing `config.yml` and keeps customized personas, contracts and standards.
- **Quick profile.** `council init --quick` or `council open --quick`: at most 4 rounds, tie-break from round 3,
  one sign-off revision, the six starred review points, and documents capped at 1,200 words.
- **Partial result on a stall.** A council that stalls, or dies on a seat failure, writes
  `stalled-draft-and-objections.md` (task, last draft, open objections, unresolved rulings and concerns) into the
  session instead of leaving nothing. It is never approvable.
- **Early arbitration.** When open objections have not dropped for `no_progress_rounds` (default 3) consecutive
  rounds the Chief Architect arbitrates immediately instead of at `tiebreak_round`.
- **One retry on transient seat failures.** An empty reply, a dropped connection or a transient 5xx from a seat
  is retried once after 5 s; timeouts are not retried.
- `council doctor` prints the one command that fixes each failing seat (install, login or model list) and
  suggests `council init --solo --force` when only Claude Code works.
- `ROADMAP.md`, this changelog, and GitHub Discussions for ideas, questions and council run reports.
- Issue and pull request templates, and a security policy.

### Changed
- Project renamed from Open Councilmen to **Open Council**.
- Install from the release tarball; the README now leads with the demo.
- The Charm announcement moved out of the README into `ROADMAP.md`.

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

[Unreleased]: https://github.com/goshtasb/OpenCouncil/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/goshtasb/OpenCouncil/releases/tag/v0.1.0
