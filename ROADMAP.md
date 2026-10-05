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

## Next

- **Publish to npm** so install is `npm i -g open-council` instead of a tarball URL.
- **Ollama adapter verified end to end** ([#2](https://github.com/goshtasb/OpenCouncil/issues/2)) — a fully local council.
- **Faster stalls** — detect a council that cannot converge earlier, so a stall costs minutes, not quota.
- **Session replay** — share a council transcript as a page, the way the demo in the README was made.

## Later

- iOS Charm.
- Windows support without WSL.

## Shipped

See [CHANGELOG.md](CHANGELOG.md) and [Releases](https://github.com/goshtasb/OpenCouncil/releases).
