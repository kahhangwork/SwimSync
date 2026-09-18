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
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="mb-2 font-semibold text-gray-900">Guests</h2>
      <p className="text-xs text-gray-500">
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
      {date < today && <p className="mt-2 text-xs text-gray-400">Bookings are for today or a future lesson.</p>}
    </section>
  );
}
