import { Table, Thead, Th, Tbody, Tr, Td } from "@/components/Table";
import { Button } from "@/components/Button";
import type { TrialsState } from "../domain/useTrials";

export function TrialPricesSection(p: { t: TrialsState }) {
  return (
    <>
      <h2 className="mt-8 mb-2 text-body font-semibold text-ink-secondary">
        Trial prices
      </h2>
      <p className="mb-3 max-w-2xl text-label text-ink-muted">
        What a <strong>paid</strong> trial of each kind of class costs. A free
        trial is free — the coach marks it as one, and nothing is charged.
        Changing a price applies from today onward and never re-values a lesson
        already taught.
      </p>
      <Table>
        <Thead>
          <Th sort={p.t.categorySort} sortKey="name">Class type</Th>
          <Th sort={p.t.categorySort} sortKey="rate">Trial price now</Th>
          <Th>Change it</Th>
        </Thead>
        <Tbody>
          {p.t.visibleCategories.map((c) => (
            <Tr key={c.id}>
              <Td className="font-medium text-ink">{c.name}</Td>
              <Td className={c.rate === null ? "text-status-warning-text" : "text-ink-secondary"}>
                {c.rate === null ? "Not set — uses the class price" : `S$${c.rate.toFixed(2)}`}
              </Td>
              <Td>
                <div className="flex items-center gap-2">
                  <span className="text-label text-ink-muted">S$</span>
                  <input
                    value={p.t.rateDraft[c.id] ?? ""}
                    onChange={(e) =>
                      p.t.setRateDraft((p) => ({ ...p, [c.id]: e.target.value }))
                    }
                    inputMode="decimal"
                    placeholder="0.00"
                    aria-label={`New trial price for ${c.name}`}
                    className="w-20 rounded-control border border-border-strong px-2 py-1.5 text-label"
                  />
                  <Button
                    variant="outline"
                    disabled={p.t.rateBusy === c.id || !(Number(p.t.rateDraft[c.id]) > 0)}
                    onClick={() => p.t.handleSaveRate(c.id)}
                  >
                    Save
                  </Button>
                </div>
              </Td>
            </Tr>
          ))}
        </Tbody>
      </Table>
      {p.t.rateError && (
        <p className="mt-2 rounded-card border border-status-danger-border bg-status-danger-bg px-3 py-2 text-label text-status-danger-text">
          {p.t.rateError}
        </p>
      )}
    </>
  );
}
