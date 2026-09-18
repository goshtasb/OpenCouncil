# S-01 — Architecture Standards

> **Scope**: Module boundaries, Vertical Slice Architecture, domain isolation,
> and public API contracts.

---

## 1. Architectural Pattern: Vertical Slice Architecture

### What It Is

Each **feature** is a self-contained vertical slice that owns its own UI
components, business logic, data access, and API routes. Code is organized
by **domain/feature**, not by technical layer.

### Why We Use It

- **Team Scalability** — Multiple developers or teams can work on separate
  features in parallel with minimal merge conflicts.
- **Reduced Coupling** — Changes to one feature do not cascade across
  unrelated parts of the codebase.
- **Easier Deletion** — Removing a feature means deleting a single folder,
  not hunting through dozens of layer-based directories.
- **Cognitive Locality** — Everything a developer needs to understand a
  feature lives in one place.

### Directory Structure (Reference)

```
src/
  features/
    <feature-name>/
      components/       # UI components scoped to this feature
      hooks/            # React hooks scoped to this feature
      services/         # Business logic and API calls
      types/            # TypeScript types/interfaces
      utils/            # Feature-specific utilities
      index.ts          # Public API — the ONLY file other features may import
      README.md         # Feature-level documentation
```

---

## 2. Module Boundary Rules

### Rule 2.1 — Self-Contained Features

Every feature directory must contain **all the code it needs** to function:
UI, logic, data fetching, and types. Shared infrastructure (HTTP clients,
auth wrappers, design-system primitives) lives in a dedicated `shared/`
directory — not inside any feature.

### Rule 2.2 — No Cross-Domain Imports

A feature **must not** import directly from another feature's internal files.
All inter-feature communication must go through:

1. The consuming feature's `index.ts` (public API), **or**
2. A shared event bus / state management layer defined in `shared/`.

**Violation Example:**
```ts
// BAD — direct cross-domain import
import { calculatePremium } from '../insurance/services/premiumEngine';
```

**Correct Example:**
```ts
// GOOD — import through public API
import { calculatePremium } from '../insurance';
```

### Rule 2.3 — Public API via `index.ts`

Each feature's `index.ts` explicitly exports only what other modules are
permitted to consume. Internal implementation files must **not** be exported.

```ts
// features/estimation/index.ts
export { EstimationForm } from './components/EstimationForm';
export { useEstimation } from './hooks/useEstimation';
export type { EstimationResult } from './types';
```

---

## 3. Shared Infrastructure

Code that is genuinely reused across 3+ features belongs in `shared/`:

```
src/
  shared/
    ui/             # Design-system primitives (Button, Input, Modal)
    hooks/          # Cross-cutting hooks (useAuth, useAnalytics)
    services/       # Infrastructure services (HTTP client, logger)
    types/          # Global type definitions
    utils/          # Pure utility functions
    index.ts        # Public API for shared code
```

**Promotion Rule**: Code starts inside a feature. It is only moved to
`shared/` when a **third** feature needs it. Premature abstraction creates
coupling, not reuse.

---

## 4. Dependency Direction

Dependencies must flow **inward** toward shared infrastructure, never
laterally between features:

```
Feature A  -->  shared/
Feature B  -->  shared/
Feature A  -/-> Feature B   (PROHIBITED)
```

---

## 5. Enforcement

- Linting rules (e.g., ESLint `no-restricted-imports`) should enforce
  boundary violations at CI time.
- Code reviews must verify that new cross-feature imports go through
  the public API.

---

*Parent: [00-manifest.md](./00-manifest.md)*
