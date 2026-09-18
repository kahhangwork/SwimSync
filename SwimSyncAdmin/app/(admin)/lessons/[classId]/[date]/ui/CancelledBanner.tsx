// The cancelled-lesson banner — the admin lesson page (lessons/[classId]/[date]). Markup moved
// verbatim from page.tsx at Stage 7 of docs/refactor/LESSON_DETAIL_REFACTOR_PLAN.md;
// the hook state is destructured at the top so the JSX is byte-identical.

export function CancelledBanner({ cancelled }: { cancelled: { reason: string | null } }) {
  return (
    <div data-testid="lesson-cancelled" className="mb-4 rounded-xl border border-gray-300 bg-gray-50 p-4 text-sm text-gray-800">
      <p className="font-semibold">This lesson is cancelled.</p>
      <p className="mt-1">
        {cancelled.reason ? <>Reason: <span className="italic">{cancelled.reason}</span>. </> : null}
        Parents see it struck out under Upcoming, the coach has nothing to mark, and the billing month does not wait for it.
        Guests cannot be booked into it. If it is going ahead after all, restore it.
      </p>
    </div>
  );
}
