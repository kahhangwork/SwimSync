import { Table, Thead, Th, Tbody, Tr, Td } from "@/components/Table";
import { formatSgDate } from "@/lib/lessonDates";
import type { MakeupsState } from "../domain/useMakeups";

export function UpcomingTable(p: { m: MakeupsState }) {
  return (
    <>
      <h2 className="mb-2 text-sm font-semibold text-gray-700">Upcoming</h2>
      <Table>
        <Thead>
          <Th sort={p.m.makeupSort} sortKey="student_name">Child</Th>
          <Th sort={p.m.makeupSort} sortKey="class_title">Joining</Th>
          <Th sort={p.m.makeupSort} sortKey="session_date" className="whitespace-nowrap">Date</Th>
          <Th sort={p.m.makeupSort} sortKey="marked">Status</Th>
          <Th>Actions</Th>
        </Thead>
        <Tbody>
          {p.m.upcoming.length === 0 ? (
            <Tr>
              <Td className="text-gray-400">No make-ups booked.</Td>
              <Td>{""}</Td><Td>{""}</Td><Td>{""}</Td><Td>{""}</Td>
            </Tr>
          ) : (
            p.m.visibleUpcoming.map((b) => (
              <Tr key={b.id}>
                <Td className="font-medium text-gray-800">{b.student_name}</Td>
                <Td className="text-gray-500">{b.class_title}</Td>
                <Td className="text-gray-500 whitespace-nowrap">{formatSgDate(b.session_date)}</Td>
                <Td className="text-gray-500">
                  {b.marked ? "Marked" : "Awaiting the lesson"}
                </Td>
                <Td>
                  <button
                    onClick={() => p.m.handleCancel(b.id)}
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
