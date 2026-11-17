#!/bin/sh
# Runs the checks in parallel and prints the output of the failing ones. A check
# is skipped if its inputs already passed it, in any worktree (content-keyed
# stamps in the common Git directory).

set -f # pathspecs below are for Git, not for the shell

stamps=$(git rev-parse --git-common-dir)/check-stamps
mkdir -p "$stamps"
find "$stamps" -type f -mtime +30 -delete
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT

# Hash of a check's name, Node, the installed dependencies and the files matching
# the pathspecs (tracked or not, present, not ignored).
key() {
  name=$1
  shift
  files=$(git ls-files -co --exclude-standard -- "$@" | while read -r f; do [ -e "$f" ] && echo "$f"; done)
  {
    echo "$name"
    node --version
    cat node_modules/.package-lock.json
    echo "$files"
    echo "$files" | git hash-object --stdin-paths
  } | git hash-object --stdin
}

# check <name> <pathspecs> <command>...
check() {
  name=$1
  # shellcheck disable=SC2086 # splits the pathspecs, globbing is off
  stamp=$stamps/$(key "$1" $2)
  shift 2
  if [ -e "$stamp" ]; then
    touch "$stamp" "$out/$name.skipped"
  elif "$@" >"$out/$name" 2>&1; then
    touch "$stamp"
  else
    return 1
  fi
}

check format '.' prettier --check . &
format=$!
check lint '*.js *.cjs *.mjs .gitignore package.json' node --run lint &
lint=$!
# Tests read only JS files and package.json: widen this if they read others.
check test '*.js *.cjs *.mjs package.json' node --run test &
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
