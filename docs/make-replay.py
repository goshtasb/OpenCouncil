#!/usr/bin/env python3
"""Renders a council session directory into a Markdown replay page.

Usage: make-replay.py <session-dir> <out.md> [--exec <execution-checkout>] [--title "..."] [--note "..."]

Everything on the page is copied from the session's own files (task.md, plan-v*.md, changes-v*.md,
round-*/reply.md, review-*/, signoff-*/, architect-rulings.json, verification/latest.json,
stalled-draft-and-objections.md) and, with --exec, from the execution checkout's git history.
Nothing is summarised or rewritten; absolute paths are shortened.
"""
import argparse, datetime as dt, json, os, re, subprocess, sys

def read(p):
    try:
        with open(p, encoding='utf-8') as f: return f.read()
    except FileNotFoundError: return None

def scrub(s):
    s = re.sub(r'/root/\.council/', '~/.council/', s)
    s = re.sub(r'/home/[^/\s]+/\.council/', '~/.council/', s)
    s = re.sub(r'/Users/[^/\s]+/\.council/', '~/.council/', s)
    s = re.sub(r'/tmp/claude[^\s`\'")]*/runs/([a-z-]+)', r'<local copy of \1>', s)
    return s

def details(summary, body, lang=''):
    fence = '````' if '```' in body else '```'
    return f"<details>\n<summary>{summary}</summary>\n\n{fence}{lang}\n{body.strip()}\n{fence}\n\n</details>\n"

def quote(body):
    return '\n'.join('> ' + l if l.strip() else '>' for l in body.strip().splitlines()) + '\n'

ap = argparse.ArgumentParser()
ap.add_argument('session'); ap.add_argument('out')
ap.add_argument('--exec', dest='execdir'); ap.add_argument('--title'); ap.add_argument('--note', default='')
a = ap.parse_args()
S = a.session
meta = json.loads(read(os.path.join(S, 'meta.json')))
task = read(os.path.join(S, 'task.md')) or ''
hist = read(os.path.join(S, 'HISTORY.log')) or ''
status = json.loads(read(os.path.join(S, 'STATUS.json')) or '{}')

events = []
for line in hist.splitlines():
    m = re.match(r'\[(.+?)\] (.*)', line)
    if m: events.append((dt.datetime.fromisoformat(m.group(1).replace('Z', '+00:00')), m.group(2)))
t0 = events[0][0] if events else None
def rel(t):
    s = int((t - t0).total_seconds()); return f"{s//60:02d}:{s%60:02d}"

rounds = sorted(int(d.split('-')[1]) for d in os.listdir(S) if re.match(r'round-\d+$', d))
stalled = read(os.path.join(S, 'stalled-draft-and-objections.md'))
prd = read(os.path.join(S, 'brief-and-prd.md'))

out = []
title = a.title or meta['slug']
out.append(f"# Replay: {title}\n")
out.append(f"Session `{meta['id']}`, {meta.get('profile','standard')} profile, base commit `{meta['baseSha'][:7]}`, round budget {meta['maxRounds']} plus {meta.get('signoffRevisions',0)} sign-off revision. Outcome: **{status.get('status','?')}**.\n")
if a.note: out.append(a.note.strip() + "\n")
out.append("Every quoted block below is the seat's reply exactly as the harness saved it. Nothing is summarised.\n")
out.append("## The task\n\n" + quote(task))
out.append("## Timeline\n\n| Time | Event |\n|---|---|")
for t, e in events:
    out.append(f"| {rel(t)} | {scrub(e).replace('|','/')} |")
out.append("")

rulings = json.loads(read(os.path.join(S, 'architect-rulings.json')) or '[]')
if rulings:
    out.append("## Binding rulings from the Chief Architect\n")
    for r in rulings:
        out.append(f"**Ruling {r.get('id')}** (asked by {r.get('askedBy','?')}, {r.get('stage','')})\n")
        out.append(quote("Q: " + r.get('question','')) + "\n" + quote("Ruling: " + r.get('ruling','')))

for n in rounds:
    out.append(f"## Round {n}\n")
    if n == 1:
        out.append(details("Lead PM: draft v1 (full text)", scrub(read(os.path.join(S, 'plan-v1.md')) or ''), 'markdown'))
    else:
        ch = read(os.path.join(S, f'changes-v{n}.md'))
        if ch: out.append(f"**Lead PM: what changed in v{n}**\n\n" + quote(scrub(ch)))
        pv = read(os.path.join(S, f'plan-v{n}.md'))
        if pv: out.append(details(f"Draft v{n} (full text)", scrub(pv), 'markdown'))
    rp = read(os.path.join(S, f'round-{n:02d}', 'reply.md'))
    if rp: out.append(f"**Chief Engineer: review of v{n}**\n\n" + quote(scrub(rp)))
    rv = read(os.path.join(S, f'review-{n:02d}', 'reply.md'))
    if rv: out.append(f"**Chief Architect: sign-off review of v{n}**\n\n" + quote(scrub(rv)))
    so = read(os.path.join(S, f'signoff-{n:02d}', 'reply.md'))
    if so: out.append(f"**Lead PM: final sign-off on v{n}**\n\n" + quote(scrub(so)))

if prd:
    sha = ''
    sj = [d for d in os.listdir(S) if d.startswith('signoff-')]
    if sj:
        j = json.loads(read(os.path.join(S, sorted(sj)[-1], 'signoff.json')) or '{}'); sha = j.get('planSha256','')
    out.append(f"## The signed-off PRD\n\nSHA-256 `{sha}`. The operator approves this exact hash with `APPROVE {sha[:8]}`.\n")
    out.append(details("Final PRD (full text)", scrub(prd), 'markdown'))
if stalled:
    out.append("## Stalled: what the harness kept\n\nNo document reached the operator. The harness wrote the last draft and the open objections instead:\n")
    out.append(details("stalled-draft-and-objections.md", scrub(stalled), 'markdown'))

ver = read(os.path.join(S, 'verification', 'latest.json'))
if ver:
    v = json.loads(ver)
    out.append(f"## Verification gates\n\nRun on `{v.get('headSha','')[:7]}`. Overall: **{'PASS' if v.get('passed') else 'FAIL'}**.\n")
    for g in v.get('gates', []):
        out.append(f"- `{g['name']}`: `{g['command']}`, exit {g.get('exitCode')}, {g.get('durationMs',0)/1000:.1f} s, **{'PASS' if g.get('passed') else 'FAIL'}**")
        out.append(details(f"Output of {g['name']}", scrub(g.get('output','')[-6000:])))
if a.execdir:
    log = subprocess.run(['git', 'log', '--format=%h %s', f"{meta['baseSha']}..HEAD"], cwd=a.execdir, capture_output=True, text=True).stdout
    diff = subprocess.run(['git', 'diff', f"{meta['baseSha']}..HEAD"], cwd=a.execdir, capture_output=True, text=True).stdout
    out.append("## What the Chief Engineer committed\n\n```\n" + log.strip() + "\n```\n")
    out.append(details("Full diff", diff, 'diff'))
d = status.get('details') or {}
if d.get('blockedReason'):
    out.append("## Why it ended BLOCKED\n\n" + quote(scrub(d['blockedReason'])[:3000]))

with open(a.out, 'w', encoding='utf-8') as f: f.write('\n'.join(out) + '\n')
print(a.out, sum(len(x) for x in out), 'chars')
