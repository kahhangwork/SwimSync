// Backdated activation (Wave 6 D5): what the "lessons already marked" dialog
// says. Pure — the rows are package_backlog_preview's, and the matcher that
// decided each row's funding lives in Postgres (⚠ RISK 8). This file only
// counts and words them; it never decides who pays.

export type BacklogRow = {
  session_date: string;
  student_id: string;
  student_name: string;
  class_title: string;
  /** null → no package can afford it; it stays ad-hoc. */
  funding_package_id: string | null;
  funding_package_name: string | null;
  /** true → THIS package pays. */
  funds_this: boolean;
};

export type BacklogSummary = {
  total: number;
  thisPackage: number;
  /** Paid by another (earlier-expiring) package of the family. */
  otherPackage: number;
  /** No package can afford it — billed at the next run. */
  adhoc: number;
};

export function summariseBacklog(rows: BacklogRow[]): BacklogSummary {
  let thisPackage = 0;
  let otherPackage = 0;
  let adhoc = 0;
  for (const r of rows) {
    if (r.funds_this) thisPackage += 1;
    else if (r.funding_package_id) otherPackage += 1;
    else adhoc += 1;
  }
  return { total: rows.length, thisPackage, otherPackage, adhoc };
}

const lessons = (n: number) => `${n} lesson${n === 1 ? "" : "s"}`;

/** One line per row of the dialog's list: who pays it if the admin draws. */
export function backlogRowFunding(r: BacklogRow): string {
  if (r.funds_this) return "this package";
  if (r.funding_package_id) return r.funding_package_name ?? "another package";
  return "stays ad-hoc";
}

/** The dialog's result line. The count is the DRAW's own return value — it
 *  re-derives at call time, so it can differ from the preview (and a second
 *  press, or another admin first, reads 0). */
export function drawResultText(drawn: number): string {
  return drawn === 0
    ? "Nothing to draw — these lessons were already drawn or billed."
    : `Drew ${lessons(drawn)} from the family's packages.`;
}

export { lessons as lessonCount };
