import { Table, Thead, Th, Tbody, Tr, Td } from "@/components/Table";
import { PackageChip } from "@/components/PackageChip";
import { formatSgDate } from "@/lib/lessonDates";
import type { TrialsState } from "../domain/useTrials";

export function UpcomingTable(p: { t: TrialsState }) {
  return (
    <>
      <h2 className="mb-2 text-sm font-semibold text-gray-700">Upcoming</h2>
      <Table>
        <Thead>
          <Th sort={p.t.trialSort} sortKey="student_name">Child</Th>
          <Th sort={p.t.trialSort} sortKey="class_title">Class</Th>
          <Th sort={p.t.trialSort} sortKey="session_date" className="whitespace-nowrap">Date</Th>
          <Th sort={p.t.trialSort} sortKey="marked">Status</Th>
          <Th>Actions</Th>
        </Thead>
        <Tbody>
          {p.t.upcoming.length === 0 ? (
            <Tr>
              <Td className="text-gray-400">No trials booked.</Td>
              <Td>{""}</Td><Td>{""}</Td><Td>{""}</Td><Td>{""}</Td>
            </Tr>
          ) : (
            p.t.visibleTrials.map((b) => (
              <Tr key={b.id}>
                <Td className="font-medium text-gray-800">
                  {b.student_name}
                  <span className="ml-1.5">
                    <PackageChip coverage={p.t.covMap.get(b.student_id)} />
                  </span>
                </Td>
                <Td className="text-gray-500">{b.class_title}</Td>
                <Td className="text-gray-500 whitespace-nowrap">{formatSgDate(b.session_date)}</Td>
                <Td className="text-gray-500">
                  {b.marked ? "Marked" : "Awaiting the lesson"}
                </Td>
                <Td>
                  <button
                    onClick={() => p.t.handleCancel(b.id)}
                    className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                </Td>
              </Tr>
            ))
          )}
        </Tbody>
      </Table>
    </>
  );
}
