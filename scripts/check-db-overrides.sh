#!/usr/bin/env bash
# Every NULL-widening in lib/database.overrides.ts names a real, non-STRICT function
# and real parameters. Wave 8 (docs/plans/WAVE8_GENERATED_TYPES_PLAN.md, F0 step 5,
# RISK 3). Run by G5 (scripts/check-db-types.sh), which already has the DB.
#
# WHY. The generated RPC Args type every param as non-null. Where the SQL handles a
# NULL argument, the app's overrides widen it, from ONE machine-readable const:
#   export const NULLABLE_RPC_ARGS = { fn_name: ["p_arg", …], … } as const;
# A widening that names a misspelled param or a dropped function silently widens
# nothing; one on a STRICT function makes the call return NULL WITHOUT RUNNING its
# body (§7.346). This check reads pg_proc, never a migration file (§7.40).
#
# THE RULE, per listed function: it exists in `public`; NO overload is STRICT; and
# at least one overload has every listed name as an INPUT parameter.
#
# Also TRIGGER_FILLED_COLUMNS ({ table: ["col", …] }): an insert may omit a NOT NULL
# column only because a trigger fills it. Per column: it exists on public.<table> and
# is NOT NULL (else the entry is stale), and an ENABLED BEFORE INSERT ROW trigger's
# function assigns NEW.<col> (`NEW.col :=` or `INTO …, NEW.col`). That proves an
# assignment exists, not that it is unconditional — the entry's citation says when.
#
# Usage:
#   scripts/check-db-overrides.sh          # both apps' lib/database.overrides.ts
#   scripts/check-db-overrides.sh FILE...  # just these (proofs)
# Exit: 0 clean · 1 a bad entry · 2 the check itself is broken.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/db-types.sh
source "$ROOT/scripts/lib/db-types.sh"
CONTAINER=$(db_types_container "$ROOT")

if (($# > 0)); then
  FILES=("$@")
else
  FILES=("$ROOT/SwimSyncApp/lib/database.overrides.ts" "$ROOT/SwimSyncAdmin/lib/database.overrides.ts")
fi

# "key v1 v2" per line, from the `export const <$2> = { … } as const` block
# (comments stripped). $2 defaults to NULLABLE_RPC_ARGS.
entries_of() {
  BLOCK=${2:-NULLABLE_RPC_ARGS} perl -0777 -ne '
    my $name = $ENV{BLOCK};
    /export const \Q$name\E\b[^=]*=\s*\{(.*?)\}\s*as const/s or do { print "!NOBLOCK\n"; exit };
    my $b = $1; $b =~ s{//[^\n]*}{}g; $b =~ s{/\*.*?\*/}{}gs;
    while ($b =~ /(\w+)\s*:\s*\[([^\]]*)\]/g) {
      my ($fn, $list) = ($1, $2); my @p = ($list =~ /["\x27](\w+)["\x27]/g);
      print join(" ", $fn, @p), "\n";
    }' "$1"
}

sql() { docker exec "$CONTAINER" psql -U postgres -d postgres -At -F'|' -c "$1"; }
sql "select 1" >/dev/null 2>&1 || { echo "✗ local Supabase stack is not reachable ($CONTAINER)" >&2; exit 2; }

bad=0; n=0; tn=0
for f in "${FILES[@]}"; do
  [[ -f "$f" ]] || { echo "✗ no such file: $f" >&2; exit 2; }
  rel=${f#"$ROOT"/}
  out=$(entries_of "$f")
  if [[ "$out" == "!NOBLOCK" ]]; then
    echo "✗ $rel: no \`export const NULLABLE_RPC_ARGS = { … } as const\` block" >&2; exit 2
  fi
  while read -r fn params; do
    [[ -n "$fn" ]] || continue
    n=$((n + 1))
    [[ "$fn" =~ ^[a-z_][a-z0-9_]*$ ]] || { echo "✗ $rel: bad function name '$fn'" >&2; bad=1; continue; }
    # One row per overload: strict flag | comma-separated INPUT parameter names.
    rows=$(sql "select p.proisstrict, case when p.proargnames is null then '' else array_to_string(array(
                  select a.name from unnest(p.proargnames,
                    coalesce(p.proargmodes, array_fill('i'::\"char\", array[cardinality(p.proargnames)])))
                    as a(name, mode) where a.mode in ('i','b','v')), ',') end
                from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
                where ns.nspname = 'public' and p.proname = '$fn'")
    if [[ -z "$rows" ]]; then
      echo "✗ $rel: $fn — no such function in public" >&2; bad=1; continue
    fi
    if grep -q '^t|' <<<"$rows"; then
      echo "✗ $rel: $fn is STRICT — a NULL argument returns NULL without running the body (§7.346)" >&2
      bad=1; continue
    fi
    matched=0
    while IFS='|' read -r _strict names; do
      ok=1
      for p in $params; do
        [[ ",$names," == *",$p,"* ]] || { ok=0; break; }
      done
      ((ok)) && { matched=1; break; }
    done <<<"$rows"
    if ((!matched)); then
      echo "✗ $rel: $fn has no overload taking all of: $params" >&2
      echo "    its input parameters: $(cut -d'|' -f2 <<<"$rows" | paste -sd ';' -)" >&2
      bad=1
    fi
  done <<<"$out"

  tout=$(entries_of "$f" TRIGGER_FILLED_COLUMNS)
  [[ "$tout" == "!NOBLOCK" ]] && tout=""   # optional block
  while read -r tbl cols; do
    [[ -n "$tbl" ]] || continue
    [[ "$tbl" =~ ^[a-z_][a-z0-9_]*$ ]] || { echo "✗ $rel: bad table name '$tbl'" >&2; bad=1; continue; }
    if [[ "$(sql "select to_regclass('public.$tbl') is not null")" != "t" ]]; then
      echo "✗ $rel: TRIGGER_FILLED_COLUMNS: no table public.$tbl" >&2; bad=1; continue
    fi
    for col in $cols; do
      tn=$((tn + 1))
      [[ "$col" =~ ^[a-z_][a-z0-9_]*$ ]] || { echo "✗ $rel: bad column name '$col'" >&2; bad=1; continue; }
      verdict=$(sql "select case
          when not exists (select 1 from pg_attribute a where a.attrelid = 'public.$tbl'::regclass
                             and a.attname = '$col' and a.attnum > 0 and not a.attisdropped) then 'no-column'
          when not (select a.attnotnull from pg_attribute a where a.attrelid = 'public.$tbl'::regclass
                      and a.attname = '$col') then 'nullable'
          when exists (select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid
                        where t.tgrelid = 'public.$tbl'::regclass and not t.tgisinternal
                          and t.tgenabled <> 'D'
                          and (t.tgtype & 1) = 1 and (t.tgtype & 2) = 2 and (t.tgtype & 4) = 4
                          and (p.prosrc ~* '(^|[^a-z_.])new\.$col\s*:='
                               or p.prosrc ~* 'into\s+(new\.[a-z_]+\s*,\s*)*new\.$col([^a-z_]|\$)'))
            then 'ok'
          else 'no-trigger' end")
      case "$verdict" in
        ok) ;;
        no-column)  echo "✗ $rel: TRIGGER_FILLED_COLUMNS: public.$tbl has no column $col" >&2; bad=1 ;;
        nullable)   echo "✗ $rel: TRIGGER_FILLED_COLUMNS: $tbl.$col is nullable — already optional on insert; drop the entry" >&2; bad=1 ;;
        no-trigger) echo "✗ $rel: TRIGGER_FILLED_COLUMNS: no enabled BEFORE INSERT row trigger on $tbl assigns NEW.$col" >&2; bad=1 ;;
        *)          echo "✗ $rel: TRIGGER_FILLED_COLUMNS: $tbl.$col — check failed: $verdict" >&2; exit 2 ;;
      esac
    done
  done <<<"$tout"
done

if ((bad)); then exit 1; fi
echo "✓ overrides: $n NULLABLE_RPC_ARGS entr$( ((n == 1)) && echo y || echo ies) — every function exists, none STRICT, every param real"
echo "✓ overrides: $tn TRIGGER_FILLED_COLUMNS column(s) — each NOT NULL and filled by an enabled BEFORE INSERT trigger"
