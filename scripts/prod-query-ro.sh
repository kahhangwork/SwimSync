#!/usr/bin/env bash
# Read-only SQL against PRODUCTION (the linked project).
#
#   scripts/prod-query-ro.sh "select count(*) from students"
#
# The guard is Postgres, not a keyword filter: the transaction is switched to
# READ ONLY before the query runs, so any write — including one hidden inside
# a CTE or a function call — is refused by the database ("cannot execute ...
# in a read-only transaction"). A single statement only: a semicolon would let
# a second statement COMMIT and run outside the read-only transaction.
#
# ⚠ It must be SET TRANSACTION, not SET SESSION CHARACTERISTICS. The Management
# API runs the whole string as ONE transaction, so a session-level setting only
# applies to the NEXT one — it reported transaction_read_only = off, silently.
# Proven 2026-10-05: `create temp table …` through this script was refused with
# 25006. Not a guard against dblink/postgres_fdw, which open their own connection.
set -euo pipefail

sql="${1:-}"
if [[ -z "$sql" ]]; then
  echo "usage: $0 \"<one SELECT statement>\"" >&2
  exit 2
fi
if [[ "$sql" == *";"* ]]; then
  echo "refused: one statement only (no ';')" >&2
  exit 2
fi

cd "$(dirname "$0")/.."
exec supabase db query --linked \
  "SET TRANSACTION READ ONLY; $sql"
