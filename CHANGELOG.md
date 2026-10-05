# Changelog

All notable changes to Open Council. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [SemVer](https://semver.org/). Get notified of new versions with **Watch → Custom → Releases**.

## [Unreleased]

### Added
- `ROADMAP.md`, this changelog, and GitHub Discussions for ideas, questions and council run reports.
- Issue and pull request templates, and a security policy.

### Changed
- Project renamed from Open Councilmen to **Open Council**.
- Install from the release tarball; the README now leads with the demo.

### Fixed
- This repository's own `.council/` config is no longer tracked in git.

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
