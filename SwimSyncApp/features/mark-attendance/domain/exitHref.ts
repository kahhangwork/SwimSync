// Where leaving the marking screen goes (COACH_ATTENDANCE_REFACTOR_PLAN.md, Stage 1) —
// the rule moved verbatim from app/(coach)/classes/[id]/attendance.tsx, which now
// calls exitHrefOf(from, id) and keeps leaveScreen() itself (it needs `router`).

// ── WHERE DOES LEAVING THIS SCREEN GO? (§7.65) ──────────────────────────
// Not `router.back()`, which trusts whatever happens to be underneath — and
// what is underneath is frequently ANOTHER LESSON'S attendance screen.
//
// This screen lives in the CLASSES tab's Stack (classes/_layout.tsx) but is
// pushed from the SCHEDULE tab as well. Switching tabs does not unwind the
// Classes stack, it only hides it, so the stack accumulates:
//
//   Schedule → tap 845am card    [classes-index, att(845, 26 Jul)]
//   back chevron → Schedule      [classes-index, att(845, 26 Jul)]  ← kept
//   Schedule → tap 930am card    [classes-index, att(845,26), att(930,26)]
//   Save → router.back()         → lands on att(845, 26 Jul)
//
// Which is what the coach reported: saving the 9:30 class returned them to
// the 8:45 one, and the URL still carried the 8:45 session id.
//
// So the caller says where it came from and we go there EXPLICITLY, with
// `replace` rather than `push` — that also drops this screen out of the
// history, so nothing can pop back into a lesson the coach has finished.
//
// ⚠ THE DEFAULT ARM IS THE SAFETY NET — KEEP IT AS `from === "roster" ? … : …`
// rather than switching on "schedule". A stale `from=today` (a bookmark, a
// driver nobody updated) then still lands on a real screen instead of
// nowhere. Narrowing it to an exact match buys nothing and can only break.
export function exitHrefOf(from: string | undefined, id: string): string {
  return from === "roster" ? `/(coach)/classes/${id}/roster` : "/(coach)/schedule";
}
