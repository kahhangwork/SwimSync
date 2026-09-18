import { Table, Thead, Th, Tbody, Tr, Td } from "@/components/Table";
import { Button } from "@/components/Button";
import type { TrialsState } from "../domain/useTrials";

export function TrialPricesSection(p: { t: TrialsState }) {
  return (
    <>
      <h2 className="mt-8 mb-2 text-sm font-semibold text-gray-700">
        Trial prices
      </h2>
      <p className="mb-3 max-w-2xl text-xs text-gray-500">
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
              <Td className="font-medium text-gray-800">{c.name}</Td>
              <Td className={c.rate === null ? "text-amber-600" : "text-gray-600"}>
                {c.rate === null ? "Not set — uses the class price" : `S$${c.rate.toFixed(2)}`}
              </Td>
              <Td>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">S$</span>
                  <input
                    value={p.t.rateDraft[c.id] ?? ""}
                    onChange={(e) =>
                      p.t.setRateDraft((p) => ({ ...p, [c.id]: e.target.value }))
                    }
                    inputMode="decimal"
                    placeholder="0.00"
                    aria-label={`New trial price for ${c.name}`}
                    className="w-20 rounded-lg border border-gray-300 px-2 py-1.5 text-xs"
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
        <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {p.t.rateError}
        </p>
      )}
    </>
  );
}
