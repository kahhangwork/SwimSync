// Pure: raw rows -> the page's entities, and the booking form's derived values.
// Lifted verbatim from page.tsx (Admin L-D, BATCH_D_PLAN.md) so they get the
// page's first unit tests. Nothing here reads a clock: `today` is passed in
// (todayInSg(), §7.7).
//
// ⚠ datesForClass is NOT shared with the Trials page's near-identical helper —
// this one merges off-schedule sessions, and deduping the two would be a second
// change hiding inside a refactor (rule 0).
import { expectedLessonDates, formatSgDate } from "@/lib/lessonDates";
import type { Booking, ClassRow, EligibleKid, LivePackage } from "../types";

/** class_id -> off-schedule session dates. */
export function toExtraMap(extras: any[] | null): Map<string, string[]> {
  const extraMap = new Map<string, string[]>();
  for (const e of extras ?? []) {
    const list = extraMap.get(e.class_id as string) ?? [];
    list.push(e.session_date as string);
    extraMap.set(e.class_id as string, list);
  }
  return extraMap;
}

// Marked = an attendance row exists for that child on that date. Same
// student+date approximation the Trials page uses.
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
    class_title: b.classes?.title ?? "—",
    marked: markedKeys.has(`${b.student_id}:${b.session_date}`),
  }));
}

// Eligible: active child with an active enrolment. The RPC re-checks all
// of this — the list is an affordance, not the guard (§7.32).
export function toEligible(kids: any[] | null): EligibleKid[] {
  return (kids ?? [])
    .filter((k: any) => k.is_active)
    .map((k: any) => {
      const enrolled = (k.student_class_enrolments ?? [])
        .filter((e: any) => e.is_active && e.classes)
        .map((e: any) => ({
          id: e.classes.id,
          title: e.classes.title,
          category_id: e.classes.category_id,
        }));
      if (enrolled.length === 0) return null;
      return {
        id: k.id,
        full_name: k.full_name,
        home_classes: enrolled,
      };
    })
    .filter(Boolean) as EligibleKid[];
}

/** student -> parent ids, for the package-expiry advisory. */
export function toParentsOf(data: any[] | null): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const r of data ?? []) {
    const list = m.get(r.student_id as string) ?? [];
    list.push(r.parent_id as string);
    m.set(r.student_id as string, list);
  }
  return m;
}

/** Live packages not yet expired as of `today2` (todayInSg()). */
export function toLivePackages(data: any[] | null, today2: string): LivePackage[] {
  return ((data ?? []) as any[])
    .filter((p) => String(p.expires_on ?? "") >= today2)
    .map((p) => ({
      parent_id: p.parent_id,
      category_id: p.category_id ?? null,
      expires_on: String(p.expires_on),
      live_lessons_remaining: Number(p.live_lessons_remaining ?? 0),
    }));
}

// WHICH class this make-up replaces. Auto-selected when there is only one, so
// the single-class case is unchanged; asked when there is a choice.
export function homeClassOf(kid: EligibleKid | undefined, bookHome: string) {
  return (
    kid?.home_classes.find((c) => c.id === bookHome) ??
    (kid?.home_classes.length === 1 ? kid.home_classes[0] : undefined)
  );
}

// Same-category classes, minus EVERY class the child is in.
//
// ⚠ THE EXCLUSION IS "ALL THEIR CLASSES", NOT "THE HOME CLASS". Excluding only
// the chosen home would leave the child's OTHER class in this list — and it is
// the likeliest pick, since the list is already filtered to their category.
// Booking that is not a billing bug (enrolment-wins prices it correctly as a
// member) but it SILENTLY VOIDS the make-up: the child attends the lesson they
// were already attending. book_makeup() refuses it; this keeps it off screen.
// Category comes from the CHOSEN home class, so switching home re-filters.
export function hostChoicesFor(
  kid: EligibleKid | undefined,
  homeClass: EligibleKid["home_classes"][number] | undefined,
  classes: ClassRow[]
): ClassRow[] {
  if (!kid || !homeClass) return [];
  const ownIds = new Set(kid.home_classes.map((c) => c.id));
  return classes.filter(
    (c) => c.category_id === homeClass.category_id && !ownIds.has(c.id)
  );
}

/** Real lesson dates for the host class: its weekday pattern (a short look
 *  back, a couple of months ahead) PLUS any admin-scheduled off-schedule
 *  session — book_makeup() accepts those too. Affordance, not the guard. */
export function datesForClass(
  classes: ClassRow[],
  extraDates: Map<string, string[]>,
  classId: string,
  today: string
): string[] {
  const c = classes.find((x) => x.id === classId);
  if (!c) return [];
  const shift = (days: number): string => {
    const [y, m, d] = today.split("-").map(Number);
    const t = new Date(Date.UTC(y, m - 1, d + days));
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
  };
  const pattern = expectedLessonDates(c.day_of_week, shift(-21), shift(70));
  const extras = extraDates.get(classId) ?? [];
  return [...new Set([...pattern, ...extras])].sort();
}

/** The advisory: if every live same-category package of this child's family
 *  expires before the chosen date, the lesson will bill at the class rate. */
export function expiryWarningFor(
  kid: EligibleKid | undefined,
  bookDate: string,
  parentsOf: Map<string, string[]>,
  livePackages: LivePackage[],
  homeClass: EligibleKid["home_classes"][number] | undefined
): string | null {
  if (!kid || !bookDate) return null;
  const parentIds = new Set(parentsOf.get(kid.id) ?? []);
  if (parentIds.size === 0) return null;
  const familyPkgs = livePackages.filter(
    (p) =>
      parentIds.has(p.parent_id) &&
      (p.category_id === null || p.category_id === homeClass?.category_id)
  );
  if (familyPkgs.length === 0) return null;
  const covering = familyPkgs.some((p) => p.expires_on >= bookDate);
  if (covering) return null;
  const latest = familyPkgs.map((p) => p.expires_on).sort().at(-1)!;
  return `The family's package expires ${formatSgDate(latest)} — this lesson is after that, so it will bill at the class rate instead.`;
}
