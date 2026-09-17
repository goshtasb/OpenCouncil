<div align="center">

# 🏛️ Open Councilmen

### *Autonomous, Multi-Agent Deliberation & Execution Council for Software Engineering*

[![CI](https://github.com/goshtasb/OpenCouncilmen/actions/workflows/ci.yml/badge.svg)](https://github.com/goshtasb/OpenCouncilmen/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)
[![Node Version](https://img.shields.io/badge/node-%3E%3D18.0.0-blue.svg)](https://nodejs.org/)

**Stop micromanaging AI coding assistants. Let an adversarial council of specialists deliberate, verify, and execute your backlog — powered directly by your existing AI subscriptions.**

[Key Features](#-key-features) •
[The Council Positions](#-the-council-positions) •
[Providers](#-providers) •
[Live Retro Office](#-the-retro-pixel-office) •
[Quickstart](#-quickstart) •
[Architecture](#-architecture)

---

</div>

## 💡 Why Open Councilmen?

Single-agent AI coders hallucinate, accept ambiguous requirements, make silent breaking changes, and require constant human intervention.

**Open Councilmen** introduces an autonomous multi-agent separation of powers:
1. **The Council Lead & Principal PM** (*Synapse Archetype*): Enforces user value, jobs-to-be-done and scope boundaries, drafts and revises the Product Brief + PRD, and gives the final sign-off.
2. **The Chief Engineer & Developer** (*Claude Code Archetype*): Owns technical ground truth. Challenges the PM with `file:line` citations from a read-only worktree, ratifies the PRD, and later implements it in an isolated clone.
3. **The Chief Architect & Arbiter** (*Grok Archetype*): Zero-tool impartial judge. Binding rulings on deadlocked objections (`STANDS`, `OVERRULED`, `MEASURE`), binding answers on any rule the standards leave undefined, and zero-concern sign-off against an 8-point industry standards checklist plus the project's engineering standards.
4. **The Executive Operator** (*You*): Never in the loop. Shown the PRD **only after all three seats have signed off the identical document with zero concerns**; one typed approval starts coding, verification and pull request creation.

---

## ⚡ Key Features

* **Adversarial Deliberation**: Multi-round debate between PM and Engineer until the Engineer ratifies (`SHIP IT` + 0 open objections).
* **Binding Arbitration**: From `tiebreak_round` on, every unresolved round is arbitrated by the Chief Architect; if `max_rounds` passes without unanimous sign-off the session stops as `STALLED` and nothing is presented to you.
* **No Human in the Loop**: Any seat that needs a rule the standards don't define writes `QUESTION FOR ARCHITECT: …`; the Chief Architect's ruling binds every seat. This applies during execution too.
* **Unanimous, Zero-Concern, Hash-Bound Sign-Off**: The Operator only sees a PRD that the Chief Engineer ratified (0 objections), the Chief Architect signed off with zero REQUIRED and zero ADVISORY concerns, and the Council Lead signed off — all on the same SHA-256. Finalization and approval both re-check this.
* **Engineering Standards**: `.councilmen/standards/` — 00 Manifest, 01 Architecture, 02 Coding Practices, 03 Documentation — is given to every seat; seats cite rules by number, name and section.
* **Subscription-First (Zero API Token Burn)**: Drives the CLIs you already pay for (Claude Code, Grok, Antigravity/Gemini) or local Ollama.
* **Verified Hands-Off Execution**: The Chief Engineer commits on `council/<slug>` in an isolated clone. Blockers go to the Chief Architect and failed checks go back to the Chief Engineer (bounded by `execution_attempts`). The harness then checks for commits and a clean tree, re-runs your lint/test commands, pushes, opens the PR, and (optionally) enables GitHub auto-merge. Anything that still fails is reported as `BLOCKED` — never as done.
* **Retro Pixel-Art Office**: A local (127.0.0.1) dashboard showing which seat is working and the backlog.

---

## 👥 The Council Positions

| Seat | Default provider | Responsibilities | Boundaries |
| :--- | :--- | :--- | :--- |
| **Lead PM** | Antigravity (`agy`, Gemini) | Part A (Product Brief), Part B (PRD), Executive Summary, revisions, final sign-off. | Read-only research; never edits code. |
| **Chief Engineer** | Claude Code (`claude -p`) | Codebase verification, objections, ratification; autonomous implementation after approval. | Read-only (plan mode) during deliberation; full permissions only inside the execution clone. |
| **Chief Architect** | Grok CLI (`grok`) | Tie-break rulings, undefined-rule rulings, zero-concern architecture/standards sign-off. | Tools disabled; rules on the text it is given. |
| **Executive Operator** | Human (You) | Approval of the final PRD (`APPROVE <sha8>`). | Never asked anything else; sees only unanimously, zero-concern signed-off documents. |

---

## 💳 Providers

| Provider id | CLI | Notes |
| :--- | :--- | :--- |
| `claude-code` | `claude` | Plan mode for research; `bypassPermissions` only for execution in the isolated clone. |
| `grok-cli` | `grok` (or `$GROK_BIN`, `~/.grok/bin/grok`) | No-tool seats run with tools denied. |
| `antigravity` | `agy` | Scoped to the worktree with `--add-dir`. |
| `gemini-cli` | `gemini` | Some Gemini Code Assist tiers no longer accept this client; use `antigravity` instead. |
| `ollama` | `ollama` | Local models; no tool use. |

Configure seats in `.councilmen/config.yml`, then run `councilmen doctor` — it asks every seat for a live reply and reports model or authentication errors before you spend a session:

```yaml
seats:
  lead_pm:
    provider: "antigravity"
    model: "gemini-3.1-pro-high"
  chief_engineer:
    provider: "claude-code"
    model: "opus"
  chief_architect:
    provider: "grok-cli"
    model: "grok-4.6"
```

---

## 🕹️ The Retro Pixel Office

```bash
councilmen office          # http://localhost:4321 (office.port)
```

* Seat sprites type while that seat's CLI is running and rest when idle.
* Click the whiteboard to view the backlog.
* The ticker shows the active backlog item.

---

## 🚀 Quickstart

### 1. Initialize in your repository

```bash
npx open-councilmen init
councilmen doctor
```
This generates `.councilmen/` with `config.yml`, `CONSTITUTION.md`, `DELEGATION.md`, `personas/`, `references/` (reply contracts) and `standards/`. Harness state (backlog, sessions, worktrees, execution clones) lives outside the repo in `~/.councilmen/projects/<repo>-<hash>/` (override with `COUNCILMEN_HOME`).

### 2. Queue an item (WIP limit from config)

```bash
councilmen backlog add "Add Stripe webhook idempotency and audit logs" --priority 1 --body "Details..."
```

### 3. Deliberate

```bash
SESSION=$(councilmen open stripe-webhook-idempotency --item 001)   # or --task / --task-file
councilmen deliberate $SESSION
```
`deliberate` runs the whole loop: Lead drafts → Engineer rounds → Architect rulings on questions → tie-breaks → Architect sign-off (zero concerns) → Lead sign-off → finalize. It is resumable. Individual steps are also available: `draft`, `ask`, `tiebreak`, `review`, `signoff`, `finalize`, `status`.

### 4. Approve and execute

```bash
councilmen approve $SESSION "APPROVE 8a3f1b9c"   # token printed after finalization
councilmen handoff $SESSION
councilmen run $SESSION                           # --skip-agent re-runs only verification and publishing
```
Pushing and PR creation use `git` and the `gh` CLI, so `origin` must be a GitHub remote you can push to.

---

## 🏛️ Architecture

```mermaid
flowchart TD
    Backlog[Backlog, WIP limit] --> Open[Pristine read-only worktree]
    Open --> PM[Lead PM: Brief + PRD draft]
    PM --> Eng[Chief Engineer: verify against code]
    Eng -->|Objections| PM
    Eng -->|Unresolved from tiebreak_round| Tiebreak[Chief Architect: binding rulings]
    Tiebreak --> PM
    Eng -->|QUESTION FOR ARCHITECT| Rule[Chief Architect: binding ruling for all seats]
    Rule --> PM
    Eng -->|max_rounds reached| Stall[STALLED: item parked, no document]
    Eng -->|SHIP IT and 0 objections| Arch[Chief Architect: 8-point + standards sign-off]
    Arch -->|any concern| PM
    Arch -->|SIGN-OFF, zero concerns| Lead[Lead PM: final sign-off]
    Lead -->|RETHINK| PM
    Lead -->|SIGN-OFF| Gate{All 3 sign-offs on same SHA-256?}
    Gate -->|yes| Operator[Operator: APPROVE sha8]
    Operator --> Exec[Chief Engineer: implement and commit in isolated clone]
    Exec -->|BLOCKED.md question| Rule2[Chief Architect ruling] --> Exec
    Exec --> Verify[Harness: commits, clean tree, lint, tests]
    Verify -->|fail, attempts left| Exec
    Verify -->|pass| PR[Push, pull request, optional auto-merge]
    Verify -->|attempts exhausted| Blocked[BLOCKED, item parked]
```

---

## 🧪 Development

```bash
npm ci
npm run build
npm test      # node:test suite with scripted seats; no model calls
```

---

## 📄 License

Open Councilmen is open-sourced under the [MIT License](LICENSE).
