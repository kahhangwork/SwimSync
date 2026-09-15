// "Awaiting confirmation" panel — pending requests + superseded offers (the
// display half of slices 5/6). Stage 11 of PACKAGES_REFACTOR_PLAN.md.
//
// ⚠ RISK 3 — pendingSort lives here, and the page renders <PendingPanel/>
// UNCONDITIONALLY (this component returns null when empty), so the sort hook is
// always mounted and survives a load() reload, exactly as the page-level sort
// did before.

import { Table, Thead, Th, Tbody, Tr, Td, useTableSort } from "@/components/Table";
import { Button } from "@/components/Button";
import { formatSgStamp } from "@/lib/lessonDates";
import { DMY, money } from "../constants";
import type { Purchase } from "../types";

export function PendingPanel({
  pending,
  superseded,
  showSuperseded,
  setShowSuperseded,
  busy,
  setConfirming,
  setCancelling,
}: {
  pending: Purchase[];
  superseded: Purchase[];
  showSuperseded: boolean;
  setShowSuperseded: (fn: (v: boolean) => boolean) => void;
  busy: boolean;
  setConfirming: (p: Purchase | null) => void;
  setCancelling: (p: Purchase | null) => void;
}) {
  // Oldest request first: this queue is work waiting on the admin, and the
  // parent who has been waiting longest is the one to serve next.
  const pendingSort = useTableSort<Purchase>({ key: "requested_at" });
  const visiblePending = pendingSort.apply(pending);

  if (pending.length === 0 && superseded.length === 0) return null;

  return (
    <div className="mb-8 rounded-xl border border-amber-200 bg-amber-50 p-4">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-sm font-bold text-amber-900">
          Awaiting confirmation ({pending.length})
        </h2>
        {superseded.length > 0 && (
          <button
            onClick={() => setShowSuperseded((v) => !v)}
            className="text-xs font-semibold text-amber-700 underline"
          >
            {showSuperseded ? "Hide" : "Show"} superseded ({superseded.length})
          </button>
        )}
      </div>
      <p className="mb-3 text-xs text-amber-800">
        Confirm once the parent&rsquo;s PayNow transfer has landed in your
        account. Confirming starts the validity period.
      </p>
      <Table>
        <Thead>
          <Th sort={pendingSort} sortKey="parent_name">Parent</Th>
          <Th sort={pendingSort} sortKey="name">Package</Th>
          <Th sort={pendingSort} sortKey="reference_number">Reference</Th>
          <Th sort={pendingSort} sortKey="total_value" firstDir="desc">Price</Th>
          <Th sort={pendingSort} sortKey="requested_at">Requested</Th>
          <Th>&nbsp;</Th>
        </Thead>
        <Tbody>
          {visiblePending.map((p) => (
            <Tr key={p.id}>
              <Td className="font-medium text-gray-900">
                {p.parent_name}
                {p.offered_by && (
                  <span className="ml-2 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700">
                    Offer
                  </span>
                )}
                {p.paid_claimed_at && (
                  <span className="ml-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                    Claimed
                  </span>
                )}
              </Td>
              <Td className="text-gray-600">
                {p.name}
                <span className="text-gray-400">
                  {" "}
                  · {p.lesson_count} × {money(p.rate_per_lesson)}
                </span>
              </Td>
              {/* The whole point of the column: this string is what
                  appears on the bank statement, so it must be readable
                  and copyable, not summarised. */}
              <Td className="font-mono text-xs text-gray-600">
                {p.reference_number ?? "—"}
              </Td>
              <Td className="text-gray-900">
                {money(p.amount_payable)}
                {p.discount_amount > 0 && (
                  <span className="ml-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                    −{money(p.discount_amount)}
                  </span>
                )}
              </Td>
              <Td className="text-gray-500">
                {formatSgStamp(p.requested_at, DMY)}
              </Td>
              <Td>
                <div className="flex gap-2">
                  <Button onClick={() => setConfirming(p)} disabled={busy}>
                    Payment received
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setCancelling(p)}
                    disabled={busy}
                  >
                    Decline
                  </Button>
                </div>
              </Td>
            </Tr>
          ))}
          {showSuperseded &&
            superseded.map((p) => (
              <Tr key={p.id} className="opacity-60">
                <Td className="font-medium text-gray-500">
                  {p.parent_name}
                  <span className="ml-2 rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600">
                    Superseded
                  </span>
                </Td>
                <Td className="text-gray-500">
                  {p.name}
                  <span className="text-gray-400">
                    {" "}
                    · {p.lesson_count} × {money(p.rate_per_lesson)}
                  </span>
                </Td>
                <Td className="font-mono text-xs text-gray-500">
                  {p.reference_number ?? "—"}
                </Td>
                <Td className="text-gray-500">{money(p.total_value)}</Td>
                <Td className="text-gray-400">
                  {formatSgStamp(p.requested_at, DMY)}
                </Td>
                <Td className="text-xs text-gray-400">
                  cancelled — a newer request replaced it
                </Td>
              </Tr>
            ))}
        </Tbody>
      </Table>
    </div>
  );
}
