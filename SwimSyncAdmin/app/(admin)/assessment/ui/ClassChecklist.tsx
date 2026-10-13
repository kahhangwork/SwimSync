import Link from "next/link";
import { Table, Thead, Th, Tbody, Tr, Td } from "@/components/Table";
import type { DayOfWeek } from "@/lib/lessonDates";
import { DAY_LABEL } from "../constants";
import type { ClassRow } from "../types";

export function ClassChecklist(p: {
  rows: ClassRow[];
  loading: boolean;
  since: string;
  today: DayOfWeek | null;
}) {
  return (
    <Table>
      <Thead>
        <Th>Class</Th>
        <Th>Day</Th>
        <Th>Coach</Th>
        <Th>Location</Th>
        <Th>This round</Th>
      </Thead>
      <Tbody>
        {p.loading ? (
          <Tr>
            <Td className="py-8 text-center text-ink-muted" colSpan={5}>
              Loading…
            </Td>
          </Tr>
        ) : p.rows.length === 0 ? (
          <Tr>
            <Td className="py-8 text-center text-ink-muted" colSpan={5}>
              No active classes.
            </Td>
          </Tr>
        ) : (
          p.rows.map((r) => {
            const done = r.total > 0 && r.assessed === r.total;
            return (
              <Tr key={r.id}>
                <Td className="font-medium text-ink">
                  <Link
                    href={`/assessment/${r.id}?since=${p.since}`}
                    className="text-primary hover:underline"
                  >
                    {r.title}
                  </Link>
                </Td>
                <Td className="whitespace-nowrap text-ink-muted">
                  {DAY_LABEL[r.day_of_week] ?? r.day_of_week}
                  {r.day_of_week === p.today ? (
                    <span className="ml-2 rounded-tag border border-status-info-border bg-status-info-bg px-1.5 py-0.5 text-label font-medium text-status-info-text">
                      Today
                    </span>
                  ) : null}
                </Td>
                <Td className="text-ink-muted">{r.coach ?? "—"}</Td>
                <Td className="text-ink-muted">{r.location ?? "—"}</Td>
                <Td>
                  <span
                    className={
                      "rounded-tag border px-1.5 py-0.5 text-label font-medium " +
                      (r.total === 0
                        ? "bg-status-neutral-bg text-status-neutral-text border-status-neutral-border"
                        : done
                        ? "bg-status-success-bg text-status-success-text border-status-success-border"
                        : "bg-status-warning-bg text-status-warning-text border-status-warning-border")
                    }
                  >
                    {r.total === 0
                      ? "No children"
                      : `${r.assessed} of ${r.total} assessed`}
                  </span>
                  {/* Reported apart from done and outstanding on purpose: a
                      child with no level is not work the assessor can do, and
                      folding them into either bucket is how they get missed. */}
                  {r.blocked > 0 ? (
                    <span className="ml-2 rounded-tag border border-status-neutral-border bg-status-neutral-bg px-1.5 py-0.5 text-label font-medium text-status-neutral-text">
                      {r.blocked} {r.blocked === 1 ? "child needs" : "children need"} a level
                    </span>
                  ) : null}
                </Td>
              </Tr>
            );
          })
        )}
      </Tbody>
    </Table>
  );
}
