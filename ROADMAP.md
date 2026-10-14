# Roadmap

Open Council is young and built in public. This is what is being worked on, roughly in order.

Want a say? Vote or comment in [Discussions → Ideas](https://github.com/goshtasb/OpenCouncil/discussions/categories/ideas).
Want to hear when something ships? **Watch → Custom → Releases** at the top of the repo.

## Now

- **The Charm** — a phone voice companion for the council. Your phone is the face and the voice; your Mac runs
  Claude, Gemini and Grok on the subscriptions you already pay for. Ask one by name, or let the router pick:
  Claude for code, Gemini for product and research, Grok for right-now questions, and all three as a panel
  for decisions. "Convene the council to…" starts a real session, and you approve the PRD from your phone.
  Android first. In development on [`feat/charm-bridge`](https://github.com/goshtasb/OpenCouncil/tree/feat/charm-bridge).
- **More real runs** — live councils are still single digits. Every run, good or bad, goes into
  [Discussions → Show and tell](https://github.com/goshtasb/OpenCouncil/discussions/categories/show-and-tell) so the stall rate is public.
- **Showcases on real repositories** — council runs on open-source issues, written up in `docs/showcase/` with the objections, the rulings and the pull request.

## Next

- **MCP server** — `council_open`, `council_deliberate`, `council_status`, `council_approve` as MCP tools, so Cursor, Codex and Gemini CLI users can drive a council without the CLI. Not started; the agent skill (`npx skills add goshtasb/OpenCouncil`) covers those agents through their shell for now.
- **Ollama adapter verified end to end** ([#2](https://github.com/goshtasb/OpenCouncil/issues/2)) — a fully local council.
- **Measured stall rate** — v0.2.0 arbitrates early and keeps a partial result on a stall; the next step is enough runs to say what the stall rate is now.
- **Session replay** — share a council transcript as a page, the way the demo in the README was made.

## Later

- iOS Charm.
- Windows support without WSL.

## Shipped

See [CHANGELOG.md](CHANGELOG.md) and [Releases](https://github.com/goshtasb/OpenCouncil/releases).
