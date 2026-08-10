#!/usr/bin/env bash
# Fails if an always-read document has grown past its byte budget.
#
# WHY THIS IS A CI GUARD AND NOT A NOTE. `/update-docs` has said "keep
# HANDOVER.md under roughly 700 lines" since 2026-07-26, and its Final check asks
# "did HANDOVER.md grow past ~700 lines?". The file crossed 700 on 2026-08-06 and
# reached 1,001 lines by 2026-08-10 — five `/update-docs` runs answered that
# question and none of them acted on it. Before the 2026-07-26 trim the same file
# had reached 3,972 lines / 290 KB by exactly this route. A number in a checklist
# does not catch that; a failing build does.
#
# WHY BYTES AND NOT LINES. The two rules that actually govern growth are written
# as SHAPES, and a shape has no size:
#   • "everything older becomes a ledger LINE ... they cost ~25 tokens" — but a
#     markdown table row has no length limit. July rows are ~130 chars; the rows
#     written in August average ~1,050 and peak at 1,446. Ten times the budget
#     the rule states, while still being one row.
#   • "`_Last updated:` → today's date, with a ONE-LINE summary" — but the header
#     grew a `_Previously,_` chain five sessions deep, 138 lines before §1.
# Both stayed inside their shape the whole way up. Only a size catches them.
#
# HOW TO USE IT WHEN IT GOES RED. Do not raise the budget. The failure output
# ranks the oversized units so the cut is mechanical — trim those, then leave the
# budget where it is. Lower BUDGET after a real trim; raising it is how the guard
# becomes decoration.
#
# Run locally:  scripts/check-doc-budget.sh

set -euo pipefail
cd "$(dirname "$0")/.."

# Budget, in bytes. Set to the file's size on 2026-08-10, when the guard was
# written, so that it is a RATCHET: today's size is permitted, one more byte is
# not. TARGET is where the design says it belongs — the file was 38 KB after the
# 2026-07-26 trim, and §3 + the ledger are the two graduations that get it back.
# When a trim lands, drop BUDGET to the new size. Never raise it.
HANDOVER_BUDGET=91338
HANDOVER_TARGET=45000

# CLAUDE.md is loaded on EVERY session, so it is the most expensive file in the
# repo per byte. `/update-docs` Step 6 caps it at 200 lines; it sits at 127.
CLAUDE_MAX_LINES=200

fail=0

# ---------------------------------------------------------------------------
# HANDOVER.md — total size
# ---------------------------------------------------------------------------
size=$(wc -c < HANDOVER.md | tr -d ' ')
lines=$(wc -l < HANDOVER.md | tr -d ' ')

if ((size > HANDOVER_BUDGET)); then
  fail=1
  over=$((size - HANDOVER_BUDGET))
  echo "✗ HANDOVER.md is ${size} bytes (${lines} lines) — ${over} over its ${HANDOVER_BUDGET}-byte budget."
  echo
  echo "  HANDOVER.md is read at the start of every session. Growth here is paid"
  echo "  on every future session, forever. Cut, don't raise the budget."
  echo

  # Name the culprits, ranked, so the remedy is obvious rather than a restructure.

  # 1. Ledger rows. The rule says one row costing ~25 tokens (~130 chars, which
  #    is what the July rows actually cost). Anything far past that is a session
  #    narrative that was demoted in NAME only — the reasoning was supposed to
  #    move to docs/ and leave a pointer behind.
  echo "  Oversized ledger rows in §8 (budget ~200 chars each — a pointer, not a story):"
  awk '/^\| \*\*8/ { if (length($0) > 200) { n = $0; sub(/^\| \*\*/, "", n); sub(/\*\*.*/, "", n); printf "    §%-8s %5d chars\n", n, length($0) } }' HANDOVER.md \
    | sort -k2 -rn | head -8
  echo

  # 2. The header dateline chain. `_Last updated:_` is authorised to be a
  #    one-line summary. Every `_Previously,_` block below it is a second copy of
  #    a session that §8 already holds twice (full entry, then ledger row).
  chain=$(grep -c '^_Previously,' HANDOVER.md || true)
  # Measure to the index table, not to §1 — "Where everything lives" is the
  # index and earns its place; the datelines above it are what ratchet.
  hdr=$(awk '/^## Where everything lives/ { print NR - 1; exit }' HANDOVER.md)
  echo "  Dateline block: ${hdr} lines above the index, with ${chain} _Previously,_ entries."
  echo "    /update-docs authorises ONE line. Each _Previously,_ block is a third"
  echo "    copy of a session §8 already holds as a full entry and a ledger row."
  echo

  # 3. §3. Append-only by construction: every session adds what it verified and
  #    nothing prunes. Most of it restates PRD.md, which is the actual spec.
  s3=$(awk '/^## 3\./ { s = NR } /^## 4/ { if (s) { print NR - s; exit } }' HANDOVER.md)
  echo "  §3 (what works): ${s3} lines. Most bullets restate PRD.md; what is"
  echo "    load-bearing is the prohibitions and the verified-vs-specified split."
  echo
  echo "  Target after graduating §3 and the ledger: ${HANDOVER_TARGET} bytes."
  echo
else
  head=$((HANDOVER_BUDGET - size))
  echo "✓ HANDOVER.md ${size} bytes (${lines} lines) — ${head} under budget, target ${HANDOVER_TARGET}"
fi

# ---------------------------------------------------------------------------
# CLAUDE.md — line cap
# ---------------------------------------------------------------------------
cl=$(wc -l < CLAUDE.md | tr -d ' ')
if ((cl > CLAUDE_MAX_LINES)); then
  fail=1
  echo "✗ CLAUDE.md is ${cl} lines, over its ${CLAUDE_MAX_LINES}-line cap."
  echo "  It loads on every session. A new gotcha belongs in docs/GOTCHAS.md;"
  echo "  promote one up here only if a session could break something expensive"
  echo "  WITHOUT having read the gotchas file."
else
  echo "✓ CLAUDE.md ${cl} lines — under its ${CLAUDE_MAX_LINES}-line cap"
fi

exit $fail
