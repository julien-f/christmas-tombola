#!/bin/sh
# Runs the checks in parallel and prints the output of the failing ones. A check
# is skipped if it already passed on the same inputs, in any worktree
# (content-keyed stamps in the common Git directory).

stamps=$(git rev-parse --git-common-dir)/check-stamps
mkdir -p "$stamps"
find "$stamps" -type f -mtime +30 -delete
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT
trap 'exit 130' INT TERM

# Hash of Node, the installed dependencies and every file not ignored by
# .gitignore (the ignores ESLint and Prettier use), tracked or not. Empty if it
# can't be computed: everything runs and nothing is stamped.
key=
# shellcheck disable=SC2016 # $f expands in the inner shell
git ls-files -z -co --exclude-from=.gitignore |
  xargs -0 sh -c 'for f; do [ -e "$f" ] && printf "%s\0" "$f"; done' sh >"$out/files" &&
  xargs -0 git hash-object --no-filters -- <"$out/files" >"$out/hashes" &&
  { cat node_modules/.package-lock.json "$out/files" "$out/hashes" && node --version; } >"$out/inputs" &&
  key=$(git hash-object --no-filters "$out/inputs") ||
  key=

# check <name> <command>...
check() {
  name=$1
  shift
  stamp=$stamps/$name-$key
  if [ -n "$key" ] && [ -e "$stamp" ]; then
    touch "$stamp" "$out/$name.skipped"
  elif "$@" >"$out/$name" 2>&1; then
    [ -z "$key" ] || touch "$stamp"
  else
    return 1
  fi
}

check format prettier --check . --cache &
format=$!
check lint node --run lint &
lint=$!
check test node --run test &
test=$!

status=0
report() {
  if wait "$2"; then
    if [ -e "$out/$1.skipped" ]; then echo "✔ $1 (unchanged)"; else echo "✔ $1"; fi
  else
    echo "✖ $1"
    cat "$out/$1"
    status=1
  fi
}
report format "$format"
report lint "$lint"
report test "$test"
exit $status
