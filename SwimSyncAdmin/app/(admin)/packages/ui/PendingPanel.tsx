// "Awaiting confirmation" panel — pending requests + superseded offers (the
// display half of slices 5/6). Stage 11 of PACKAGES_REFACTOR_PLAN.md.
//
// ⚠ RISK 3 — pendingSort lives here, and the page renders <PendingPanel/>
// UNCONDITIONALLY (this component returns null when empty), so the sort hook is
// always mounted and survives a load() reload, exactly as the page-level sort
// did before.

import { Table, Thead, Th, Tbody, Tr, Td, useTableSort } from "@/components/Table";
import { Button } from "@/components/Button";
import { Tag } from "@/components/ui/Tag";
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
  canEdit = false,
  openChangeChild,
}: {
  pending: Purchase[];
  superseded: Purchase[];
  showSuperseded: boolean;
  setShowSuperseded: (fn: (v: boolean) => boolean) => void;
  busy: boolean;
  setConfirming: (p: Purchase | null) => void;
  setCancelling: (p: Purchase | null) => void;
  /** Change child (D4) — packages:edit only; the RPC is the authority. */
  canEdit?: boolean;
  openChangeChild?: (p: Purchase) => void;
}) {
  // Oldest request first: this queue is work waiting on the admin, and the
  // parent who has been waiting longest is the one to serve next.
  const pendingSort = useTableSort<Purchase>({ key: "requested_at" });
  const visiblePending = pendingSort.apply(pending);

  if (pending.length === 0 && superseded.length === 0) return null;

  return (
    <div className="mb-8 rounded-card border border-status-info-border bg-status-info-bg p-4">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-headline font-semibold text-status-info-text">
          Awaiting confirmation ({pending.length})
        </h2>
        {superseded.length > 0 && (
          <button
            onClick={() => setShowSuperseded((v) => !v)}
            className="text-label font-semibold text-status-info-text underline underline-offset-2"
          >
            {showSuperseded ? "Hide" : "Show"} superseded ({superseded.length})
          </button>
        )}
      </div>
      <p className="mb-3 text-body-secondary text-status-info-text">
        Confirm once the parent&rsquo;s PayNow transfer has landed in your
        account. Confirming starts the validity period.
      </p>
      <Table>
        <Thead>
          <Th sort={pendingSort} sortKey="parent_name">Parent</Th>
          <Th sort={pendingSort} sortKey="name">Package</Th>
          <Th sort={pendingSort} sortKey="reference_number">Reference</Th>
          <Th sort={pendingSort} sortKey="total_value" firstDir="desc" className="text-right">Price</Th>
          <Th sort={pendingSort} sortKey="requested_at">Requested</Th>
          <Th>&nbsp;</Th>
        </Thead>
        <Tbody>
          {visiblePending.map((p) => (
            <Tr key={p.id}>
              <Td className="font-medium text-ink">
                {p.parent_name}
                {p.offered_by && (
                  <Tag tone="neutral" className="ml-2">
                    Offer
                  </Tag>
                )}
                {p.paid_claimed_at && (
                  // Claimed is its own state, Info (DESIGN.md) — never green.
                  <Tag tone="info" className="ml-1">
                    Claimed
                  </Tag>
                )}
              </Td>
              <Td className="text-ink-secondary">
                {p.name}
                <span className="text-ink-muted">
                  {" "}
                  · {p.lesson_count} × {money(p.rate_per_lesson)}
                </span>
                {p.student_id && (
                  <span className="block text-label text-ink-secondary" data-testid="one-child-label">
                    {p.student_name ?? "One child"} only
                  </span>
                )}
              </Td>
              {/* The whole point of the column: this string is what
                  appears on the bank statement, so it must be readable
                  and copyable, not summarised. */}
              <Td className="font-mono text-label text-ink-secondary">
                {p.reference_number ?? "—"}
              </Td>
              <Td className="text-right tabular-nums text-ink">
                {money(p.amount_payable)}
                {p.discount_amount > 0 && (
                  <span className="ml-1 text-label text-ink-muted">
                    −{money(p.discount_amount)}
                  </span>
                )}
              </Td>
              <Td className="text-ink-muted">
                {formatSgStamp(p.requested_at, DMY)}
              </Td>
              <Td>
                <div className="flex gap-2">
                  {/* Per-row buttons are secondary — a primary per ROW would
                      be many per section (DESIGN.md: one per section). */}
                  <Button variant="outline" size="sm" onClick={() => setConfirming(p)} disabled={busy}>
                    Payment received
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => setCancelling(p)}
                    disabled={busy}
                  >
                    Decline
                  </Button>
                  {canEdit && openChangeChild && p.student_id && (
                    <Button variant="ghost" size="sm" onClick={() => openChangeChild(p)} disabled={busy}>
                      Change child
                    </Button>
                  )}
                </div>
              </Td>
            </Tr>
          ))}
          {showSuperseded &&
            superseded.map((p) => (
              <Tr key={p.id} className="opacity-60">
                <Td className="font-medium text-ink-muted">
                  {p.parent_name}
                  <Tag tone="neutral" className="ml-2">
                    Superseded
                  </Tag>
                </Td>
                <Td className="text-ink-muted">
                  {p.name}
                  <span className="text-ink-muted">
                    {" "}
                    · {p.lesson_count} × {money(p.rate_per_lesson)}
                  </span>
                </Td>
                <Td className="font-mono text-label text-ink-muted">
                  {p.reference_number ?? "—"}
                </Td>
                <Td className="text-right tabular-nums text-ink-muted">{money(p.total_value)}</Td>
                <Td className="text-ink-muted">
                  {formatSgStamp(p.requested_at, DMY)}
                </Td>
                <Td className="text-label text-ink-muted">
                  cancelled — a newer request replaced it
                </Td>
              </Tr>
            ))}
        </Tbody>
      </Table>
    </div>
  );
}
