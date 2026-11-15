# Sourced by run.sh. How a failed run is labelled, and when the batch stops.
# Antigravity asking to sign in again (it opens a browser page and waits for a code it can't get here).
SIGNIN_RE='accounts\.google\.com|paste (this|the) code|authorization code|(sign|log) ?in (again|required|to continue)|not (signed|logged) in|re-?authenticat'
LIMIT_RE='usage limit|limit reached|rate.limit|quota|resource.exhausted|too many requests|credit balance|out of credits|exceeded your|try again (later|in)'

# classify_failure OUT CODE RES: prints ERROR, TIMEOUT, LIMIT or SIGNIN for a run that exited CODE, and
# writes RES/STOP when the batch must stop (it holds "signin" for a sign-in, so the end message can say so).
classify_failure() {
  local out=$1 code=$2 res=$3 st=ERROR
  [ "$code" = 142 ] && st=TIMEOUT
  if grep -qiE "$LIMIT_RE" "$out/cli.log" "$out/calls.jsonl" 2>/dev/null && [ "$st" = ERROR ]; then st=LIMIT; touch "$res/STOP"; fi
  if grep -qiE "$SIGNIN_RE" "$out/agy-stderr.log" 2>/dev/null; then st=SIGNIN; echo signin > "$res/STOP"; fi
  echo "$st"
}
