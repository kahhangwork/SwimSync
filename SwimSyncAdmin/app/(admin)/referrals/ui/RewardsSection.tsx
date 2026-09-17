import { Table, Thead, Th, Tbody, Tr, Td } from "@/components/Table";
import { Button } from "@/components/Button";
import { StatusBadge } from "@/components/StatusBadge";
import { formatSgStamp } from "@/lib/lessonDates";
import { DMY } from "../constants";
import { displayStatus } from "../domain/referralRows";
import type { Reward } from "../types";

export function RewardsSection({
  rewards,
  busy,
  onVoid,
}: {
  rewards: Reward[];
  busy: boolean;
  onVoid: (id: string) => void;
}) {
  return (
    <section className="mb-8">
      <h2 className="text-base font-bold text-gray-900 mb-2">Rewards</h2>
      {rewards.length === 0 ? (
        <p className="text-sm text-gray-500">No rewards yet.</p>
      ) : (
        <Table>
          <Thead>
            <Th>Beneficiary</Th><Th>Kind</Th><Th>Status</Th><Th>Earned</Th><Th>Expires</Th><Th>{""}</Th>
          </Thead>
          <Tbody>
            {rewards.map((r) => {
              const st = displayStatus(r);
              return (
                <Tr key={r.id}>
                  <Td>{r.beneficiary}</Td>
                  <Td>{r.kind === "referee_first" ? "Friend's first"
                     : r.kind === "referrer" ? "Referrer" : "Manual"}</Td>
                  <Td><StatusBadge status={st[0].toUpperCase() + st.slice(1)} /></Td>
                  <Td>{formatSgStamp(r.earned_at, DMY)}</Td>
                  <Td>{r.expires_at ? formatSgStamp(r.expires_at, DMY) : "never"}</Td>
                  <Td>
                    {(r.status === "available" || r.status === "reserved") && (
                      <Button variant="ghost" onClick={() => onVoid(r.id)} disabled={busy}>
                        Void
                      </Button>
                    )}
                  </Td>
                </Tr>
              );
            })}
          </Tbody>
        </Table>
      )}
    </section>
  );
}
