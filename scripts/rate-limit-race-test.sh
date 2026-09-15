#!/bin/sh
# ============================================================
# Shop Web — the throttle under concurrency
#
#   su postgres -c 'sh scripts/rate-limit-race-test.sh <db>'
#
# The check that matters most and that a single psql session cannot
# make. Without the advisory lock in app.take_rate_token, forty
# simultaneous callers all read a count below the limit and all insert,
# and the limit means nothing under exactly the conditions it exists
# for. So: forty real sessions, one key, at once. Exactly ten may pass.
#
# Committed rather than rolled back, on a throwaway key, because a
# rolled-back transaction holds its locks to the end and would serialise
# the very thing being tested.
# ============================================================
set -e
DB="${1:-sw_rate}"
KEY="race-$(date +%s)-$$"
N=40
LIMIT=10

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

i=1
while [ "$i" -le "$N" ]; do
  (
    psql -d "$DB" -tAX -c \
      "select app.take_rate_token('race_test', '$KEY', $LIMIT, interval '1 hour');" \
      > "$TMP/$i" 2>/dev/null
  ) &
  i=$((i + 1))
done
wait

ALLOWED=$(cat "$TMP"/* | grep -c '^t$' || true)
REFUSED=$(cat "$TMP"/* | grep -c '^f$' || true)
ROWS=$(psql -d "$DB" -tAX -c \
  "select count(*) from app.rate_events where bucket = 'race_test' and key = '$KEY';")

psql -d "$DB" -qc \
  "delete from app.rate_events where bucket = 'race_test' and key = '$KEY';"

echo "concurrent callers: $N   allowed: $ALLOWED   refused: $REFUSED   rows: $ROWS"

if [ "$ALLOWED" -ne "$LIMIT" ]; then
  echo "FAIL $ALLOWED callers passed a limit of $LIMIT"
  exit 1
fi
if [ "$ROWS" -ne "$LIMIT" ]; then
  echo "FAIL $ROWS rows recorded for a limit of $LIMIT"
  exit 1
fi
if [ "$REFUSED" -ne $((N - LIMIT)) ]; then
  echo "FAIL $REFUSED refusals, expected $((N - LIMIT))"
  exit 1
fi
echo "PASS exactly $LIMIT of $N concurrent callers passed the limit"
echo "ALL RATE LIMIT RACE CHECKS PASSED"
