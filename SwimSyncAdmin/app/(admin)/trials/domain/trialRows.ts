// Pure: raw rows -> the page's entities, and the booking form's lesson dates.
// Lifted verbatim from page.tsx (Admin L-D, BATCH_D_PLAN.md) so they get the
// page's first unit tests. Nothing here reads a clock: `today` is passed in
// (todayInSg(), §7.7).
//
// ⚠ datesForClass is NOT shared with the Make-ups page's near-identical helper —
// that one also merges off-schedule sessions; deduping the two would be a
// second change hiding inside a refactor (rule 0).
import { expectedLessonDates } from "@/lib/lessonDates";
import type { Booking, Category, ClassRow } from "../types";

// The rate a category is on TODAY — the newest row not dated in the future.
// Older rows still price older lessons; this display is only "what would a
// trial booked now cost". `rates` arrive newest-first (effective_from desc).
export function toCategories(cats: any[] | null, rates: any[] | null, today: string): Category[] {
  const current = new Map<string, number>();
  for (const r of rates ?? []) {
    const cid = r.category_id as string;
    if (current.has(cid)) continue; // already have a newer one
    if (String(r.effective_from) <= today) current.set(cid, Number(r.rate));
  }
  return (cats ?? []).map((c: any) => ({
    id: c.id,
    name: c.name,
    rate: current.get(c.id) ?? null,
  }));
}

// Which bookings have been marked? A booking whose lesson has passed and
// is NOT marked is what holds the month open, so it gets its own list.
export function toBookings(books: any[] | null, att: any[] | null): Booking[] {
  const markedKeys = new Set(
    (att ?? []).map(
      (a: any) => `${a.student_id}:${a.lesson_sessions?.session_date}`
    )
  );

  return (books ?? []).map((b: any) => ({
    id: b.id,
    session_date: b.session_date,
    student_id: b.student_id ?? "",
    student_name: b.students?.full_name ?? "—",
    class_id: b.class_id ?? "",
    class_title: b.classes?.title ?? "—",
    marked: markedKeys.has(`${b.student_id}:${b.session_date}`),
  }));
}

// Eligible children: in this business, active, and NOT currently in a class.
export function toEligible(kids: any[] | null): { id: string; full_name: string }[] {
  return (kids ?? [])
    .filter(
      (k: any) =>
        k.is_active &&
        !(k.student_class_enrolments ?? []).some((e: any) => e.is_active)
    )
    .map((k: any) => ({ id: k.id, full_name: k.full_name }));
}

/**
 * The dates this class actually runs, from today onward — plus a short look
 * back, so a trial that already happened can be recorded.
 *
 * Offering only real lesson dates is an affordance, NOT the guard: book_trial()
 * refuses a non-class day itself. A limit only the admin screen applies is not
 * a limit (§7.32).
 */
export function datesForClass(classes: ClassRow[], classId: string, today: string): string[] {
  const c = classes.find((x) => x.id === classId);
  if (!c) return [];
  // Date arithmetic on a YYYY-MM-DD string, via Date.UTC so no local timezone
  // is ever consulted. NOT `new Date(x).toISOString().slice(0,10)`: that is
  // the banned pattern (§7.7) and the audit grep flags it on sight, even where
  // it happens to round-trip.
  const shift = (days: number): string => {
    const [y, m, d] = today.split("-").map(Number);
    const t = new Date(Date.UTC(y, m - 1, d + days));
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
  };
  return expectedLessonDates(c.day_of_week, shift(-21), shift(70));
}
