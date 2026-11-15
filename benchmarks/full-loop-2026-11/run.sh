#!/bin/bash
# Full loop: the council plans, builds and verifies vs one agent builds. Pre-registered in README.md next to this file.
#
#   bash run.sh                        preflight, then every task x arm, scored on hidden tests; re-run to resume
#   PREFLIGHT_ONLY=1 bash run.sh       check every CLI is signed in and answers, then stop
#   RUNS_COUNCIL=2 bash run.sh         fewer council runs per task (default 3)
#   RUNS_SINGLE=5 bash run.sh          fewer single-agent runs per task (default 10, the noise floor)
#   ARMS="mixed single solo" bash run.sh   also run the all-Claude council (secondary arm)
#   PROFILE=quick bash run.sh          the 4-round quick profile instead of the default full one (not the pre-registered run)
#   GROK_MODEL=grok-4.7 bash run.sh    pin the Grok model (default: the newest plain grok-N.N that `grok models` lists)
#
# Runs on the CLIs' own sign-ins (Claude Code, Antigravity, Grok). API keys in the environment are
# ignored for this run so nothing is billed to a key. Nothing is pushed or posted: each task is a small
# local repo from tasks/, built in a temporary folder; the council's "pull request" step is pointed at a
# stand-in for gh that only records it. Results stay in $BENCH_ROOT.
set -u
BENCH=$(cd "$(dirname "$0")" && pwd)
ROOT=${BENCH_ROOT:-$HOME/oc-full-loop}
RES=$ROOT/results
CLI_VERSION=0.4.0
LEAD_MODEL=gemini-4-argon-high
ENGINEER_MODEL=opus
SOLO_SIDE_MODEL=sonnet
ARMS=${ARMS:-"mixed single"}
RUNS_COUNCIL=${RUNS_COUNCIL:-3}
RUNS_SINGLE=${RUNS_SINGLE:-10}
PARALLEL=${PARALLEL:-2}
COUNCIL_TIMEOUT=${COUNCIL_TIMEOUT:-7200}   # whole council run: plan, build, verify
SINGLE_TIMEOUT=${SINGLE_TIMEOUT:-1800}
JUDGE_MODEL=opus
JUDGE_TIMEOUT=${JUDGE_TIMEOUT:-600}
PROFILE=${PROFILE:-full}                # council profile: full (the default `council init`, 10 rounds) or quick (4 rounds)
TASKS=${TASKS:-"charge-retries late-fees event-pagination daily-usage coupon-redeem"}
mkdir -p "$ROOT/bin" "$ROOT/tool" "$RES"

say() { printf '%s\n' "$*" | tee -a "$RES/preflight.txt"; }
die() { say "STOP: $*"; exit 1; }
# Kills a command after N seconds (macOS has no `timeout`); the alarm survives exec.
with_timeout() { local s=$1; shift; perl -e 'alarm shift; exec @ARGV or die "exec failed: $!"' "$s" "$@"; }
real_bin() { PATH=$(printf %s "$PATH" | tr ':' '\n' | grep -vx "$ROOT/bin" | paste -sd: -) command -v "$1"; }
runs_for() { case $1 in single) echo "$RUNS_SINGLE";; *) echo "$RUNS_COUNCIL";; esac; }
has_arm() { case " $ARMS " in *" $1 "*) return 0;; *) return 1;; esac; }

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

REAL_CLAUDE=$(real_bin claude) || die "Claude Code is not installed: curl -fsSL https://claude.ai/install.sh | bash, then run claude once to sign in."
REAL_AGY=""; REAL_GROK=""
if has_arm mixed; then
  REAL_AGY=$(real_bin agy) || die "The Antigravity CLI (agy) is not installed; the mixed arm needs it for the Lead PM seat."
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
# Each run sets BENCH_CALLS_LOG; the wrappers append one JSON line per model call. They change nothing
# about the call, except that Claude's print-mode calls are asked for JSON and their text is passed on as is.
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
model=""; prev=""
for a in "\$@"; do [ "\$prev" = --model ] && model=\$a; prev=\$a; done
t0=\$(date +%s); "\$REAL" "\$@"; code=\$?
printf '{"vendor":"gemini","model":"%s","seconds":%s,"code":%s}\n' "\$model" "\$(( \$(date +%s) - t0 ))" "\$code" >> "\$BENCH_CALLS_LOG"
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
# Stand-in for gh: the council's publish step "opens" a pull request here, and nothing reaches GitHub.
mkdir -p "$ROOT/gh-shim"
cat > "$ROOT/gh-shim/gh" <<'SHIM'
#!/bin/bash
[ -n "${BENCH_GH_LOG:-}" ] && printf '%s\n' "gh $*" >> "$BENCH_GH_LOG"
case "$1 $2" in
  "pr create") echo "local-only (benchmark: nothing was sent to GitHub)"; exit 0;;
  *) exit 1;;
esac
SHIM
chmod +x "$ROOT"/bin/* "$ROOT/gh-shim/gh"
export PATH="$ROOT/bin:$PATH"
[ -n "$REAL_GROK" ] && export GROK_BIN="$ROOT/bin/grok"

# ---------------------------------------------------------------- seat configs
write_config() { # <arm> <file>
  node "$BENCH/lib/config.cjs" "$1" "$2" "$LEAD_MODEL" "$ENGINEER_MODEL" "${GROK_MODEL:-}" "$SOLO_SIDE_MODEL" "$PROFILE"
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
  out=$(cd "$ROOT" && with_timeout 240 "$REAL_AGY" -p "Reply with the single word ok." --output-format text --print-timeout 180s \
          --disable-slash-commands --mode plan --dangerously-skip-permissions --model "$LEAD_MODEL" 2>&1) \
    || die "Antigravity refused the Lead PM's kind of call: $(echo "$out" | tail -3). Open agy once and sign in, then rerun."
  printf '%s' "$out" | grep -qi ok || die "Antigravity answered something unexpected: $(echo "$out" | tail -2 | cut -c1-200)"
  say "   $LEAD_MODEL in plan mode -> answered"

  say "-- Grok: $("$REAL_GROK" --version 2>&1 | head -1)"
  if [ -z "${GROK_MODEL:-}" ]; then
    GROK_MODEL=$("$REAL_GROK" models 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const ids=[...new Set(s.match(/\bgrok-\d+(?:\.\d+)?\b(?![-\w.])/g)||[])];const v=x=>x.slice(5).split(".").map(Number);ids.sort((a,b)=>{const[p,q]=[v(a),v(b)];return (p[0]-q[0])||((p[1]||0)-(q[1]||0))});process.stdout.write(ids.pop()||"")})')
    [ -n "$GROK_MODEL" ] || die "Could not read a grok-N.N model from 'grok models'. Set GROK_MODEL to one it lists, then rerun."
  fi
  pf=$(mktemp); echo "Reply with the single word ok." > "$pf"
  out=$(cd "$ROOT" && with_timeout 240 "$REAL_GROK" -m "$GROK_MODEL" --prompt-file "$pf" --disable-web-search --no-subagents --no-memory \
          --output-format plain --tools none --deny '*' --max-turns 10 2>&1) \
    || die "Grok did not answer on $GROK_MODEL: $(echo "$out" | tail -3). Run 'grok login', or set GROK_MODEL to one that 'grok models' lists, then rerun."
  rm -f "$pf"
  printf '%s' "$out" | grep -qi ok || die "Grok answered something unexpected on $GROK_MODEL: $(echo "$out" | tail -2 | cut -c1-200)"
  say "   $GROK_MODEL with tools off -> answered"

  d=$(mktemp -d "${TMPDIR:-/tmp}/fl.XXXXXX"); mkdir -p "$d/app/.council"; write_config mixed "$d/app/.council/config.yml"
  (cd "$d/app" && git init -q && COUNCIL_HOME="$d/h" with_timeout 600 node "$COUNCIL_JS" doctor) > "$d/doctor.log" 2>&1
  dc=$?; sed 's/^/   /' "$d/doctor.log" | tee -a "$RES/preflight.txt"
  rm -rf "$d"
  [ $dc = 0 ] || die "council doctor found a seat that does not answer (above)."
fi

say ""
say "Arms:"
has_arm mixed && say "  mixed  = council full loop: Lead PM $LEAD_MODEL (Antigravity), Chief Engineer $ENGINEER_MODEL (Claude Code), Chief Architect $GROK_MODEL (Grok)"
has_arm solo && say "  solo   = council full loop, all Claude Code: Lead PM $SOLO_SIDE_MODEL, Chief Engineer $ENGINEER_MODEL, Chief Architect $SOLO_SIDE_MODEL"
has_arm single && say "  single = one Claude Code agent on $ENGINEER_MODEL with the same task text"
{ echo "date: $(date '+%Y-%m-%d %H:%M %Z')"; echo "open-council-cli: $CLI_VERSION"; echo "benchmark commit: $(git -C "$BENCH" log -1 --format=%H -- . 2>/dev/null)";
  echo "arms: $ARMS"; echo "lead (mixed): $LEAD_MODEL"; echo "engineer: $ENGINEER_MODEL"; echo "architect (mixed): ${GROK_MODEL:-n/a}"; echo "solo side seats: $SOLO_SIDE_MODEL";
  echo "council profile: $PROFILE"; echo "runs: council $RUNS_COUNCIL per task, single $RUNS_SINGLE per task"; } > "$RES/meta.txt"
[ -n "${PREFLIGHT_ONLY:-}" ] && { say "Preflight passed."; exit 0; }

# ---------------------------------------------------------------- one run
LIMIT_RE='usage limit|limit reached|rate.limit|quota|resource.exhausted|too many requests|credit balance|out of credits|exceeded your|try again (later|in)'

make_repo() { # <task> <dir>: the task's repo as a fresh git checkout on main
  mkdir -p "$2" && cp -R "$BENCH/tasks/$1/repo/." "$2/" &&
  (cd "$2" && git init -q && git symbolic-ref HEAD refs/heads/main && git add -A && git -c user.email=bench@localhost -c user.name=bench commit -qm "Initial commit")
}

single_run() { # <task> <out> <work dir>
  local task=$1 out=$2 w=$3 code t0
  make_repo "$task" "$w/app" || return 1
  t0=$(date +%s)
  (cd "$w/app" && BENCH_CALLS_LOG="" with_timeout "$SINGLE_TIMEOUT" "$REAL_CLAUDE" -p "$(cat "$BENCH/tasks/$task/task.md")" --model "$ENGINEER_MODEL" \
     --permission-mode acceptEdits --strict-mcp-config --output-format json \
     --allowedTools "Read Edit Write Glob Grep Bash(npm test*) Bash(npm run *) Bash(node *) Bash(git diff*) Bash(git status*) Bash(git log*) Bash(ls*)") \
     > "$out/agent.json" 2> "$out/cli.log"
  code=$?
  node "$BENCH/lib/claude-json.cjs" "$out/agent.json" "$out/calls.jsonl" "$ENGINEER_MODEL" "$(( $(date +%s) - t0 ))" "$code" > "$out/result.md" 2>/dev/null
  grep -q '"is_error":true' "$out/calls.jsonl" 2>/dev/null && [ "$code" = 0 ] && code=1
  (cd "$w/app" && git add -A && git diff --cached HEAD > "$out/diff.patch")
  echo "$w/app" > "$out/tree"
  return $code
}

council_run() { # <arm> <task> <out> <work dir>
  local arm=$1 task=$2 out=$3 w=$4 sess sdir st tok code=0
  make_repo "$task" "$w/app" || return 1
  (cd "$w/app" && COUNCIL_HOME="$w/h" node "$COUNCIL_JS" init --full $([ "$PROFILE" = quick ] && echo --quick) > "$out/init.log" 2>&1) || { cat "$out/init.log" >> "$out/cli.log"; return 1; }
  write_config "$arm" "$w/app/.council/config.yml"
  (cd "$w/app" && git add -A && git -c user.email=bench@localhost -c user.name=bench commit -qm "Add .council")
  # A local bare repo stands in for GitHub, so the council's push step works as it would on a real
  # project and never reaches the network. Without an origin the push fails and a finished run reads as BLOCKED.
  git init -q --bare "$w/origin.git" && (cd "$w/app" && git remote add origin "$w/origin.git" && git push -q origin main) >> "$out/cli.log" 2>&1 || return 1
  export COUNCIL_HOME="$w/h" BENCH_CALLS_LOG="$out/calls.jsonl" BENCH_GH_LOG="$out/gh.log"
  local deadline=$(( $(date +%s) + COUNCIL_TIMEOUT ))
  left() { local l=$(( deadline - $(date +%s) )); [ $l -gt 30 ] && echo $l || echo 30; }
  sess=$(cd "$w/app" && with_timeout 300 node "$COUNCIL_JS" open "$task" --task-file "$BENCH/tasks/$task/task.md" $([ "$PROFILE" = quick ] && echo --quick) 2>> "$out/cli.log" | tail -1)
  sdir=$(ls -d "$w/h"/projects/*/sessions/"$sess" 2>/dev/null | head -1)
  [ -n "$sess" ] && [ -d "$sdir" ] || { echo "council open failed" >> "$out/cli.log"; return 1; }
  echo "$sess" > "$out/session-id"
  (cd "$w/app" && with_timeout "$(left)" node "$COUNCIL_JS" deliberate "$sess") >> "$out/cli.log" 2>&1 || code=$?
  st=$(node -p "require('$sdir/STATUS.json').status" 2>/dev/null)
  echo "deliberation: $st" > "$out/outcome"
  if [ "$st" = AWAITING_APPROVAL ]; then
    # The benchmark is the operator: it approves the signed-off plan unread, as a hands-off user would.
    tok=$(node -e 'const c=require("crypto"),f=require("fs");process.stdout.write("APPROVE "+c.createHash("sha256").update(f.readFileSync(process.argv[1])).digest("hex").slice(0,8))' "$sdir/brief-and-prd.md")
    (cd "$w/app" && node "$COUNCIL_JS" approve "$sess" "$tok" && node "$COUNCIL_JS" handoff "$sess") >> "$out/cli.log" 2>&1 || code=$?
    (cd "$w/app" && PATH="$ROOT/gh-shim:$PATH" with_timeout "$(left)" node "$COUNCIL_JS" run "$sess") >> "$out/cli.log" 2>&1 || code=$?
    st=$(node -p "require('$sdir/STATUS.json').status" 2>/dev/null)
    echo "execution: $st" >> "$out/outcome"
  fi
  cp -R "$sdir" "$out/session" 2>/dev/null
  local ew; ew=$(node -p "require('$sdir/STATUS.json').details.execWorktree || ''" 2>/dev/null)
  # A council that stalled in planning built nothing: it is scored on the untouched repo, so it counts as a miss.
  if [ -z "$ew" ] || [ ! -d "$ew" ]; then echo "$w/app" > "$out/tree"; fi
  if [ -n "$ew" ] && [ -d "$ew" ]; then
    echo "$ew" > "$out/tree"
    (cd "$ew" && git add -A >/dev/null 2>&1; git diff --cached "$(node -p "require('$sdir/meta.json').baseSha")" > "$out/diff.patch" 2>/dev/null)
  fi
  unset COUNCIL_HOME BENCH_CALLS_LOG BENCH_GH_LOG
  # A timeout that killed the council counts as an error, not a miss; a stall or a block is a result.
  [ "$code" = 142 ] && return 142
  return 0
}

done_run() { grep -qs '"status": "OK"' "$1/score.json" && { [ "$2" = single ] || grep -qs '"status": "OK"' "$1/flip.json"; }; }
run_job() { # <task> <arm> <n>
  local task=$1 arm=$2 n=$3 out=$RES/$1/$2-$3
  done_run "$out" "$arm" && return 0
  [ -f "$RES/STOP" ] && return 0
  if [ ! -f "$out/score.json" ] || ! grep -q '"status": "OK"' "$out/score.json"; then
    rm -rf "$out"; mkdir -p "$out"
    local w code t0; w=$(mktemp -d "${TMPDIR:-/tmp}/fl.XXXXXX"); t0=$(date +%s)
    if [ "$arm" = single ]; then single_run "$task" "$out" "$w"; else council_run "$arm" "$task" "$out" "$w"; fi
    code=$?
    echo "$code" > "$out/exit"; echo $(( $(date +%s) - t0 )) > "$out/seconds"
    if [ "$code" != 0 ] || [ ! -f "$out/tree" ]; then
      local st=ERROR
      [ "$code" = 142 ] && st=TIMEOUT
      if grep -qiE "$LIMIT_RE" "$out/cli.log" "$out/calls.jsonl" 2>/dev/null; then st=LIMIT; touch "$RES/STOP"; fi
      if [ "$arm" != single ] && grep -qs '"failures": *\[ *{' "$out/session/seats.json"; then st=SEAT-FAILURE; fi
      local detail; detail=$(grep -v '^\s*$' "$out/cli.log" 2>/dev/null | tail -1 | cut -c1-160 | tr -d '"\\')
      printf '{"status":"%s","detail":"exit %s: %s"}\n' "$st" "$code" "$detail" > "$out/score.json"
      echo "$task $arm $n: $st (exit $code) after $(cat "$out/seconds")s"
      rm -rf "$w"; return 0
    fi
    if [ "$arm" != single ] && grep -qs '"failures": *\[ *{' "$out/session/seats.json"; then
      printf '{"status":"SEAT-FAILURE","detail":"a seat failed (see session/seats.json); not scored"}\n' > "$out/score.json"
      echo "$task $arm $n: a seat failed, not scored"; rm -rf "$w"; return 0
    fi
    local line; line=$(node "$BENCH/lib/score.cjs" "$BENCH/tasks/$task" "$(cat "$out/tree")" "$out/tests.json")
    node -e 'const f=require("fs"),[o,s]=process.argv.slice(1);const t=JSON.parse(f.readFileSync(o+"/tests.json"));f.writeFileSync(o+"/score.json",JSON.stringify({status:"OK",passed:t.passed,seconds:+s},null,2))' "$out" "$(cat "$out/seconds")"
    echo "$task $arm $n: $line, $(cat "$out/outcome" 2>/dev/null | tr '\n' ' ')in $(cat "$out/seconds")s"
    rm -rf "$w"
  fi
  [ "$arm" = single ] && return 0
  # Late sign-off concerns: would one of them have flipped the gate on this run's failing hidden tests?
  node "$BENCH/lib/flip.cjs" prompt "$out" "$BENCH/tasks/$task" > "$out/flip.prompt.md"
  local jd; jd=$(mktemp -d "${TMPDIR:-/tmp}/fj.XXXXXX")
  if [ -s "$out/flip.prompt.md" ]; then
    (cd "$jd" && with_timeout "$JUDGE_TIMEOUT" "$REAL_CLAUDE" -p --model "$JUDGE_MODEL" --tools '' --strict-mcp-config --output-format json \
       --append-system-prompt 'You have no tools in this session: no file access, no shell, no web. Judge only the text in the prompt and answer in full; never say you will look something up.' \
       < "$out/flip.prompt.md") > "$jd/a.json" 2> "$out/flip.err"
    node "$BENCH/lib/claude-json.cjs" "$jd/a.json" "$out/judge-calls.jsonl" "$JUDGE_MODEL" 0 $? > "$out/flip.answer.txt" 2>/dev/null
  fi
  rm -rf "$jd"
  node "$BENCH/lib/flip.cjs" parse "$out" "$BENCH/tasks/$task"
}

# ---------------------------------------------------------------- the schedule
# Run 1 of every task and arm comes before any run 2, so a stop part-way still leaves a balanced set.
node -e '
  const [tasks, arms, runs] = [process.argv[1].split(/\s+/).filter(Boolean), process.argv[2].split(/\s+/).filter(Boolean), JSON.parse(process.argv[3])];
  const max = Math.max(...arms.map(a => runs[a]));
  let i = 0;
  for (let n = 1; n <= max; n++) for (const t of tasks) {
    const k = i++ % arms.length;
    for (const a of arms.slice(k).concat(arms.slice(0, k))) if (n <= runs[a]) console.log(`${t} ${a} ${n}`);
  }' "$TASKS" "$ARMS" "{\"mixed\":$RUNS_COUNCIL,\"solo\":$RUNS_COUNCIL,\"single\":$RUNS_SINGLE}" > "$RES/schedule.txt" || die "could not build the schedule"
todo=0; while read -r t a n; do done_run "$RES/$t/$a-$n" "$a" || todo=$((todo + 1)); done < "$RES/schedule.txt"
echo; echo "$todo runs to do, $PARALLEL at a time. Results: $RES. Stop with Ctrl-C; the same command resumes."
trap 'echo; echo "Stopped. Run the same command to resume."; kill $(jobs -p) 2>/dev/null; exit 130' INT TERM

while read -r t a n; do
  [ -f "$RES/STOP" ] && break
  run_job "$t" "$a" "$n" < /dev/null &
  sleep 3
  while [ "$(jobs -rp | wc -l | tr -d ' ')" -ge "$PARALLEL" ]; do sleep 5; done
done < "$RES/schedule.txt"
wait

node "$BENCH/lib/summarize.cjs" "$RES" "$BENCH" > "$ROOT/summary.md"
echo
if [ -f "$RES/STOP" ]; then
  echo "A seat hit a usage limit, so the batch stopped early. Wait for the limit to reset, then run the same command: it picks up where it stopped."
fi
echo "Summary: $ROOT/summary.md"
