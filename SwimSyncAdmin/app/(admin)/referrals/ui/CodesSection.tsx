import { Table, Thead, Th, Tbody, Tr, Td } from "@/components/Table";
import { Button } from "@/components/Button";
import { StatusBadge } from "@/components/StatusBadge";
import type { Membership } from "../types";

export function CodesSection({
  memberships,
  busy,
  onToggle,
}: {
  memberships: Membership[];
  busy: boolean;
  onToggle: (m: Membership) => void;
}) {
  return (
    <section className="mb-8">
      <h2 className="text-base font-bold text-gray-900 mb-2">Family referral codes</h2>
      <p className="text-sm text-gray-500 mb-2">
        A leaked code cannot be rotated — disable it to shut it off.
      </p>
      {memberships.length === 0 ? (
        <p className="text-sm text-gray-500">No families yet.</p>
      ) : (
        <Table>
          <Thead>
            <Th>Family</Th><Th>Code</Th><Th>Status</Th><Th>{""}</Th>
          </Thead>
          <Tbody>
            {memberships.map((m) => (
              <Tr key={m.membership_id}>
                <Td>{m.name}</Td>
                <Td><span className="font-mono">{m.code ?? "—"}</span></Td>
                <Td>{m.disabled_at
                  ? <StatusBadge status="Disabled" />
                  : <StatusBadge status="Active" />}</Td>
                <Td>
                  <Button variant="ghost" onClick={() => onToggle(m)} disabled={busy}>
                    {m.disabled_at ? "Enable" : "Disable"}
                  </Button>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}
    </section>
  );
}
