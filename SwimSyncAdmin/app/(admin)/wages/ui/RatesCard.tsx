import { Table, Thead, Th, Tbody, Tr, Td, type TableSort } from "@/components/Table";
import type { CoachRow } from "../types";

export function RatesCard({
  rateSort,
  visibleCoaches,
  rateFor,
  setRateFor,
  rateRole,
  setRateRole,
  rateAmount,
  setRateAmount,
  rateUnit,
  setRateUnit,
  rateFrom,
  setRateFrom,
  busy,
  handleSaveRate,
}: {
  rateSort: TableSort<CoachRow>;
  visibleCoaches: CoachRow[];
  rateFor: string | null;
  setRateFor: (id: string | null) => void;
  rateRole: "main" | "shadow";
  setRateRole: (r: "main" | "shadow") => void;
  rateAmount: string;
  setRateAmount: (v: string) => void;
  rateUnit: string;
  setRateUnit: (v: string) => void;
  rateFrom: string;
  setRateFrom: (v: string) => void;
  busy: boolean;
  handleSaveRate: (coachId: string) => void;
}) {
  return (
    <div className="mb-6 rounded-2xl border border-gray-200 bg-white p-4">
      <h2 className="mb-1 text-sm font-semibold text-gray-900">Rates</h2>
      <p className="mb-3 text-xs text-gray-500">
        A coach with no rate isn&rsquo;t on payroll — which is right for a
        private coach, whose income is their parents&rsquo; invoices. Saving a
        rate adds a new dated rate rather than editing the old one, so past
        months keep the rate they were actually worked at.
      </p>
      <Table>
        <Thead>
          <Th sort={rateSort} sortKey="name">Coach</Th>
          <Th sort={rateSort} sortKey="rate" firstDir="desc">Current rate</Th>
          <Th sort={rateSort} sortKey="effective_from">In effect from</Th>
          <Th>Shadow rate</Th>
          <Th>Actions</Th>
        </Thead>
        <Tbody>
          {visibleCoaches.map((c) => (
            <Tr key={c.id}>
              <Td>{c.name}</Td>
              <Td>
                {c.rate
                  ? `S$${c.rate.amount.toFixed(2)} per ${c.rate.unit_minutes} min`
                  : "Not on payroll"}
              </Td>
              <Td>{c.rate?.effective_from ?? "—"}</Td>
              <Td>
                {c.shadowRate ? (
                  <span className="text-gray-900">
                    S${c.shadowRate.amount.toFixed(2)} per{" "}
                    {c.shadowRate.unit_minutes} min
                  </span>
                ) : (
                  <span className="text-sm text-gray-400">—</span>
                )}
              </Td>
              <Td>
                {rateFor === c.id ? (
                  <div className="flex flex-wrap items-center gap-2">
                    {/* ⚠ SWITCHING THE ROLE RE-PREFILLS THE AMOUNT. The
                        editor opens on the coach's TEACHING rate, so leaving
                        the number alone when the role changes means the
                        default action for "Shadow rate" is to save the full
                        teaching rate — handing a trainee a coach's pay, which
                        is the one thing the shadow rate exists to prevent. */}
                    <select
                      value={rateRole}
                      onChange={(e) => {
                        const next = e.target.value as "main" | "shadow";
                        setRateRole(next);
                        const r = next === "shadow" ? c.shadowRate : c.rate;
                        setRateAmount(r ? String(r.amount) : "");
                        setRateUnit(String(r?.unit_minutes ?? 60));
                      }}
                      className="rounded-lg border border-gray-200 px-2 py-1 text-sm"
                    >
                      <option value="main">Teaching rate</option>
                      <option value="shadow">Shadow rate</option>
                    </select>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="30.00"
                      value={rateAmount}
                      onChange={(e) => setRateAmount(e.target.value)}
                      className="w-24 rounded-lg border border-gray-200 px-2 py-1 text-sm"
                    />
                    <span className="text-xs text-gray-500">per</span>
                    <input
                      type="number"
                      value={rateUnit}
                      onChange={(e) => setRateUnit(e.target.value)}
                      className="w-16 rounded-lg border border-gray-200 px-2 py-1 text-sm"
                    />
                    <span className="text-xs text-gray-500">min, from</span>
                    <input
                      type="date"
                      value={rateFrom}
                      onChange={(e) => setRateFrom(e.target.value)}
                      className="rounded-lg border border-gray-200 px-2 py-1 text-sm"
                    />
                    <button
                      onClick={() => handleSaveRate(c.id)}
                      disabled={busy}
                      className="rounded-lg bg-sky-500 px-3 py-1 text-sm font-medium text-white disabled:opacity-50"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setRateFor(null)}
                      className="text-sm text-gray-500"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setRateFor(c.id);
                      setRateRole("main");
                      setRateAmount(c.rate ? String(c.rate.amount) : "");
                      setRateUnit(String(c.rate?.unit_minutes ?? 60));
                      setRateFrom("");
                    }}
                    className="text-sm font-medium text-sky-600 underline"
                  >
                    {c.rate ? "Change rate" : "Set a rate"}
                  </button>
                )}
              </Td>
            </Tr>
          ))}
        </Tbody>
      </Table>
    </div>
  );
}
