#!/usr/bin/env bash
# Applies every migration to a throwaway local Postgres, runs the SQL tests in
# test/sql/, rolls 0017 back with its down script, and re-applies it.
# Needs Postgres 16 binaries (initdb/pg_ctl). Never touches a real database.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
WORK="$(mktemp -d)"
PORT="${PG_TEST_PORT:-55439}"
RUN=""
if [ "$(id -u)" = "0" ]; then chown postgres "$WORK"; RUN="runuser -u postgres --"; fi
cleanup() { $RUN "$BIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
$RUN "$BIN/initdb" -D "$WORK/data" -U postgres -A trust >/dev/null
$RUN "$BIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=''" -l "$WORK/log" start >/dev/null
export PGOPTIONS="-c client_min_messages=warning"
PSQL=(psql -X -q -v ON_ERROR_STOP=1 -h "$WORK" -p "$PORT" -U postgres -d postgres)
"${PSQL[@]}" -f "$ROOT/test/sql/stubs.sql"
for f in "$ROOT"/supabase/migrations/[0-9]*.sql; do
  case "$f" in *.down.sql) continue;; esac
  # Extensions that only exist on Supabase are stubbed in stubs.sql.
  sed -e 's/^create extension if not exists pg_net;//' -e 's/^create extension if not exists pg_cron;//' "$f" \
    | "${PSQL[@]}" -f - >/dev/null || { echo "FAILED applying $(basename "$f")"; exit 1; }
done
echo "migrations: applied"
for t in "$ROOT"/test/sql/[0-9]*_test.sql; do
  "${PSQL[@]}" -f "$t" || { echo "FAILED $(basename "$t")"; exit 1; }
  echo "ok - $(basename "$t")"
done
if "${PSQL[@]}" -f "$ROOT/supabase/migrations/0017_dose_integrity_and_safety.down.sql" >/dev/null 2>"$WORK/down.err"; then
  echo "FAILED: down migration ran although precise/mcg rows exist"; exit 1
fi
grep -q "Refusing to roll back 0017" "$WORK/down.err" || { cat "$WORK/down.err"; exit 1; }
echo "ok - down migration refuses to round existing doses"
"${PSQL[@]}" -c "delete from myday_doses; delete from myday_refills; delete from myday_medications;" >/dev/null
"${PSQL[@]}" -f "$ROOT/supabase/migrations/0017_dose_integrity_and_safety.down.sql" >/dev/null
echo "ok - down migration applies cleanly on an empty database"
"${PSQL[@]}" -f "$ROOT/supabase/migrations/0017_dose_integrity_and_safety.sql" >/dev/null
echo "ok - 0017 re-applies after rollback"
