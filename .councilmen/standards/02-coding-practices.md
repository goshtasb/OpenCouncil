# S-02 — Coding Practices

> **Scope**: SOLID principles, Functional Core / Imperative Shell, file-size
> limits, naming conventions, and general code quality rules.

---

## 1. SOLID Principles

### 1.1 Single Responsibility (SRP)

Every module, class, or function must have **one reason to change**. If a
component fetches data AND renders UI AND handles form validation, it has
three responsibilities and must be split.

### 1.2 Open/Closed (OCP)

Code should be **open for extension, closed for modification**. Favor
composition, strategy patterns, and configuration over editing existing
working code.

### 1.3 Liskov Substitution (LSP)

Subtypes must be substitutable for their base types without altering program
correctness. In practice: if you define an interface, every implementation
must honor its contract fully.

### 1.4 Interface Segregation (ISP)

No consumer should be forced to depend on methods it does not use. Prefer
small, focused interfaces over large, catch-all ones.

### 1.5 Dependency Inversion (DIP)

High-level modules must not depend on low-level modules. Both should depend
on **abstractions** (interfaces/types). Inject dependencies rather than
hard-coding them.

---

## 2. Functional Core, Imperative Shell

### What It Means

- **Functional Core** — Pure functions that take input and return output with
  no side effects. All business logic, calculations, and transformations live
  here. These are trivially testable.
- **Imperative Shell** — The thin outer layer that handles I/O: API calls,
  database queries, user events, file reads. This layer orchestrates the
  functional core.

### Why

- Pure functions are **deterministic** and easy to unit test without mocking.
- Side effects are isolated to the shell, making bugs easier to trace.
- Business logic survives framework migrations because it has no framework
  dependencies.

### Example

```ts
// Functional Core — pure, testable
function calculateEstimate(sqft: number, condition: string): number {
  const baseRate = 150;
  const conditionMultiplier = condition === 'excellent' ? 1.2 : 1.0;
  return sqft * baseRate * conditionMultiplier;
}

// Imperative Shell — orchestrates I/O
async function handleEstimateSubmit(formData: FormData): Promise<void> {
  const sqft = Number(formData.get('sqft'));
  const condition = String(formData.get('condition'));
  const result = calculateEstimate(sqft, condition);
  await api.post('/estimates', { sqft, condition, result });
}
```

---

## 3. File-Size Limits

| Asset Type      | Max Lines | Rationale                          |
| --------------- | --------- | ---------------------------------- |
| Source file      | 250       | Cognitive load; fits in one screen |
| Documentation    | 250       | Readability; focused scope         |
| Test file        | 250       | One behavior cluster per file      |
| Config file      | 100       | Should be minimal and declarative  |

**250 is a strong default and a review trigger — not an absolute ceiling.**
It exists to prevent logic sprawl and to encourage extracting pure helpers
(the old 300-line "code" allowance was removed for exactly that reason — a
300 default lets logic sprawl). When a file approaches 250, that is the signal
to **extract a new module along a natural boundary** — default to splitting.

But the line count is a **proxy for cohesion, not the goal itself.** Do **not**
fracture genuinely cohesive logic across files just to get under the number
(that produces "sibling sprawl" — having to open five files to follow one flow,
which is *worse* than one slightly-long, cohesive file). Modularity is about
**boundaries and interfaces**, and the line limit only nudges you toward them.

If a split would harm readability more than the length does, keeping the file
longer is the right call — **provided** you add a one-line comment at the top
noting why it deliberately exceeds 250, so reviewers see a justified exception,
not drift. A file materially over 250 *without* that justification is a refactor
smell to be addressed (see the God-File backlog), not an automatic failure.

**Why we limit file size**: Research on cognitive load (Miller's Law, working
memory limits) shows that humans struggle to reason about more than ~7
distinct concepts simultaneously. Long files force developers to hold too
much context, increasing error rates and slowing code review.

---

## 4. Naming Conventions

### 4.1 General Rules

- **Be descriptive.** `calculateMonthlyPremium` over `calcPrem`.
- **No abbreviations** unless they are universally understood (`id`, `url`,
  `api`).
- **Boolean variables** start with `is`, `has`, `should`, or `can`:
  `isVisible`, `hasPermission`.

### 4.2 Casing Standards

| Construct           | Convention       | Example                  |
| ------------------- | ---------------- | ------------------------ |
| Variables/functions | camelCase        | `estimateTotal`          |
| Constants           | UPPER_SNAKE_CASE | `MAX_RETRY_COUNT`        |
| Types/Interfaces    | PascalCase       | `EstimationResult`       |
| Files (components)  | PascalCase       | `EstimationForm.tsx`     |
| Files (utilities)   | camelCase        | `formatCurrency.ts`      |
| Directories         | kebab-case       | `feature-estimation/`    |

### 4.3 Function Naming

- **Event handlers**: `handle` + noun + verb — `handleFormSubmit`.
- **Hooks**: `use` + description — `useEstimation`.
- **Boolean getters**: `is`/`has`/`can` + description — `isFormValid`.
- **Transformers**: verb + noun — `formatAddress`, `parseResponse`.

---

## 5. Error Handling

- Handle errors at **system boundaries** (user input, API responses, file I/O).
- Do not wrap internal function calls in try/catch unless there is a specific
  recovery strategy.
- Use typed error objects, not raw strings.
- Log errors with sufficient context (operation name, input parameters).

---

## 6. Testing Expectations

- **Unit tests** cover the functional core (pure functions, business logic).
- **Integration tests** cover the imperative shell (API routes, data flow).
- **Component tests** verify UI behavior, not implementation details.
- Test files live adjacent to the code they test: `EstimationForm.test.tsx`
  next to `EstimationForm.tsx`.

---

*Parent: [00-manifest.md](./00-manifest.md)*
