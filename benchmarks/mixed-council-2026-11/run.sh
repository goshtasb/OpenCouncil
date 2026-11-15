#!/bin/bash
# Mixed council vs one agent, pre-registered in README.md next to this file.
#
#   bash run.sh                      preflight, then every task x arm (mixed, single) x 3 runs, judged; re-run to resume
#   PREFLIGHT_ONLY=1 bash run.sh     check every CLI is signed in and answers, then stop
#   RUNS_SINGLE=10 bash run.sh       e.g. raise the single agent to 10 runs per task (noise floor)
#   ARMS="mixed single solo" bash run.sh  also run the all-Claude council (secondary arm)
#   GROK_MODEL=grok-4.7 bash run.sh  pin the Grok model (default: the newest plain grok-N.N that `grok models` lists)
#   LEAD_CANDIDATES="gemini-4-argon-high gemini-3.8-flash-high auto" bash run.sh
#                                    try these Lead PM models in order and use the first that answers ("auto" adds
#                                    every other Gemini model `agy models` lists). Any model but the pre-registered one
#                                    is a deviation: it is recorded in results/deviations.txt and reported separately.
#
# Runs on the CLIs' own sign-ins (Claude Code, Antigravity, Grok). API keys in the environment are
# ignored for this run so nothing is billed to a key. Nothing is pushed, posted or published:
# each task is a local checkout of a public pull request (pinned in tasks.json), reviewed read-only
# (plan mode, nothing installed or run), and results stay in $BENCH_ROOT.
set -u
BENCH=$(cd "$(dirname "$0")" && pwd)
ROOT=${BENCH_ROOT:-$HOME/oc-bench}
RES=$ROOT/results
CLI_VERSION=0.3.2
PREREG_LEAD_MODEL=gemini-4-argon-high   # pre-registered Lead PM, and the Gemini cross-check judge's model
LEAD_CANDIDATES=${LEAD_CANDIDATES:-$PREREG_LEAD_MODEL}
LEAD_MODEL=$PREREG_LEAD_MODEL           # set by the preflight to the first candidate that answers
GEMINI_JUDGE_MODEL=$PREREG_LEAD_MODEL
ENGINEER_MODEL=opus
SOLO_SIDE_MODEL=sonnet
RUNS=${RUNS:-3}
ARMS=${ARMS:-"mixed single"}   # add solo for the all-Claude council: ARMS="mixed single solo"
PARALLEL=${PARALLEL:-2}
COUNCIL_TIMEOUT=${COUNCIL_TIMEOUT:-2700}
SINGLE_TIMEOUT=${SINGLE_TIMEOUT:-1800}
JUDGE_MODEL=opus
JUDGE_TIMEOUT=${JUDGE_TIMEOUT:-900}
CACHE=$ROOT/repos
# Antigravity asking to sign in again (it opens a browser page and waits for a code it can't get here).
SIGNIN_RE='accounts\.google\.com|paste (this|the) code|authorization code|(sign|log) ?in (again|required|to continue)|not (signed|logged) in|re-?authenticat'
LIMIT_RE='usage limit|limit reached|rate.limit|quota|resource.exhausted|too many requests|credit balance|out of credits|exceeded your|try again (later|in)'
mkdir -p "$ROOT/bin" "$ROOT/tool" "$RES" "$CACHE"

say() { printf '%s\n' "$*" | tee -a "$RES/preflight.txt"; }
die() { say "STOP: $*"; exit 1; }
# Kills a command after N seconds (macOS has no `timeout`); the alarm survives exec.
with_timeout() { local s=$1; shift; perl -e 'alarm shift; exec @ARGV or die "exec failed: $!"' "$s" "$@"; }
# The real binary for a CLI, skipping this script's wrappers.
real_bin() { PATH=$(printf %s "$PATH" | tr ':' '\n' | grep -vx "$ROOT/bin" | paste -sd: -) command -v "$1"; }
runs_for() { case $1 in mixed) echo "${RUNS_MIXED:-$RUNS}";; solo) echo "${RUNS_SOLO:-$RUNS}";; single) echo "${RUNS_SINGLE:-$RUNS}";; esac; }
has_arm() { case " $ARMS " in *" $1 "*) return 0;; *) return 1;; esac; }

# ---------------------------------------------------------------- environment
for v in ANTHROPIC_API_KEY XAI_API_KEY GROK_API_KEY GEMINI_API_KEY GOOGLE_API_KEY GOOGLE_GENAI_USE_VERTEXAI; do
  if [ -n "$(printenv "$v" 2>/dev/null)" ]; then echo "Ignoring $v for this run, so the seats use your plan sign-ins."; unset "$v"; fi
done
unset CLAUDECODE CLAUDE_CODE_ENTRYPOINT CLAUDE_CODE_SESSION_ID 2>/dev/null
# Claude Code updates itself in the background; mid-run that briefly removes the binary every seat and
# judge call goes through (seen on an npm install under nvm). Updates wait until the benchmark ends.
export DISABLE_AUTOUPDATER=1
: > "$RES/preflight.txt"
rm -f "$RES/STOP"

command -v node >/dev/null || die "Node.js is not installed. Install it from https://nodejs.org (version 18 or newer)."
node -e 'process.exit(+process.versions.node.split(".")[0] >= 18 ? 0 : 1)' || die "Node $(node -v) is too old; install Node 18 or newer."
for c in git perl npm tar; do command -v $c >/dev/null || die "$c is not installed."; done

REAL_CLAUDE=$(real_bin claude) || die "Claude Code is not installed: curl -fsSL https://claude.ai/install.sh | bash, then run claude once to sign in."
# The Claude binary for one call: the one found at start, or, if it has moved since (an update that
# started before this run), wait for it and look it up again.
claude_bin() {
  local i=0
  while [ ! -x "$REAL_CLAUDE" ] && [ $i -lt 12 ]; do sleep 5; i=$((i + 1)); done
  [ -x "$REAL_CLAUDE" ] || REAL_CLAUDE=$(real_bin claude) || REAL_CLAUDE=claude-not-found
  printf '%s' "$REAL_CLAUDE"
}
REAL_AGY=""; REAL_GROK=""
JUDGES=${JUDGES:-"claude gemini"}
if has_arm mixed || [[ " $JUDGES " == *" gemini "* ]]; then
  REAL_AGY=$(real_bin agy) || die "The Antigravity CLI (agy) is not installed; the mixed arm (and the Gemini cross-check judge) needs it."
fi
if has_arm mixed; then
  for g in "${GROK_BIN:-}" "$HOME/.grok/bin/grok" "$(real_bin grok 2>/dev/null)"; do
    [ -n "$g" ] && [ -x "$g" ] && [ "$g" != "$ROOT/bin/grok" ] && { REAL_GROK=$g; break; }
  done
  [ -n "$REAL_GROK" ] || die "The Grok CLI is not installed; the mixed arm needs it for the Chief Architect seat."
fi

# ---------------------------------------------------------------- open-council-cli, from the public registry
installed=$(node -p "require('$ROOT/tool/node_modules/open-council-cli/package.json').version" 2>/dev/null)
if [ "$installed" != "$CLI_VERSION" ]; then
  echo "Installing open-council-cli@$CLI_VERSION into $ROOT/tool"
  (cd "$ROOT/tool" && { [ -f package.json ] || echo '{"private":true}' > package.json; } &&
   npm install --no-audit --no-fund --ignore-scripts --registry=https://registry.npmjs.org/ "open-council-cli@$CLI_VERSION" >/dev/null) || die "npm install open-council-cli@$CLI_VERSION failed."
fi
COUNCIL_JS=$ROOT/tool/node_modules/open-council-cli/bin/council.js
[ -f "$COUNCIL_JS" ] || die "open-council-cli is missing from $ROOT/tool."

# ---------------------------------------------------------------- wrappers that log every seat call
# Each run sets BENCH_CALLS_LOG; the wrappers append one JSON line per model call (model, seconds, and
# for Claude the tokens and API-price cost it reports). They change nothing about the call itself,
# except that Claude is asked for JSON and its text answer is printed exactly as the council expects.
cat > "$ROOT/bin/claude" <<SHIM
#!/bin/bash
REAL="$REAL_CLAUDE"
i=0; while [ ! -x "\$REAL" ] && [ \$i -lt 12 ]; do sleep 5; i=\$((i + 1)); done
if [ ! -x "\$REAL" ]; then
  REAL=\$(PATH=\$(printf %s "\$PATH" | tr ':' '\\n' | grep -vx "$ROOT/bin" | paste -sd: -) command -v claude) || { echo "claude not found (it moved during the run)" >&2; exit 127; }
fi
is_p=0; has_fmt=0; model=""; prev=""
for a in "\$@"; do
  [ "\$a" = -p ] && is_p=1
  case "\$a" in --output-format|--output-format=*) has_fmt=1;; esac
  [ "\$prev" = --model ] && model=\$a
  prev=\$a
done
if [ \$is_p = 0 ] || [ \$has_fmt = 1 ] || [ -z "\${BENCH_CALLS_LOG:-}" ]; then exec "\$REAL" "\$@"; fi
t0=\$(date +%s); tmp=\$(mktemp)
"\$REAL" "\$@" --output-format json > "\$tmp"; code=\$?
node "$BENCH/lib/claude-json.cjs" "\$tmp" "\$BENCH_CALLS_LOG" "\$model" "\$(( \$(date +%s) - t0 ))" "\$code"
rm -f "\$tmp"; exit \$code
SHIM
if [ -n "$REAL_AGY" ]; then cat > "$ROOT/bin/agy" <<SHIM
#!/bin/bash
REAL="$REAL_AGY"
case " \$* " in *" -p "*) ;; *) exec "\$REAL" "\$@";; esac
[ -n "\${BENCH_CALLS_LOG:-}" ] || exec "\$REAL" "\$@"
model=""; mode=""; prev=""
for a in "\$@"; do [ "\$prev" = --model ] && model=\$a; [ "\$prev" = --mode ] && mode=\$a; prev=\$a; done
# stderr is passed on unchanged and also kept next to the run's call log, where run.sh looks for a sign-in prompt.
t0=\$(date +%s); err=\$(mktemp); "\$REAL" "\$@" 2> "\$err"; code=\$?
cat "\$err" >&2; cat "\$err" >> "\$(dirname "\$BENCH_CALLS_LOG")/agy-stderr.log"; rm -f "\$err"
printf '{"vendor":"gemini","model":"%s","mode":"%s","seconds":%s,"code":%s}\n' "\$model" "\$mode" "\$(( \$(date +%s) - t0 ))" "\$code" >> "\$BENCH_CALLS_LOG"
exit \$code
SHIM
fi
if [ -n "$REAL_GROK" ]; then cat > "$ROOT/bin/grok" <<SHIM
#!/bin/bash
REAL="$REAL_GROK"
case " \$* " in *" --prompt-file "*|*" -p "*) ;; *) exec "\$REAL" "\$@";; esac
[ -n "\${BENCH_CALLS_LOG:-}" ] || exec "\$REAL" "\$@"
model=""; prev=""
for a in "\$@"; do { [ "\$prev" = -m ] || [ "\$prev" = --model ]; } && model=\$a; prev=\$a; done
t0=\$(date +%s); "\$REAL" "\$@"; code=\$?
printf '{"vendor":"grok","model":"%s","seconds":%s,"code":%s}\n' "\$model" "\$(( \$(date +%s) - t0 ))" "\$code" >> "\$BENCH_CALLS_LOG"
exit \$code
SHIM
fi
chmod +x "$ROOT"/bin/*
export PATH="$ROOT/bin:$PATH"
[ -n "$REAL_GROK" ] && export GROK_BIN="$ROOT/bin/grok"

# ---------------------------------------------------------------- seat configs
write_config() { # <arm> <file>
  mkdir -p "$(dirname "$2")"
  if [ "$1" = mixed ]; then
    lead="{ provider: antigravity, model: $LEAD_MODEL }"; arch="{ provider: grok-cli, model: $GROK_MODEL }"
  else
    lead="{ provider: claude-code, model: $SOLO_SIDE_MODEL }"; arch="{ provider: claude-code, model: $SOLO_SIDE_MODEL }"
  fi
  cat > "$2" <<YML
version: 1
project: { name: app, base_branch: main, install_command: "", test_command: "", lint_command: "" }
seats:
  lead_pm: $lead
  chief_engineer: { provider: claude-code, model: $ENGINEER_MODEL }
  chief_architect: $arch
YML
}

# ---------------------------------------------------------------- preflight
say "== Preflight $(date '+%Y-%m-%d %H:%M %Z')"
say "open-council-cli $(node -p "require('$ROOT/tool/node_modules/open-council-cli/package.json').version"), node $(node -v), $(uname -sm)"
say "benchmark: $(git -C "$BENCH" log -1 --format='%h %cd' --date=short -- . 2>/dev/null || echo 'not in a git checkout')"
if [ -n "$(git -C "$BENCH" status --porcelain -- . 2>/dev/null)" ]; then say "WARNING: the benchmark files differ from the committed pre-registration."; fi

claude_ping() { # <alias>
  local out; out=$(cd "$ROOT" && with_timeout 180 "$REAL_CLAUDE" -p --model "$1" --strict-mcp-config --output-format json "Reply with the single word ok." 2>&1) || { echo "FAIL $(echo "$out" | tail -3)"; return 1; }
  echo "$out" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);if(j.is_error)throw new Error(j.result);console.log(Object.keys(j.modelUsage||{}).join(", ")+" (answered: "+String(j.result).trim().slice(0,20)+")")}catch(e){console.log("FAIL "+e.message.slice(0,200));process.exit(1)}})'
}
agy_ping() { # <model>  Same shape as the Lead PM's call: plan mode, slash commands off. Prints the reason on failure.
  local out; out=$(cd "$ROOT" && with_timeout 240 "$REAL_AGY" -p "Reply with the single word ok." --output-format text --print-timeout 180s \
          --disable-slash-commands --mode plan --dangerously-skip-permissions --model "$1" 2>&1)
  local code=$?
  if [ $code = 0 ] && printf '%s\n' "$out" | grep -qiE '^[^[:alnum:]]*ok[^[:alnum:]]*$' && ! printf '%s' "$out" | grep -qiE "$LIMIT_RE"; then return 0; fi
  printf '%s' "$out" | grep -v '^[[:space:]]*$' | tail -2 | tr '\n' ' ' | cut -c1-200; return 1
}
say "-- Claude Code: $("$REAL_CLAUDE" --version 2>&1 | head -1)"
m=$(claude_ping "$ENGINEER_MODEL") || die "Claude Code did not answer on '$ENGINEER_MODEL': $m. Run 'claude' once and sign in with your plan, then rerun."
say "   $ENGINEER_MODEL -> $m"
if has_arm solo; then
  m=$(claude_ping "$SOLO_SIDE_MODEL") || die "Claude Code did not answer on '$SOLO_SIDE_MODEL': $m"
  say "   $SOLO_SIDE_MODEL -> $m"
fi

if has_arm mixed; then
  say "-- Antigravity (Gemini): $("$REAL_AGY" --version 2>&1 | head -1)"
  list=$("$REAL_AGY" models 2>/dev/null)
  cands=""
  for c in $LEAD_CANDIDATES; do
    if [ "$c" = auto ]; then
      # Every other Gemini model agy lists, in its order; never a retired id the CLI would silently remap.
      for m in $(printf '%s\n' "$list" | tr -s ' \t,()' '\n' | grep -E '^gemini-[0-9][0-9a-z.-]*$' | awk '!seen[$0]++'); do
        [ "$m" = gemini-3.1-pro-high ] && continue
        case " $cands " in *" $m "*) ;; *) cands="$cands $m";; esac
      done
    else
      case " $cands " in *" $c "*) ;; *) cands="$cands $c";; esac
    fi
  done
  LEAD_MODEL=""; tried=""
  for c in $cands; do
    if [ -n "$list" ] && ! printf '%s\n' "$list" | tr -s ' \t,()' '\n' | grep -qxF -- "$c"; then tried="$tried; $c: not listed by agy"; say "   $c -> not listed by agy models"; continue; fi
    if out=$(agy_ping "$c"); then LEAD_MODEL=$c; break; fi
    tried="$tried; $c: $out"
    say "   $c -> no answer: $out"
  done
  [ -n "$LEAD_MODEL" ] || die "No Lead PM model answered${tried}. Open agy once and sign in, or wait for a quota to reset, then rerun."
  say "   Lead PM $LEAD_MODEL in plan mode -> answered"
  if [ "$LEAD_MODEL" != "$PREREG_LEAD_MODEL" ]; then
    say "   DEVIATION: the pre-registered Lead PM $PREREG_LEAD_MODEL did not answer, so new mixed runs use $LEAD_MODEL."
    dev="$(date '+%Y-%m-%d %H:%M %Z'): Lead PM (mixed arm) is $LEAD_MODEL for runs from now on; the pre-registered $PREREG_LEAD_MODEL did not answer (${tried#; }). Mixed runs are reported separately by Lead PM model."
    grep -qsF "Lead PM (mixed arm) is $LEAD_MODEL " "$RES/deviations.txt" || echo "$dev" >> "$RES/deviations.txt"
  fi

  say "-- Grok: $("$REAL_GROK" --version 2>&1 | head -1)"
  # On a resumed batch, keep the Grok model the batch started with, so the arm doesn't change midway.
  if [ -z "${GROK_MODEL:-}" ] && [ -f "$RES/meta.txt" ]; then
    GROK_MODEL=$(sed -n 's/^architect (mixed): \(grok-[0-9][0-9.]*\)$/\1/p' "$RES/meta.txt" | head -1)
    [ -n "$GROK_MODEL" ] && say "   keeping $GROK_MODEL from the batch's first run"
  fi
  if [ -z "${GROK_MODEL:-}" ]; then
    GROK_MODEL=$("$REAL_GROK" models 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const ids=[...new Set(s.match(/\bgrok-\d+(?:\.\d+)?\b(?![-\w.])/g)||[])];const v=x=>x.slice(5).split(".").map(Number);ids.sort((a,b)=>{const[p,q]=[v(a),v(b)];return (p[0]-q[0])||((p[1]||0)-(q[1]||0))});process.stdout.write(ids.pop()||"")})')
    [ -n "$GROK_MODEL" ] || die "Could not read a grok-N.N model from 'grok models'. Set GROK_MODEL to one it lists, then rerun."
  fi
  pf=$(mktemp); echo "Reply with the single word ok." > "$pf"
  # Same shape as the Chief Architect's call: every tool denied.
  out=$(cd "$ROOT" && with_timeout 240 "$REAL_GROK" -m "$GROK_MODEL" --prompt-file "$pf" --disable-web-search --no-subagents --no-memory \
          --output-format plain --tools none --deny '*' --max-turns 10 2>&1) \
    || die "Grok did not answer on $GROK_MODEL: $(echo "$out" | tail -3). Run 'grok login', or set GROK_MODEL to one that 'grok models' lists, then rerun."
  rm -f "$pf"
  printf '%s' "$out" | grep -qi ok || die "Grok answered something unexpected on $GROK_MODEL: $(echo "$out" | tail -2 | cut -c1-200)"
  say "   $GROK_MODEL with tools off -> answered"

  # The council's own check, through the same adapters the review uses.
  d=$(mktemp -d "${TMPDIR:-/tmp}/cb.XXXXXX"); write_config mixed "$d/.council/config.yml"
  (mkdir -p "$d/app" && cd "$d/app" && git init -q && COUNCIL_HOME="$d/h" with_timeout 600 node "$COUNCIL_JS" doctor) > "$d/doctor.log" 2>&1
  dc=$?; sed 's/^/   /' "$d/doctor.log" | tee -a "$RES/preflight.txt"
  rm -rf "$d"
  [ $dc = 0 ] || die "council doctor found a seat that does not answer (above)."
fi

if [[ " $JUDGES " == *" gemini "* ]]; then
  # The Gemini cross-check judge stays on its pre-registered model; if that has no quota, it is skipped, not swapped.
  if jo=$(agy_ping "$GEMINI_JUDGE_MODEL"); then
    say "-- Gemini judge $GEMINI_JUDGE_MODEL -> answered"
    if grep -qsF "Gemini cross-check judge ($GEMINI_JUDGE_MODEL) did not answer" "$RES/deviations.txt" && ! grep -qsF "Gemini cross-check judge answered again" "$RES/deviations.txt"; then
      echo "$(date '+%Y-%m-%d %H:%M %Z'): the Gemini cross-check judge answered again and judges every run it had missed." >> "$RES/deviations.txt"
    fi
  else
    JUDGES=$(printf '%s' " $JUDGES " | sed 's/ gemini / /; s/^ *//; s/ *$//')
    say "-- Gemini judge $GEMINI_JUDGE_MODEL did not answer ($jo), so it is skipped for this session; runs are scored by the Claude judge only."
    dev="$(date '+%Y-%m-%d %H:%M %Z'): the Gemini cross-check judge ($GEMINI_JUDGE_MODEL) did not answer, so runs judged from now on have no Gemini cross-check until it does; it judges them when a later session reaches it."
    grep -qsF "Gemini cross-check judge" "$RES/deviations.txt" || echo "$dev" >> "$RES/deviations.txt"
  fi
fi

say ""
say "Seats:"
has_arm mixed && say "  mixed  = Lead PM $LEAD_MODEL (Antigravity), Chief Engineer $ENGINEER_MODEL (Claude Code), Chief Architect $GROK_MODEL (Grok, tools off)"
has_arm solo && say "  solo   = Lead PM $SOLO_SIDE_MODEL, Chief Engineer $ENGINEER_MODEL, Chief Architect $SOLO_SIDE_MODEL (tools off), all Claude Code"
has_arm single && say "  single = one Claude Code agent on $ENGINEER_MODEL, plan mode, same review instructions"
say "Judges: $JUDGES (Claude $JUDGE_MODEL is the pre-registered one)"
{ echo "date: $(date '+%Y-%m-%d %H:%M %Z')"; echo "open-council-cli: $CLI_VERSION"; echo "benchmark commit: $(git -C "$BENCH" log -1 --format=%H -- . 2>/dev/null)";
  echo "arms: $ARMS"; echo "lead (mixed): $LEAD_MODEL"; echo "engineer: $ENGINEER_MODEL"; echo "architect (mixed): ${GROK_MODEL:-n/a}"; echo "solo side seats: $SOLO_SIDE_MODEL"; echo "judges: $JUDGES (claude = $JUDGE_MODEL, gemini = $GEMINI_JUDGE_MODEL)"; echo "pre-registered lead (mixed): $PREREG_LEAD_MODEL"; } > "$RES/meta.txt"
[ -n "${PREFLIGHT_ONLY:-}" ] && { say "Preflight passed."; exit 0; }

# ---------------------------------------------------------------- judges
# Each judge reads the labelled review (review.md) and the task's known issues, in an empty folder with
# no tools, and answers in JSON. Claude Opus is the pre-registered judge; Gemini is the cross-check.
# The same note the council's Claude adapter adds when a seat has no tools, so the judge answers instead of trying to look.
NO_TOOLS_NOTE='You have no tools in this session: no file access, no shell, no web. Judge only the text in the prompt and answer in full; never say you will look something up.'
judge_run() { # <run dir> <task> <arm> <judge>
  local out=$1 task=$2 arm=$3 j=$4 jd; jd=$(mktemp -d "${TMPDIR:-/tmp}/cj.XXXXXX")
  node "$BENCH/lib/judge.cjs" prompt "$out" "$BENCH/tasks.json" "$task" > "$out/judge-$j.prompt.md"
  if [ "$j" = claude ]; then
    (cd "$jd" && with_timeout "$JUDGE_TIMEOUT" "$(claude_bin)" -p --model "$JUDGE_MODEL" --tools '' --strict-mcp-config --output-format json \
        --append-system-prompt "$NO_TOOLS_NOTE" < "$out/judge-$j.prompt.md") > "$jd/a.json" 2> "$out/judge-$j.err"
    node "$BENCH/lib/claude-json.cjs" "$jd/a.json" "$out/judge-calls.jsonl" "$JUDGE_MODEL" 0 $? > "$out/judge-$j.answer.txt" 2>/dev/null
  else
    (cd "$jd" && with_timeout "$JUDGE_TIMEOUT" "$REAL_AGY" -p "$(cat "$out/judge-$j.prompt.md")" --output-format text --print-timeout "${JUDGE_TIMEOUT}s" \
        --disable-slash-commands --mode plan --dangerously-skip-permissions --model "$GEMINI_JUDGE_MODEL") > "$out/judge-$j.answer.txt" 2> "$out/judge-$j.err"
  fi
  rm -rf "$jd"
  if grep -qiE "$LIMIT_RE" "$out/judge-$j.err" 2>/dev/null && ! grep -q '"issues"' "$out/judge-$j.answer.txt"; then touch "$RES/STOP"; fi
  node "$BENCH/lib/judge.cjs" parse "$out" "$BENCH/tasks.json" "$task" "$arm" "$j" "$out/judge-$j.answer.txt"
}

# ---------------------------------------------------------------- one run
# A run is finished when every judge has scored it.
done_run() { local j; for j in $JUDGES; do grep -qs '"status": "OK"' "$1/judge-$j.json" || return 1; done; }
run_job() { # <task> <arm> <n>
  local task=$1 arm=$2 n=$3
  local out=$RES/$task/$arm-$n
  if done_run "$out"; then return 0; fi
  [ -f "$RES/STOP" ] && return 0
  if [ ! -f "$out/run.ok" ]; then
    rm -rf "$out"; mkdir -p "$out"
    local w; w=$(mktemp -d "${TMPDIR:-/tmp}/cb.XXXXXX")
    if ! bash "$BENCH/lib/fixture.sh" "$BENCH/tasks.json" "$task" "$CACHE" "$w/app" > "$out/make.log" 2>&1; then
      printf '{"status":"ERROR","detail":"checkout failed: %s"}\n' "$(tail -1 "$out/make.log" | tr -d '"\\' | cut -c1-150)" > "$out/score.json"; rm -rf "$w"
      echo "$task $arm $n: checkout failed (see $out/make.log)"; return 0
    fi
    local t0 code; t0=$(date +%s)
    if [ "$arm" = single ]; then
      node "$BENCH/lib/make-prompt.cjs" "$BENCH/single-agent-prompt.md" "$w/app" main > "$out/prompt.md"
      (cd "$w/app" && with_timeout "$SINGLE_TIMEOUT" "$(claude_bin)" -p --model "$ENGINEER_MODEL" --permission-mode plan --strict-mcp-config --output-format json < "$out/prompt.md") > "$out/agent.json" 2> "$out/agent.err"
      code=$?
      node "$BENCH/lib/claude-json.cjs" "$out/agent.json" "$out/calls.jsonl" "$ENGINEER_MODEL" "$(( $(date +%s) - t0 ))" "$code" > "$out/result.md" 2>/dev/null
      grep -q '"is_error":true' "$out/calls.jsonl" 2>/dev/null && [ "$code" = 0 ] && code=1
      [ -s "$out/result.md" ] || { [ "$code" = 0 ] && code=1; }
      cp "$out/agent.err" "$out/cli.log"
    else
      write_config "$arm" "$w/.council/config.yml"
      [ "$arm" = mixed ] && echo "$LEAD_MODEL" > "$out/lead-model"
      (cd "$w/app" && COUNCIL_HOME="$w/h" BENCH_CALLS_LOG="$out/calls.jsonl" with_timeout "$COUNCIL_TIMEOUT" node "$COUNCIL_JS" review --base main --no-open) > "$out/cli.log" 2>&1
      code=$?
      local sess; sess=$(ls -d "$w/h"/projects/*/sessions/* 2>/dev/null | head -1)
      [ -n "$sess" ] && cp -R "$sess" "$out/session"
      [ -n "$sess" ] || { [ "$code" = 0 ] && code=1; }
    fi
    echo "$code" > "$out/exit"; echo $(( $(date +%s) - t0 )) > "$out/seconds"
    rm -rf "$w"
    if [ "$code" != 0 ]; then
      local st=ERROR
      [ "$code" = 142 ] && st=TIMEOUT
      if grep -qiE "$LIMIT_RE" "$out/cli.log" "$out/calls.jsonl" 2>/dev/null && [ "$st" = ERROR ]; then st=LIMIT; touch "$RES/STOP"; fi
      if grep -qiE "$SIGNIN_RE" "$out/agy-stderr.log" 2>/dev/null; then st=SIGNIN; echo signin > "$RES/STOP"; fi
      local detail; detail=$(grep -v '^\s*$' "$out/cli.log" 2>/dev/null | tail -1 | cut -c1-160 | tr -d '"\\')
      printf '{"status":"%s","detail":"exit %s: %s"}\n' "$st" "$code" "$detail" > "$out/score.json"
      echo "$task $arm $n: $st (exit $code) after $(cat "$out/seconds")s"
      return 0
    fi
    node "$BENCH/lib/review-text.cjs" "$out" "$arm" > /dev/null
    touch "$out/run.ok"
  fi
  # The review is done; judge it (again, if an earlier judge call failed).
  local j line=""
  for j in $JUDGES; do
    [ -f "$out/judge-$j.json" ] && grep -q '"status": "OK"' "$out/judge-$j.json" && continue
    [ -f "$RES/STOP" ] && break
    line=$(judge_run "$out" "$task" "$arm" "$j")
    [ "$j" = claude ] && echo "$line in $(cat "$out/seconds")s"
  done
  [ -f "$out/score.json" ] || printf '{"status":"JUDGE-ERROR","detail":"no answer from the Claude judge yet"}\n' > "$out/score.json"
}

# ---------------------------------------------------------------- the schedule
# Runs judged before the checkout fix are checked once against the PR's diff; any that can't be vouched
# for are set aside and re-run (lib/verify-kept.cjs).
node "$BENCH/lib/verify-kept.cjs" "$RES" "$BENCH/tasks.json" "$BENCH/lib/fixture.sh" "$CACHE" "$JUDGES" || die "the check of earlier runs failed"

# Run 1 of every task and arm comes before any run 2, so a stop part-way still leaves a balanced set.
# Within a round the arms are rotated so no arm always goes first.
node -e '
  const [tasksFile, arms, runs] = [process.argv[1], process.argv[2].split(/\s+/).filter(Boolean), JSON.parse(process.argv[3])];
  const tasks = require(tasksFile).tasks.map(t => t.id);
  const max = Math.max(...arms.map(a => runs[a]));
  let i = 0;
  for (let n = 1; n <= max; n++) for (const t of tasks) {
    const k = i++ % arms.length;
    for (const a of arms.slice(k).concat(arms.slice(0, k))) if (n <= runs[a]) console.log(`${t} ${a} ${n}`);
  }' "$BENCH/tasks.json" "$ARMS" "{\"mixed\":$(runs_for mixed),\"solo\":$(runs_for solo),\"single\":$(runs_for single)}" > "$RES/schedule.txt" || die "could not build the schedule"
jobs_file=$RES/schedule.txt
todo=0; while read -r t a n; do done_run "$RES/$t/$a-$n" || todo=$((todo + 1)); done < "$jobs_file"
echo; echo "$todo runs to do, $PARALLEL at a time. Results: $RES. Stop with Ctrl-C; the same command resumes."
trap 'echo; echo "Stopped. Run the same command to resume."; kill $(jobs -p) 2>/dev/null; exit 130' INT TERM

while read -r t a n; do
  [ -f "$RES/STOP" ] && break
  run_job "$t" "$a" "$n" < /dev/null &
  sleep 3
  while [ "$(jobs -rp | wc -l | tr -d ' ')" -ge "$PARALLEL" ]; do sleep 5; done
done < "$jobs_file"
wait

node "$BENCH/lib/summarize.cjs" "$RES" "$BENCH" > /dev/null
echo
if grep -qs signin "$RES/STOP"; then
  echo "Antigravity asked to sign in again, so the batch stopped early. In a new Terminal window run: agy"
  echo "Sign in there, then run the same command: it picks up where it stopped."
elif [ -f "$RES/STOP" ]; then
  echo "A seat hit a usage limit, so the batch stopped early. Wait for the limit to reset, then run the same command: it picks up where it stopped."
fi
echo "Summary: $ROOT/summary.md  (drag this file into the chat)"
