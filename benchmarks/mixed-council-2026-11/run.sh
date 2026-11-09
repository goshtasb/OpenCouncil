#!/bin/bash
# Mixed council vs one agent, pre-registered in README.md next to this file.
#
#   bash run.sh                      preflight, then every task x arm (mixed, single) x 3 runs, judged; re-run to resume
#   PREFLIGHT_ONLY=1 bash run.sh     check every CLI is signed in and answers, then stop
#   RUNS_SINGLE=10 bash run.sh       e.g. raise the single agent to 10 runs per task (noise floor)
#   ARMS="mixed single solo" bash run.sh  also run the all-Claude council (secondary arm)
#   GROK_MODEL=grok-4.7 bash run.sh  pin the Grok model (default: the newest plain grok-N.N that `grok models` lists)
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
LEAD_MODEL=gemini-4-argon-high
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
for v in ANTHROPIC_API_KEY XAI_API_KEY GROK_API_KEY; do
  if [ -n "$(printenv "$v" 2>/dev/null)" ]; then echo "Ignoring $v for this run, so the seats use your plan sign-ins."; unset "$v"; fi
done
unset CLAUDECODE CLAUDE_CODE_ENTRYPOINT CLAUDE_CODE_SESSION_ID 2>/dev/null
: > "$RES/preflight.txt"
rm -f "$RES/STOP"

command -v node >/dev/null || die "Node.js is not installed. Install it from https://nodejs.org (version 18 or newer)."
node -e 'process.exit(+process.versions.node.split(".")[0] >= 18 ? 0 : 1)' || die "Node $(node -v) is too old; install Node 18 or newer."
for c in git perl npm tar; do command -v $c >/dev/null || die "$c is not installed."; done

REAL_CLAUDE=$(real_bin claude) || die "Claude Code is not installed: curl -fsSL https://claude.ai/install.sh | bash, then run claude once to sign in."
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
t0=\$(date +%s); "\$REAL" "\$@"; code=\$?
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
  if [ -n "$list" ] && ! printf '%s\n' "$list" | grep -q "$LEAD_MODEL"; then
    die "Antigravity does not list $LEAD_MODEL. It lists: $(printf '%s' "$list" | tr '\n' ' ' | cut -c1-300)"
  fi
  # Same shape as the Lead PM's call: plan mode, slash commands off.
  out=$(cd "$ROOT" && with_timeout 240 "$REAL_AGY" -p "Reply with the single word ok." --output-format text --print-timeout 180s \
          --disable-slash-commands --mode plan --dangerously-skip-permissions --model "$LEAD_MODEL" 2>&1) \
    || die "Antigravity refused the Lead PM's kind of call: $(echo "$out" | tail -3). Open agy once and sign in, then rerun."
  printf '%s' "$out" | grep -qi ok || die "Antigravity answered something unexpected: $(echo "$out" | tail -2 | cut -c1-200)"
  say "   $LEAD_MODEL in plan mode -> answered"

  say "-- Grok: $("$REAL_GROK" --version 2>&1 | head -1)"
  if [ -z "${GROK_MODEL:-}" ]; then
    GROK_MODEL=$("$REAL_GROK" models 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const ids=[...new Set(s.match(/\bgrok-\d+(?:\.\d+)?\b(?![-\w])/g)||[])];ids.sort((a,b)=>parseFloat(a.slice(5))-parseFloat(b.slice(5)));process.stdout.write(ids.pop()||"")})')
    [ -n "$GROK_MODEL" ] || GROK_MODEL=grok-4.6
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

say ""
say "Seats:"
has_arm mixed && say "  mixed  = Lead PM $LEAD_MODEL (Antigravity), Chief Engineer $ENGINEER_MODEL (Claude Code), Chief Architect $GROK_MODEL (Grok, tools off)"
has_arm solo && say "  solo   = Lead PM $SOLO_SIDE_MODEL, Chief Engineer $ENGINEER_MODEL, Chief Architect $SOLO_SIDE_MODEL (tools off), all Claude Code"
has_arm single && say "  single = one Claude Code agent on $ENGINEER_MODEL, plan mode, same review instructions"
say "Judges: $JUDGES (Claude $JUDGE_MODEL is the pre-registered one)"
{ echo "date: $(date '+%Y-%m-%d %H:%M %Z')"; echo "open-council-cli: $CLI_VERSION"; echo "benchmark commit: $(git -C "$BENCH" log -1 --format=%H -- . 2>/dev/null)";
  echo "arms: $ARMS"; echo "lead (mixed): $LEAD_MODEL"; echo "engineer: $ENGINEER_MODEL"; echo "architect (mixed): ${GROK_MODEL:-n/a}"; echo "solo side seats: $SOLO_SIDE_MODEL"; echo "judges: $JUDGES (claude = $JUDGE_MODEL, gemini = $LEAD_MODEL)"; } > "$RES/meta.txt"
[ -n "${PREFLIGHT_ONLY:-}" ] && { say "Preflight passed."; exit 0; }

# ---------------------------------------------------------------- judges
# Each judge reads the labelled review (review.md) and the task's known issues, in an empty folder with
# no tools, and answers in JSON. Claude Opus is the pre-registered judge; Gemini is the cross-check.
judge_run() { # <run dir> <task> <arm> <judge>
  local out=$1 task=$2 arm=$3 j=$4 jd; jd=$(mktemp -d "${TMPDIR:-/tmp}/cj.XXXXXX")
  node "$BENCH/lib/judge.cjs" prompt "$out" "$BENCH/tasks.json" "$task" > "$out/judge-$j.prompt.md"
  if [ "$j" = claude ]; then
    (cd "$jd" && with_timeout "$JUDGE_TIMEOUT" "$REAL_CLAUDE" -p --model "$JUDGE_MODEL" --tools '' --strict-mcp-config --output-format json < "$out/judge-$j.prompt.md") > "$jd/a.json" 2> "$out/judge-$j.err"
    node "$BENCH/lib/claude-json.cjs" "$jd/a.json" "$out/judge-calls.jsonl" "$JUDGE_MODEL" 0 $? > "$out/judge-$j.answer.txt" 2>/dev/null
  else
    (cd "$jd" && with_timeout "$JUDGE_TIMEOUT" "$REAL_AGY" -p "$(cat "$out/judge-$j.prompt.md")" --output-format text --print-timeout "${JUDGE_TIMEOUT}s" \
        --disable-slash-commands --mode plan --dangerously-skip-permissions --model "$LEAD_MODEL") > "$out/judge-$j.answer.txt" 2> "$out/judge-$j.err"
  fi
  rm -rf "$jd"
  if grep -qiE "$LIMIT_RE" "$out/judge-$j.err" 2>/dev/null && ! grep -q '"issues"' "$out/judge-$j.answer.txt"; then touch "$RES/STOP"; fi
  node "$BENCH/lib/judge.cjs" parse "$out" "$BENCH/tasks.json" "$task" "$arm" "$j" "$out/judge-$j.answer.txt"
}

# ---------------------------------------------------------------- one run
LIMIT_RE='usage limit|limit reached|rate.limit|quota|resource.exhausted|too many requests|credit balance|out of credits|exceeded your|try again (later|in)'
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
      (cd "$w/app" && with_timeout "$SINGLE_TIMEOUT" "$REAL_CLAUDE" -p --model "$ENGINEER_MODEL" --permission-mode plan --strict-mcp-config --output-format json < "$out/prompt.md") > "$out/agent.json" 2> "$out/agent.err"
      code=$?
      node "$BENCH/lib/claude-json.cjs" "$out/agent.json" "$out/calls.jsonl" "$ENGINEER_MODEL" "$(( $(date +%s) - t0 ))" "$code" > "$out/result.md" 2>/dev/null
      grep -q '"is_error":true' "$out/calls.jsonl" 2>/dev/null && [ "$code" = 0 ] && code=1
      [ -s "$out/result.md" ] || { [ "$code" = 0 ] && code=1; }
      cp "$out/agent.err" "$out/cli.log"
    else
      write_config "$arm" "$w/.council/config.yml"
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
if [ -f "$RES/STOP" ]; then
  echo "A seat hit a usage limit, so the batch stopped early. Wait for the limit to reset, then run the same command: it picks up where it stopped."
fi
echo "Summary: $ROOT/summary.md  (drag this file into the chat)"
