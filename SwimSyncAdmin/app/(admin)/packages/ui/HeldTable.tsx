// "Who holds one" — held packages + the client-side search + Record-a-sale
// trigger + per-row Extend/Cancel (display half of slices 1/4/7). Stage 11 of
// PACKAGES_REFACTOR_PLAN.md.
//
// ⚠ RISK 3 — heldSort is declared here, ABOVE the `loading ? … : <Table>`
// branch, and the page renders <HeldTable/> unconditionally, so a Retire/
// Confirm/Extend reload does not reset the user's sort.

import { Table, Thead, Th, Tbody, Tr, Td, useTableSort } from "@/components/Table";
import { Button } from "@/components/Button";
import { RowMenu, RowMenuItem } from "@/components/ui/RowMenu";
import { StatusBadge } from "@/components/StatusBadge";
import { formatSgStamp, todayInSg } from "@/lib/lessonDates";
import { ROW_LIMIT, money } from "../constants";
import { refundState } from "../domain/packageRows";
import type { LiveRefund, Purchase } from "../types";

const DMY: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" };

export function HeldTable({
  held,
  heldMatches,
  heldSearch,
  setHeldSearch,
  loading,
  capped,
  busy,
  openExtend,
  setCancelling,
  setSaleModal,
  refunds,
  canEdit,
  openRefund,
  openReverse,
  checkBacklog,
  checking,
  openChangeChild,
}: {
  held: Purchase[];
  heldMatches: Purchase[];
  heldSearch: string;
  setHeldSearch: (v: string) => void;
  loading: boolean;
  capped: boolean;
  busy: boolean;
  openExtend: (p: Purchase) => void;
  setCancelling: (p: Purchase | null) => void;
  setSaleModal: (open: boolean) => void;
  /** Live refunds by package id; null = they could not be loaded (controls hide). */
  refunds: Map<string, LiveRefund> | null;
  /** packages:edit, known (false while permissions load — fail closed). */
  canEdit: boolean;
  openRefund: (p: Purchase) => void;
  openReverse: (p: Purchase, r: LiveRefund) => void;
  /** Re-ask the backdated-draw question for this package (packages:edit). */
  checkBacklog: (p: Purchase) => void;
  /** The package id being checked, else null — locks every row's Check. */
  checking: string | null;
  /** Change child (D4) — one-child, non-cancelled packages, packages:edit. */
  openChangeChild?: (p: Purchase) => void;
}) {
  const heldSort = useTableSort<Purchase>({
    key: "parent_name",
    accessors: { remaining: (p) => (p.status === "active" ? p.lessons_remaining : null) },
  });
  const visibleHeld = heldSort.apply(heldMatches);

  return (
    <div className="mb-8">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-headline font-semibold text-ink">Who holds one</h2>
        <div className="flex items-center gap-2">
          {held.length > 0 && (
            <input
              type="text"
              placeholder="Search parent, package or ref…"
              value={heldSearch}
              onChange={(e) => setHeldSearch(e.target.value)}
              className="w-56 rounded-control border border-border-strong bg-surface px-3 py-2 text-body placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-primary"
            />
          )}
          <Button variant="outline" onClick={() => setSaleModal(true)}>
            Record a sale
          </Button>
        </div>
      </div>
      {!loading && capped && (
        <p className="mb-3 text-body text-status-warning-text">
          Showing the first {ROW_LIMIT} packages — the list is truncated. This
          is not expected; contact support if you see it.
        </p>
      )}
      {loading ? (
        <p className="text-body text-ink-muted">Loading…</p>
      ) : held.length === 0 ? (
        <p className="text-body text-ink-muted">
          Nobody holds a package yet.
        </p>
      ) : heldMatches.length === 0 ? (
        <p className="text-body text-ink-muted">
          No held package matches &ldquo;{heldSearch}&rdquo;.
        </p>
      ) : (
        <Table>
          <Thead>
            <Th sort={heldSort} sortKey="parent_name">Parent</Th>
            <Th sort={heldSort} sortKey="name">Package</Th>
            <Th sort={heldSort} sortKey="reference_number">Reference</Th>
            <Th sort={heldSort} sortKey="remaining">Remaining</Th>
            <Th sort={heldSort} sortKey="start_date">Starts</Th>
            <Th sort={heldSort} sortKey="expires_on">Expires</Th>
            <Th sort={heldSort} sortKey="status">Status</Th>
            <Th>&nbsp;</Th>
          </Thead>
          <Tbody>
            {visibleHeld.map((p) => {
              // todayInSg(), never toISOString().slice — the UTC date is
              // yesterday in SGT before 08:00 (§7.7).
              const expired =
                p.status === "active" &&
                p.expires_on !== null &&
                p.expires_on < todayInSg();
              return (
                <Tr key={p.id}>
                  <Td className="font-medium text-ink">
                    {p.parent_name}
                    {p.children && (
                      <span className="block text-label font-normal text-ink-muted">
                        {p.children}
                      </span>
                    )}
                  </Td>
                  <Td className="text-ink-secondary">
                    {p.name}
                    <span className="text-ink-muted">
                      {" "}
                      · {p.category_name ?? "all classes"}
                    </span>
                    {p.student_id && (
                      <span className="block text-label text-primary" data-testid="one-child-label">
                        {p.student_name ?? "One child"} only
                      </span>
                    )}
                  </Td>
                  {/* Kept here too so a payment can still be reconciled
                      after the request has been confirmed. */}
                  <Td className="font-mono text-label text-ink-secondary">
                    {p.reference_number ?? "—"}
                  </Td>
                  <Td>
                    {p.status === "active" ? (
                      <span
                        className="font-medium text-ink"
                        data-testid="live-remaining"
                      >
                        {p.lessons_remaining} lesson
                        {p.lessons_remaining === 1 ? "" : "s"}
                        <span className="font-normal text-ink-muted">
                          {" "}
                          · {money(p.value_remaining)}
                        </span>
                      </span>
                    ) : (
                      <span className="text-ink-muted">
                        {money(p.value_remaining)}
                      </span>
                    )}
                  </Td>
                  {/* DISPLAY only (S9): the raw dates stay what `expired` and the sort read. */}
                  <Td className="text-ink-muted">
                    {/* A carried-over package shows its ORIGINAL start (expiry is
                        counted from it); coverage began the day it was brought in. */}
                    {p.carried_over_start
                      ? formatSgStamp(p.carried_over_start, DMY)
                      : p.start_date ? formatSgStamp(p.start_date, DMY) : "—"}
                    {p.carried_over_start && (
                      <span className="block text-label" data-testid="held-carried-note">
                        Brought in {p.start_date ? formatSgStamp(p.start_date, DMY) : ""} · {p.carried_over_lessons} left then
                      </span>
                    )}
                  </Td>
                  <Td className="text-ink-muted">
                    {p.expires_on ? formatSgStamp(p.expires_on, DMY) : "—"}
                    {expired && (
                      <span className="ml-1 text-label text-status-danger-text">
                        expired
                      </span>
                    )}
                    {p.holiday_extension_days > 0 && (
                      <div className="mt-0.5 text-label text-ink-muted">
                        +{p.holiday_extension_days} day
                        {p.holiday_extension_days === 1 ? "" : "s"} · public holidays
                      </div>
                    )}
                    {p.cancel_extension_days > 0 && (
                      <div className="mt-0.5 text-label text-ink-muted">
                        +{p.cancel_extension_days} day
                        {p.cancel_extension_days === 1 ? "" : "s"} · cancelled lessons
                      </div>
                    )}
                    {p.manual_extension_days > 0 && (
                      <div className="mt-0.5 text-label text-ink-muted">
                        +{p.manual_extension_days} day
                        {p.manual_extension_days === 1 ? "" : "s"} · manual
                      </div>
                    )}
                  </Td>
                  <Td>
                    <StatusBadge
                      status={
                        p.status.charAt(0).toUpperCase() + p.status.slice(1)
                      }
                    />
                  </Td>
                  <Td>
                    <RefundCell
                      p={p}
                      refunds={refunds}
                      canEdit={canEdit}
                      busy={busy}
                      openRefund={openRefund}
                    />
                    {/* One inline action per row (DESIGN.md → Tables): Extend on
                        an active package, Record refund on a cancelled paid one
                        (RefundCell); everything else in the "…" menu — Check
                        marked lessons, Change child, Reverse a refund, and
                        Cancel (destructive, behind its confirm). Same handlers. */}
                    <div className="flex items-center gap-1.5">
                      {p.status === "active" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openExtend(p)}
                          disabled={busy}
                        >
                          Extend
                        </Button>
                      )}
                      <RowMenu>
                        {/* The backdated-draw question again (Wave 6 D5 is
                            asked once, at activation). Draw needs
                            packages:edit, so the item does too. */}
                        {p.status === "active" && canEdit && (
                          <RowMenuItem
                            onClick={() => checkBacklog(p)}
                            disabled={busy || checking !== null}
                          >
                            {checking === p.id ? "Checking…" : "Check marked lessons"}
                          </RowMenuItem>
                        )}
                        {/* Change child (D4): the RPC decides "unused" — offered
                            for every one-child package that is not cancelled. */}
                        {canEdit && openChangeChild && p.student_id && p.status !== "cancelled" && (
                          <RowMenuItem onClick={() => openChangeChild(p)} disabled={busy}>
                            Change child
                          </RowMenuItem>
                        )}
                        {refundState(p, refunds, canEdit) === "recorded" && (
                          <RowMenuItem
                            destructive
                            onClick={() => openReverse(p, refunds!.get(p.id)!)}
                            disabled={busy}
                          >
                            Reverse refund
                          </RowMenuItem>
                        )}
                        {p.status === "active" && (
                          <RowMenuItem destructive onClick={() => setCancelling(p)} disabled={busy}>
                            Cancel
                          </RowMenuItem>
                        )}
                      </RowMenu>
                    </div>
                  </Td>
                </Tr>
              );
            })}
          </Tbody>
        </Table>
      )}
      {refunds === null && (
        <p className="mt-1 text-label text-status-warning-text" data-testid="refunds-unavailable">
          Refund details couldn&rsquo;t load — reload the page before recording a refund.
        </p>
      )}
    </div>
  );
}

// The refund slot of a cancelled row (PACKAGE_REVENUE_REFUNDS_PLAN.md U2). What
// it shows is decided by refundState() alone, so the rules live in one tested place.
function RefundCell({
  p,
  refunds,
  canEdit,
  busy,
  openRefund,
}: {
  p: Purchase;
  refunds: Map<string, LiveRefund> | null;
  canEdit: boolean;
  busy: boolean;
  openRefund: (p: Purchase) => void;
}) {
  const state = refundState(p, refunds, canEdit);
  if (state === "none") return null;
  if (state === "can_record") {
    return (
      <Button variant="outline" size="sm" onClick={() => openRefund(p)} disabled={busy}>
        Record refund
      </Button>
    );
  }
  const r = refunds!.get(p.id)!;
  return (
    <div className="flex items-center gap-1" data-testid="refund-recorded">
      <span className="text-label text-ink-secondary" title={r.note ?? undefined}>
        Refunded {money(r.amount)} on {formatSgStamp(r.refunded_on, DMY)}
      </span>
    </div>
  );
}
