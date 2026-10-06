# Handoff — worktree `wave7-tests` (Wave 7 lane2: CI guards G1–G4 + pgTAP clock conversion)

_Written by lane2 at `/worktree-close`, 2026-10-06. Consumed and `git rm`'d by `/update-docs` (lane1, root, on main)._

**Landed on main:** G1–G4 (`fec8dc5`, G1 JSON-key fix `8c44c54`), batch 1 (`0e258d1`), batch 2a–2d
(`9f70b69`, `6d2c75a`, `5e2e2de`, `73004ed`) incl. `supabase/tests/app_clock_edges.test.sql`. Final merge `4d8cc90`:
92 files / 1991 pgTAP tests green, G1–G4 rc 0, G1 required since T5.
**Shared DB:** nothing left (no `wt-wave7-` rows, no edge tenants). **Ports:** none were used.

## To graduate

### Gotchas (→ `docs/GOTCHAS.md`, next §7.N)

1. **Literalizing a clock call can turn an assertion into a tautology.** A converter that replaces every
   `session_window_start()` with its pinned value also rewrites the ACTUAL side of
   `is(session_window_start(), d_floor)` → `is('2026-08-01', '2026-08-01')`, green forever. A names-identical check
   cannot see it (lane1 caught `attendance_window` #1–2 in review). Rule: a literal may replace fixture data or the
   EXPECTED value, never the actual/subject of an is/isnt/ok/cmp_ok/results_eq that was a clock function. Audit two
   ways: a diff-based scan (statements where a clock call disappeared) and a structural scan (no function call, no
   FROM, no column in the first argument). After the fix both found 0 hits in all 82 converted files, and the
   structural scan also finds 0 in the 82 originals.
2. **`cmd | grep -q` under `set -o pipefail` reads a MATCH as no-match.** `grep -q` exits on the first hit, the
   producer takes SIGPIPE (141), and the pipeline's status is failure. G1's first draft classified 2 of 82 dated
   files as date-free that way. Use `grep -q PAT <(cmd)`, `grep -m1`, or let awk do the limiting
   (`scripts/lib/pgtap-pin.sh` documents it).
3. **A regex date-literalizer must mask string literals.** Descriptions mention `today_sg()`, and rewriting them
   broke one file (`''2026-08-01'::date …`). The mask must keep `'Asia/Singapore'` visible for the
   `(app_now() AT TIME ZONE 'Asia/Singapore')::date` pattern, and a `± N` chain must stop before `N * 7`
   (precedence: `+ 52 * 7` would otherwise become `'…'::date * 7`).
4. (process) **`git reset --hard` to rewrite a branch also discards uncommitted work in that tree.** It lost the 4d
   conversions once; they were regenerated from the scripted pipeline. WIP-commit before any reset.

### Consequences / plan facts (→ `docs/plans/WAVE7_DB_CLOCK_PLAN.md` or TESTING)

- **G1 hit count = 82 of 90** (the plan's "80" was an estimate; D1 already said 82). Stable under three predicates
  (raw / comments stripped / + `CURRENT_*`, `::date`, `interval`). Date-free (8, audited: their only "date" is in
  regprocedure signatures): app_settings_dead_keys, booking_retire_race, class_capacity_lock, enrolment_retire_race,
  function_grants, package_default_products, recurring_gotchas, table_grants. Final tree: 92 files = 83 pinned,
  1 clock-free (`app_clock`), 8 date-free.
- **Pin form after `plan()`** (already in the plan, `d47fdeb`). pgTAP refuses any test before `plan()` ("You tried to
  run a test without a plan!", verified in pgtap 1.3.3 source). So the form is BEGIN; pin;
  [CREATE EXTENSION IF NOT EXISTS pgtap;] SELECT plan(N); SELECT is(app_today(), '<pin date>', 'clock pinned');.
  `app_clock_edges` puts `SET LOCAL TimeZone = 'UTC'` right after that header, because G1 needs the pin first.
- **G1 JSON-key exception** (`8c44c54`): a quoted `'now'`/`'today'` right after `->`/`->>` is a key, not a clock.
  G2 keeps the old pattern on purpose (lane1: the census counts that key).
- **G3 blind spots** (in the script header): `.substring(0, 10)` and Intl formatting are not scanned. Function scoping
  uses brace depth, so braces inside strings/template literals can mis-scope a hit. Class methods are attributed to
  the enclosing declaration. A `//` inside a string hides the rest of its line. The allowlist is file + function +
  ONE hit per entry; an unused entry exits 2.
- **Conversion kept on purpose:** `app_now() ± INTERVAL` timestamps (tenants.created_at backdates, graded_at,
  expires_at). They are stamps relative to the pin, not dates through a guard; created_at stays before every pin
  (§7.277). Literal-valued fixture temp tables (`f`, `td`, …) stay: each value is the old derivation evaluated under
  the pin. email_claim's lease lines keep REAL `now()` with `-- clock: stamp` (claim_* / email_delivery_state are
  REAL-TIME). Accepted rename: accounting_package_revenue's two descriptions "…pinned to now()" → "…to app_now()".

### Pin-shift table (+3 months, pin 2026-12-15, scratch copies only)

| Batch | Guarded (Appendix B, first count) | RED | Stayed green → re-marked n (reason) |
|---|---|---|---|
| 1 | 3 | 0 | student_claims, student_merge, unbilled_sealed_lessons: every guarded-table write is a superuser fixture insert (guards skip non-authenticated). The originals already passed with 2026-07 dates under the 2026-09-01 floor |
| 2a | 12 | 11 | coach_wages: superuser fixtures only, no authenticated guarded write |
| 2b | 12 | 5 | credit_note_double_credit, credit_note_trigger, document_name_snapshot, edge_cases, holiday_late_buyer: superuser fixtures only. holiday_admin_guard: its authenticated UPDATE/DELETEs hit an EXISTING attendance row, and guard_attendance_date returns early for corrections. holiday_day_rpc: mark_day_holiday on 2026-03 dates, below the floor at both pins |
| 2c | 7 | 2 | package_corrections, package_draw_at_marking_b, package_holiday_extension, partial_payment_followups, partial_payment: superuser fixtures only |
| 2d | 6 | 3 | stranger_isolation, tenant_suspension, void_credit_note: superuser fixtures only |

All 16 re-marks are in Appendix B (lane1). After re-marking: red = guarded in every batch.
**app_clock_edges red-proof (lane1, under HOLD):** with today_sg()/session_window_start() re-bodied to the UTC date,
tests 3–6, 8–9 and 12–14 go red (E1 07:59 SGT, E2 SGT midnight). E3/E4 stay green as designed. Restored
byte-identical.

### Notes for TESTING.md (→ `docs/TESTING.md` §5)

- New CI guards: `scripts/check-pgtap-clock.sh` (G1, required), `scripts/check-migration-clock.sh` (G2, required,
  CUTOFF = M3), `scripts/check-functions-sg-date.sh` (G3), and `scripts/check-test-dates.sh` (G4), which skips
  pinned files via the shared `scripts/lib/pgtap-pin.sh`.
- New suite: `supabase/tests/app_clock_edges.test.sql` (24): 07:59 SGT on the 1st, the month boundary at SGT
  midnight, 2028-02-29, the day before a month's first Saturday.
- One full-suite run showed `credit_drawdown` "planned 29, ran 0". It was green alone and on every re-run, probably a
  concurrent run on the shared DB; not seen again.

### Nothing for PRD / BACKLOG from this lane

There is no user-visible change. Driver clock pinning is lane1's BACKLOG item (D2).
