import { Table, Thead, Th, Tbody, Tr, Td } from "@/components/Table";
import { Button } from "@/components/Button";
import { StatusBadge } from "@/components/StatusBadge";
import { formatSgStamp } from "@/lib/lessonDates";
import { DMY } from "../constants";
import { canVoidReferral } from "../domain/referralRows";
import type { Referral } from "../types";

export function ReferralsSection({
  referrals,
  busy,
  onVoid,
}: {
  referrals: Referral[];
  busy: boolean;
  onVoid: (id: string) => void;
}) {
  return (
    <section className="mb-8">
      <h2 className="text-headline font-semibold text-ink mb-2">Referrals</h2>
      {referrals.length === 0 ? (
        <p className="text-body text-ink-muted">No referrals yet.</p>
      ) : (
        <Table>
          <Thead>
            <Th>Referrer</Th><Th>Friend</Th><Th>Joined</Th><Th>Status</Th><Th>Converted</Th><Th>{""}</Th>
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
                <Td>
                  {/* "Void referral", never bare "Void": the Rewards table's Void voids only a
                      reward and leaves the referral pending (plan RISK 7). */}
                  {canVoidReferral(r) && (
                    <Button variant="danger" size="sm" onClick={() => onVoid(r.id)} disabled={busy}>
                      Void referral
                    </Button>
                  )}
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}
    </section>
  );
}
