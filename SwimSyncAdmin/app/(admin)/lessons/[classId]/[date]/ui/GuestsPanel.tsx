// The guests summary and the two Book buttons — the admin lesson page (lessons/[classId]/[date]). Markup moved
// verbatim from page.tsx at Stage 7 of docs/refactor/LESSON_DETAIL_REFACTOR_PLAN.md;
// the hook state is destructured at the top so the JSX is byte-identical.

import { Button } from "@/components/Button";
import type { LessonDetail } from "../domain/useLessonDetail";
import type { GuestBookingState } from "../domain/useGuestBooking";

export function GuestsPanel({ date, ld, gb }: { date: string; ld: LessonDetail; gb: GuestBookingState }) {
  const { guestCount, today, cancelled } = ld;
  const { setBookKind, setBookError } = gb;

  return (
    <section className="rounded-card border border-border bg-surface p-4">
      <h2 className="mb-2 font-semibold text-ink">Guests</h2>
      <p className="text-label text-ink-muted">
        {guestCount === 0 ? "No trial or make-up guests booked into this lesson." : `${guestCount} guest${guestCount === 1 ? "" : "s"} booked — they appear in the attendance table above.`}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => { setBookKind("makeup"); setBookError(null); }} disabled={date < today || !!cancelled}>
          Book a make-up into this lesson
        </Button>
        <Button size="sm" variant="outline" onClick={() => { setBookKind("trial"); setBookError(null); }} disabled={date < today || !!cancelled}>
          Book a trial into this lesson
        </Button>
      </div>
      {date < today && <p className="mt-2 text-label text-ink-muted">Bookings are for today or a future lesson.</p>}
    </section>
  );
}
