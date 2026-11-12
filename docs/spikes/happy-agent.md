# Spike: running council seats through happy-agent

Status: experiment on branch `spike/happy-agent-seat`. Not for merge as is. Nothing here changes
defaults; both adapters load only with `COUNCIL_EXPERIMENTAL_ADAPTERS=1`.

## Question

Can [happy-agent](https://github.com/slopus/happy-agent) (MIT; adapted Grok Build parts Apache-2.0)
run OpenCouncil seats better than our own per-CLI adapters, specifically for:

- #46: the Antigravity plan seat is not read-only (`--disable-slash-commands` makes `agy` ignore
  `--mode plan`, and plan seats also get `--dangerously-skip-permissions`).
- #45: a failing seat should fail fast so seat failover can take over.

## What was built

- `src/adapters/happy-agent.ts`: provider `happy-agent`. Talks to a running daemon over its Unix
  socket API. The seat's model is a Happy model ID (`antigravity/gemini-4-argon`,
  `anthropic/opus-5`); the provider is looked up in `GET /v0/config`. Each call opens a fresh
  agent, sends with `permissionMode` mapped (`plan` to `read_only`), polls the run, and turns a
  `failed` or `aborted` run into an error.
- `src/adapters/acp.ts`: provider `antigravity-acp`. Speaks the Agent Client Protocol directly to
  `agy acp` over stdio, with no daemon. Read-only seats set the agent's `mode` option to `plan`,
  refuse every `session/request_permission`, and advertise no filesystem or terminal capability.
  This is the same mechanism happy-agent uses for its Read only mode on Antigravity.
- `test/fixtures/fake-acp-agent.cjs`: a scripted ACP agent (asks to write, dies mid-turn, hangs).
- `scripts/spike/agy-readonly-probe.cjs`: the check that needs a real, signed-in `agy`.

## What was verified here (Linux, no Gemini login)

Against the real Happy Agent 2026.11.5 daemon, with the fake agent configured as an ACP harness:

| Check | Result |
| --- | --- |
| Read only seat, agent asks to write a file | Ask refused, file not written |
| Agent process dies mid-turn | Run `failed` with "ACP connection closed" in under 1 second |
| `antigravity` harness with no `agy` login | Run failed after about 61 seconds with agy's sign-in message |
| Daemon killed | Client gets ECONNREFUSED at once; adapter reports "daemon is not running" |

The direct ACP adapter passes the same scenarios in `test/acp-adapter.test.cjs` (write refused,
death reported in under 100 ms, hang times out, missing command is a clear error).

Things learned on the way:

- On Antigravity, happy-agent does not sandbox the agent. Foreign harnesses run their own tools
  outside happy-agent's Seatbelt/Bubblewrap sandbox; Read only means agy's `plan` mode plus
  refusing agy's permission asks. Whether that stops writes is up to agy, which the probe checks.
- happy-agent wraps every seat prompt in its own instructions (about 15 KB, "You are Happy
  Agent..."), so seat personas no longer arrive alone.
- The 2026.11.5 release binary launches Antigravity through the third-party npm package
  `antigravity-acp` via `npx` when the harness is enabled; the main branch has since moved to
  agy's own `agy acp` (agy 1.5.5 or newer).
- Install: one platform tarball of 232 to 269 MB (no npm or Homebrew package), a background
  daemon (about 245 MB resident when idle), and a socket path short enough for a Unix socket.

## Still to check on a Mac with agy signed in

```sh
cd ~ && { [ -d oc-spike ] || git clone -q https://github.com/goshtasb/OpenCouncil.git oc-spike; } && cd oc-spike && git fetch -q origin spike/happy-agent-seat && git checkout -q FETCH_HEAD && npm ci --silent && npm run build --silent && node scripts/spike/agy-readonly-probe.cjs > ~/Desktop/agy-readonly-probe.txt 2>&1; sed -n '/^B\. /,$p' ~/Desktop/agy-readonly-probe.txt
```

Section B of the report answers #46 for the ACP path; section A reproduces it on today's path;
section C is the control that shows the prompt really makes agy write. Section P runs first and
picks a model that answers at all; agy's "quota reached" notice is reported as no result, never as a
block. The first two Mac runs (Nov 11) hit that quota on every call, so they tested nothing.
