# Replay: council gates --json (stalled)

Session `20261106194407-gates-json-r2`, quick profile, base commit `15b3e44`, round budget 4 plus 1 sign-off revision. Outcome: **STALLED**.

Solo mode (every seat on Claude Code: Lead PM sonnet, Chief Engineer opus, Chief Architect sonnet with tools off), Open Council 0.2.1, run on 2026-11-06 against a local copy with no GitHub remote, so the run could not open a pull request.

Every quoted block below is the seat's reply exactly as the harness saved it. Nothing is summarised.

## The task

> `council gates` prints the verification gates as a human-readable list. Add a `--json` flag that prints the same resolved gates (name, command, standard, and where each came from) as a JSON array, and `[]` when no gates resolve, so scripts can read them (GitHub issue #5). The command is in src/commands/project.ts (program.command('gates')). Add a test in test/cli.test.cjs.

## Timeline

| Time | Event |
|---|---|
| 00:00 | Created session gates-json-r2 on commit 15b3e4461c1f5a4e120dba6ce3b3db3483e343f5 |
| 00:41 | Saved plan-v1 (8b88e1e981fd3702604471ea9debed67dd54bc8ec4d82ab8ccc279802b84c307) |
| 00:56 | Chief Architect issued 1 ruling(s) for lead_pm (draft v1). |
| 01:56 | Round 1 finished: SHIP WITH CHANGES, objections: 4, converged: false |
| 02:09 | Chief Architect issued 1 ruling(s) for chief_engineer (round 1). |
| 02:46 | Saved changes-v2 (ef5c7b74baec0e4d95c61930ea7781f963864c01f379319240cfe08f71d1a904) |
| 02:46 | Saved plan-v2 (074ba99b42c00c9974efd5c5e1e5c385b45075bb31ef497492939780824ea3bc) |
| 03:47 | Round 2 finished: SHIP WITH CHANGES, objections: 1, converged: false |
| 04:17 | Saved changes-v3 (3a64d125ae3b39c3e2d21a005974aed723ea2cd4794e7029dbd3fcc2d7fe08a0) |
| 04:17 | Saved plan-v3 (2c62e4990e62f000e51e24fb7cb5eb46fba47d3cf96dcc46ec2d1ad715cfabf8) |
| 05:09 | Round 3 finished: SHIP IT, objections: 0, converged: true |
| 05:52 | Architecture review finished: SIGN-OFF WITH CONCERNS (Required: 0, Advisory: 2) |
| 06:36 | Saved changes-v4 (3dfa0b98c95670c20c9d01308bad78a6d7c9d0fb31bce80d6d28a7f4febb1f59) |
| 06:36 | Saved plan-v4 (21b7662024dae2c7bc0e83f6be7a301600c256382ac1a8d59b7736fb41aa6269) |
| 07:13 | Round 4 finished: SHIP WITH CHANGES, objections: 1, converged: false |
| 07:13 | Partial result written: stalled-draft-and-objections.md (No unanimous zero-concern sign-off after 4 rounds (max_rounds 4, sign-off revisions 1); nothing was presented to the Operator.) |
| 07:13 | Status changed to STALLED |

## Binding rulings from the Chief Architect

**Ruling 1** (asked by lead_pm, draft v1)

> Q: Is deriving source in the command acceptable, or must resolveGates return the origin (Constitution §1, Single Source of Truth)? The draft takes the first option as the smallest change. If the Architect rules otherwise, source moves into resolveGates as an additive optional field.

> Ruling: resolveGates MUST return the origin: it sets an additive source ("verification.gates", "project.lintcommand" or "project.testcommand") on each resolved gate, at the point where it chooses between configured and implicit gates. The type is a resolved-gate type that extends VerificationGate, so the config schema gains no field. The gates command MUST copy source from the result and MUST NOT re-evaluate verification?.gates or the lint/test commands. Checkable by (a) a grep of src/commands/project.ts finding no such condition, (b) a resolveGates unit test asserting source for the default pair, a custom gate and the empty case, and (c) the three existing text-mode tests staying byte-identical. — Constitution §1 forbids a second copy of the selection logic, because the command's copy would drift from gates.ts:14 and source could then misreport what ran (§4). The task's "where each came from" requirement needs this change, so it is in scope, and the PRD's "Changes to resolveGates" out-of-scope line and the file list must be updated to match.

**Ruling 2** (asked by chief_engineer, round 1)

> Q: Ruling R1 spells the implicit sources "project.lintcommand" and "project.testcommand". The config keys are project.lintcommand and project.testcommand (src/engine/gates.ts:18-19, README.md:228, and the test YAML at test/cli.test.cjs:80). The missing underscores look like markdown formatting ate them. Should the emitted strings be "project.lintcommand" and "project.testcommand", matching the config key paths?

> Ruling: The emitted implicit-source strings MUST be exactly the dotted config key paths as the YAML schema spells them, not the markdown-rendered text of R1. Settle the spelling with grep -nE "lint.?command|test.?command" src/engine/gates.ts README.md test/cli.test.cjs. If the keys have no underscore, emit "project.lintcommand" and "project.testcommand". If they have one, emit "project.lintcommand" and "project.testcommand". Define each string once as a constant in gates.ts next to the key it names. The resolveGates unit test and CLI Test 1 MUST assert the exact string, and the CLI test MUST write the YAML with the same key, so a mismatch fails the test. — I can't see the repo, so the spelling is an empirical fact and I rule a MEASURE. Constitution §1 and §4 require source to be the real key path, so a reviewer or script can find it in the config. The underscore may have been lost in either R1 or the question's text, so neither is authoritative.

## Round 1

<details>
<summary>Lead PM: draft v1 (full text)</summary>

```markdown
# Product Brief

## Executive Summary
`council gates` only prints a human-readable list. Scripts and CI that need the resolved gates must parse padded text. Issue #5 asks for `--json`. The repo already does this for `backlog list --json` (src/commands/project.ts:154-160), so the change follows an existing pattern.

## Problem Statement & Impact
The text line (src/commands/project.ts:198-205) is space-delimited. The `standard` and `command` fields can contain spaces, so the line is ambiguous to parse. The line also omits where a gate came from, which is the first thing a script needs when a gate is missing or unexpected.

## Solution & Scope
**In scope**
- `council gates --json` prints a JSON array of the gates returned by `resolveGates(ctx.config)` (src/engine/gates.ts:13).
- Each element has `name`, `command`, `standard`, `required`, `timeout_seconds` and `source`.
- Output is `[]` when no gates resolve.

**Out of scope**
- Changes to `resolveGates`.
- Changes to the text output.
- Other commands.
- A JSON schema file.

## User Journeys & Jobs-to-be-Done
- A CI author runs `council gates --json | jq -r '.[].command'` to know which checks to run locally.
- A script author checks `source` to see whether gates came from `verification.gates` or from the implicit lint/test pair.

## Success Metrics
- North Star: the command's JSON output parses with `JSON.parse` in 100% of config shapes tested (default pair, custom gate, empty).
- Guardrail: the three existing text-mode tests stay byte-identical and green.
- Instrumentation: the new test in test/cli.test.cjs. N/A for runtime telemetry (the command is a local read-only preview).

## Risks & Mitigations
- Schema drift from the text output. Mitigation: both modes read the same `resolveGates` result.
- Consumers rely on field names. Mitigation: names match `VerificationGate` (src/types.ts:138-147) plus `source`, and later changes must be additive (Constitution §7).
- Dependency, vendor and compliance risk: N/A, no new dependency and no data handled.

## Key Assumptions & Chief Architect Rulings
- "Where each came from" is not exposed by `resolveGates`. Assumption: `source` is derived in the command. It is `"verification.gates"` when `ctx.config.verification?.gates` is non-empty (the same condition as gates.ts:14). Otherwise it is `"project.lint_command"` for the gate named `lint` and `"project.test_command"` for the gate named `test`. This avoids changing `resolveGates`, but it duplicates the selection condition (unverified against Constitution §1).
- QUESTION FOR ARCHITECT: Is deriving `source` in the command acceptable, or must `resolveGates` return the origin (Constitution §1, Single Source of Truth)? The draft takes the first option as the smallest change. If the Architect rules otherwise, `source` moves into `resolveGates` as an additive optional field.

# PRD

## Verified Baseline
- `gates` command: src/commands/project.ts:189-207 at 15b3e44. It has no options.
- Pattern to copy: `backlog list --json` at project.ts:154-160. It uses `.option('--json', ...)`, `JSON.stringify(rows, null, 2)`, and returns before the text path.
- `resolveGates` applies `required` default `true` (gates.ts:30-39) but leaves `timeout_seconds` and `standard` possibly undefined.
- Existing tests: test/cli.test.cjs:73-111. They use `run(repo, 'gates')` and `writeConfig`.

## Functional Requirements
- **FR1** The `gates` command MUST accept `--json`.
  - Given a default lint/test config, when `council gates --json` runs, then stdout is a JSON array of 2 objects in resolution order, `lint` then `test`, and the exit code is 0.
- **FR2** Each element MUST contain `name`, `command`, `standard`, `required`, `timeout_seconds` and `source`.
  - `required` is a boolean.
  - `timeout_seconds` is the effective value: the configured one, else `DEFAULT_GATE_TIMEOUT_SECONDS` (900).
  - `standard` is `null` when the gate has none.
  - `source` is as defined in Key Assumptions.
  - Given a custom gate `a11y` with `required: false`, `timeout_seconds: 120` and `standard: ""`, when run, then the element is `{name:"a11y", command:"npm run a11y", standard:null, required:false, timeout_seconds:120, source:"verification.gates"}`.
- **FR3** When no gates resolve, `--json` MUST print `[]` and exit 0. It MUST NOT print the "No verification gates" sentence.
  - Given empty lint and test commands, when run, then stdout is `[]\n`.
- **FR4** Without `--json`, output MUST be unchanged.
- **FR5** In `--json` mode, stdout MUST contain only the JSON. Config errors keep the existing one-line stderr and exit 1 through the `action` wrapper.
  - Given a malformed config, when run, then the exit code is 1 and stdout is empty.

## Non-Functional Requirements
- Performance: N/A, the command is a local preview and adds no I/O.
- Security and privacy: the command prints only the commands already printed in text mode. No secrets are added (Constitution §6).
- Accessibility and i18n: N/A, machine output. Keys are English and stable.
- Cost: none.

## Invariants & Architecture Compliance
- §1: both modes read the same `resolveGates` result. The `source` derivation is flagged in the Architect question.
- §2: validation stays inside `resolveGates`, so invalid configs fail before any output.
- §4: output reflects what resolved.
- §7: the change is additive. The text mode is untouched.
- §8: reversible by reverting one commit.

## Engineering Standards Compliance
- 01 Architecture §2.3: no new cross-feature imports.
- 02 Coding Practices §2: a small pure helper (`toGateRows(config, gates)`) may sit in the command file. The file is currently 224 lines, so this keeps it under 250 (02 Coding Practices §3).
- 02 Coding Practices §6: the test sits next to the existing gate tests.
- 03 Documentation §6: update the README gates line if one exists (unverified).

## Test Plan
Add three tests to test/cli.test.cjs, reusing `makeRepo`, `writeConfig` and `run`. Each uses a temp repo, so it is deterministic.
1. Default pair: parse stdout and deep-equal the 2 expected objects, with `source` values `project.lint_command` and `project.test_command`.
2. Custom advisory gate: deep-equal the FR2 object.
3. Empty: stdout equals `[]\n`.

Constitution §5 requires each test to fail before the change. `--json` is an unknown option before the change, so the run exits 1 and the parse fails. The full suite must pass.

## Traceability
| Requirement | Test |
|---|---|
| FR1, FR2 | Test 1, Test 2 |
| FR3 | Test 3 |
| FR4 | Existing tests at cli.test.cjs:73-111, unchanged |
| FR5 | Existing malformed-config test at cli.test.cjs:113-120; add `--json` to a copy if cheap |

## Observability & Operability
N/A: local CLI, no telemetry or SLO. No runbook is needed.

## Rollout, Flagging & Rollback
The flag is opt-in, so there is no rollout stage and no kill switch. Rollback is reverting the commit. No migration is involved.

## Dependencies & Supply Chain
None added.

# Executive Summary
Add an opt-in `--json` flag to `council gates`. It prints the resolved gates as a JSON array with `name`, `command`, `standard`, `required`, `timeout_seconds` and `source`, and prints `[]` when none resolve. The change follows the existing `backlog list --json` pattern and touches `src/commands/project.ts` and `test/cli.test.cjs` only. Text output is unchanged. One open question goes to the Architect: whether `source` is derived in the command or returned by `resolveGates`. Rollback is a single revert.
```

</details>

**Chief Engineer: review of v1**

> VERDICT: SHIP WITH CHANGES
> OPEN OBJECTIONS: 4
>
> 1. **Draft v1 does not apply binding ruling R1.** It still derives `source` inside the command, keeps "Changes to `resolveGates`" out of scope, and limits the file list to `src/commands/project.ts` and `test/cli.test.cjs`.
>    - Evidence: the choice between configured and implicit gates is made in one place, `src/engine/gates.ts:14-20`. `resolveGates` returns `VerificationGate[]` (`gates.ts:13`), and that type (`src/types.ts:138-147`) has no origin field.
>    - Required change:
>      - Add `export interface ResolvedGate extends VerificationGate { source: 'verification.gates' | 'project.lint_command' | 'project.test_command'; }` to `src/types.ts`.
>      - Change the return type of `resolveGates` to `ResolvedGate[]`.
>      - Set `source` in the configured branch (`gates.ts:16`) and on each implicit literal (`gates.ts:18-19`).
>      - Make the command copy `gate.source` only.
>      - Remove the Key Assumption and the derivation in FR2.
>      - Delete the out-of-scope line about `resolveGates`.
>      - Add `src/engine/gates.ts`, `src/types.ts` and `test/gates.test.cjs` to the file list.
>      - Add the R1(a) grep as an acceptance check: no `verification?.gates`, `lint_command` or `test_command` in `src/commands/project.ts`.
>    - Blast radius: I checked the only other caller, `src/engine/execution.ts:106`. It passes the gates to `runGates`, which builds each `GateResult` field by field (`gates.ts:47-58`). So `source` does not leak into the evidence report or the PR body, and existing `GateResult` consumers don't change. The PRD should say so.
>
> 2. **A config entry must not be able to fake its `source`.** Configured gates are copied with `{ ...gate }` (`gates.ts:16`). Config loading only checks that `verification.gates` is an array (`src/config.ts:79-80`) and does not remove unknown keys. If `source` is placed before the spread, a YAML gate with `source: "project.lint_command"` would report the wrong origin. That breaks the reason R1 exists (Constitution §4).
>    - Required change: FR text says `source` is assigned after the spread, as `{ ...gate, source: 'verification.gates' }`.
>    - The `resolveGates` unit test must include a configured gate with a fake `source` key and assert that the result is `verification.gates`.
>
> 3. **FR5 has no required test.** The Traceability row says "add `--json` to a copy if cheap". That lets a requirement ship untested, which breaks 02 Coding Practices §6 and Constitution §5.
>    - Required change: make the test mandatory. In `test/cli.test.cjs`, `run(repo, 'gates', '--json')` with the malformed config from `cli.test.cjs:113-120` must assert all of:
>      - status 1
>      - `stdout === ''`
>      - stderr matches `/Failed to load .*config\.yml/`
>      - no stack trace
>
> 4. **The Test Plan is missing the `resolveGates` unit test that R1(b) requires, and the "fails before the change" reasoning for it.**
>    - Required change: add Test 4 in `test/gates.test.cjs`. It sits next to the existing `resolveGates` test at `gates.test.cjs:16-28`, which compares mapped fields rather than whole objects, so adding a field does not break it. Test 4 must cover:
>      - the default pair, giving `project.lint_command` and `project.test_command`
>      - a configured gate, giving `verification.gates`, including the fake-key case from objection 2
>      - empty lint and test commands, giving `[]`
>    - Before the change `source` is `undefined`, so each assertion fails. Constitution §5 is met without depending on commander's unknown-option error.
>    - Update the Traceability table to match.
>
> QUESTION FOR ARCHITECT: Ruling R1 spells the implicit sources `"project.lintcommand"` and `"project.testcommand"`. The config keys are `project.lint_command` and `project.test_command` (`src/engine/gates.ts:18-19`, `README.md:228`, and the test YAML at `test/cli.test.cjs:80`). The missing underscores look like markdown formatting ate them. Should the emitted strings be `"project.lint_command"` and `"project.test_command"`, matching the config key paths?
>
> **Notes (not objections)**
> - 03 Documentation §6: the README gates line exists at `README.md:228` ("`council gates` previews them without running anything"). Change "update if one exists (unverified)" to a concrete one-line mention of `--json` there.
> - Code that consumes the result could read `required` as a definite boolean on `ResolvedGate`, since `resolveGates` always sets it (`gates.ts:31`). This is optional.
> - File sizes stay under 250 lines (02 Coding Practices §3):
>   - `project.ts` is 224 lines, and the 3–4 lines of JSON code (with the helper written inline) keep it under 250.
>   - `gates.ts` is 86, `cli.test.cjs` 120 and `gates.test.cjs` 167, each with room for the additions.
> - FR2's `standard: null` for `""` and `timeout_seconds` defaulting to `DEFAULT_GATE_TIMEOUT_SECONDS` (already imported at `project.ts:8`) match the text mode's existing handling at `project.ts:198-205`.
>
> **Not checked:**
> - I did not build or run the suite, typecheck or lint. The worktree is read-only, `npm test` loads `dist/` after `tsc`, and `package.json` has no lint script.
> - I did not confirm commander's exit code for an unknown `--json` today.
> - I did not read `docs/showcase/opencouncil.md` beyond line 4, or the other commands in `project.ts` outside lines 140-224.

## Round 2

**Lead PM: what changed in v2**

> # Response to Objections
>
> **Objection 1 (apply R1): adopted.**
> - `resolveGates` now returns `ResolvedGate[]` and sets `source` where it picks configured or implicit gates (`gates.ts:14-20`).
> - The command copies `gate.source` only.
> - The Key Assumption, the FR2 derivation and the out-of-scope line about `resolveGates` are removed.
> - The file list now includes `src/engine/gates.ts`, `src/types.ts` and `test/gates.test.cjs`.
> - The R1(a) grep is an acceptance check.
> - Blast radius: the only other caller is `execution.ts:106`. `runGates` builds each `GateResult` field by field (`gates.ts:47-58`), so `source` does not reach the evidence report or PR body.
>
> **Objection 2 (a config entry must not fake `source`): adopted.** `source` is assigned after the spread, as `{ ...gate, source }`. A unit test covers a configured gate carrying a fake `source` key.
>
> **Objection 3 (FR5 test): adopted.** FR5 now has a mandatory CLI test (Test 3).
>
> **Objection 4 (unit test for `resolveGates`): adopted.** Test 4 is added in `test/gates.test.cjs`. Before the change `source` is `undefined`, so its assertions fail (Constitution §5).
>
> **R2 (spelling): measured.** I ran `grep -nE "lint.?command|test.?command"` on `src/engine/gates.ts`, `README.md` and `test/cli.test.cjs`.
> - The config keys have underscores: `lint_command` and `test_command` (`gates.ts:18-19`, `cli.test.cjs:75,89-90,107`, `README.md:228`).
> - The emitted strings are therefore `"project.lint_command"` and `"project.test_command"`.
> - Each string is defined once as a constant in `gates.ts`.
> - The tests assert the exact string, and the CLI test writes YAML with the same key.
> - This answers the Chief Engineer's question to the Architect, so I am not re-asking it.
>
> **Notes:**
> - The README line is now concrete: add a one-line `--json` mention at `README.md:228`.
> - `required` is typed as a definite boolean on `ResolvedGate`.

<details>
<summary>Draft v2 (full text)</summary>

```markdown
# Product Brief

## Executive Summary
`council gates` prints only a human-readable list. Scripts and CI that need the resolved gates must parse padded text. Issue #5 asks for `--json`. The repo already does this for `backlog list --json` (`src/commands/project.ts:154-160`), so the change follows an existing pattern.

## Problem Statement & Impact
The text line (`project.ts:198-205`) is space-delimited. `standard` and `command` can contain spaces, so the line is ambiguous to parse. It also omits where each gate came from, which is the first thing a script needs when a gate is missing or unexpected.

## Solution & Scope
**In scope**
- `council gates --json` prints a JSON array of the gates from `resolveGates(ctx.config)` (`gates.ts:13`).
- Each element has `name`, `command`, `standard`, `required`, `timeout_seconds` and `source`.
- Output is `[]` when no gates resolve.
- `resolveGates` returns the origin (`source`) of each gate (R1). Files touched:
  - `src/engine/gates.ts`
  - `src/types.ts`
  - `src/commands/project.ts`
  - `test/cli.test.cjs`
  - `test/gates.test.cjs`
  - `README.md`

**Out of scope**
- Changes to the text output.
- Other commands.
- A JSON schema file.
- Any new field in the config schema.

## User Journeys & Jobs-to-be-Done
- A CI author runs `council gates --json | jq -r '.[].command'` to see which checks to run locally.
- A script author reads `source` to tell configured gates from the implicit lint/test pair.

## Success Metrics
- North Star: `--json` output parses with `JSON.parse` in 100% of tested config shapes (default pair, custom gate, empty).
- Guardrail: the three existing text-mode tests (`cli.test.cjs:73-111`) stay byte-identical and green.
- Instrumentation: the new tests. N/A for runtime telemetry (local read-only preview).

## Risks & Mitigations
- Schema drift between modes. Mitigation: both modes read one `resolveGates` result.
- A config entry spoofing `source`. Mitigation: `source` is assigned after the spread and covered by a test.
- Consumers depend on field names. Mitigation: names match `VerificationGate` (`types.ts:138-147`) plus `source`, and later changes must be additive (§7).
- Dependency, vendor and compliance risk: N/A, no new dependency and no data handled.

## Key Assumptions & Chief Architect Rulings
- R1: `resolveGates` MUST return `source`. The command MUST copy it and MUST NOT re-evaluate `verification?.gates` or the lint/test commands.
- R2: the implicit sources are the exact config key paths, `project.lint_command` and `project.test_command`. Verified by grep (`gates.ts:18-19`, `cli.test.cjs:75`, `README.md:228`).
- `required` is always set by `resolveGates` (`gates.ts:31`).

# PRD

## Verified Baseline
- At 15b3e44, the `gates` command is at `project.ts:189-207` and has no options.
- `resolveGates` chooses configured versus implicit gates at `gates.ts:14-20`. Configured gates are copied with `{ ...gate }` (`gates.ts:16`).
- Config loading checks only that `verification.gates` is an array (`config.ts:79-80`), so unknown keys survive.
- The only other caller, `execution.ts:106`, passes gates to `runGates`. `runGates` builds `GateResult` field by field (`gates.ts:47-58`).
- The existing `resolveGates` test (`gates.test.cjs:16-28`) compares mapped fields, so adding a field does not break it.

## Functional Requirements
- **FR1** `gates` MUST accept `--json`.
  - Given a default lint/test config, when `council gates --json` runs, then stdout is a JSON array of 2 objects (`lint`, then `test`) and the exit code is 0.
- **FR2** Each element MUST contain these fields:
  - `name` and `command`.
  - `standard`: `null` when empty.
  - `required`: a boolean.
  - `timeout_seconds`: the effective value, defaulting to `DEFAULT_GATE_TIMEOUT_SECONDS` (900).
  - `source`: copied from `gate.source`.
  - Given the default pair, then `source` is `"project.lint_command"` and `"project.test_command"`.
  - Given a custom gate `a11y` with `required: false`, `timeout_seconds: 120` and `standard: ""`, then the element is `{name:"a11y", command:"npm run a11y", standard:null, required:false, timeout_seconds:120, source:"verification.gates"}`.
- **FR3** `resolveGates` MUST return `ResolvedGate[]`.
  - `ResolvedGate extends VerificationGate` and adds `source: 'verification.gates' | 'project.lint_command' | 'project.test_command'` in `src/types.ts`.
  - Configured gates MUST be built as `{ ...gate, source: VERIFICATION_GATES_SOURCE }`, with `source` placed after the spread.
  - Each implicit gate MUST carry its key-path constant, defined once in `gates.ts`.
  - Given a YAML gate with `source: "project.lint_command"`, then the resolved `source` is `"verification.gates"`.
- **FR4** When no gates resolve, `--json` MUST print `[]\n`, exit 0, and not print the "No verification gates" sentence.
- **FR5** Without `--json`, output MUST be unchanged.
- **FR6** In `--json` mode, stdout MUST contain only JSON.
  - Given a malformed config, then the exit code is 1, stdout is empty, stderr matches `/Failed to load .*config\.yml/`, and there is no stack trace.

## Non-Functional Requirements
- Performance, accessibility and i18n: N/A, local machine-readable preview with no added I/O.
- Security and privacy: the command prints only what text mode already prints, and no secrets are added (§6).
- Cost: none.

## Invariants & Architecture Compliance
- §1: the origin is decided once, in `resolveGates`.
- §2: config validation stays upstream of any output.
- §4: `source` reports the branch that actually ran, and it cannot be spoofed.
- §7: the change is additive and the config schema is unchanged.
- §8: reversible by one revert.

## Engineering Standards Compliance
- 01 Architecture §2.3: no new cross-feature imports.
- 02 Coding Practices §2: the mapping to rows is a small pure function. `project.ts` is 224 lines, so 3-4 added lines stay under 250 (§3).
- 02 Coding Practices §6: tests sit next to the existing ones.
- 03 Documentation §6: add a one-line `--json` mention at `README.md:228`.

## Test Plan
All tests use temp repos or pure inputs, so they are deterministic.
1. CLI default pair: deep-equal the 2 objects with exact `source` strings. The YAML uses `lint_command` and `test_command`.
2. CLI custom advisory gate: deep-equal the FR2 object.
3. CLI malformed config with `--json`: assert status 1, `stdout === ''`, the stderr pattern, and no stack trace.
4. CLI empty: stdout equals `[]\n`.
5. `gates.test.cjs` unit test of `resolveGates`, covering:
   - the default pair
   - a configured gate
   - a configured gate with a fake `source` key
   - the empty case

Constitution §5: before the change `source` is `undefined`, so test 5 fails. `--json` is an unknown option, so tests 1-4 fail.

Acceptance checks:
- The full suite passes (`npm test` after `tsc`).
- `grep -nE "verification\?\.gates|lint_command|test_command" src/commands/project.ts` returns nothing.
- The existing text-mode tests are unchanged.

## Traceability
| Requirement | Test |
|---|---|
| FR1, FR2 | 1, 2 |
| FR3 | 5 |
| FR4 | 4 |
| FR5 | Existing tests, `cli.test.cjs:73-111` |
| FR6 | 3 |

## Observability & Operability
N/A: local CLI with no telemetry or SLO.

## Rollout, Flagging & Rollback
The flag is opt-in, so there is no staged rollout or kill switch. Rollback is reverting the commit. No migration is involved.

## Dependencies & Supply Chain
None added.

# Executive Summary
Add an opt-in `--json` flag to `council gates`. It prints the resolved gates as a JSON array with `name`, `command`, `standard`, `required`, `timeout_seconds` and `source`, and prints `[]` when none resolve. Per ruling R1, `resolveGates` now returns each gate's origin, using the exact config key paths from R2. The command only copies it. Text output and the config schema are unchanged. Five tests cover the behavior, including a spoofed-`source` case. Rollback is a single revert.
```

</details>

**Chief Engineer: review of v2**

> VERDICT: SHIP WITH CHANGES
> OPEN OBJECTIONS: 1
>
> 1. **FR2 does not say what `standard` is when the key is missing, so it can silently disappear from the output.**
>    - **Evidence:**
>      - `VerificationGate.standard` is optional (`src/types.ts:146`).
>      - Configured gates are copied as-is (`src/engine/gates.ts:16`), so a YAML gate written without a `standard:` line resolves with `standard === undefined`.
>      - FR2 only says "`standard`: `null` when empty", and Test 2 only covers `standard: ""`.
>      - If the code checks only for `''` (e.g. `gate.standard === '' ? null : gate.standard`), it passes every planned test. But `JSON.stringify` then drops the `standard` key for any gate written without it.
>      - Scripts doing `.[].standard` would then get a missing key in some rows and `null` in others. That breaks the fixed shape FR2 promises and the additive-contract claim (Constitution §7).
>      - This case is common: the `sca` and `dependency-audit` style gates in the README and tests can be written without `standard`.
>    - **Required change:**
>      - Reword FR2 to "`standard`: the string, or `null` when absent or empty".
>      - Specify the mapping as `standard: gate.standard || null`.
>      - Add to Test 2 (or the Test 5 unit test of the row mapper) a configured gate with no `standard` key. It should assert `'standard' in row` and `row.standard === null`.
>
> **Checked and confirmed against 15b3e44:**
> - The `gates` command is at `project.ts:189-207` and takes no options. `project.ts` is 224 lines, so the change fits under 250 (02 §3).
> - Gates are picked at `gates.ts:14-20`, and the config keys are `lint_command` and `test_command` (`gates.ts:18-19`). R2's resolved strings `project.lint_command` and `project.test_command` are correct.
> - `required` is always set at `gates.ts:31`.
> - `runGates` builds `GateResult` one field at a time (`gates.ts:47-58`), so `source` cannot leak into evidence. The only other caller is `execution.ts:106`.
> - Config is loaded lazily inside `action()` (`cli.ts:15-24`). Errors go to stderr through `logger.error` (`shared.ts:16`, `logger.ts:12`), and the message is `Failed to load ${configFile}` (`config.ts:98`). FR6's "stdout empty" therefore holds, and Test 3 fails before the change: commander's unknown-option error does not match `/Failed to load/`.
> - `src/index.ts:1,16` re-exports `types` and `gates`, so `ResolvedGate` and the source constants become public additively. `test/helpers.cjs:10` reaches `resolveGates` through `lib`.
> - The four test-plan cases fail before the change, as the draft claims (§5).
>
> **Notes (not objections):**
> - The Lead's response says "FR5 test (Test 3)" and "Test 4" for the unit test. The PRD numbers them differently (3 is malformed config, 5 is the unit test). The PRD and traceability table agree with each other, so use those numbers.
> - The R1(a) acceptance grep already returns nothing at baseline (exit 1). It is a valid post-condition, but not a before/after check. Test 5 and the spoofed-`source` case carry the real proof.
> - The malformed-config text test is at `cli.test.cjs:113-120`. It is outside the cited `73-111` range but should also stay unchanged.
>
> Not checked:
> - I did not run `tsc` or `npm test`. The checkout has no `node_modules`, and installing would modify the read-only worktree.
> - I did not review `src/engine/execution.ts` beyond line 106, or the office dashboard's use of gate data (if any).
> - I did not check whether a lint or format config is enforced beyond `tsc`.

## Round 3

**Lead PM: what changed in v3**

> # Response to Objections
>
> 1. **`standard` can vanish when the key is missing: adopted.**
>    - `VerificationGate.standard` is optional (`types.ts:146`) and configured gates are copied as-is (`gates.ts:16`). A gate written without `standard:` therefore resolves with `undefined`, and `JSON.stringify` drops that key.
>    - FR2 now reads "the string, or `null` when absent or empty" and fixes the mapping as `standard: gate.standard || null`.
>    - Test 2 gains a configured gate with no `standard` key. It asserts `'standard' in row` and `row.standard === null`. The same case is added to the Test 5 row-mapper unit test, so a bare `=== ''` check fails.
>    - No code or document change is needed for the Notes beyond two housekeeping edits:
>      - The PRD numbering (Test 3 = malformed config, Test 5 = unit test) is kept.
>      - `cli.test.cjs:113-120` (the malformed-config text test) is added to the unchanged-tests guardrail.
>    - The acceptance grep is demoted to a post-condition. Test 5 and the spoofed-`source` case are the real before/after proof.
> 2. **R1 and R2: already applied.** `source` comes from `resolveGates`, and the implicit strings are `project.lint_command` and `project.test_command`. The Chief Engineer confirmed these at `gates.ts:18-19`.

<details>
<summary>Draft v3 (full text)</summary>

```markdown
# Product Brief

## Executive Summary
`council gates` prints only a human-readable list. Scripts and CI that need the resolved gates must parse padded text. Issue #5 asks for `--json`. The repo already does this for `backlog list --json` (`src/commands/project.ts:154-160`), so the change follows an existing pattern.

## Problem Statement & Impact
The text line (`project.ts:198-205`) is space-delimited. `standard` and `command` can contain spaces, so the line is ambiguous to parse. It also omits where each gate came from, which is the first thing a script needs when a gate is missing or unexpected.

## Solution & Scope
**In scope**
- `council gates --json` prints a JSON array of the gates from `resolveGates(ctx.config)` (`gates.ts:13`).
- Each element has `name`, `command`, `standard`, `required`, `timeout_seconds` and `source`.
- Output is `[]` when no gates resolve.
- `resolveGates` returns the origin (`source`) of each gate (R1). Files touched:
  - `src/engine/gates.ts`
  - `src/types.ts`
  - `src/commands/project.ts`
  - `test/cli.test.cjs`
  - `test/gates.test.cjs`
  - `README.md`

**Out of scope**
- Changes to the text output.
- Other commands.
- A JSON schema file.
- Any new field in the config schema.

## User Journeys & Jobs-to-be-Done
- A CI author runs `council gates --json | jq -r '.[].command'` to see which checks to run locally.
- A script author reads `source` to tell configured gates from the implicit lint/test pair, and reads `.standard` knowing the key is always present.

## Success Metrics
- North Star: `--json` output parses with `JSON.parse` in 100% of tested config shapes (default pair, custom gate, gate without `standard`, empty).
- Guardrail: the existing text-mode tests (`cli.test.cjs:73-120`) stay byte-identical and green.
- Instrumentation: the new tests. N/A for runtime telemetry (local read-only preview).

## Risks & Mitigations
- Schema drift between modes. Mitigation: both modes read one `resolveGates` result.
- A config entry spoofing `source`. Mitigation: `source` is assigned after the spread and covered by a test.
- Optional fields dropped by `JSON.stringify`. Mitigation: every field is explicitly mapped, with `standard || null`, and tested for key presence.
- Consumers depend on field names. Mitigation: names match `VerificationGate` (`types.ts:138-147`) plus `source`, and later changes must be additive (§7).
- Dependency, vendor and compliance risk: N/A, no new dependency and no data handled.

## Key Assumptions & Chief Architect Rulings
- R1: `resolveGates` MUST return `source`. The command MUST copy it and MUST NOT re-evaluate `verification?.gates` or the lint/test commands.
- R2: the implicit sources are the exact config key paths, `project.lint_command` and `project.test_command`. Verified at `gates.ts:18-19`, `cli.test.cjs:75` and `README.md:228`, and confirmed by the Chief Engineer.
- `required` is always set by `resolveGates` (`gates.ts:31`).

# PRD

## Verified Baseline
- At 15b3e44, the `gates` command is at `project.ts:189-207` and has no options.
- `resolveGates` chooses configured versus implicit gates at `gates.ts:14-20`. Configured gates are copied with `{ ...gate }` (`gates.ts:16`).
- `standard` is optional (`types.ts:146`), so a configured gate may resolve with `standard === undefined`.
- Config loading checks only that `verification.gates` is an array (`config.ts:79-80`), so unknown keys survive.
- The only other caller, `execution.ts:106`, passes gates to `runGates`. `runGates` builds `GateResult` field by field (`gates.ts:47-58`), so `source` cannot leak into evidence.
- The existing `resolveGates` test (`gates.test.cjs:16-28`) compares mapped fields, so adding a field does not break it.
- `src/index.ts:1,16` re-exports `types` and `gates`, so `ResolvedGate` becomes public additively.

## Functional Requirements
- **FR1** `gates` MUST accept `--json`.
  - Given a default lint/test config, when `council gates --json` runs, then stdout is a JSON array of 2 objects (`lint`, then `test`) and the exit code is 0.
- **FR2** Each element MUST contain all of these keys:
  - `name` and `command`.
  - `standard`: the string, or `null` when absent or empty. The mapping is `standard: gate.standard || null`.
  - `required`: a boolean.
  - `timeout_seconds`: the effective value, defaulting to `DEFAULT_GATE_TIMEOUT_SECONDS` (900).
  - `source`: copied from `gate.source`.
  - Given the default pair, then `source` is `"project.lint_command"` and `"project.test_command"`.
  - Given a custom gate `a11y` with `required: false`, `timeout_seconds: 120` and `standard: ""`, then the element is `{name:"a11y", command:"npm run a11y", standard:null, required:false, timeout_seconds:120, source:"verification.gates"}`.
  - Given a configured gate written with no `standard` key, then the element has `'standard' in row` true and `row.standard === null`.
- **FR3** `resolveGates` MUST return `ResolvedGate[]`.
  - `ResolvedGate extends VerificationGate` and adds `source: 'verification.gates' | 'project.lint_command' | 'project.test_command'` in `src/types.ts`.
  - Configured gates MUST be built as `{ ...gate, source: VERIFICATION_GATES_SOURCE }`, with `source` placed after the spread.
  - Each implicit gate MUST carry its key-path constant, defined once in `gates.ts`.
  - Given a YAML gate with `source: "project.lint_command"`, then the resolved `source` is `"verification.gates"`.
- **FR4** When no gates resolve, `--json` MUST print `[]\n`, exit 0, and not print the "No verification gates" sentence.
- **FR5** Without `--json`, output MUST be unchanged.
- **FR6** In `--json` mode, stdout MUST contain only JSON.
  - Given a malformed config, then the exit code is 1, stdout is empty, stderr matches `/Failed to load .*config\.yml/`, and there is no stack trace.

## Non-Functional Requirements
- Performance, accessibility and i18n: N/A, local machine-readable preview with no added I/O.
- Security and privacy: the command prints only what text mode already prints, and no secrets are added (§6).
- Cost: none.

## Invariants & Architecture Compliance
- §1: the origin is decided once, in `resolveGates`.
- §2: config validation stays upstream of any output.
- §4: `source` reports the branch that actually ran, and it cannot be spoofed.
- §7: the change is additive, the config schema is unchanged, and the row shape is fixed.
- §8: reversible by one revert.

## Engineering Standards Compliance
- 01 Architecture §2.3: no new cross-feature imports.
- 02 Coding Practices §2: the mapping to rows is a small pure function. `project.ts` is 224 lines, so 3-4 added lines stay under 250 (§3).
- 02 Coding Practices §6: tests sit next to the existing ones.
- 03 Documentation §6: add a one-line `--json` mention at `README.md:228`.

## Test Plan
All tests use temp repos or pure inputs, so they are deterministic.
1. CLI default pair: deep-equal the 2 objects with exact `source` strings. The YAML uses `lint_command` and `test_command`.
2. CLI custom gates: deep-equal the FR2 `a11y` object, and a second gate with no `standard` key asserting `'standard' in row` and `row.standard === null`.
3. CLI malformed config with `--json`: assert status 1, `stdout === ''`, the stderr pattern, and no stack trace.
4. CLI empty: stdout equals `[]\n`.
5. `gates.test.cjs` unit test of `resolveGates` and the row mapper, covering:
   - the default pair
   - a configured gate
   - a configured gate with a fake `source` key
   - a configured gate with no `standard`
   - the empty case

Constitution §5: before the change `source` is `undefined`, so test 5 fails. `--json` is an unknown option, so tests 1-4 fail.

Acceptance checks:
- The full suite passes (`npm test` after `tsc`).
- Post-condition: `grep -nE "verification\?\.gates|lint_command|test_command" src/commands/project.ts` returns nothing.
- The existing text-mode tests (`cli.test.cjs:73-120`) are unchanged.

## Traceability
| Requirement | Test |
|---|---|
| FR1, FR2 | 1, 2, 5 |
| FR3 | 5 |
| FR4 | 4 |
| FR5 | Existing tests, `cli.test.cjs:73-120` |
| FR6 | 3 |

## Observability & Operability
N/A: local CLI with no telemetry or SLO.

## Rollout, Flagging & Rollback
The flag is opt-in, so there is no staged rollout or kill switch. Rollback is reverting the commit. No migration is involved.

## Dependencies & Supply Chain
None added.

# Executive Summary
Add an opt-in `--json` flag to `council gates`. It prints the resolved gates as a JSON array with `name`, `command`, `standard`, `required`, `timeout_seconds` and `source`, and prints `[]` when none resolve. `standard` is always present: it is `null` when absent or empty. Per ruling R1, `resolveGates` returns each gate's origin, using the exact config key paths from R2. The command only copies it. Text output and the config schema are unchanged. Five tests cover the behavior, including spoofed-`source` and missing-`standard` cases. Rollback is a single revert.
```

</details>

**Chief Engineer: review of v3**

> VERDICT: SHIP IT
> OPEN OBJECTIONS: 0
>
> I found no open objections. I checked draft v3 against commit 15b3e44:
>
> - **My round-2 objection (`standard` missing):** resolved. `VerificationGate.standard` is optional (`src/types.ts:146`). Configured gates are copied with `{ ...gate }` (`src/engine/gates.ts:16`). The new rule `standard: gate.standard || null` (FR2) plus Test 2 and Test 5, which check that the `standard` key is present and `null`, close the gap where `JSON.stringify` silently dropped the key.
> - **R1/R2 spelling:** `src/engine/gates.ts:18-19` reads `config.project.lint_command` and `config.project.test_command`. The test YAML at `test/cli.test.cjs:75` and `README.md:228` use the same underscored keys. So the implicit sources are `project.lint_command` and `project.test_command`, as FR2 says.
> - **FR6 (stdout holds only JSON on error):**
>   - `ctx.config` is loaded only when first used, inside `action()` (`src/cli.ts:14-20`).
>   - Errors go to `logger.error`, which is `console.error` (`src/utils/logger.ts:12`). It sets `process.exitCode = 1`, and prints a stack only when `COUNCIL_DEBUG` is set (`src/commands/shared.ts:15-18`).
>   - So with a malformed config, stdout stays empty and the requirement can be tested as written.
> - **FR4 (`[]\n`):** this matches the existing `console.log(JSON.stringify(rows, null, 2))` pattern at `project.ts:159`. `JSON.stringify([], null, 2)` is `"[]"`.
> - **FR3 spoofing:** config loading checks only that `gates` is an array (`src/config.ts:79-80`), so a `source` key written in YAML does reach `resolveGates`. Placing `source` after the spread overrides it, and Test 5 covers that case.
> - **Evidence path:** `runGates` builds `GateResult` field by field (`src/engine/gates.ts:47-58`), so `source` cannot leak into evidence. The other caller (`src/engine/execution.ts:106`) passes the gates straight to `runGates`, and `ResolvedGate[]` can be used wherever `VerificationGate[]` is expected.
> - **Public API:** `src/index.ts:1,16` re-exports `types` and `gates`, so the change adds exports and breaks nothing (§7).
> - **Existing tests:** the `resolveGates` unit test (`test/gates.test.cjs:16-28`) compares mapped fields only, so adding a field does not break it. The four text-mode CLI tests (`test/cli.test.cjs:73-120`) don't use `--json` and are unaffected (FR5).
> - **Post-condition grep:** `grep -nE "verification\?\.gates|lint_command|test_command" src/commands/project.ts` finds nothing at baseline, so it is a valid check that will still pass after the change.
> - **File size:** `src/commands/project.ts` is 224 lines, so the change stays under 250 (02 Coding Practices §3).
>
> Notes (not objections):
> - Test 5 unit-tests "the row mapper" through `lib`, but the draft doesn't say where the mapper lives. A mapper inside `project.ts` can't be imported by `test/gates.test.cjs`. The implementer should export it from `src/engine/gates.ts`, for example as `toGateRow(gate: ResolvedGate)`. Re-exporting through `src/index.ts:16` is then automatic, and `project.ts` imports it.
> - The two `source` constants should be exported from `gates.ts` too, so tests can compare against them as well as against the literal strings.
>
> Not checked:
> - I did not run `npm test` or a typecheck. `node_modules` is not installed in this read-only worktree: `npx tsc --noEmit` fails across the repo, with missing `execa`, `commander` and `@types/node`. The baseline suite is therefore unverified here.
> - I did not look at Commander's handling of an unknown `--json` before the change (the draft says it fails). I also did not check the README beyond line 228.
> - I did not review any commands other than `gates` and `backlog list`.

**Chief Architect: sign-off review of v3**

> **Review of Agreed Document v3 (`council gates --json`)**
>
> POINT 1: No concern. The change is a single revert and the tests give a named verifier. The author, verifier and approver split is held by the council process.
> POINT 2: No concern. Output goes through `JSON.stringify`, so there is no injection or encoding risk. The command prints only what text mode already prints. The `source` spoofing path is closed by FR3 and has a test.
> POINT 3: N/A. No dependencies are added.
> POINT 4: One concern, below.
> POINT 5: N/A. No personal data is handled and nothing new is persisted or logged.
> POINT 6: No concern. The FRs are testable and traceable, and R1 and R2 are recorded in the document.
> POINT 7: N/A — quick profile
> POINT 8: N/A — quick profile
> POINT 9: N/A — quick profile
> POINT 10: No concern. The new JSON row shape is pinned by tests 1, 2 and 5, and later changes must be additive. A schema file is out of scope.
> POINT 11: N/A — quick profile
> POINT 12: N/A — quick profile
>
> CONCERN 1: ADVISORY — Constitution §1 and §4, Checklist 4 (FR2 versus `config.ts:79-80`) — Config validation checks only that `verification.gates` is an array, so a configured gate may omit `required` or `timeout_seconds`, or carry a non-boolean `required`. The spec asserts "`required` is always set (`gates.ts:31`)" and that `timeout_seconds` is the "effective value". It doesn't say whether that normalization happens once in `resolveGates`, or is repeated in the row mapper beside the one `runGates` applies.
> - Resolution: state that the mapper reads the already-normalized `required` and `timeout_seconds` from `resolveGates` and applies no second default. If `runGates` applies the timeout default separately, the default must come from the one shared `DEFAULT_GATE_TIMEOUT_SECONDS`.
> - Add to test 5 (or test 2) a configured gate with no `required` and no `timeout_seconds`. It must assert `typeof row.required === 'boolean'`, `row.timeout_seconds === 900`, and that both keys are present.
>
> CONCERN 2: ADVISORY — Rulings Must Be Checkable (R1 grep), Checklist 4 — The post-condition `grep -nE "verification\?\.gates|lint_command|test_command" src/commands/project.ts` must return nothing. The Verified Baseline doesn't record that the grep is already clean at 15b3e44. The existing text path or its "No verification gates" hint could mention `lint_command`, which would force an out-of-scope text change or an unsatisfiable check.
> - MEASURE: run that grep on the unmodified `project.ts` and record the result in the Verified Baseline.
> - If it matches, narrow the pattern to the selection logic, for example `verification\?\.gates|\.lint_command|\.test_command` on code lines only. Do not touch the text output.
>
> VERDICT: SIGN-OFF WITH CONCERNS
> SUMMARY: The design is sound and R1 and R2 are honored, but it still needs the `required`/`timeout_seconds` normalization pinned to one place with an omitted-key test, and the baseline grep post-condition recorded before sign-off.

## Round 4

**Lead PM: what changed in v4**

> # Response to Objections
>
> **Chief Engineer, v3:** SHIP IT, 0 objections. Both notes are adopted. The row mapper `toGateRow(gate: ResolvedGate)` and the three `source` constants are exported from `src/engine/gates.ts`, so `test/gates.test.cjs` can import them and `src/index.ts:16` re-exports them.
>
> **Architect CONCERN 1 (normalization in one place):** Adopted, with a correction. I checked `gates.ts`. `resolveGates` normalizes only `required === undefined` to `true` (line 31). It does not normalize `timeout_seconds`. `runGates` applies the timeout default (line 40) and the `!== false` coercion of `required` (line 41) itself. So the premise that both fields are already normalized in `resolveGates` is only half true. A mapper that copied the raw fields would disagree with `runGates` for a non-boolean `required`. A mapper that re-defaulted would be a second copy. Fix:
> - Two pure helpers are defined once in `gates.ts`: `effectiveTimeoutSeconds(gate)` and `isGateRequired(gate)`.
> - `runGates` is changed to call them in place of its inline expressions at lines 40-41, with identical behavior.
> - `toGateRow` calls the same helpers, so the JSON shows exactly what `runGates` would run.
> - Test 2 and test 5 gain a configured gate with no `required` and no `timeout_seconds`. They assert both keys are present, `typeof row.required === 'boolean'` and `row.timeout_seconds === 900`.
> - Test 5 also asserts that a gate with `required: "no"` reports `true`, matching `runGates` at line 41.
>
> **Architect CONCERN 2 (baseline grep):** Adopted. I ran `grep -nE "verification\?\.gates|lint_command|test_command" src/commands/project.ts` on the unmodified file at 15b3e44. It returns no matches (exit 1). The result is recorded in the Verified Baseline, so the post-condition is satisfiable and the text output is untouched.
>
> **Rulings R1 and R2:** Already honored. The R2 spelling was measured, and the underscored keys are the ones emitted.

<details>
<summary>Draft v4 (full text)</summary>

```markdown
# Product Brief

## Executive Summary
`council gates` prints only a human-readable list. Scripts and CI that need the resolved gates must parse padded text. Issue #5 asks for `--json`. The repo already offers `backlog list --json` (`src/commands/project.ts:154-160`), so the change follows an existing pattern.

## Problem Statement & Impact
The text line (`project.ts:198-205`) is space-delimited. `standard` and `command` can contain spaces, so the line is ambiguous to parse. It also omits where each gate came from, which is the first thing a script needs when a gate is missing or unexpected.

## Solution & Scope
**In scope**
- `council gates --json` prints a JSON array of the gates from `resolveGates(ctx.config)` (`gates.ts:13`).
- Each element has `name`, `command`, `standard`, `required`, `timeout_seconds` and `source`.
- Output is `[]` when no gates resolve.
- `resolveGates` returns each gate's origin (R1). Files touched:
  - `src/engine/gates.ts`
  - `src/types.ts`
  - `src/commands/project.ts`
  - `test/cli.test.cjs`
  - `test/gates.test.cjs`
  - `README.md`

**Out of scope**
- Changes to the text output.
- Other commands.
- A JSON schema file.
- Any new field in the config schema.
- Any change in gate execution behavior. The helper extraction in FR3 is behavior-neutral.

## User Journeys & Jobs-to-be-Done
- A CI author runs `council gates --json | jq -r '.[].command'` to see which checks to run locally.
- A script author reads `source` to tell configured gates from the implicit lint/test pair. They can rely on `.standard` always being present.

## Success Metrics
- North Star: `--json` output parses with `JSON.parse` in 100% of tested config shapes (default pair, custom gate, gate without `standard`, gate without `required`/`timeout_seconds`, empty).
- Guardrail: the existing text-mode tests (`cli.test.cjs:73-120`) stay byte-identical and green. The `runGates` tests stay green.
- Instrumentation: the new tests. N/A for runtime telemetry (local read-only preview).

## Risks & Mitigations
- Schema drift between modes. Mitigation: both modes read one `resolveGates` result.
- Mapper and `runGates` disagreeing on `required` or the timeout. Mitigation: both call the same helpers, and tests assert the values.
- A config entry spoofing `source`. Mitigation: `source` is assigned after the spread and covered by a test.
- Optional fields dropped by `JSON.stringify`. Mitigation: every field is explicitly mapped, with `standard || null`, and tested for key presence.
- Consumers depend on field names. Mitigation: names match `VerificationGate` (`types.ts:138-147`) plus `source`, and later changes must be additive (§7).
- Dependency, vendor and compliance risk: N/A, no new dependency and no data handled.

## Key Assumptions & Chief Architect Rulings
- R1: `resolveGates` MUST return `source`. The command MUST copy it and MUST NOT re-evaluate `verification?.gates` or the lint/test commands.
- R2: the implicit sources are the exact config key paths, `project.lint_command` and `project.test_command`. Verified at `gates.ts:18-19`, `cli.test.cjs:75` and `README.md:228`. Each is defined once as an exported constant in `gates.ts`.
- Architect concern 1: `required` and `timeout_seconds` are interpreted in one place, the shared helpers in `gates.ts`. Neither the command nor the mapper re-defaults them.

# PRD

## Verified Baseline
- At 15b3e44, the `gates` command is at `project.ts:189-207` and has no options.
- The grep `grep -nE "verification\?\.gates|lint_command|test_command" src/commands/project.ts` returns no matches (exit 1) on the unmodified file. It is a valid post-condition.
- `resolveGates` chooses configured versus implicit gates at `gates.ts:14-20`. Configured gates are copied with `{ ...gate }` (`gates.ts:16`).
- `resolveGates` defaults only `required === undefined` to `true` (`gates.ts:31`). It validates a non-positive timeout (`gates.ts:28`).
- `runGates` applies the timeout default at `gates.ts:40` and `required = gate.required !== false` at `gates.ts:41`. `DEFAULT_GATE_TIMEOUT_SECONDS = 900` is at `gates.ts:5`.
- `standard` is optional (`types.ts:146`), so a configured gate may resolve with `standard === undefined`.
- Config loading checks only that `verification.gates` is an array (`config.ts:79-80`), so unknown keys survive.
- The only other caller, `execution.ts:106`, passes gates to `runGates`. `runGates` builds `GateResult` field by field (`gates.ts:47-58`), so `source` cannot leak into evidence.
- The existing `resolveGates` test (`gates.test.cjs:16-28`) compares mapped fields, so adding a field does not break it.
- `src/index.ts:1,16` re-exports `types` and `gates`, so the new exports are additive.

## Functional Requirements
- **FR1** `gates` MUST accept `--json`.
  - Given a default lint/test config, when `council gates --json` runs, then stdout is a JSON array of 2 objects (`lint`, then `test`) and the exit code is 0.
- **FR2** Each element MUST contain all of these keys:
  - `name` and `command`.
  - `standard`: the string, or `null` when absent or empty. The mapping is `standard: gate.standard || null`.
  - `required`: `isGateRequired(gate)`, a boolean.
  - `timeout_seconds`: `effectiveTimeoutSeconds(gate)`, defaulting to 900.
  - `source`: copied from `gate.source`.
  - Given the default pair, then `source` is `"project.lint_command"` and `"project.test_command"`.
  - Given a custom gate `a11y` with `required: false`, `timeout_seconds: 120` and `standard: ""`, then the element is `{name:"a11y", command:"npm run a11y", standard:null, required:false, timeout_seconds:120, source:"verification.gates"}`.
  - Given a configured gate with no `standard`, `required` or `timeout_seconds`, then all three keys are present, `standard === null`, `required === true`, and `timeout_seconds === 900`.
- **FR3** `resolveGates` MUST return `ResolvedGate[]`, and `gates.ts` MUST own the interpretation of the gate fields.
  - `ResolvedGate extends VerificationGate` and adds `source: 'verification.gates' | 'project.lint_command' | 'project.test_command'` in `src/types.ts`.
  - Configured gates MUST be built as `{ ...gate, source: VERIFICATION_GATES_SOURCE }`, with `source` placed after the spread.
  - `gates.ts` MUST export these:
    - the three source constants
    - `isGateRequired` and `effectiveTimeoutSeconds`
    - `toGateRow(gate: ResolvedGate)`
  - `runGates` MUST call the two helpers instead of its inline expressions at `gates.ts:40-41`. Behavior is identical.
  - `toGateRow` MUST NOT define its own defaults.
  - Given a YAML gate with `source: "project.lint_command"`, then the resolved `source` is `"verification.gates"`.
- **FR4** When no gates resolve, `--json` MUST print `[]\n`, exit 0, and not print the "No verification gates" sentence.
- **FR5** Without `--json`, output MUST be unchanged.
- **FR6** In `--json` mode, stdout MUST contain only JSON.
  - Given a malformed config, then the exit code is 1, stdout is empty, stderr matches `/Failed to load .*config\.yml/`, and there is no stack trace.

## Non-Functional Requirements
- Performance, accessibility and i18n: N/A, local machine-readable preview with no added I/O.
- Security and privacy: the command prints only what text mode already prints, and no secrets are added (§6).
- Cost: none.

## Invariants & Architecture Compliance
- §1: the origin and the field interpretation each live once, in `gates.ts`.
- §2: config validation stays upstream of any output.
- §4: `source`, `required` and `timeout_seconds` report what `runGates` would actually use, and `source` cannot be spoofed.
- §7: the change is additive, the config schema is unchanged, and the row shape is fixed.
- §8: reversible by one revert.

## Engineering Standards Compliance
- 01 Architecture §2.3: no new cross-feature imports.
- 02 Coding Practices §2: the helpers and `toGateRow` are pure functions. `project.ts` is 224 lines, so 3-4 added lines stay under 250 (§3).
- 02 Coding Practices §6: tests sit next to the existing ones.
- 03 Documentation §6: add a one-line `--json` mention at `README.md:228`.

## Test Plan
All tests use temp repos or pure inputs, so they are deterministic.
1. CLI default pair: deep-equal the 2 objects with exact `source` strings. The YAML uses `lint_command` and `test_command`.
2. CLI custom gates: deep-equal the FR2 `a11y` object. Add a second gate with no `standard`, `required` or `timeout_seconds`, asserting key presence, `standard === null`, `typeof row.required === 'boolean'` and `row.timeout_seconds === 900`.
3. CLI malformed config with `--json`: assert status 1, `stdout === ''`, the stderr pattern, and no stack trace.
4. CLI empty: stdout equals `[]\n`.
5. `gates.test.cjs` unit tests of `resolveGates`, `toGateRow` and the helpers, covering:
   - the default pair, compared with the exported constants and the literal strings
   - a configured gate
   - a configured gate with a fake `source` key
   - a configured gate with no `standard`, `required` or `timeout_seconds`
   - `required: "no"` giving `true`, matching `runGates`
   - the empty case

Constitution §5: before the change `source` is `undefined`, so test 5 fails. `--json` is an unknown option, so tests 1-4 fail.

Acceptance checks:
- The full suite passes (`npm test` after `tsc`).
- Post-condition: the baseline grep on `project.ts` still returns nothing.
- The existing text-mode tests (`cli.test.cjs:73-120`) are unchanged.

## Traceability
| Requirement | Test |
|---|---|
| FR1, FR2 | 1, 2, 5 |
| FR3 | 5 |
| FR4 | 4 |
| FR5 | Existing tests, `cli.test.cjs:73-120` |
| FR6 | 3 |

## Observability & Operability
N/A: local CLI with no telemetry or SLO.

## Rollout, Flagging & Rollback
The flag is opt-in, so there is no staged rollout or kill switch. Rollback is reverting the commit. No migration is involved.

## Dependencies & Supply Chain
N/A: no dependencies added.

# Executive Summary
Add an opt-in `--json` flag to `council gates`. It prints the resolved gates as a JSON array with `name`, `command`, `standard`, `required`, `timeout_seconds` and `source`, and prints `[]` when none resolve. `standard` is always present and is `null` when absent or empty. Per ruling R1, `resolveGates` returns each gate's origin, using the exact config key paths from R2. `required` and `timeout_seconds` come from two shared helpers that `runGates` also uses, so the output matches what would run. Text output and the config schema are unchanged. Five test groups cover the behavior. Rollback is a single revert.
```

</details>

**Chief Engineer: review of v4**

> VERDICT: SHIP WITH CHANGES
> OPEN OBJECTIONS: 1
>
> 1. **The text path still reads `required` and `timeout_seconds` on its own, so the draft's §1 claim is false as written.** This breaks Constitution §1 (Single Source of Truth) and the Architect's CONCERN 1.
>    - **Evidence.** The draft says "`required` and `timeout_seconds` are interpreted in one place, the shared helpers in `gates.ts`. Neither the command nor the mapper re-defaults them." It also says, under Invariants, "§1: … the field interpretation each live once, in `gates.ts`". At 15b3e44 the existing text loop in the same command applies both rules itself:
>      - `src/commands/project.ts:199`: `const timeoutSeconds = gate.timeout_seconds ?? DEFAULT_GATE_TIMEOUT_SECONDS;`
>      - `src/commands/project.ts:202`: `gate.required !== false ? 'required' : 'advisory'`
>      - `src/commands/project.ts:8` imports `DEFAULT_GATE_TIMEOUT_SECONDS` for that purpose.
>
>      As drafted, FR3 moves only `runGates` (`gates.ts:40-41`) onto the helpers. That leaves a third copy in the command, next to the new `--json` branch. The two modes of the same command could then disagree about one gate, which is the drift R1 and CONCERN 1 exist to prevent (§4).
>    - **Required change.** This changes what gets built.
>      - Add to FR3: "The text-mode loop in `project.ts` MUST call `effectiveTimeoutSeconds(gate)` and `isGateRequired(gate)` in place of its inline expressions at lines 199 and 202. It MUST drop the `DEFAULT_GATE_TIMEOUT_SECONDS` import. Output stays byte-identical."
>      - Adjust the Out of scope line to say the text *output* is unchanged. The text *code* changes as above.
>      - Extend the acceptance grep so it also checks this. On the modified file, `grep -nE "verification\?\.gates|lint_command|test_command|timeout_seconds \?\?|required !== false|DEFAULT_GATE_TIMEOUT_SECONDS" src/commands/project.ts` returns nothing (exit 1). FR5 stays guarded by the unchanged `cli.test.cjs:73-120`. Those tests already cover an advisory gate with a custom timeout and a standard-less gate (`cli.test.cjs:85-103`), so they will catch a regression.
>      - The line budget is unaffected (`project.ts` is 224 lines).
>
> **Verified at 15b3e44 (read-only):**
> - `resolveGates` and its branches are at `gates.ts:13-34`. `{ ...gate }` is at line 16, the implicit pair at lines 18-19, `required === undefined → true` at line 31, and timeout validation at line 28.
> - `runGates` handles timeout and required at `gates.ts:40-41`. `GateResult` is built field by field at lines 47-58, so `source` cannot leak into evidence.
> - `DEFAULT_GATE_TIMEOUT_SECONDS = 900` is at `gates.ts:5`.
> - `VerificationGate` is at `types.ts:138-147`, and `standard` is optional.
> - The `gates` command is at `project.ts:189-207`, and `backlog list --json` is at `project.ts:154-160`. `project.ts` is 224 lines.
> - The baseline grep `verification\?\.gates|lint_command|test_command` on `project.ts` returns no matches (exit 1), as the draft records.
> - `src/index.ts:16` re-exports `engine/gates.js`, so the new exports are additive.
> - The only other `resolveGates` caller is `execution.ts:106`.
> - The existing `gates.test.cjs:12-29` maps fields, so adding `source` doesn't break it.
> - The error text `Failed to load ${configFile}` comes from `src/config.ts:98`.
> - README `:228` mentions `lint_command`/`test_command` with underscores, which confirms the R2 spelling `project.lint_command` and `project.test_command`.
>
> **Notes (not objections):**
> - The Verified Baseline cites `config.ts:79-80`. The file is `src/config.ts`, and there is no `src/engine/config.ts`. Fix the path in the document.
> - Name the helper parameters `VerificationGate`, not `ResolvedGate`, so `runGates(gates: VerificationGate[])` can call them without changing its signature.
>
> Not checked:
> - I did not run `tsc` or `npm test`, because this is a read-only deliberation checkout and I made no build artifacts.
> - I did not check how `action()` and `ctx` handle a malformed config without a stack trace, so FR6's stderr and stack-trace claim is not re-verified this round.
> - I did not open the full text of `cli.test.cjs:73-120` beyond the test names and line positions.
> - I did not check `summarizeGates` or other `gates.ts` exports after line 70.

## Stalled: what the harness kept

No document reached the operator. The harness wrote the last draft and the open objections instead:

<details>
<summary>stalled-draft-and-objections.md</summary>

```markdown
# Council stalled: partial result for session 20261106194407-gates-json-r2

> This document is NOT signed off and NOT approved. No seat agreed to it; `council approve` will refuse it.
> It is the last draft the council produced plus the objections and concerns still open against it, so the
> work spent is not lost: fix the task statement or the draft and open a new session.

- Reason: No unanimous zero-concern sign-off after 4 rounds (max_rounds 4, sign-off revisions 1); nothing was presented to the Operator.
- Rounds completed: 4
- Latest draft: plan-v4.md

## Task

`council gates` prints the verification gates as a human-readable list. Add a `--json` flag that prints the same resolved gates (name, command, standard, and where each came from) as a JSON array, and `[]` when no gates resolve, so scripts can read them (GitHub issue #5). The command is in src/commands/project.ts (program.command('gates')). Add a test in test/cli.test.cjs.

## Chief Engineer's reply to v4 (open objections)

VERDICT: SHIP WITH CHANGES
OPEN OBJECTIONS: 1

1. **The text path still reads `required` and `timeout_seconds` on its own, so the draft's §1 claim is false as written.** This breaks Constitution §1 (Single Source of Truth) and the Architect's CONCERN 1.
   - **Evidence.** The draft says "`required` and `timeout_seconds` are interpreted in one place, the shared helpers in `gates.ts`. Neither the command nor the mapper re-defaults them." It also says, under Invariants, "§1: … the field interpretation each live once, in `gates.ts`". At 15b3e44 the existing text loop in the same command applies both rules itself:
     - `src/commands/project.ts:199`: `const timeoutSeconds = gate.timeout_seconds ?? DEFAULT_GATE_TIMEOUT_SECONDS;`
     - `src/commands/project.ts:202`: `gate.required !== false ? 'required' : 'advisory'`
     - `src/commands/project.ts:8` imports `DEFAULT_GATE_TIMEOUT_SECONDS` for that purpose.

     As drafted, FR3 moves only `runGates` (`gates.ts:40-41`) onto the helpers. That leaves a third copy in the command, next to the new `--json` branch. The two modes of the same command could then disagree about one gate, which is the drift R1 and CONCERN 1 exist to prevent (§4).
   - **Required change.** This changes what gets built.
     - Add to FR3: "The text-mode loop in `project.ts` MUST call `effectiveTimeoutSeconds(gate)` and `isGateRequired(gate)` in place of its inline expressions at lines 199 and 202. It MUST drop the `DEFAULT_GATE_TIMEOUT_SECONDS` import. Output stays byte-identical."
     - Adjust the Out of scope line to say the text *output* is unchanged. The text *code* changes as above.
     - Extend the acceptance grep so it also checks this. On the modified file, `grep -nE "verification\?\.gates|lint_command|test_command|timeout_seconds \?\?|required !== false|DEFAULT_GATE_TIMEOUT_SECONDS" src/commands/project.ts` returns nothing (exit 1). FR5 stays guarded by the unchanged `cli.test.cjs:73-120`. Those tests already cover an advisory gate with a custom timeout and a standard-less gate (`cli.test.cjs:85-103`), so they will catch a regression.
     - The line budget is unaffected (`project.ts` is 224 lines).

**Verified at 15b3e44 (read-only):**
- `resolveGates` and its branches are at `gates.ts:13-34`. `{ ...gate }` is at line 16, the implicit pair at lines 18-19, `required === undefined → true` at line 31, and timeout validation at line 28.
- `runGates` handles timeout and required at `gates.ts:40-41`. `GateResult` is built field by field at lines 47-58, so `source` cannot leak into evidence.
- `DEFAULT_GATE_TIMEOUT_SECONDS = 900` is at `gates.ts:5`.
- `VerificationGate` is at `types.ts:138-147`, and `standard` is optional.
- The `gates` command is at `project.ts:189-207`, and `backlog list --json` is at `project.ts:154-160`. `project.ts` is 224 lines.
- The baseline grep `verification\?\.gates|lint_command|test_command` on `project.ts` returns no matches (exit 1), as the draft records.
- `src/index.ts:16` re-exports `engine/gates.js`, so the new exports are additive.
- The only other `resolveGates` caller is `execution.ts:106`.
- The existing `gates.test.cjs:12-29` maps fields, so adding `source` doesn't break it.
- The error text `Failed to load ${configFile}` comes from `src/config.ts:98`.
- README `:228` mentions `lint_command`/`test_command` with underscores, which confirms the R2 spelling `project.lint_command` and `project.test_command`.

**Notes (not objections):**
- The Verified Baseline cites `config.ts:79-80`. The file is `src/config.ts`, and there is no `src/engine/config.ts`. Fix the path in the document.
- Name the helper parameters `VerificationGate`, not `ResolvedGate`, so `runGates(gates: VerificationGate[])` can call them without changing its signature.

Not checked:
- I did not run `tsc` or `npm test`, because this is a read-only deliberation checkout and I made no build artifacts.
- I did not check how `action()` and `ctx` handle a malformed config without a stack trace, so FR6's stderr and stack-trace claim is not re-verified this round.
- I did not open the full text of `cli.test.cjs:73-120` beyond the test names and line positions.
- I did not check `summarizeGates` or other `gates.ts` exports after line 70.

## Last draft (plan-v4, not approved)

# Product Brief

## Executive Summary
`council gates` prints only a human-readable list. Scripts and CI that need the resolved gates must parse padded text. Issue #5 asks for `--json`. The repo already offers `backlog list --json` (`src/commands/project.ts:154-160`), so the change follows an existing pattern.

## Problem Statement & Impact
The text line (`project.ts:198-205`) is space-delimited. `standard` and `command` can contain spaces, so the line is ambiguous to parse. It also omits where each gate came from, which is the first thing a script needs when a gate is missing or unexpected.

## Solution & Scope
**In scope**
- `council gates --json` prints a JSON array of the gates from `resolveGates(ctx.config)` (`gates.ts:13`).
- Each element has `name`, `command`, `standard`, `required`, `timeout_seconds` and `source`.
- Output is `[]` when no gates resolve.
- `resolveGates` returns each gate's origin (R1). Files touched:
  - `src/engine/gates.ts`
  - `src/types.ts`
  - `src/commands/project.ts`
  - `test/cli.test.cjs`
  - `test/gates.test.cjs`
  - `README.md`

**Out of scope**
- Changes to the text output.
- Other commands.
- A JSON schema file.
- Any new field in the config schema.
- Any change in gate execution behavior. The helper extraction in FR3 is behavior-neutral.

## User Journeys & Jobs-to-be-Done
- A CI author runs `council gates --json | jq -r '.[].command'` to see which checks to run locally.
- A script author reads `source` to tell configured gates from the implicit lint/test pair. They can rely on `.standard` always being present.

## Success Metrics
- North Star: `--json` output parses with `JSON.parse` in 100% of tested config shapes (default pair, custom gate, gate without `standard`, gate without `required`/`timeout_seconds`, empty).
- Guardrail: the existing text-mode tests (`cli.test.cjs:73-120`) stay byte-identical and green. The `runGates` tests stay green.
- Instrumentation: the new tests. N/A for runtime telemetry (local read-only preview).

## Risks & Mitigations
- Schema drift between modes. Mitigation: both modes read one `resolveGates` result.
- Mapper and `runGates` disagreeing on `required` or the timeout. Mitigation: both call the same helpers, and tests assert the values.
- A config entry spoofing `source`. Mitigation: `source` is assigned after the spread and covered by a test.
- Optional fields dropped by `JSON.stringify`. Mitigation: every field is explicitly mapped, with `standard || null`, and tested for key presence.
- Consumers depend on field names. Mitigation: names match `VerificationGate` (`types.ts:138-147`) plus `source`, and later changes must be additive (§7).
- Dependency, vendor and compliance risk: N/A, no new dependency and no data handled.

## Key Assumptions & Chief Architect Rulings
- R1: `resolveGates` MUST return `source`. The command MUST copy it and MUST NOT re-evaluate `verification?.gates` or the lint/test commands.
- R2: the implicit sources are the exact config key paths, `project.lint_command` and `project.test_command`. Verified at `gates.ts:18-19`, `cli.test.cjs:75` and `README.md:228`. Each is defined once as an exported constant in `gates.ts`.
- Architect concern 1: `required` and `timeout_seconds` are interpreted in one place, the shared helpers in `gates.ts`. Neither the command nor the mapper re-defaults them.

# PRD

## Verified Baseline
- At 15b3e44, the `gates` command is at `project.ts:189-207` and has no options.
- The grep `grep -nE "verification\?\.gates|lint_command|test_command" src/commands/project.ts` returns no matches (exit 1) on the unmodified file. It is a valid post-condition.
- `resolveGates` chooses configured versus implicit gates at `gates.ts:14-20`. Configured gates are copied with `{ ...gate }` (`gates.ts:16`).
- `resolveGates` defaults only `required === undefined` to `true` (`gates.ts:31`). It validates a non-positive timeout (`gates.ts:28`).
- `runGates` applies the timeout default at `gates.ts:40` and `required = gate.required !== false` at `gates.ts:41`. `DEFAULT_GATE_TIMEOUT_SECONDS = 900` is at `gates.ts:5`.
- `standard` is optional (`types.ts:146`), so a configured gate may resolve with `standard === undefined`.
- Config loading checks only that `verification.gates` is an array (`config.ts:79-80`), so unknown keys survive.
- The only other caller, `execution.ts:106`, passes gates to `runGates`. `runGates` builds `GateResult` field by field (`gates.ts:47-58`), so `source` cannot leak into evidence.
- The existing `resolveGates` test (`gates.test.cjs:16-28`) compares mapped fields, so adding a field does not break it.
- `src/index.ts:1,16` re-exports `types` and `gates`, so the new exports are additive.

## Functional Requirements
- **FR1** `gates` MUST accept `--json`.
  - Given a default lint/test config, when `council gates --json` runs, then stdout is a JSON array of 2 objects (`lint`, then `test`) and the exit code is 0.
- **FR2** Each element MUST contain all of these keys:
  - `name` and `command`.
  - `standard`: the string, or `null` when absent or empty. The mapping is `standard: gate.standard || null`.
  - `required`: `isGateRequired(gate)`, a boolean.
  - `timeout_seconds`: `effectiveTimeoutSeconds(gate)`, defaulting to 900.
  - `source`: copied from `gate.source`.
  - Given the default pair, then `source` is `"project.lint_command"` and `"project.test_command"`.
  - Given a custom gate `a11y` with `required: false`, `timeout_seconds: 120` and `standard: ""`, then the element is `{name:"a11y", command:"npm run a11y", standard:null, required:false, timeout_seconds:120, source:"verification.gates"}`.
  - Given a configured gate with no `standard`, `required` or `timeout_seconds`, then all three keys are present, `standard === null`, `required === true`, and `timeout_seconds === 900`.
- **FR3** `resolveGates` MUST return `ResolvedGate[]`, and `gates.ts` MUST own the interpretation of the gate fields.
  - `ResolvedGate extends VerificationGate` and adds `source: 'verification.gates' | 'project.lint_command' | 'project.test_command'` in `src/types.ts`.
  - Configured gates MUST be built as `{ ...gate, source: VERIFICATION_GATES_SOURCE }`, with `source` placed after the spread.
  - `gates.ts` MUST export these:
    - the three source constants
    - `isGateRequired` and `effectiveTimeoutSeconds`
    - `toGateRow(gate: ResolvedGate)`
  - `runGates` MUST call the two helpers instead of its inline expressions at `gates.ts:40-41`. Behavior is identical.
  - `toGateRow` MUST NOT define its own defaults.
  - Given a YAML gate with `source: "project.lint_command"`, then the resolved `source` is `"verification.gates"`.
- **FR4** When no gates resolve, `--json` MUST print `[]\n`, exit 0, and not print the "No verification gates" sentence.
- **FR5** Without `--json`, output MUST be unchanged.
- **FR6** In `--json` mode, stdout MUST contain only JSON.
  - Given a malformed config, then the exit code is 1, stdout is empty, stderr matches `/Failed to load .*config\.yml/`, and there is no stack trace.

## Non-Functional Requirements
- Performance, accessibility and i18n: N/A, local machine-readable preview with no added I/O.
- Security and privacy: the command prints only what text mode already prints, and no secrets are added (§6).
- Cost: none.

## Invariants & Architecture Compliance
- §1: the origin and the field interpretation each live once, in `gates.ts`.
- §2: config validation stays upstream of any output.
- §4: `source`, `required` and `timeout_seconds` report what `runGates` would actually use, and `source` cannot be spoofed.
- §7: the change is additive, the config schema is unchanged, and the row shape is fixed.
- §8: reversible by one revert.

## Engineering Standards Compliance
- 01 Architecture §2.3: no new cross-feature imports.
- 02 Coding Practices §2: the helpers and `toGateRow` are pure functions. `project.ts` is 224 lines, so 3-4 added lines stay under 250 (§3).
- 02 Coding Practices §6: tests sit next to the existing ones.
- 03 Documentation §6: add a one-line `--json` mention at `README.md:228`.

## Test Plan
All tests use temp repos or pure inputs, so they are deterministic.
1. CLI default pair: deep-equal the 2 objects with exact `source` strings. The YAML uses `lint_command` and `test_command`.
2. CLI custom gates: deep-equal the FR2 `a11y` object. Add a second gate with no `standard`, `required` or `timeout_seconds`, asserting key presence, `standard === null`, `typeof row.required === 'boolean'` and `row.timeout_seconds === 900`.
3. CLI malformed config with `--json`: assert status 1, `stdout === ''`, the stderr pattern, and no stack trace.
4. CLI empty: stdout equals `[]\n`.
5. `gates.test.cjs` unit tests of `resolveGates`, `toGateRow` and the helpers, covering:
   - the default pair, compared with the exported constants and the literal strings
   - a configured gate
   - a configured gate with a fake `source` key
   - a configured gate with no `standard`, `required` or `timeout_seconds`
   - `required: "no"` giving `true`, matching `runGates`
   - the empty case

Constitution §5: before the change `source` is `undefined`, so test 5 fails. `--json` is an unknown option, so tests 1-4 fail.

Acceptance checks:
- The full suite passes (`npm test` after `tsc`).
- Post-condition: the baseline grep on `project.ts` still returns nothing.
- The existing text-mode tests (`cli.test.cjs:73-120`) are unchanged.

## Traceability
| Requirement | Test |
|---|---|
| FR1, FR2 | 1, 2, 5 |
| FR3 | 5 |
| FR4 | 4 |
| FR5 | Existing tests, `cli.test.cjs:73-120` |
| FR6 | 3 |

## Observability & Operability
N/A: local CLI with no telemetry or SLO.

## Rollout, Flagging & Rollback
The flag is opt-in, so there is no staged rollout or kill switch. Rollback is reverting the commit. No migration is involved.

## Dependencies & Supply Chain
N/A: no dependencies added.

# Executive Summary
Add an opt-in `--json` flag to `council gates`. It prints the resolved gates as a JSON array with `name`, `command`, `standard`, `required`, `timeout_seconds` and `source`, and prints `[]` when none resolve. `standard` is always present and is `null` when absent or empty. Per ruling R1, `resolveGates` returns each gate's origin, using the exact config key paths from R2. `required` and `timeout_seconds` come from two shared helpers that `runGates` also uses, so the output matches what would run. Text output and the config schema are unchanged. Five test groups cover the behavior. Rollback is a single revert.
```

</details>

