import { Table, Thead, Th, Tbody, Tr, Td } from "@/components/Table";
import { formatSgDate } from "@/lib/lessonDates";
import type { MakeupsState } from "../domain/useMakeups";

export function UpcomingTable(p: { m: MakeupsState }) {
  return (
    <>
      <h2 className="mb-2 text-body font-semibold text-ink-secondary">Upcoming</h2>
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
              <Td className="text-ink-muted">No make-ups booked.</Td>
              <Td>{""}</Td><Td>{""}</Td><Td>{""}</Td><Td>{""}</Td>
            </Tr>
          ) : (
            p.m.visibleUpcoming.map((b) => (
              <Tr key={b.id}>
                <Td className="font-medium text-ink">{b.student_name}</Td>
                <Td className="text-ink-muted">{b.class_title}</Td>
                <Td className="text-ink-muted whitespace-nowrap">{formatSgDate(b.session_date)}</Td>
                <Td className="text-ink-muted">
                  {b.marked ? "Marked" : "Awaiting the lesson"}
                </Td>
                <Td>
                  <button
                    onClick={() => p.m.handleCancel(b.id)}
                    className="rounded-control border border-border px-2.5 py-1 text-label font-semibold text-ink-secondary hover:bg-ground"
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
