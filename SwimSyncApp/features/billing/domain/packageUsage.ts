// What a package paid for (Wave 6 D3): the dated lines under a package on the
// Packages tab. Pure — the rows are package_usage(p_package)'s, which unions the
// marking-time draws with the LEGACY invoice-time rows so the history is whole.
// One row per draw; a returned lesson is the same row with reversed_at set (a
// re-draw after a return is a new row), so a return is a label, not a line.

import { formatSgStamp } from "@/lib/lessonDates";

export type PackageUsageRow = {
  lesson_date: string;
  student_id: string;
  student_name: string;
  class_title: string;
  amount: number | string;
  /** 'marking' = drawn when the lesson was marked; 'invoice' = legacy, drawn by a monthly invoice. */
  source: string;
  applied_at: string;
  reversed_at: string | null;
};

export type UsageLine = {
  key: string;
  date: string;
  who: string;
  amount: string;
  /** Given back to the package (marked absent/cancelled afterwards). */
  returned: boolean;
  /** Shown under a legacy line so the parent can match it to an invoice. */
  note: string | null;
};

const money = (v: number | string) => `S$${Number(v).toFixed(2)}`;

export function usageLines(rows: PackageUsageRow[]): UsageLine[] {
  return rows.map((r) => ({
    // applied_at, not the lesson: a re-draw after a return is a second row
    // for the same lesson and child.
    key: `${r.lesson_date}:${r.student_id}:${r.applied_at}`,
    date: formatSgStamp(r.lesson_date, { day: "numeric", month: "short", year: "numeric" }),
    who: `${r.student_name} · ${r.class_title}`,
    amount: money(r.amount),
    returned: r.reversed_at !== null,
    note: r.source === "invoice" ? "On a monthly invoice" : null,
  }));
}

/** The toggle's label — counts lessons the package is still paying for. */
export function usageToggleLabel(open: boolean, rows: PackageUsageRow[] | null): string {
  if (open) return "Hide lessons used";
  if (!rows) return "Show lessons used";
  const used = rows.filter((r) => r.reversed_at === null).length;
  return `Show lessons used (${used})`;
}
