# Standing Delegation for Autonomous Operations

This document establishes the authority and boundaries for autonomous execution by Open Councilmen.

## Operator Review Boundary
The human Operator reviews and approves:
1. The root **Product Brief + PRD** for any new feature or major refactor.
2. Changes to production environment variables, production deployment keys, or sensitive infrastructure.
3. Unresolvable disputes escalated by the Council after failed arbitration.

## Delegated Execution Authority
Once a root specification is formally approved:
1. **Autonomous Worktree Implementation**: The Chief Engineer runs headlessly in an isolated worktree branch, writing code, tests, and opening a Pull Request.
2. **Autonomous CI Resolution**: If continuous integration checks fail, the Chief Engineer investigates the failure logs, pushes fixes, and waits for a green build without operator interruption.
3. **In-Scope Amendments**: If execution encounters a technical blocker, the Council Lead and Chief Engineer may deliberate an amendment. If the amendment does not modify the approved user-facing scope, target branch, or core database schemas, it is automatically approved under standing delegation.
