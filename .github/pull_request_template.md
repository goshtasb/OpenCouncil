**What this changes**

**How it was verified**
<!-- `npm test` output, and for behaviour changes a new test. Tests use scripted seats, so they
     need no API credit. If you ran a live council, say which seats and what happened. -->

**Checklist**
- [ ] `npm run build && npm test` pass
- [ ] Behaviour change is covered by a test
- [ ] If a persona, contract or standard changed, `test/standards-coverage.test.cjs` asserts it
- [ ] Nothing reports success that did not happen (failures end as BLOCKED, never DONE)
