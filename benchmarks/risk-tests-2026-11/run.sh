#!/bin/bash
# council build (one agent builds, three companies' models name risks, every risk becomes a required test) vs one
# Claude Code agent, on the five full-loop tasks. Pre-registered in README.md next to this file.
#
#   bash run.sh                        preflight, then every task x arm, scored on hidden tests; re-run to resume
#   PREFLIGHT_ONLY=1 bash run.sh       check every CLI is signed in and answers, then stop
#   RUNS_BUILD=2 bash run.sh           fewer council build runs per task (default 3)
#   RUNS_SINGLE=3 bash run.sh          fewer single-agent runs per task (default 5)
#   DESKTOP_COPY=0 bash run.sh         do not copy summary.md to ~/Desktop/council-build-results.md
#   GROK_MODEL=grok-4.7 bash run.sh    pin the Grok model (default: the newest plain grok-N.N that `grok models` lists)
#   LEAD_CANDIDATES="gemini-4-argon-high auto" bash run.sh
#                                      Lead PM models to try in order when the pre-registered one has no quota
#
# Uses the open-council-cli built from this checkout (npm ci && npm run build first). Runs on the CLIs' own
# sign-ins; API keys in the environment are ignored so nothing is billed to a key. Nothing is pushed or posted:
# each task is a small local repo built in a temporary folder. Results stay in $BENCH_ROOT (default ~/oc-risk-tests),
# and summary.md is also copied to the Desktop.
set -u
BENCH=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$BENCH/../.." && pwd)
FL=$REPO/benchmarks/full-loop-2026-11      # the tasks and the scoring, unchanged
ROOT=${BENCH_ROOT:-$HOME/oc-risk-tests}
RES=$ROOT/results
PREREG_LEAD_MODEL=gemini-4-argon-high
LEAD_CANDIDATES=${LEAD_CANDIDATES:-$PREREG_LEAD_MODEL}
LEAD_MODEL=$PREREG_LEAD_MODEL
ENGINEER_MODEL=opus
ARMS="build single"
RUNS_BUILD=${RUNS_BUILD:-3}
RUNS_SINGLE=${RUNS_SINGLE:-5}
PARALLEL=${PARALLEL:-2}
BUILD_TIMEOUT=${BUILD_TIMEOUT:-3600}
SINGLE_TIMEOUT=${SINGLE_TIMEOUT:-1800}
TASKS=${TASKS:-"charge-retries late-fees event-pagination daily-usage coupon-redeem"}
mkdir -p "$ROOT/bin" "$RES"
LOCK=$ROOT/.running
if ! mkdir "$LOCK" 2>/dev/null; then
  p=$(cat "$LOCK/pid" 2>/dev/null)
  if [ -n "$p" ] && kill -0 "$p" 2>/dev/null; then echo "This benchmark is already running in another window. Let that one finish, or stop it with Ctrl-C there first."; exit 1; fi
  rm -rf "$LOCK"; mkdir "$LOCK" || { echo "Could not take the lock $LOCK."; exit 1; }
fi
echo $$ > "$LOCK/pid"
trap 'rm -rf "$LOCK"' EXIT
SIGNIN_RE='accounts\.google\.com|paste (this|the) code|authorization code|to complete authentication|(sign|log) ?in (again|required|to continue)|not (signed|logged) in|re-?authenticat'
SIGNIN_STRICT_RE='accounts\.google\.com/o/oauth|paste (this|the) code|to complete authentication|(sign|log) ?in (again|required|to continue)|not (signed|logged) in to antigravity'
LIMIT_RE='usage limit|limit reached|hit your (usage |weekly |session |daily )?limit|weekly limit|rate.?limit|quota|resource.?exhausted|too many requests|credit balance|out of credits|exceeded your|try again (later|in)'

say() { printf '%s\n' "$*" | tee -a "$RES/preflight.txt"; }
die() { say "STOP: $*"; exit 1; }
with_timeout() { local s=$1; shift; perl -e 'alarm shift; exec @ARGV or die "exec failed: $!"' "$s" "$@"; }
real_bin() { PATH=$(printf %s "$PATH" | tr ':' '\n' | grep -vx "$ROOT/bin" | paste -sd: -) command -v "$1"; }

# ---------------------------------------------------------------- environment
for v in ANTHROPIC_API_KEY XAI_API_KEY GROK_API_KEY GEMINI_API_KEY GOOGLE_API_KEY GOOGLE_GENAI_USE_VERTEXAI; do
  if [ -n "$(printenv "$v" 2>/dev/null)" ]; then echo "Ignoring $v for this run, so the seats use your plan sign-ins."; unset "$v"; fi
done
unset CLAUDECODE CLAUDE_CODE_ENTRYPOINT CLAUDE_CODE_SESSION_ID 2>/dev/null
: > "$RES/preflight.txt"
rm -f "$RES/STOP"

command -v node >/dev/null || die "Node.js is not installed. Install it from https://nodejs.org (version 20 or newer)."
node -e 'process.exit(+process.versions.node.split(".")[0] >= 20 ? 0 : 1)' || die "Node $(node -v) is too old; install Node 20 or newer."
for c in git perl npm; do command -v $c >/dev/null || die "$c is not installed."; done
[ -d "$FL/tasks" ] || die "The full-loop tasks are missing from $FL."

COUNCIL_JS=$REPO/bin/council.js
[ -f "$REPO/dist/engine/build.js" ] || die "This checkout is not built. Run: cd $REPO && npm ci && npm run build"
CLI_VERSION="$(node -p "require('$REPO/package.json').version") from $(git -C "$REPO" rev-parse --short HEAD 2>/dev/null) ($(git -C "$REPO" rev-parse --abbrev-ref HEAD 2>/dev/null))"

REAL_CLAUDE=$(real_bin claude) || die "Claude Code is not installed: curl -fsSL https://claude.ai/install.sh | bash, then run claude once to sign in."
REAL_AGY=$(real_bin agy) || die "The Antigravity CLI (agy) is not installed; the build arm needs it for Gemini."
REAL_GROK=""
for g in "${GROK_BIN:-}" "$HOME/.grok/bin/grok" "$(real_bin grok 2>/dev/null)"; do
  [ -n "$g" ] && [ -x "$g" ] && [ "$g" != "$ROOT/bin/grok" ] && { REAL_GROK=$g; break; }
done
[ -n "$REAL_GROK" ] || die "The Grok CLI is not installed; the build arm needs it."

# ---------------------------------------------------------------- wrappers that log every seat call (as in the full-loop benchmark)
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
"\$REAL" "\$@" --output-format json > "\$tmp" 2> >(tee -a "\$(dirname "\$BENCH_CALLS_LOG")/claude-stderr.log" >&2); code=\$?
node "$FL/lib/claude-json.cjs" "\$tmp" "\$BENCH_CALLS_LOG" "\$model" "\$(( \$(date +%s) - t0 ))" "\$code"
rm -f "\$tmp"; exit \$code
SHIM
cat > "$ROOT/bin/agy" <<SHIM
#!/bin/bash
REAL="$REAL_AGY"
case " \$* " in *" -p "*) ;; *) exec "\$REAL" "\$@";; esac
[ -n "\${BENCH_CALLS_LOG:-}" ] || exec "\$REAL" "\$@"
model=""; prev=""
for a in "\$@"; do [ "\$prev" = --model ] && model=\$a; prev=\$a; done
D=\$(dirname "\$BENCH_CALLS_LOG")
if grep -qs signin "\${BENCH_STOP_FILE:-/nonexistent}"; then
  echo "Antigravity is not signed in: call skipped, the batch is stopping for a sign-in." | tee -a "\$D/agy-stderr.log" >&2
  printf '{"vendor":"gemini","model":"%s","seconds":0,"code":1,"skipped":"signin"}\n' "\$model" >> "\$BENCH_CALLS_LOG"
  exit 1
fi
co=\$(mktemp); ce=\$(mktemp)
signin_check() {
  [ "\$1" = 0 ] && return 0
  sleep 0.3
  if grep -qiE '$SIGNIN_RE' "\$ce" 2>/dev/null || grep -qiE '$SIGNIN_STRICT_RE' "\$co" 2>/dev/null; then
    echo "Antigravity is not signed in: this call stopped at a sign-in prompt." >> "\$D/agy-stderr.log"
    [ -n "\${BENCH_STOP_FILE:-}" ] && echo signin > "\$BENCH_STOP_FILE"
  fi
}
t0=\$(date +%s)
"\$REAL" "\$@" < /dev/null > >(tee -a "\$D/agy-stdout.log" "\$co") 2> >(tee -a "\$D/agy-stderr.log" "\$ce" >&2) & pid=\$!
trap 'kill \$pid 2>/dev/null; wait \$pid 2>/dev/null; signin_check 143; rm -f "\$co" "\$ce"; exit 143' TERM INT HUP
wait \$pid; code=\$?
signin_check \$code
rm -f "\$co" "\$ce"
printf '{"vendor":"gemini","model":"%s","seconds":%s,"code":%s}\n' "\$model" "\$(( \$(date +%s) - t0 ))" "\$code" >> "\$BENCH_CALLS_LOG"
exit \$code
SHIM
cat > "$ROOT/bin/grok" <<SHIM
#!/bin/bash
REAL="$REAL_GROK"
case " \$* " in *" --prompt-file "*|*" -p "*) ;; *) exec "\$REAL" "\$@";; esac
[ -n "\${BENCH_CALLS_LOG:-}" ] || exec "\$REAL" "\$@"
model=""; prev=""
for a in "\$@"; do { [ "\$prev" = -m ] || [ "\$prev" = --model ]; } && model=\$a; prev=\$a; done
t0=\$(date +%s); "\$REAL" "\$@" 2> >(tee -a "\$(dirname "\$BENCH_CALLS_LOG")/grok-stderr.log" >&2); code=\$?
printf '{"vendor":"grok","model":"%s","seconds":%s,"code":%s}\n' "\$model" "\$(( \$(date +%s) - t0 ))" "\$code" >> "\$BENCH_CALLS_LOG"
exit \$code
SHIM
chmod +x "$ROOT"/bin/*
export PATH="$ROOT/bin:$PATH"
export GROK_BIN="$ROOT/bin/grok"

# ---------------------------------------------------------------- preflight
say "== Preflight $(date '+%Y-%m-%d %H:%M %Z')"
say "open-council-cli $CLI_VERSION, node $(node -v), $(uname -sm)"
if [ -n "$(git -C "$REPO" status --porcelain -- benchmarks src 2>/dev/null)" ]; then say "WARNING: this checkout differs from its last commit (benchmarks/ or src/)."; fi

claude_ping() {
  local out; out=$(cd "$ROOT" && with_timeout 180 "$REAL_CLAUDE" -p --model "$1" --strict-mcp-config --output-format json "Reply with the single word ok." 2>&1) || { echo "FAIL $(echo "$out" | tail -3)"; return 1; }
  echo "$out" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);if(j.is_error)throw new Error(j.result);console.log(Object.keys(j.modelUsage||{}).join(", ")+" (answered: "+String(j.result).trim().slice(0,20)+")")}catch(e){console.log("FAIL "+e.message.slice(0,200));process.exit(1)}})'
}
say "-- Claude Code: $("$REAL_CLAUDE" --version 2>&1 | head -1)"
if ! m=$(claude_ping "$ENGINEER_MODEL"); then
  printf '%s' "$m" | grep -qiE "$LIMIT_RE" && die "Your Claude plan's usage limit is reached ($m). Nothing has run. Paste the same command again after it resets."
  die "Claude Code did not answer on '$ENGINEER_MODEL': $m. Run 'claude' once and sign in with your plan, then rerun."
fi
say "   $ENGINEER_MODEL -> $m"

say "-- Antigravity (Gemini): $("$REAL_AGY" --version 2>&1 | head -1)"
list=$("$REAL_AGY" models 2>/dev/null)
agy_ping() {
  local out; out=$(cd "$ROOT" && with_timeout 240 "$REAL_AGY" -p "Reply with the single word ok." --output-format text --print-timeout 180s \
          --disable-slash-commands --mode plan --dangerously-skip-permissions --model "$1" < /dev/null 2>&1)
  local code=$?
  if printf '%s' "$out" | grep -qiE "$SIGNIN_RE"; then echo signin; return 2; fi
  if [ $code = 0 ] && printf '%s\n' "$out" | grep -qiE '^[^[:alnum:]]*ok[^[:alnum:]]*$' && ! printf '%s' "$out" | grep -qiE "$LIMIT_RE"; then return 0; fi
  printf '%s' "$out" | grep -v '^[[:space:]]*$' | tail -2 | tr '\n' ' ' | cut -c1-200; return 1
}
cands=""
for c in $LEAD_CANDIDATES; do
  if [ "$c" = auto ]; then
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
  out=$(agy_ping "$c"); rc=$?
  [ $rc = 0 ] && { LEAD_MODEL=$c; break; }
  [ $rc = 2 ] && die "Antigravity wants you to sign in again. Open a new Terminal window, run: agy   and sign in there. Then paste the same command again: it picks up where it stopped."
  tried="$tried; $c: $out"
  say "   $c -> no answer: $out"
done
[ -n "$LEAD_MODEL" ] || die "No Gemini model answered${tried}. Open agy once and sign in, or wait for a quota to reset, then rerun. (Try LEAD_CANDIDATES=\"$PREREG_LEAD_MODEL auto\".)"
say "   Gemini $LEAD_MODEL in plan mode -> answered"
if [ "$LEAD_MODEL" != "$PREREG_LEAD_MODEL" ]; then
  say "   DEVIATION: the pre-registered $PREREG_LEAD_MODEL did not answer, so new build runs use $LEAD_MODEL."
  dev="$(date '+%Y-%m-%d %H:%M %Z'): the Gemini seat is $LEAD_MODEL for build runs from now on; the pre-registered $PREREG_LEAD_MODEL did not answer (${tried#; })."
  grep -qsF "Gemini seat is $LEAD_MODEL " "$RES/deviations.txt" || echo "$dev" >> "$RES/deviations.txt"
fi

say "-- Grok: $("$REAL_GROK" --version 2>&1 | head -1)"
if [ -z "${GROK_MODEL:-}" ] && [ -f "$RES/meta.txt" ]; then
  GROK_MODEL=$(sed -n 's/^grok: \(grok-[0-9][0-9.]*\)$/\1/p' "$RES/meta.txt" | head -1)
  [ -n "$GROK_MODEL" ] && say "   keeping $GROK_MODEL from the batch's first run"
fi
if [ -z "${GROK_MODEL:-}" ]; then
  GROK_MODEL=$("$REAL_GROK" models 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const ids=[...new Set(s.match(/\bgrok-\d+(?:\.\d+)?\b(?![-\w.])/g)||[])];const v=x=>x.slice(5).split(".").map(Number);ids.sort((a,b)=>{const[p,q]=[v(a),v(b)];return (p[0]-q[0])||((p[1]||0)-(q[1]||0))});process.stdout.write(ids.pop()||"")})')
  [ -n "$GROK_MODEL" ] || die "Could not read a grok-N.N model from 'grok models'. Set GROK_MODEL to one it lists, then rerun."
fi
pf=$(mktemp); echo "Reply with the single word ok." > "$pf"
# Same shape as the risk round's call: plan mode, read-only tools.
out=$(cd "$ROOT" && with_timeout 240 "$REAL_GROK" -m "$GROK_MODEL" --prompt-file "$pf" --disable-web-search --no-subagents --no-memory \
        --output-format plain --permission-mode plan --max-turns 10 2>&1) \
  || die "Grok did not answer on $GROK_MODEL: $(echo "$out" | tail -3). Run 'grok login', or set GROK_MODEL to one that 'grok models' lists, then rerun."
rm -f "$pf"
printf '%s' "$out" | grep -qi ok || die "Grok answered something unexpected on $GROK_MODEL: $(echo "$out" | tail -2 | cut -c1-200)"
say "   $GROK_MODEL in plan mode -> answered"

say ""
say "Arms:"
say "  build  = council build: Claude Code $ENGINEER_MODEL builds; Gemini $LEAD_MODEL, Claude $ENGINEER_MODEL and Grok $GROK_MODEL name risks; every risk becomes a required test"
say "  single = one Claude Code agent on $ENGINEER_MODEL with the same task text"
{ echo "date: $(date '+%Y-%m-%d %H:%M %Z')"; echo "open-council-cli: $CLI_VERSION"; echo "benchmark commit: $(git -C "$REPO" log -1 --format=%H -- benchmarks/risk-tests-2026-11 2>/dev/null)";
  echo "gemini: $LEAD_MODEL"; echo "pre-registered gemini: $PREREG_LEAD_MODEL"; echo "claude: $ENGINEER_MODEL"; echo "grok: $GROK_MODEL";
  echo "runs: build $RUNS_BUILD per task, single $RUNS_SINGLE per task"; } > "$RES/meta.txt"
[ -n "${PREFLIGHT_ONLY:-}" ] && { say "Preflight passed."; exit 0; }

# ---------------------------------------------------------------- one run
make_repo() { # <task> <dir>
  mkdir -p "$2" && cp -R "$FL/tasks/$1/repo/." "$2/" &&
  (cd "$2" && git init -q && git symbolic-ref HEAD refs/heads/main && git add -A && git -c user.email=bench@localhost -c user.name=bench commit -qm "Initial commit")
}

single_run() { # <task> <out> <work dir>   (exactly as in the full-loop benchmark)
  local task=$1 out=$2 w=$3 code t0
  make_repo "$task" "$w/app" || return 99
  t0=$(date +%s)
  (cd "$w/app" && BENCH_CALLS_LOG="" with_timeout "$SINGLE_TIMEOUT" "$REAL_CLAUDE" -p "$(cat "$FL/tasks/$task/task.md")" --model "$ENGINEER_MODEL" \
     --permission-mode acceptEdits --strict-mcp-config --output-format json \
     --allowedTools "Read Edit Write Glob Grep Bash(npm test*) Bash(npm run *) Bash(node *) Bash(git diff*) Bash(git status*) Bash(git log*) Bash(ls*)") \
     > "$out/agent.json" 2> "$out/cli.log"
  code=$?
  node "$FL/lib/claude-json.cjs" "$out/agent.json" "$out/calls.jsonl" "$ENGINEER_MODEL" "$(( $(date +%s) - t0 ))" "$code" > "$out/result.md" 2>/dev/null
  grep -q '"is_error":true' "$out/calls.jsonl" 2>/dev/null && [ "$code" = 0 ] && code=1
  (cd "$w/app" && git add -A && git diff --cached HEAD > "$out/diff.patch")
  echo "$w/app" > "$out/tree"
  return $code
}

build_run() { # <task> <out> <work dir>
  local task=$1 out=$2 w=$3 sdir st ew code=0
  make_repo "$task" "$w/app" || return 99
  node "$BENCH/lib/config.cjs" "$w/app/.council/config.yml" "$LEAD_MODEL" "$ENGINEER_MODEL" "$GROK_MODEL" || return 99
  (cd "$w/app" && git add -A && git -c user.email=bench@localhost -c user.name=bench commit -qm "Add .council") || return 99
  echo "$LEAD_MODEL" > "$out/lead-model"
  export COUNCIL_HOME="$w/h" BENCH_CALLS_LOG="$out/calls.jsonl" BENCH_STOP_FILE="$RES/STOP"
  (cd "$w/app" && with_timeout "$BUILD_TIMEOUT" node "$COUNCIL_JS" build --task-file "$FL/tasks/$task/task.md" --slug "$task" --no-branch --no-check) > "$out/cli.log" 2>&1 || code=$?
  unset COUNCIL_HOME BENCH_CALLS_LOG BENCH_STOP_FILE
  sdir=$(ls -d "$w/h"/projects/*/builds/*/ 2>/dev/null | head -1)
  [ -n "$sdir" ] && cp -R "$sdir" "$out/session" 2>/dev/null
  st=$(node -p "require('$out/session/STATUS.json').status" 2>/dev/null)
  echo "build: ${st:-none}" > "$out/outcome"
  ew=$(node -p "require('$out/session/STATUS.json').details.execWorktree || ''" 2>/dev/null)
  if [ -n "$ew" ] && [ -d "$ew" ]; then
    echo "$ew" > "$out/tree"
    (cd "$ew" && git add -A >/dev/null 2>&1; git diff --cached "$(node -p "require('$out/session/meta.json').baseSha")" > "$out/diff.patch" 2>/dev/null)
  fi
  [ "$code" = 142 ] && return 142
  # DONE or BLOCKED is the build's own result (BLOCKED exits 2); anything else is a crash.
  { [ "$st" = DONE ] || [ "$st" = BLOCKED ]; } && return 0
  return 3
}

final_run() { grep -qsE '"status": ?"(OK|CRASH)"' "$1/score.json"; }
run_job() { # <task> <arm> <n>
  local task=$1 arm=$2 n=$3 out=$RES/$1/$2-$3
  final_run "$out" && return 0
  [ -f "$RES/STOP" ] && return 0
  rm -rf "$out"; mkdir -p "$out"
  local w code t0; w=$(mktemp -d "${TMPDIR:-/tmp}/rt.XXXXXX"); t0=$(date +%s)
  if [ "$arm" = single ]; then single_run "$task" "$out" "$w"; else build_run "$task" "$out" "$w"; fi
  code=$?
  echo "$code" > "$out/exit"; echo $(( $(date +%s) - t0 )) > "$out/seconds"
  # A usage limit or a sign-in prompt makes the run unscored (never a miss) and stops the batch; the same command resumes.
  local lim; lim=$(node "$FL/lib/limits.cjs" "$out" "$([ "$arm" = single ] && echo single || echo run)")
  if [ -n "$lim" ]; then
    local st=LIMIT; [ "$lim" = signin ] && st=SIGNIN
    echo "$lim" > "$RES/STOP"
    printf '{"status":"%s","detail":"%s"}\n' "$st" "$(printf '%s' "$lim" | tr -d '"\\' | cut -c1-200)" > "$out/score.json"
    echo "$task $arm $n: $st, not scored ($lim)"; rm -rf "$w"; return 0
  fi
  if [ "$code" = 99 ]; then
    printf '{"status":"HARNESS-ERROR","detail":"the task repo could not be set up"}\n' > "$out/score.json"
    echo "$task $arm $n: harness error, not scored"; rm -rf "$w"; return 0
  fi
  if [ "$code" != 0 ] || [ ! -f "$out/tree" ]; then
    # A crash or a timeout gave the user nothing: a miss in the primary table (pre-registered), for both arms.
    local kind=error; [ "$code" = 142 ] && kind=timeout
    local detail; detail=$(grep -v '^\s*$' "$out/cli.log" 2>/dev/null | tail -1 | cut -c1-160 | tr -d '"\\')
    printf '{"status":"CRASH","kind":"%s","passed":false,"detail":"exit %s: %s"}\n' "$kind" "$code" "$detail" > "$out/score.json"
    echo "$task $arm $n: $kind (exit $code) after $(cat "$out/seconds")s, counted as a miss"; rm -rf "$w"; return 0
  fi
  local line; line=$(node "$FL/lib/score.cjs" "$FL/tasks/$task" "$(cat "$out/tree")" "$out/tests.json")
  node -e 'const f=require("fs"),[o,s]=process.argv.slice(1);const t=JSON.parse(f.readFileSync(o+"/tests.json"));f.writeFileSync(o+"/score.json",JSON.stringify({status:"OK",passed:t.passed,seconds:+s},null,2))' "$out" "$(cat "$out/seconds")"
  echo "$task $arm $n: $line, $(cat "$out/outcome" 2>/dev/null | tr '\n' ' ')in $(cat "$out/seconds")s"
  rm -rf "$w"
}

# ---------------------------------------------------------------- the schedule: run 1 of every task and arm before any run 2
node -e '
  const [tasks, arms, runs] = [process.argv[1].split(/\s+/).filter(Boolean), process.argv[2].split(/\s+/).filter(Boolean), JSON.parse(process.argv[3])];
  const max = Math.max(...arms.map(a => runs[a]));
  let i = 0;
  for (let n = 1; n <= max; n++) for (const t of tasks) {
    const k = i++ % arms.length;
    for (const a of arms.slice(k).concat(arms.slice(0, k))) if (n <= runs[a]) console.log(`${t} ${a} ${n}`);
  }' "$TASKS" "$ARMS" "{\"build\":$RUNS_BUILD,\"single\":$RUNS_SINGLE}" > "$RES/schedule.txt" || die "could not build the schedule"
todo=0; while read -r t a n; do final_run "$RES/$t/$a-$n" || todo=$((todo + 1)); done < "$RES/schedule.txt"
echo; echo "$todo runs to do, $PARALLEL at a time. Results: $RES. Stop with Ctrl-C; the same command resumes."
trap 'echo; echo "Stopped. Run the same command to resume."; kill $(jobs -p) 2>/dev/null; exit 130' INT TERM

while read -r t a n; do
  [ -f "$RES/STOP" ] && break
  run_job "$t" "$a" "$n" < /dev/null &
  sleep 3
  while [ "$(jobs -rp | wc -l | tr -d ' ')" -ge "$PARALLEL" ]; do sleep 5; done
done < "$RES/schedule.txt"
wait

node "$BENCH/lib/summarize.cjs" "$RES" > "$ROOT/summary.md"
DESKTOP_COPY=${DESKTOP_COPY:-1}
[ "$DESKTOP_COPY" = 1 ] && [ -d "$HOME/Desktop" ] && cp "$ROOT/summary.md" "$HOME/Desktop/council-build-results.md"
echo
if [ -f "$RES/STOP" ]; then
  why=$(head -1 "$RES/STOP")
  case "$why" in
    signin) echo "Antigravity asked to sign in again, so the batch stopped early. In a new Terminal window run: agy"
            echo "Sign in there, then paste the same command: it picks up where it stopped.";;
    *) echo "A plan's usage limit was reached, so the batch stopped early (${why#limit })."
       echo "Those runs are not scored and never count as misses. Paste the same command after the limit resets: it picks up where it stopped.";;
  esac
fi
echo "Summary: $ROOT/summary.md"
[ "$DESKTOP_COPY" = 1 ] && [ -d "$HOME/Desktop" ] && echo "Copied to your Desktop: council-build-results.md"
