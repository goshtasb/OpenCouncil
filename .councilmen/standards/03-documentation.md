# S-03 — Documentation Standards

> **Scope**: Documentation structure, co-location rules, Architecture Decision
> Records (ADRs), and the "No God Docs" rule.

---

## 1. The No God Docs Rule

**Documentation files should stay within 250 lines** — a strong default and
review trigger, not an absolute ceiling (aligned with S-02 §3). When a document
grows past it, the default is to split it into focused sub-documents linked from
a parent index. Keep a doc longer only when splitting would fracture genuinely
cohesive material, and note why at the top.

### Why

- **Discoverability** — Engineers skip monolithic docs. Short, focused docs
  get read.
- **Maintainability** — A 1,000-line doc is nobody's responsibility. A
  100-line doc clearly belongs to one team or module.
- **Accuracy** — Smaller docs are easier to keep current. Stale docs are
  worse than no docs.

---

## 2. Documentation Co-Location

Documentation must live **next to the code it describes**. Do not maintain
a separate `/docs` monolith.

### Required Structure Per Feature Module

```
features/<feature-name>/
  README.md        # Required — Overview, usage, and public API summary
  ARCHITECTURE.md  # Optional — Complex architectural decisions specific
                   #            to this feature
```

### Project-Level Documentation

```
/standards/        # Engineering standards (this directory)
/docs/             # Only for cross-cutting operational docs
  /adrs/           # Architecture Decision Records
  /runbooks/       # Operational runbooks
```

---

## 3. Module README Structure

Every feature module must have a `README.md` with these sections:

### Template

```markdown
# <Feature Name>

## Overview
One-paragraph description of what this feature does and why it exists.

## Usage
How to use this module's public API. Include import examples.

## Key Components
Brief list of major internal components and their responsibilities.

## Dependencies
What shared modules or external packages this feature depends on.

## Related ADRs
Links to any Architecture Decision Records that affect this feature.
```

Keep each section concise. If a section would exceed 50 lines, it warrants
its own sub-document.

---

## 4. Architecture Decision Records (ADRs)

ADRs capture the **why** behind significant technical decisions. They live
in `/docs/adrs/` and follow a sequential numbering scheme.

### When to Write an ADR

- Choosing a framework, library, or major dependency.
- Defining a new architectural pattern or boundary.
- Making a decision that is difficult or expensive to reverse.
- Resolving a technical disagreement with a final decision.

### ADR Template

```markdown
# ADR-<NNN>: <Title>

## Status
Accepted | Superseded by ADR-XXX | Deprecated

## Context
What problem or question prompted this decision?

## Decision
What did we decide, and why?

## Consequences
What are the trade-offs? What becomes easier or harder?

## Alternatives Considered
What other options were evaluated and why were they rejected?
```

### ADR Rules

- ADRs are **immutable** once accepted. If a decision changes, write a new
  ADR that supersedes the original.
- Number ADRs sequentially: `ADR-001`, `ADR-002`, etc.
- Keep each ADR under 150 lines. If more context is needed, link to
  external references.

---

## 5. Inline Code Comments

- Write comments that explain **why**, not **what**. The code shows what
  happens; comments explain the reasoning.
- Do not add comments to self-explanatory code.
- Use `TODO:` for planned improvements, with a brief description and
  owner if possible.
- Use `HACK:` for intentional workarounds, with an explanation of why the
  workaround is necessary.

---

## 6. Documentation Maintenance

- Review feature READMEs during every PR that modifies the feature.
- Stale documentation must be updated or removed — never left to mislead.
- During sprint retrospectives, flag any docs that have drifted from reality.

---

*Parent: [00-manifest.md](./00-manifest.md)*
