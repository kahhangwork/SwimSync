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
            <Td className="py-8 text-center text-gray-400" colSpan={5}>
              Loading…
            </Td>
          </Tr>
        ) : p.rows.length === 0 ? (
          <Tr>
            <Td className="py-8 text-center text-gray-400" colSpan={5}>
              No active classes.
            </Td>
          </Tr>
        ) : (
          p.rows.map((r) => {
            const done = r.total > 0 && r.assessed === r.total;
            return (
              <Tr key={r.id}>
                <Td className="font-medium text-gray-900">
                  <Link
                    href={`/assessment/${r.id}?since=${p.since}`}
                    className="text-sky-700 hover:underline"
                  >
                    {r.title}
                  </Link>
                </Td>
                <Td className="whitespace-nowrap text-gray-500">
                  {DAY_LABEL[r.day_of_week] ?? r.day_of_week}
                  {r.day_of_week === p.today ? (
                    <span className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-700">
                      Today
                    </span>
                  ) : null}
                </Td>
                <Td className="text-gray-500">{r.coach ?? "—"}</Td>
                <Td className="text-gray-500">{r.location ?? "—"}</Td>
                <Td>
                  <span
                    className={
                      "rounded-full px-2 py-0.5 text-xs font-semibold " +
                      (r.total === 0
                        ? "bg-gray-100 text-gray-500"
                        : done
                        ? "bg-green-100 text-green-700"
                        : "bg-amber-100 text-amber-700")
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
                    <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">
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
