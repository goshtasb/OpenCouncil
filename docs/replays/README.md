# Council replays

Real solo-mode councils, each rendered from its session directory by [`docs/make-replay.py`](../make-replay.py): every draft, every objection with its `file:line`, every Architect concern and ruling, the sign-offs, the gate output and the diff. Nothing is summarised.

| Replay | What happened |
|---|---|
| [`council review` reviews itself](council-review-reviews-itself.md) | The first `council review` run, on the change that added it. Round 1 found five real problems, including untracked secrets sent to providers and a worktree shared with running sessions. All five were fixed before release. Three rounds, 6 minutes, stalled on objections to the fix plan. |
| [slugify: empty string and accents](slugify-empty-and-accents.md) | The Engineer found `npm test` already broken on Node 22 in round 1. Four rounds, one sign-off revision, signed off, gate passed. |
| [`council gates --json`, stalled](gates-json-stalled.md) | The Engineer converged; the Architect's last concern drew a new objection in the final round. The budget ran out and nothing reached the operator. |
| [slugify: letters NFD can't split, BLOCKED](slugify-special-letters-blocked.md) | Signed off in two rounds, but the PRD's gate and the project's configured gate disagreed. The harness refused to call it done. |

These ran on local copies with no GitHub remote, so none of them could open a pull request; that step ends BLOCKED by design.

Make your own from any session:

```bash
python3 docs/make-replay.py ~/.council/projects/<repo>-<hash>/sessions/<id> replay.md \
  --exec ~/.council/projects/<repo>-<hash>/exec/<id>    # optional: adds the commits and diff
```

Session prompts contain your repository's contents. Check for anything private before you publish a replay.
