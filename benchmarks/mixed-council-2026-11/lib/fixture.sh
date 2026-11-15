#!/bin/bash
# Builds the review checkout for one task: branch "main" at the PR's base commit and branch "pr" with
# the PR's change as one commit on top, checked out.
#   bash fixture.sh <tasks.json> <task id> <cache dir> <dest dir>
# The two commits are fetched once (depth 1) from the public fork into <cache dir>/<fork>.git, and a
# template repo per task is built once in <cache dir>/templates/<task id>; each run is a local clone of it.
# Nothing in the fetched code is installed, built or run.
set -eu -o pipefail
TASKS=$1; ID=$2; CACHE=$3; DEST=$4
read -r REPO BASE HEAD TITLE < <(node -e '
  const t = require(process.argv[1]).tasks.find(x => x.id === process.argv[2]);
  if (!t) { console.error("unknown task " + process.argv[2]); process.exit(2); }
  console.log([t.source.repo, t.source.base_sha, t.source.head_sha, t.title].join(" "));' "$TASKS" "$ID")
FORK=$(basename "$REPO")
G=$CACHE/$FORK.git
T=$CACHE/templates/$ID
mkdir -p "$CACHE/templates"

# Two runs start in parallel, often on the same task (or two tasks from the same fork), so building the
# shared bare repo and template is done by one run at a time. mkdir is atomic on every filesystem and
# macOS has no flock; a lock left by a run that was killed is taken over once its process is gone.
# A finished template is never rebuilt, so a run whose template is ready skips the lock. A run waits for
# the lock at most LOCK_TIMEOUT seconds (default 45 minutes: one cold fetch of a large fork); past that
# its checkout fails and the run stays unscored, to be re-run.
L=$CACHE/.build-lock
ready() { [ -f "$T/.ready" ] && [ -s "$CACHE/templates/$ID.tree" ]; }
if ! ready; then
  waited=0
  until mkdir "$L" 2>/dev/null; do
    if [ -f "$L/pid" ] && ! kill -0 "$(cat "$L/pid" 2>/dev/null)" 2>/dev/null; then rm -rf "$L"; continue; fi
    [ $waited -ge "${LOCK_TIMEOUT:-2700}" ] && { echo "timed out waiting for another run to build the repo cache" >&2; exit 1; }
    sleep 2; waited=$((waited + 2))
  done
  echo $$ > "$L/pid"
  trap 'rm -rf "$L"' EXIT
fi

# git's automatic housekeeping (gc --auto) runs detached after a commit or fetch that leaves many loose
# objects, and outlives the lock. It packs and then deletes loose objects, so a run cloning the template
# (or archiving from the bare repo) while it runs fails with "failed to copy file to ...: No such file or
# directory" or missing objects. It is off for the cache, and a clone waits out one already running.
gc_busy() { [ -f "$1/gc.pid" ] && kill -0 "$(awk '{print $1}' "$1/gc.pid" 2>/dev/null)" 2>/dev/null; }
wait_gc() { local i=0; while gc_busy "$1" && [ $i -lt 600 ]; do sleep 1; i=$((i + 1)); done; }
build() {
  [ -d "$G" ] || git init -q --bare "$G"
  git -C "$G" config gc.auto 0; git -C "$G" config maintenance.auto false
  wait_gc "$G"
  for sha in "$BASE" "$HEAD"; do
    git -C "$G" cat-file -e "$sha^{commit}" 2>/dev/null && continue
    n=0
    until GIT_LFS_SKIP_SMUDGE=1 git -C "$G" fetch -q --depth=1 --no-tags "$REPO" "$sha"; do
      n=$((n + 1)); [ $n -ge 4 ] && { echo "could not fetch $sha from $REPO" >&2; exit 1; }
      sleep $((2 ** n))
    done
  done
  rm -rf "$T"; mkdir -p "$T"
  git -C "$T" init -q -b main
  git -C "$T" config gc.auto 0; git -C "$T" config maintenance.auto false
  git -C "$T" config user.name "Benchmark"; git -C "$T" config user.email bench@example.invalid
  git -C "$T" config commit.gpgsign false; git -C "$T" config core.autocrlf false
  # Store every file byte for byte: the repo's own .gitattributes (line endings, LFS filters) must not rewrite it.
  printf '* -text -filter\n' > "$T/.git/info/attributes"
  git -C "$G" archive "$BASE" | tar -x -C "$T"
  git -C "$T" add -A -f >/dev/null; git -C "$T" commit -q --no-verify -m "Base for review"
  git -C "$T" checkout -q -b pr
  git -C "$G" diff --binary --no-renames "$BASE" "$HEAD" > "$CACHE/templates/$ID.patch"
  [ -s "$CACHE/templates/$ID.patch" ] || { echo "empty diff for $ID" >&2; exit 1; }
  git -C "$T" apply --index --whitespace=nowarn "$CACHE/templates/$ID.patch"
  git -C "$T" commit -q --no-verify -m "$TITLE"
  # The change must match the PR exactly.
  [ "$(git -C "$T" rev-parse HEAD^{tree})" = "$(git -C "$G" rev-parse "$HEAD^{tree}")" ] || { echo "tree mismatch for $ID" >&2; exit 1; }
  git -C "$G" rev-parse "$HEAD^{tree}" > "$CACHE/templates/$ID.tree"
  touch "$T/.ready"
}
if ! ready; then
  # A bare repo that two fetches wrote to at once can be left broken (missing objects); if building
  # from it fails, start that fork's cache over once.
  rm -f "$T/.ready"
  ( build ) || { echo "rebuilding the $FORK cache from scratch" >&2; rm -rf "$G" "$T"; ( build ); } || exit 1
fi
if [ -d "$L" ] && [ "$(cat "$L/pid" 2>/dev/null)" = $$ ]; then rm -rf "$L"; trap - EXIT; fi

rm -rf "$DEST"
wait_gc "$T/.git"
git clone -q -b pr "$T" "$DEST"
git -C "$DEST" branch -q main origin/main
git -C "$DEST" remote remove origin
printf '* -text -filter\n' > "$DEST/.git/info/attributes"
[ -z "$(git -C "$DEST" status --porcelain)" ] || { echo "checkout for $ID is not clean" >&2; exit 1; }
# The checkout must hold the PR's exact change (guards against cloning a template mid-build).
[ "$(git -C "$DEST" rev-parse HEAD^{tree})" = "$(cat "$CACHE/templates/$ID.tree")" ] || { echo "checkout for $ID does not match the PR" >&2; exit 1; }
