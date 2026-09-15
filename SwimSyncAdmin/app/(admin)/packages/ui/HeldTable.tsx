// "Who holds one" — held packages + the client-side search + Record-a-sale
// trigger + per-row Extend/Cancel (display half of slices 1/4/7). Stage 11 of
// PACKAGES_REFACTOR_PLAN.md.
//
// ⚠ RISK 3 — heldSort is declared here, ABOVE the `loading ? … : <Table>`
// branch, and the page renders <HeldTable/> unconditionally, so a Retire/
// Confirm/Extend reload does not reset the user's sort.

import { Table, Thead, Th, Tbody, Tr, Td, useTableSort } from "@/components/Table";
import { Button } from "@/components/Button";
import { StatusBadge } from "@/components/StatusBadge";
import { todayInSg } from "@/lib/lessonDates";
import { ROW_LIMIT, money } from "../constants";
import type { Purchase } from "../types";

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
}) {
  const heldSort = useTableSort<Purchase>({
    key: "parent_name",
    accessors: { remaining: (p) => p.live_lessons_remaining },
  });
  const visibleHeld = heldSort.apply(heldMatches);

  return (
    <div className="mb-8">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-bold text-gray-900">Who holds one</h2>
        <div className="flex items-center gap-2">
          {held.length > 0 && (
            <input
              type="text"
              placeholder="Search parent, package or ref…"
              value={heldSearch}
              onChange={(e) => setHeldSearch(e.target.value)}
              className="w-56 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-400"
            />
          )}
          <Button variant="outline" onClick={() => setSaleModal(true)}>
            Record a sale
          </Button>
        </div>
      </div>
      {!loading && capped && (
        <p className="mb-3 text-sm text-amber-700">
          Showing the first {ROW_LIMIT} packages — the list is truncated. This
          is not expected; contact support if you see it.
        </p>
      )}
      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : held.length === 0 ? (
        <p className="text-sm text-gray-400">
          Nobody holds a package yet.
        </p>
      ) : heldMatches.length === 0 ? (
        <p className="text-sm text-gray-400">
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
                  <Td className="font-medium text-gray-900">
                    {p.parent_name}
                    {p.children && (
                      <span className="block text-xs font-normal text-gray-400">
                        {p.children}
                      </span>
                    )}
                  </Td>
                  <Td className="text-gray-600">
                    {p.name}
                    <span className="text-gray-400">
                      {" "}
                      · {p.category_name ?? "all classes"}
                    </span>
                  </Td>
                  {/* Kept here too so a payment can still be reconciled
                      after the request has been confirmed. */}
                  <Td className="font-mono text-xs text-gray-600">
                    {p.reference_number ?? "—"}
                  </Td>
                  <Td>
                    {p.status === "active" &&
                    p.live_lessons_remaining !== null ? (
                      <span
                        className="font-medium text-gray-900"
                        data-testid="live-remaining"
                      >
                        {p.live_lessons_remaining} lesson
                        {p.live_lessons_remaining === 1 ? "" : "s"}
                        <span className="font-normal text-gray-400">
                          {" "}
                          · {money(p.live_value_remaining ?? 0)}
                        </span>
                        {p.live_value_remaining !== p.value_remaining && (
                          <span
                            className="ml-1 font-normal text-gray-400"
                            title="Includes lessons attended but not yet invoiced"
                          >
                            *
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-gray-500">
                        {money(p.value_remaining)}
                      </span>
                    )}
                  </Td>
                  <Td className="text-gray-500">{p.start_date ?? "—"}</Td>
                  <Td className="text-gray-500">
                    {p.expires_on ?? "—"}
                    {expired && (
                      <span className="ml-1 text-xs text-red-600">
                        expired
                      </span>
                    )}
                    {p.holiday_extension_days > 0 && (
                      <div className="mt-0.5 text-xs text-gray-400">
                        +{p.holiday_extension_days} day
                        {p.holiday_extension_days === 1 ? "" : "s"} · public holidays
                      </div>
                    )}
                    {p.cancel_extension_days > 0 && (
                      <div className="mt-0.5 text-xs text-gray-400">
                        +{p.cancel_extension_days} day
                        {p.cancel_extension_days === 1 ? "" : "s"} · cancelled lessons
                      </div>
                    )}
                    {p.manual_extension_days > 0 && (
                      <div className="mt-0.5 text-xs text-gray-400">
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
                    {p.status === "active" && (
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openExtend(p)}
                          disabled={busy}
                        >
                          Extend
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => setCancelling(p)}
                          disabled={busy}
                        >
                          Cancel
                        </Button>
                      </div>
                    )}
                  </Td>
                </Tr>
              );
            })}
          </Tbody>
        </Table>
      )}
      <p className="mt-2 text-xs text-gray-500">
        * Remaining balances are live: lessons attended but not yet invoiced
        are already subtracted. The money itself moves when the month is
        billed.
      </p>
    </div>
  );
}
