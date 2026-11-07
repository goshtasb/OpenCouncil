#!/usr/bin/env python3
"""Renders docs/demo-terminal.gif from the real output of `council demo`.

It runs the built CLI (`node bin/council.js demo --fast` with colour forced on), keeps its text and
colours exactly, and reveals it one beat at a time in a scrolling terminal window. Nothing is typed in
by hand: if the recorded session or the playback changes, re-run this and the GIF follows.

Usage: python3 docs/make-demo-gif.py [out.gif] [--mp4 out.mp4]
Needs Pillow and the DejaVu Sans Mono font; --mp4 also needs ffmpeg.
"""
import os, re, subprocess, sys
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
args = sys.argv[1:]
mp4 = None
if '--mp4' in args:
    i = args.index('--mp4'); mp4 = args[i + 1]; del args[i:i + 2]
OUT = args[0] if args else os.path.join(ROOT, 'docs', 'demo-terminal.gif')

COLS, ROWS, FS = 100, 30, 15
FONT_DIR = '/usr/share/fonts/truetype/dejavu/'
REG = ImageFont.truetype(FONT_DIR + 'DejaVuSansMono.ttf', FS)
BOLD = ImageFont.truetype(FONT_DIR + 'DejaVuSansMono-Bold.ttf', FS)
CW = round(REG.getlength('M')); LH = FS + 6
PAD, BAR = 18, 34
W, H = PAD * 2 + CW * COLS, BAR + PAD * 2 + LH * ROWS

BG, FG, DIM, BARC = (24, 24, 27), (226, 226, 222), (128, 128, 136), (40, 40, 44)
ANSI = {31: (255, 121, 121), 32: (126, 231, 135), 33: (241, 196, 15), 34: (121, 168, 255),
        35: (217, 140, 255), 36: (86, 220, 220), 37: FG, 90: DIM}

env = dict(os.environ, FORCE_COLOR='1')
raw = subprocess.run(['node', os.path.join(ROOT, 'bin', 'council.js'), 'demo', '--fast'],
                     capture_output=True, text=True, env=env, cwd=ROOT, check=True).stdout

def parse(line):
    """ANSI SGR line -> list of (text, colour, bold)."""
    spans, colour, bold, dim = [], None, False, False
    for part in re.split(r'(\x1b\[[0-9;]*m)', line):
        m = re.fullmatch(r'\x1b\[([0-9;]*)m', part)
        if m:
            for code in [int(c or 0) for c in m.group(1).split(';')]:
                if code == 0: colour, bold, dim = None, False, False
                elif code == 1: bold = True
                elif code == 2: dim = True
                elif code == 22: bold = dim = False
                elif code == 39: colour = None
                elif code in ANSI: colour = ANSI[code]
        elif part:
            spans.append((part, DIM if dim and colour is None else (colour or FG), bold))
    return spans

lines = [parse(l) for l in raw.rstrip('\n').split('\n')]
prompt = [[('$ ', ANSI[32], True), ('npx open-council-cli demo', FG, True)]]

# Beats are separated by blank lines; each is revealed whole. The header is the first beat.
beats, cur = [], []
for l in lines:
    if not ''.join(t for t, _, _ in l).strip():
        if cur: beats.append(cur); cur = []
    else:
        cur.append(l)
if cur: beats.append(cur)

def text_of(beat):
    return ' '.join(''.join(t for t, _, _ in l) for l in beat)

def hold(beat):
    """Seconds to keep a beat on screen before the next one: reading pace, longer for the catch."""
    t = text_of(beat)
    secs = min(3.0, 0.7 + len(t.split()) * 0.045)
    if 'already fails at the baseline' in t: secs = 6.0
    if 'Outcome:' in t: secs = 3.5
    return secs

def render(rows):
    img = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, W, BAR], fill=BARC)
    for i, c in enumerate([(255, 95, 86), (255, 189, 46), (39, 201, 63)]):
        d.ellipse([PAD + i * 22, 11, PAD + i * 22 + 12, 23], fill=c)
    title = 'council demo'
    d.text(((W - REG.getlength(title)) / 2, 9), title, font=REG, fill=DIM)
    y = BAR + PAD
    for row in rows[-ROWS:]:
        x = PAD
        for t, colour, bold in row:
            d.text((x, y), t, font=BOLD if bold else REG, fill=colour)
            x += CW * len(t)
        y += LH
    return img

frames, durations, screen = [], [], []
screen += prompt
frames.append(render(screen)); durations.append(1200)
for n, beat in enumerate(beats):
    if n: screen.append([])
    screen += beat
    frames.append(render(screen)); durations.append(int(hold(beat) * 1000))
durations[-1] = 6000

frames[0].save(OUT, save_all=True, append_images=frames[1:], duration=durations, loop=0, optimize=True)
print(f'{OUT}: {len(frames)} frames, {sum(durations) / 1000:.1f} s, {os.path.getsize(OUT) // 1024} KB, {W}x{H}')

if mp4:
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', OUT, '-movflags', 'faststart', '-pix_fmt', 'yuv420p',
                    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-crf', '18', mp4], check=True)
    print(f'{mp4}: {os.path.getsize(mp4) // 1024} KB')
