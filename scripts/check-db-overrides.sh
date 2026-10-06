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
# is NOT NULL (else the entry is stale), and a qualifying trigger assigns NEW.<col>
# (rules in scripts/lib/trigger-fill.sql). That proves an assignment exists, not that
# it is unconditional — the entry's citation says when.
#
# Both blocks must be plain `name: ["a", …],` entries: a quoted, spread or computed key
# is still applied by TypeScript but invisible to this parser, so it fails here.
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
    # STRICT grammar: `ident: ["a", "b"],` entries and nothing else. A quoted, spread
    # or computed key is still applied by TypeScript but would be invisible here.
    my $entry = qr/[a-z_][a-z0-9_]*\s*:\s*\[\s*(?:["\x27][a-z_][a-z0-9_]*["\x27]\s*,?\s*)*\]\s*,?\s*/;
    $b =~ /\A\s*(?:$entry)*\z/ or do { print "!UNPARSED\n"; exit };
    while ($b =~ /(\w+)\s*:\s*\[([^\]]*)\]/g) {
      my ($fn, $list) = ($1, $2); my @p = ($list =~ /["\x27](\w+)["\x27]/g);
      print join(" ", $fn, @p), "\n";
    }' "$1"
}

sql() { docker exec "$CONTAINER" psql -U postgres -d postgres -At -F'|' -c "$1"; }
sql "select 1" >/dev/null 2>&1 || { echo "✗ local Supabase stack is not reachable ($CONTAINER)" >&2; exit 2; }

# ok | no-column | nullable | no-trigger — the rules are in scripts/lib/trigger-fill.sql.
fill_verdict() {
  docker exec -i "$CONTAINER" psql -U postgres -d postgres -At -v ON_ERROR_STOP=1 \
    -v tbl="$1" -v col="$2" <"$ROOT/scripts/lib/trigger-fill.sql"
}

bad=0; n=0; tn=0
for f in "${FILES[@]}"; do
  [[ -f "$f" ]] || { echo "✗ no such file: $f" >&2; exit 2; }
  rel=${f#"$ROOT"/}
  out=$(entries_of "$f")
  if [[ "$out" == "!NOBLOCK" ]]; then
    echo "✗ $rel: no \`export const NULLABLE_RPC_ARGS = { … } as const\` block" >&2; exit 2
  fi
  if [[ "$out" == "!UNPARSED" ]]; then
    echo "✗ $rel: NULLABLE_RPC_ARGS holds something other than \`name: [\"p_a\", …],\` entries (a quoted, spread or computed key?) — this check cannot see it" >&2
    bad=1; out=""
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
  if [[ "$tout" == "!NOBLOCK" ]]; then   # dropping it (or its `as const`) silently widens nothing-or-everything
    echo "✗ $rel: no \`export const TRIGGER_FILLED_COLUMNS = { … } as const\` block" >&2; exit 2
  fi
  if [[ "$tout" == "!UNPARSED" ]]; then
    echo "✗ $rel: TRIGGER_FILLED_COLUMNS holds something other than \`table: [\"col\", …],\` entries — this check cannot see it" >&2
    bad=1; tout=""
  fi
  while read -r tbl cols; do
    [[ -n "$tbl" ]] || continue
    [[ "$tbl" =~ ^[a-z_][a-z0-9_]*$ ]] || { echo "✗ $rel: bad table name '$tbl'" >&2; bad=1; continue; }
    if [[ "$(sql "select to_regclass('public.$tbl') is not null")" != "t" ]]; then
      echo "✗ $rel: TRIGGER_FILLED_COLUMNS: no table public.$tbl" >&2; bad=1; continue
    fi
    for col in $cols; do
      tn=$((tn + 1))
      [[ "$col" =~ ^[a-z_][a-z0-9_]*$ ]] || { echo "✗ $rel: bad column name '$col'" >&2; bad=1; continue; }
      verdict=$(fill_verdict "$tbl" "$col")
      case "$verdict" in
        ok) ;;
        no-column)  echo "✗ $rel: TRIGGER_FILLED_COLUMNS: public.$tbl has no column $col" >&2; bad=1 ;;
        nullable)   echo "✗ $rel: TRIGGER_FILLED_COLUMNS: $tbl.$col is nullable — already optional on insert; drop the entry" >&2; bad=1 ;;
        no-trigger) echo "✗ $rel: TRIGGER_FILLED_COLUMNS: no qualifying trigger on $tbl assigns NEW.$col (enabled, BEFORE INSERT ROW, no WHEN; comments/strings/`:= NULL` ignored)" >&2; bad=1 ;;
        *)          echo "✗ $rel: TRIGGER_FILLED_COLUMNS: $tbl.$col — check failed: $verdict" >&2; exit 2 ;;
      esac
    done
  done <<<"$tout"
done

if ((bad)); then exit 1; fi
echo "✓ overrides: $n NULLABLE_RPC_ARGS entr$( ((n == 1)) && echo y || echo ies) — every function exists, none STRICT, every param real"
echo "✓ overrides: $tn TRIGGER_FILLED_COLUMNS column(s) — each NOT NULL and filled by an enabled BEFORE INSERT trigger"
