"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { sortRows, type SortDir, type SortValue } from "@/lib/tableSort";

export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("w-full overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm", className)}>
      {/* The last column absorbs the leftover width — see the note on <Th>.
          Done here, once, with a descendant selector rather than a prop every
          table has to remember: `th:last-child` beats the cell's own `w-px` on
          specificity, so every table gets it and no table can forget it. */}
      <table className="w-full text-sm [&_th:last-child]:w-full [&_td:last-child]:w-full">
        {children}
      </table>
    </div>
  );
}

/**
 * Emits its own <tr>, so callers pass <Th> DIRECTLY. Never wrap them in a <Tr>.
 *
 * It used not to, and the convention split: some call sites wrapped their <Th>s
 * in a row and some did not, so the bare ones produced invalid HTML — <th>
 * cannot be a child of <thead>. Moving the row in here fixed those.
 *
 * ⚠ THE SWEEP THAT CAME WITH IT MISSED levels/page.tsx, AND THIS COMMENT USED
 * TO CLAIM OTHERWISE. It named levels as one of the pages the change fixed;
 * levels in fact still had its <Tr> at that very commit, so the change is what
 * broke it: <tr> inside <tr>, all five headers collapsed into one cell in
 * column 1, and every column pushed out of line with its own header. It
 * shipped to production and stayed there for a week — no test covered it, and
 * every text-based assertion passes on a table whose labels are all correct
 * and merely in the wrong place.
 *
 * The old comment also asserted that owning the row made the broken form
 * "unrepresentable". It did not: a caller can still nest a <Tr> and nothing
 * stops them. Prose cannot enforce a call-site contract.
 * **components/Table.test.tsx scans every admin page and fails if one does.**
 * That test is the enforcement; this paragraph is only the reason.
 * See `docs/GOTCHAS.md` §7.54.
 */
export function Thead({ children }: { children: React.ReactNode }) {
  return (
    <thead className="border-b border-gray-200 bg-gray-50">
      <tr>{children}</tr>
    </thead>
  );
}

/**
 * COLUMN WIDTHS: EVERY COLUMN HUGS ITS CONTENT, THE LAST ONE TAKES THE SLACK.
 *
 * The table is `w-full`, and with `table-layout: auto` that used to hand every
 * column a roughly equal share of the page — so `Kah Hang` sat in a column wide
 * enough for a paragraph, and the eye had to travel a long way from a student's
 * name to their status.
 *
 * `w-px whitespace-nowrap` is what fixes it. A width that small cannot be
 * honoured, so the browser falls back to the column's min-content width — and
 * because the content cannot wrap, min-content IS the full text. The column
 * ends up exactly as wide as its widest cell.
 *
 * If EVERY column did that, the leftover space would have nowhere to go and the
 * browser would quietly spread it again. So **the LAST column absorbs the
 * slack**, applied once on the <table> itself in `Table` above. Nothing to mark
 * per table, nothing to forget, and the gap lands at the trailing edge where it
 * costs nothing — the data columns end up packed together, which is the actual
 * complaint about an evenly-spread table: the eye travels too far from a name to
 * its status.
 *
 * An earlier version made this a `grow` prop, one nominated column per table.
 * Two things were wrong with it. It needed a call-site test to catch a table
 * that nominated none, because the failure is invisible — the table renders
 * fine, it just silently goes back to spreading. And on a narrow table it put
 * the gap in the MIDDLE: Attendance grew its Class column and opened a visible
 * void between Class and Coach, reproducing the very problem it was fixing.
 *
 * Cells stay `nowrap` so a column can never be squeezed below its own text.
 * When the columns genuinely exceed the width the wrapper's `overflow-x-auto`
 * scrolls; a table that scrolls is recoverable, a crushed column reads as a
 * layout bug. Measured on Classes at a 1600px viewport, an earlier wrapping
 * version left the primary Class Name column 110px — narrower than Day — with
 * the title broken mid-phrase.
 *
 * Add `wrap` for a column of genuine prose (a credit note's reason). It hugs
 * short values like any other column but caps at 20rem and wraps beyond that,
 * so one long sentence cannot push the whole table sideways.
 */
export function Th({
  children,
  className,
  wrap,
  sort,
  sortKey,
  firstDir = "asc",
}: {
  children: React.ReactNode;
  className?: string;
  /** Prose column: hugs short values, caps at 20rem and wraps beyond. */
  wrap?: boolean;
  /** The `useTableSort` handle. Pass with `sortKey` to make the column sortable. */
  sort?: TableSort<any>;
  /** Key into the row (or into `accessors`) this column sorts by. */
  sortKey?: string;
  /** Direction the FIRST click applies. `desc` suits dates and amounts. */
  firstDir?: SortDir;
}) {
  const sortable = Boolean(sort && sortKey);
  const active = sortable && sort!.key === sortKey;

  return (
    <th
      aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : sortable ? "none" : undefined}
      className={cn(
        "px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 w-px",
        wrap ? "max-w-xs whitespace-normal" : "whitespace-nowrap",
        className
      )}
    >
      {sortable ? (
        <button
          type="button"
          onClick={() => sort!.toggle(sortKey!, firstDir)}
          // The <th> is already uppercase/tracked; the button inherits it and
          // only adds the affordance. `group` drives the arrow's hover state.
          className="group inline-flex items-center gap-1 uppercase tracking-wide transition-colors hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 rounded"
          title={`Sort by ${typeof children === "string" ? children : "this column"}`}
        >
          {children}
          <SortArrow active={active} dir={sort!.dir} />
        </button>
      ) : (
        children
      )}
    </th>
  );
}

/**
 * Inactive columns keep a faint up/down pair rather than nothing at all — an
 * arrow that only appears on hover is invisible to anyone who never hovers, and
 * the whole point is that a long table LOOKS sortable before you guess.
 */
function SortArrow({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) {
    return (
      <svg viewBox="0 0 10 16" aria-hidden="true" className="h-3 w-2.5 shrink-0 text-gray-300 transition-colors group-hover:text-gray-500">
        <path d="M5 2 L8.5 6 H1.5 Z" fill="currentColor" />
        <path d="M5 14 L8.5 10 H1.5 Z" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 10 16" aria-hidden="true" className="h-3 w-2.5 shrink-0 text-sky-600">
      {dir === "asc" ? <path d="M5 3 L9 9 H1 Z" fill="currentColor" /> : <path d="M5 13 L9 7 H1 Z" fill="currentColor" />}
    </svg>
  );
}

export function Tbody({ children }: { children: React.ReactNode }) {
  return <tbody className="divide-y divide-gray-100">{children}</tbody>;
}

export function Tr({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <tr className={cn("hover:bg-gray-50 transition-colors", className)}>
      {children}
    </tr>
  );
}

export function Td({
  children,
  className,
  colSpan,
  wrap,
}: {
  children: React.ReactNode;
  className?: string;
  colSpan?: number;
  /** Must match the <Th> of the same column — a column is sized by every cell. */
  wrap?: boolean;
}) {
  return (
    <td
      colSpan={colSpan}
      className={cn(
        "px-4 py-3 text-gray-700 w-px",
        wrap ? "max-w-xs whitespace-normal" : "whitespace-nowrap",
        className
      )}
    >
      {children}
    </td>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sorting
// ─────────────────────────────────────────────────────────────────────────────

export type TableSort<T> = {
  key: string | null;
  dir: SortDir;
  toggle: (key: string, firstDir?: SortDir) => void;
  /** Returns a sorted copy, or `rows` untouched while no column is active. */
  apply: (rows: readonly T[]) => T[];
};

/**
 * Click-to-sort for one table, in one line at the top of the page component:
 *
 *     const sort = useTableSort<Row>({ key: "session_date", dir: "desc" });
 *     const visible = sort.apply(filtered);
 *     …
 *     <Th sort={sort} sortKey="student_name">Student</Th>
 *
 * By default a column reads `row[sortKey]`. When the cell shows something the
 * row does not hold under that name — a nested field, a computed count, a
 * formatted amount — give it an accessor and sort by the underlying value
 * rather than the text:
 *
 *     useTableSort<Row>({ accessors: { amount: (r) => r.cents } })
 *
 * `apply` runs on every render, like the `.filter()` calls it sits beside. That
 * is deliberate — these tables are hundreds of rows, not thousands, and a
 * `useMemo` keyed on a fresh `accessors` object every render would buy nothing
 * while making the freshness of the result harder to reason about.
 */
export function useTableSort<T>({
  key: initialKey = null,
  dir: initialDir = "asc",
  accessors,
}: {
  /** Column active on first render. `null` leaves the page's own order alone. */
  key?: string | null;
  dir?: SortDir;
  accessors?: Record<string, (row: T) => SortValue>;
} = {}): TableSort<T> {
  const [state, setState] = useState<{ key: string | null; dir: SortDir }>({
    key: initialKey,
    dir: initialDir,
  });

  return {
    key: state.key,
    dir: state.dir,
    toggle: (key, firstDir = "asc") =>
      setState((prev) =>
        prev.key === key
          ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
          : { key, dir: firstDir }
      ),
    apply: (rows) => {
      const key = state.key;
      if (!key) return [...rows];
      const get = accessors?.[key] ?? ((row: T) => (row as Record<string, SortValue>)[key]);
      return sortRows(rows, get, state.dir);
    },
  };
}
