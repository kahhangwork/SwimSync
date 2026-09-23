// The parent Home tab's pure half (docs/refactor/BATCH_FGH_PLAN.md, App L-F): the
// formatters and the row mapping, moved VERBATIM out of app/(parent)/home/index.tsx
// — the loop bodies are the route's own, lifted into functions so they can be
// pinned by homeRows.test.ts. No clock, no client.
import { WEEKDAY_ORDER } from "../constants";
import type { Child, ChildClass } from "../types";

export function formatTime(time: string | null): string | null {
  if (!time) return null;
  const [h, m] = time.split(":");
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  return `${hour12}:${m} ${ampm}`;
}

export function capitalize(str: string | null): string {
  if (!str) return "—";
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/** Credit is held PER BUSINESS and is only spendable there, so there is
 *  no single balance any more. The summary card shows the total the family
 *  holds; the Billing tab is where each business's invoice shows what its
 *  own credit actually covered. */
export function totalCredit(parent: any): number {
  const balances = (parent as any).parent_tenant_balances ?? [];
  return balances.reduce((sum: number, b: any) => sum + Number(b.credit_balance ?? 0), 0);
}

export function mapChildren(parent: any): Child[] {
  return (parent.parent_students ?? []).map((ps: any) => {
    const s = ps.students;
    // EVERY active enrolment, not `.find()`. Sorted by weekday so two
    // classes read in the order the week runs rather than in whatever order
    // PostgREST returned them — an unordered list of a family's week looks
    // like a bug even when every row in it is right.
    const classes: ChildClass[] = (s.student_class_enrolments ?? [])
      .filter((e: any) => e.is_active && e.classes)
      .map((e: any) => {
        const cls = e.classes;
        return {
          coach_name: cls?.coaches?.profiles?.full_name ?? null,
          day: cls?.day_of_week ?? null,
          time: `${formatTime(cls.start_time)} – ${formatTime(cls.end_time)}`,
          location: cls?.locations?.name ?? null,
        };
      })
      .sort(
        (a: ChildClass, b: ChildClass) =>
          WEEKDAY_ORDER.indexOf(a.day ?? "") - WEEKDAY_ORDER.indexOf(b.day ?? "")
      );

    return {
      id: s.id,
      full_name: s.full_name,
      assignment_status: s.assignment_status,
      is_active: s.is_active,
      classes,
      trial: null, // filled below
      makeup: null, // filled below
    };
  });
}

/** One booking per student — the rows arrive earliest first from the query,
 *  so the first one wins. `fallback` is the title shown when the class did
 *  not embed ("their class" for a trial, "another class" for a make-up). */
export function firstBookingByStudent(
  rows: any[] | null,
  fallback: string
): Map<string, { class_title: string; session_date: string }> {
  const byStudent = new Map<string, { class_title: string; session_date: string }>();
  for (const b of (rows ?? []) as any[]) {
    // Earliest first from the query, so the first one wins.
    if (!byStudent.has(b.student_id)) {
      byStudent.set(b.student_id, {
        class_title: b.classes?.title ?? fallback,
        session_date: b.session_date,
      });
    }
  }
  return byStudent;
}

export function totalOutstandingOf(invoices: any[] | null): number {
  return (invoices ?? []).reduce(
    (sum: number, inv: any) => sum + Number(inv.net_amount),
    0
  );
}
