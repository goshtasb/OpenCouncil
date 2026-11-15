#!/bin/bash
# Builds the review checkout for one task: branch "main" at the PR's base commit and branch "pr" with
# the PR's change as one commit on top, checked out.
#   bash fixture.sh <tasks.json> <task id> <cache dir> <dest dir>
# The two commits are fetched once (depth 1) from the public fork into <cache dir>/<fork>.git, and a
# template repo per task is built once in <cache dir>/templates/<task id>; each run is a local clone of it.
# Nothing in the fetched code is installed, built or run.
set -eu
TASKS=$1; ID=$2; CACHE=$3; DEST=$4
read -r REPO BASE HEAD TITLE < <(node -e '
  const t = require(process.argv[1]).tasks.find(x => x.id === process.argv[2]);
  if (!t) { console.error("unknown task " + process.argv[2]); process.exit(2); }
  console.log([t.source.repo, t.source.base_sha, t.source.head_sha, t.title].join(" "));' "$TASKS" "$ID")
FORK=$(basename "$REPO")
G=$CACHE/$FORK.git
T=$CACHE/templates/$ID
mkdir -p "$CACHE/templates"

if [ ! -f "$T/.ready" ]; then
  [ -d "$G" ] || git init -q --bare "$G"
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
  touch "$T/.ready"
fi

rm -rf "$DEST"
git clone -q -b pr "$T" "$DEST"
git -C "$DEST" branch -q main origin/main
git -C "$DEST" remote remove origin
printf '* -text -filter\n' > "$DEST/.git/info/attributes"
[ -z "$(git -C "$DEST" status --porcelain)" ] || { echo "checkout for $ID is not clean" >&2; exit 1; }
