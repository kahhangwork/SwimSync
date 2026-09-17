import { Table, Thead, Th, Tbody, Tr, Td } from "@/components/Table";
import { StatusBadge } from "@/components/StatusBadge";
import { formatSgStamp } from "@/lib/lessonDates";
import { DMY } from "../constants";
import type { Referral } from "../types";

export function ReferralsSection({ referrals }: { referrals: Referral[] }) {
  return (
    <section className="mb-8">
      <h2 className="text-base font-bold text-gray-900 mb-2">Referrals</h2>
      {referrals.length === 0 ? (
        <p className="text-sm text-gray-500">No referrals yet.</p>
      ) : (
        <Table>
          <Thead>
            <Th>Referrer</Th><Th>Friend</Th><Th>Joined</Th><Th>Status</Th><Th>Converted</Th>
          </Thead>
          <Tbody>
            {referrals.map((r) => (
              <Tr key={r.id}>
                <Td>{r.referrer}</Td>
                <Td>{r.referee}</Td>
                <Td>{formatSgStamp(r.created_at, DMY)}</Td>
                <Td>
                  <StatusBadge status={r.status === "converted" ? "Converted"
                    : r.status === "void" ? `Void${r.void_reason ? ` · ${r.void_reason}` : ""}`
                    : "Pending"} />
                </Td>
                <Td>{r.converted_at ? formatSgStamp(r.converted_at, DMY) : "—"}</Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}
    </section>
  );
}
