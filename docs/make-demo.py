#!/usr/bin/env python3
"""Renders docs/demo.svg: an animated replay of a real council session.

Every line below is taken from the transcript of session 20260917213447-gates-command
(logs under ~/.councilmen/projects/<repo>-<hash>/sessions/<id>/HISTORY.log and the run output).
This is a replay of a real run, not a mock-up and not a live screencast.
"""
import html

# (delay_seconds, text, colour_key)
C = {
    "prompt": "#7ef0ff", "cmd": "#e8f5c8", "pm": "#ff79c6", "eng": "#79b8ff",
    "arch": "#ffcc66", "harness": "#8be9fd", "op": "#8bac0f", "ok": "#5af78e", "dim": "#8a8f80",
}
LINES = [
    (0.0,  "$ councilmen open gates-command --item 002", "cmd"),
    (1.0,  "20260917213447-gates-command", "dim"),
    (1.6,  "$ councilmen deliberate 20260917213447-gates-command", "cmd"),
    (2.6,  "[LEAD PM] Drafting v1...                            Gemini", "pm"),
    (4.2,  "[CHIEF ENGINEER] Round 1: SHIP WITH CHANGES, objections 6    Claude", "eng"),
    (5.8,  "[CHIEF ARCHITECT] Ruling on 1 undefined-rule question...     Grok", "arch"),
    (7.2,  "[LEAD PM] Revising v2...", "pm"),
    (8.4,  "[CHIEF ENGINEER] Round 2: SHIP WITH CHANGES, objections 3", "eng"),
    (9.6,  "[LEAD PM] Revising v3...", "pm"),
    (10.8, "[CHIEF ENGINEER] Round 3: SHIP WITH CHANGES, objections 3", "eng"),
    (12.0, "[LEAD PM] Revising v4...", "pm"),
    (13.2, "[CHIEF ENGINEER] Round 4: SHIP IT, open objections 0", "eng"),
    (14.8, "[CHIEF ARCHITECT] Verdict on v4: SIGN-OFF (required 0, advisory 0)", "arch"),
    (16.2, "[LEAD PM] Sign-off on v4: SIGN-OFF", "pm"),
    (17.4, "[HARNESS] Deliverable finalized: brief-and-prd.md", "harness"),
    (18.4, "[OPERATOR] PRD for approval (PDF): brief-and-prd.pdf", "op"),
    (19.6, "Agreed and signed off after 4 round(s).", "dim"),
    (21.0, "$ councilmen approve 20260917213447-gates-command \"APPROVE 41f920af\"", "cmd"),
    (22.4, "✔ Session successfully APPROVED.   <- the only human step", "ok"),
    (23.6, "$ councilmen run 20260917213447-gates-command", "cmd"),
    (24.8, "[CHIEF ENGINEER] Autonomous execution attempt 1/3...", "eng"),
    (26.6, "[HARNESS] Merged origin/main before verification.", "harness"),
    (27.6, "[HARNESS] Gate build: npm run build", "harness"),
    (28.4, "✔ Gate build passed (0.6s)", "ok"),
    (29.2, "[HARNESS] Gate test: npm test", "harness"),
    (30.0, "✔ Gate test passed (2.2s)", "ok"),
    (31.2, "✔ Pull Request: github.com/goshtasb/OpenCouncilmen/pull/1", "ok"),
    (32.2, "Execution finished with outcome: DONE", "ok"),
]
TOTAL = 38.0
W, H, LH, TOP, LEFT, FS = 940, 700, 21, 96, 26, 14.5

def pct(t):
    return round(t / TOTAL * 100, 3)

css = [
    ".t{font-family:'SF Mono',Menlo,Consolas,'DejaVu Sans Mono',monospace;font-size:%gpx;white-space:pre}" % FS,
    ".c{opacity:0}",
]
for i, (t, _, _) in enumerate(LINES):
    p = pct(t)
    css.append(
        f"@keyframes l{i}{{0%{{opacity:0}}{max(p-0.15,0)}%{{opacity:0}}{p}%{{opacity:1}}98%{{opacity:1}}100%{{opacity:0}}}}"
    )
    css.append(f".l{i}{{animation:l{i} {TOTAL}s infinite}}")

rows = []
for i, (t, text, key) in enumerate(LINES):
    y = TOP + i * LH
    rows.append(
        f'<text class="t c l{i}" x="{LEFT}" y="{y}" fill="{C[key]}">{html.escape(text)}</text>'
    )

svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" role="img"
     aria-label="A real Open Councilmen session: Gemini drafts a PRD, Claude objects four times, Grok rules and signs off, the operator approves, gates pass, a pull request opens.">
<style>{''.join(css)}</style>
<rect width="{W}" height="{H}" rx="10" fill="#0d1117"/>
<rect width="{W}" height="38" rx="10" fill="#161b22"/><rect y="28" width="{W}" height="10" fill="#161b22"/>
<circle cx="22" cy="19" r="6" fill="#ff5f56"/><circle cx="42" cy="19" r="6" fill="#ffbd2e"/><circle cx="62" cy="19" r="6" fill="#27c93f"/>
<text class="t" x="86" y="24" fill="#8a8f80" font-size="12.5">open-councilmen — a real session, replayed from its transcript</text>
<text class="t" x="{LEFT}" y="64" fill="#5af78e" font-size="12.5">Lead PM: Gemini (Antigravity)   Chief Engineer: Claude Code   Chief Architect: Grok</text>
{chr(10).join(rows)}
</svg>'''
open("docs/demo.svg", "w").write(svg)
print(f"docs/demo.svg written: {len(svg)} bytes, {len(LINES)} lines, {TOTAL}s loop")
