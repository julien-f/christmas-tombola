#!/bin/sh
# Runs the checks in parallel and prints the output of the failing ones.

out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT

prettier --check . >"$out/format" 2>&1 &
format=$!
node --run lint >"$out/lint" 2>&1 &
lint=$!
node --run test >"$out/test" 2>&1 &
test=$!

status=0
report() {
  if wait "$2"; then
    echo "✔ $1"
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
