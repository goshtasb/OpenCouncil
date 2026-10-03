# The Charm

A phone voice companion for the council. Your phone is the face and the voice; your Mac runs
Claude Code, Antigravity (Gemini) and Grok on the subscriptions the council already uses. No API keys.

```
phone (Charm app) ──HTTPS, tailnet only──▶ tailscale serve ──▶ council charm (127.0.0.1:4322) ──▶ claude / agy / grok
```

## Who answers

1. **You name one** — "ask Grok…", "Gemini, …", "Claude: …" (common mishearings accepted), or long-press a face in the app.
2. **Keyword rules** (free, instant) — each mind keeps its council lane:
   - **Claude** (Chief Engineer): code, your repos, debugging, reasoning, writing and editing.
   - **Gemini** (Lead PM / Synapse): product, brainstorming, research, plans, explanations.
   - **Grok** (Chief Architect): right-now questions (news, X, markets), blunt opinions, making the call.
   - Decisions ("should I…", "X vs Y") go to the **panel**: all three answer, Grok rules.
3. **Router model** — if the rules are unsure, Claude Haiku picks (one short call).
4. **Default** — Claude.

"Convene the council to …" starts a real council session. Build requests that don't say so only get an
*offer* to convene, so quota is never spent unasked. When the PRD is signed off, the phone notifies you
and you approve (or approve-and-build) from the app.

Naming a project from `charm.projects` lets Claude read that repo read-only. Gemini and Grok always run in an
empty scratch directory. Every route is logged to `~/.council/projects/<repo>/charm/routes.jsonl`;
`council charm route "…"` shows a decision without asking anyone — use it to tune the rules.

## Setup (once)

On the Mac, in the repo you want the council to work on:

```bash
npm install -g <this branch's tarball or `npm link` from a clone>
council charm doctor          # every brain + router answers PONG
council charm                 # starts the bridge on 127.0.0.1:4322 (leave running)
tailscale serve --bg 4322     # HTTPS on https://<mac>.<tailnet>.ts.net, visible only to your devices
council charm token           # paste into the app
```

On the phone: install Tailscale and sign in to the same tailnet, install the Charm APK, open Settings,
paste the `https://…ts.net` URL and the token, tap **Save & test**.

Optional: Settings → Apps → Default apps → Digital assistant app → **Charm** (long-press power summons it),
and add the **Charm** Quick Settings tile.

## Build the APK

Android Studio: open `charm-android/`, Run. Or `cd charm-android && ./gradlew assembleRelease`
(needs the Android SDK). The `charm-android` GitHub workflow builds it on push and attaches the APK as an artifact.

## Limits

- Your Mac must be awake, online and running `council charm`.
- Each reply starts a CLI, so expect several seconds; a panel takes longer (three answers plus a ruling).
- Use the CLIs on your own subscriptions for yourself only; don't share the bridge with other people.
