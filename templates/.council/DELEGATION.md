# Standing Delegation for Autonomous Operations

This document establishes the authority and boundaries for autonomous execution by Open Council.

## Operator Review Boundary
The human Operator has exactly one act: approving the final **Product Brief + PRD** before coding begins.
The Operator is shown a PRD only after the Chief Engineer, the Chief Architect and the Council Lead have all signed off the identical document with zero open objections and zero concerns. The Operator is never asked questions during deliberation or execution.

## Council Authority
1. **Undefined Rules**: Any seat that needs a rule not defined by the standards, the constitution or an earlier ruling asks the Chief Architect. The ruling is binding on every seat for the session.
2. **Deadlocks**: From `tiebreak_round` on, the Chief Architect issues binding rulings on unresolved objections. If no unanimous zero-concern sign-off is reached by `max_rounds`, the session stops as STALLED and the backlog item is parked; nothing is presented to the Operator.

## Delegated Execution Authority
Once a PRD is approved:
1. **Autonomous Implementation**: The Chief Engineer runs headlessly, with full tool permissions, in an isolated clone on a dedicated branch, writing code, tests, and commits.
2. **Blockers**: A `BLOCKED.md` question is ruled on by the Chief Architect within the approved scope, and the Chief Engineer is resumed.
3. **Harness Verification**: The harness checks for commits and a clean tree, then runs every configured verification gate (lint, tests, dependency audit, secret scan, static analysis, accessibility, performance — whatever the project declares). Required gates must pass; advisory gates are recorded. Results are written to the session as immutable evidence and summarized in the pull request. Failures are fed back to the Chief Engineer, bounded by `execution_attempts`.
4. **Pull Request**: Only after verification passes does the harness push the branch and open a Pull Request (and, if configured, enable GitHub auto-merge). If attempts are exhausted or publishing fails, the session is marked BLOCKED and the backlog item parked.
