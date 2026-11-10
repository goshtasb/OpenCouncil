# Changelog

All notable changes to Open Council. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [SemVer](https://semver.org/). Get notified of new versions with **Watch → Custom → Releases**.

## [Unreleased]

A first review on any setup: it checks which AIs are ready, runs with those, and finishes even when a seat fails.

### Added
- `council review` checks every AI CLI (Claude, Gemini through `agy`, Grok) before it spends anything: a one-word prompt in an empty folder with no tools. Each line says ready, not installed, not signed in or out of quota, with the command that fixes it. `--no-check` skips it.
- `council doctor` works outside a set-up repository: it runs the same check and says which seats a review would use.
- A seat that fails partway (usage limit, lost login, turn limit, error) moves to another model or AI for the rest of the review. A lost login drops that AI; any other failure drops only that model, so Claude's Engineer seat falls back from opus to sonnet before leaving Claude. A seat only moves to an AI already in the review's line-up: with a `.council/config.yml`, one its seats name or one listed under `council.failover_providers`. The review lists each swap under "Gaps in this review" and records the line-up in `seats.json`. When no AI is left for the Chief Architect, the review finishes without its rulings.
- Reviews say who actually held each seat. A review on Claude alone is labeled single-vendor and names its models.
- When the Chief Architect overrules every objection, the review says so instead of reporting a stalled review with nothing found.

### Changed
- `council review` runs one quick round by default: the Lead PM's brief, the Chief Engineer's objections, and the Chief Architect's ruling on each. `--debate` runs the earlier two-round debate. `--rounds` now takes 1 to 4.
- A seat in `.council/config.yml` whose AI is not ready moves to a ready one for that review only; the file is not changed.
- The GitHub Action still passes `--rounds 2`, so it keeps the two-round debate. It skips the setup check (`--no-check`): a rejected token still ends the run with the Action's own "Claude rejected the login" error, now also when the seat's failure is reported as "is not signed in". But a seat that fails mid-run now falls back to another Claude model and the comment lists the gap.

## [0.3.2] — 2026-11-08

The Gemini seat works again on current Antigravity builds, and every seat treats notes that point outside the repo as unverified claims.

### Changed
- Every seat (Lead, Engineer, Architect, tie-break, execution and `council review`) is told that a comment, docstring, README, commit message or task line saying behaviour is handled outside the checkout is an unverified claim, not proof. A note saying something is intended or handled elsewhere does not remove a defect from review.

### Fixed
- The Antigravity seat defaults to `gemini-4-argon-high`. Current `agy` builds no longer offer `gemini-3.1-pro-high`, so every review with an Antigravity seat failed at its first call. A config.yml still set to the old id is retried once on the new default, with a line saying so.
- When `agy` rejects a seat's model, the error names the model, the config line to change and the models `agy` offers, instead of agy's raw output.

## [0.3.1] — 2026-11-07

Run the council on every pull request, on your own Claude plan or your own API key.

### Added
- A GitHub Action (`uses: goshtasb/OpenCouncil@main`) that reviews each pull request and posts the strongest file:line objections as one comment, with a link to the full replay. It takes your plan token from `claude setup-token` (`claude_code_oauth_token`) or your own Anthropic API key (`anthropic_api_key`, recommended for team repos), edits its earlier comment instead of adding more, and skips fork, draft and login-less runs with a notice. See "Review every pull request" in the README.
- `council review` prints which login each seat uses (your plan or an API key) before the seats start, and warns when `ANTHROPIC_API_KEY` would bill a key instead of your plan. `council doctor` names it for each seat too.
- `council review --comment <file>` writes a PR-comment version of the review, and `--replay-url <url>` links it to the full replay.
- With a Gemini API key (or Vertex turned on) and gemini-cli installed, the Lead PM seat runs on gemini-cli, since Antigravity cannot use a key.

### Fixed
- A seat CLI that fails is reported by name with its last lines of output, not its whole command line.
- file:line locations keep a leading dot (`.github/...`).

## [0.3.0] — 2026-11-07

Point the council at your own code with no setup: `npx open-council-cli review`.

### Added
- `council review` has the council tear into your own change, with no setup. Run `npx open-council-cli review` in any git repository with Claude Code installed. It reviews your uncommitted changes, or the branch since its base (`--base <ref>`), or a one-line plan (`council review "add rate limiting to login"`). Seats come from the AI CLIs on your PATH and the gates from your project files; nothing is written to the repository and nothing is executed. It runs the quick profile with 2 rounds (`--rounds`, up to 4), about four minutes and writes `review.html` and `review.md`, which lead with the strongest file:line objections and a line you can share. Before the seats start it lists every file whose diff they will see; untracked files that look like secrets (`.env*`, `*.pem`, `*.key`, `id_rsa` and the like) are never sent. Each review uses a worktree of its own and removes it when it ends, so it never disturbs a session already running in the same repo.
- `council replay <session>` writes any session (by id or by directory) as one self-contained HTML page: every seat reply rendered from its saved file, the timeline, rulings, the signed-off PRD, gate output, commits and the diff, with local paths shortened. The page has no scripts and loads nothing from the network. `--play` plays the session back in the terminal instead.

### Changed
- `council review <session>` (the Chief Architect's review of one session) is now `council architect-review <session>`. The old form still works, prints a notice on stderr, and goes away in 0.4.0.

## [0.2.1] — 2026-11-06

A small release, and the first with outside contributors. Thanks to [@O1sumitkumar](https://github.com/O1sumitkumar) and [@Doomguy-BFG9000](https://github.com/Doomguy-BFG9000).

### Added
- `council backlog list --json` prints the backlog as a JSON array (`id`, `title`, `status`, `priority`, `session`; `session` is `null` until a session takes the item), and `[]` for an empty backlog, so scripts can read it ([#14](https://github.com/goshtasb/OpenCouncil/issues/14)).
- `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1), a "Your first contribution" path and an AI-assisted contributions policy in `CONTRIBUTING.md`, and issue routing that sends questions and run reports to Discussions ([#13](https://github.com/goshtasb/OpenCouncil/pull/13)).

### Changed
- On native Windows every `council` command now stops at once with a message pointing to WSL, instead of failing later inside a gate or project command ([#15](https://github.com/goshtasb/OpenCouncil/issues/15)).
- README states what a run costs right under the install line.

## [0.2.0] — 2026-10-14

The entry ticket drops from three CLIs to one, and the project ships through npm, the Claude Code plugin marketplace and the skills ecosystem.

### Added
- **Published as `open-council-cli` on npm**: `npx open-council-cli init` (npm rejects `open-council` as too similar to an existing package). Install-time scripts removed from the package.
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
- The execution prompt names the files the dependency install step created and tells the Chief Engineer to leave
  them uncommitted (observed: an unrequested "commit npm lockfile" commit on the first solo-mode PR).
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

[Unreleased]: https://github.com/goshtasb/OpenCouncil/compare/v0.3.2...HEAD
[0.3.2]: https://github.com/goshtasb/OpenCouncil/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/goshtasb/OpenCouncil/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/goshtasb/OpenCouncil/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/goshtasb/OpenCouncil/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/goshtasb/OpenCouncil/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/goshtasb/OpenCouncil/releases/tag/v0.1.0
