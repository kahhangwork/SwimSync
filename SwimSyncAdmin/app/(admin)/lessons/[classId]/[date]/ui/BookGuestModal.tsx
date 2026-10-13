// Book a make-up or trial guest into this lesson — the admin lesson page (lessons/[classId]/[date]). Markup moved
// verbatim from page.tsx at Stage 7 of docs/refactor/LESSON_DETAIL_REFACTOR_PLAN.md;
// the hook state is destructured at the top so the JSX is byte-identical.

import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { formatCount } from "@/lib/calendarLessons";
import { formatSgDate } from "@/lib/lessonDates";
import type { LessonDetail } from "../domain/useLessonDetail";
import type { GuestBookingState } from "../domain/useGuestBooking";
import type { ClassInfo } from "../types";

export function BookGuestModal({ date, cls, ld, gb }: { date: string; cls: ClassInfo; ld: LessonDetail; gb: GuestBookingState }) {
  const { full, enrolledCount, guestCount, trialKids } = ld;
  const {
    bookKind,
    setBookKind,
    bookQuery,
    setBookQuery,
    bookKid,
    setBookKid,
    bookHome,
    setBookHome,
    bookBusy,
    bookError,
    bookKidRow,
    makeupCandidates,
    requestBook,
  } = gb;
  const countText = formatCount(enrolledCount, guestCount, cls.capacity);

  return (
    <>
      {/* ── Book a guest ────────────────────────────────────────────────── */}
      <Modal title={bookKind === "trial" ? "Book a trial into this lesson" : "Book a make-up into this lesson"} open={bookKind !== null} onClose={() => setBookKind(null)}>
        <div className="space-y-3">
          <p className="text-label text-ink-muted">
            {cls.title} · {formatSgDate(date)} · currently {countText}{full ? " (full)" : ""}
          </p>
          {bookKind === "makeup" ? (
            <>
              <input
                aria-label="Search child"
                placeholder="Child's name or their class…"
                className="w-full rounded-control border border-border-strong px-3 py-2 text-body"
                value={bookQuery}
                onChange={(e) => { setBookQuery(e.target.value); setBookKid(""); setBookHome(""); }}
              />
              <select aria-label="Child" className="w-full rounded-control border border-border-strong bg-surface px-3 py-2 text-body" value={bookKid} onChange={(e) => { setBookKid(e.target.value); setBookHome(""); }}>
                <option value="">Choose a child ({makeupCandidates.length})…</option>
                {makeupCandidates.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.full_name} — {k.home_class_titles.join(", ")}
                  </option>
                ))}
              </select>
              {bookKidRow && bookKidRow.home_classes.length > 1 && (
                <select aria-label="Which class does this make-up replace" className="w-full rounded-control border border-border-strong bg-surface px-3 py-2 text-body" value={bookHome} onChange={(e) => setBookHome(e.target.value)}>
                  <option value="">Which class does this make-up replace?</option>
                  {bookKidRow.home_classes.filter((c) => c.category_id === cls.category_id).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
              )}
              <p className="text-label text-ink-muted">Only children enrolled in another same-category class are offered; the booking rules are re-checked when you book.</p>
            </>
          ) : (
            <>
              <select aria-label="Trial child" className="w-full rounded-control border border-border-strong bg-surface px-3 py-2 text-body" value={bookKid} onChange={(e) => setBookKid(e.target.value)}>
                <option value="">Choose a child not yet in a class ({trialKids.length})…</option>
                {trialKids.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.full_name}
                  </option>
                ))}
              </select>
              <p className="text-label text-ink-muted">A trial child must not be enrolled anywhere. To add a brand-new child, use the Trials page.</p>
            </>
          )}
          {full && (
            <p className="rounded-card bg-status-warning-bg px-3 py-2 text-label text-status-warning-text" data-testid="full-notice">
              This lesson is full ({countText}). The database will refuse a booking — raise the class&apos;s maximum on the Classes page to add one.
            </p>
          )}
          {bookError && <p className="rounded-card bg-status-danger-bg px-3 py-2 text-body text-status-danger-text">{bookError}</p>}
          <div className="flex gap-2 pt-1">
            <Button variant="outline" className="flex-1" onClick={() => setBookKind(null)}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={requestBook} disabled={bookBusy} data-testid="book-guest">
              {bookBusy ? "Booking…" : "Book"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
