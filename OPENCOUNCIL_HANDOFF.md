# Handoff: Get OpenCouncil on the radar

**Repo:** https://github.com/goshtasb/OpenCouncil (clone it if it isn't already local)
**Owner:** Ashkan (goshtasb)
**Mode:** Work end-to-end. Make reasonable calls and proceed without asking. Stop for Ashkan's approval only where this file says **APPROVAL** — and when you do, give him a ready-to-approve summary so his only job is "yes/no".

---

## Context (read first)

OpenCouncil: three AI CLIs (Gemini via Antigravity, Claude Code, Grok) deliberate a PRD until they unanimously sign off on the same SHA-256; the human approves; Claude implements in an isolated clone, the harness merges base, runs verification gates, and opens the PR. It currently has **1 star, 0 forks, 20 commits**, v0.1.0.

Why it isn't getting traction (diagnosis from comparing against repos that blew up — `morluto/rea`, `mvanhorn/last30days-skill`):

1. **Entry ticket too high.** A stranger needs Claude Code + Grok CLI + Antigravity all installed and authed. Most devs have only Claude Code. A run takes 10–40 min and 1 in 5 stalled.
2. **Install friction.** Install is a GitHub release-tarball URL. No `npx`, no Claude Code plugin, no skills.sh listing. The winners all ship one-command setup into agent marketplaces.
3. **Crowded category, unclear edge.** `sherifkozman/the-llm-council` (pip + Claude Code plugin) and `jacob-bd/the-ai-counsel` already do multi-model debate. OpenCouncil's real edge: **debate → verified, gated PR, never reports "done" when it isn't.** Lead with that.
4. **Polish issues.** About link points to `github.com/goshtasb/OpenCouncilmen`; `open-councilmen-0.1.0.tgz` committed at repo root while README installs `open-council-0.1.0.tgz` (name mismatch); the "Charm" section dilutes focus.
5. **Not enough proof.** Single-digit live runs; one showcase (its own PR #1).

Strong assets to keep and amplify: the self-built PR #1 story (Claude caught Grok's mistake), the "Honest limits" section, the retro pixel-art office dashboard (very shareable), subscription-first / zero API keys, hash-bound sign-off.

---

## Phase 1 — Cleanup (do immediately)

- [ ] Fix the repo About/homepage link (`gh repo edit goshtasb/OpenCouncil --homepage ...` — point to the repo itself or remove). Set description to the new one-liner from Phase 3.
- [ ] Remove `open-councilmen-0.1.0.tgz` from the repo root; add `*.tgz` to `.gitignore`. Reconcile the package name everywhere (`package.json` name, bin name `council`, README, release asset). Pick one name — see Phase 2 naming check.
- [ ] Move the "Coming next: the Charm" section out of the README into `ROADMAP.md` (keep a one-line link).
- [ ] Add GitHub topics: `mcp`, `claude-code-plugin`, `agent-skills`, `multi-model`, `code-review`, `prd` (keep existing ones).
- [ ] Make sure CI is green on `main` before anything goes public.

## Phase 2 — Lower the entry ticket (the most important phase)

**Goal: a stranger with only Claude Code installed gets a successful council run in under 5 minutes of setup.**

- [ ] **Solo/"lite" mode.** Make `council init` detect which CLIs exist and auto-configure. If only `claude` is present, run all three seats on Claude Code with distinct personas/models (e.g. Lead PM = sonnet read-only, Chief Engineer = opus plan mode, Chief Architect = claude with all tools disallowed). Verify Claude Code can actually run a zero-tool seat (`--disallowedTools` / equivalent) — if not, document the closest safe config. Optional extra seats: Gemini free tier via Antigravity, Ollama (the Ollama adapter has **never been run** — run it now and fix issue #2, or mark it experimental).
- [ ] **Fast path.** Add a `--quick` profile: fewer max rounds, smaller standards checklist, target <10 min. Keep the full 12-point mode as default for "serious" runs; README should show quick first.
- [ ] **Reduce stalls.** Investigate the 1-in-5 stall rate from existing session transcripts in `~/.council/projects/`. Fix what you can; at minimum make a stall produce a partial, useful artifact (the last PRD draft + open objections) instead of nothing.
- [ ] **`council doctor`** must print exactly what's missing and the one command to fix each item.
- [ ] Add tests for solo-mode config generation. Keep `npm test` model-free.

## Phase 3 — Distribution (one-command install everywhere)

- [ ] **npm.** Check name availability: `npm view open-council`, `npm view opencouncil`, `npm view open-council-cli`. Pick the best free one and make `npx <name> init` work. Run `npm whoami`; if Ashkan is logged in, publish. If not logged in → **APPROVAL**: tell him the single command to run (`npm login`), then publish yourself after.
- [ ] Bump to **v0.2.0**, update `CHANGELOG.md`, cut a GitHub release with release notes.
- [ ] **Claude Code plugin.** Package OpenCouncil as a Claude Code plugin with a marketplace manifest so users can run `/plugin marketplace add goshtasb/OpenCouncil` then `/plugin install`. Expose `/council` slash command(s) that wrap backlog add → deliberate → approve → run. Check the current Claude Code plugin docs for the exact manifest format before writing it.
- [ ] **Agent skill.** Add `.agents/skills/open-council/SKILL.md` (or the current skills.sh layout — check how `morluto/rea` does it) so `npx skills add goshtasb/OpenCouncil` works and the repo is listable on skills.sh.
- [ ] **MCP server (stretch).** If straightforward, expose `council_open`, `council_deliberate`, `council_status`, `council_approve` as MCP tools so Cursor/Codex/Gemini CLI users can drive it. Skip if it takes more than a few hours; note it in ROADMAP.

## Phase 4 — README rewrite (outcome-first)

Rewrite the top of README.md so the first screen answers "why should I care" in 5 seconds:

1. **One-liner (outcome, not mechanism):** e.g. *"Three AIs argue over your spec until they agree. Then one ships it — tested, gated, and as a PR. It never says done when it isn't."* Also use it as the repo description.
2. **Demo GIF** of the pixel-art office during a real session (record with a screen recorder or render from a transcript; keep under ~5 MB). Keep the existing `docs/demo.svg` below it.
3. **Install in one line** (`npx <name> init`) + the Claude Code plugin line. Tarball install moves to an "Other install methods" section.
4. **"How is this different from an LLM council?"** — 3 bullets max: (a) debate produces a *verified PR*, not just an answer; (b) unanimous sign-off bound to one SHA-256 and gates checked by commands, not trusted to a model; (c) runs on subscriptions you already pay for, zero API keys. Do not name or disparage competitors.
5. **Showcases** section (filled in Phase 5).
6. Keep **Honest limits** — it builds trust. Update numbers after Phase 2.
7. Add a star-history badge at the bottom.

Write in plain, direct language. No hype words, no em-dash-heavy AI phrasing.

## Phase 5 — Proof: showcases on real repos

The strongest signal for both users and the people who amplify projects is merged PRs on well-known repos.

- [ ] Pick 4–6 popular, active open-source repos in the AI-agent / dev-tools space with open `good first issue` or clearly-scoped bug issues (candidates: `garrytan/gstack`, `openclaw/openclaw`, `NousResearch/hermes-agent`, `QwenLM/qwen-code`, `steipete/*`, MCP SDKs). Prefer repos whose maintainers are active on X.
- [ ] Read each repo's CONTRIBUTING.md and AI-contribution policy. **Skip any repo that bans or discourages AI-generated PRs.**
- [ ] Run the council on each issue in a fork. Only keep results that are substantive (real bug fixes/features, never typo/comment-only PRs), pass the repo's own tests, and that you would defend line by line.
- [ ] **APPROVAL** before opening each upstream PR: show Ashkan the issue link, the diff summary, test results, and the PR text. PR body must disclose: "Spec deliberated and implemented with OpenCouncil (link); reviewed by a human before submission."
- [ ] For each run (merged or not), write a short case study in `docs/showcase/<repo>.md`: the task, the objections the Engineer raised, what the Architect ruled, outcome. Link them from the README Showcases section. Failures that the council caught are good content.

## Phase 6 — Launch kit (drafts only — Ashkan posts)

Save everything in `launch/`:

- [ ] `x-thread.md` — 5–7 post thread: hook (the self-built PR #1 story), the pixel office GIF, how it works in one image, one showcase result, install line. Plain voice.
- [ ] `x-short-posts.md` — 5 standalone posts for the following two weeks (one per showcase, one for the pixel office, one for "honest limits").
- [ ] `reddit.md` — post drafts for r/ClaudeAI and r/LocalLLaMA (the latter only if Ollama mode works), each following that subreddit's self-promo rules.
- [ ] `outreach.md` — short, specific DM drafts to 5 people who post about Claude Code tooling/agent skills (find them by searching X/GitHub; include why this is relevant to *them*).
- [ ] **Do NOT draft anything for Hacker News.** Ashkan's HN account is currently filtered for self-promotion and he writes all HN content himself.

## Definition of done

- `npx <name> init && council doctor` succeeds on a machine with only Claude Code installed.
- At least one successful solo-mode run end to end (PRD → approval → PR on a test repo).
- Published to npm, installable as a Claude Code plugin and as a skill, v0.2.0 released.
- README rewritten per Phase 4, with demo GIF and at least 2 showcases.
- Launch kit in `launch/`.
- Final report to Ashkan: what shipped, links (npm, release, plugin install command, showcase PRs), anything blocked and exactly why.

## Guardrails

- Never fake or buy stars, never use sock-puppet accounts, never mass-open low-value PRs. One flagged account (GitHub or X) costs more than the launch gains.
- Don't commit secrets, session transcripts with private code, or anything from `~/.council/`.
- Keep `main` green; work on branches and merge via PRs with CI passing.
