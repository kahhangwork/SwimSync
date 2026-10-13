// Family status across businesses. Stage 10 of
// docs/refactor/PLATFORM_REFACTOR_PLAN.md, markup verbatim from page.tsx.
//
// Read-only ON PURPOSE. Whether a family is a customer of a business is THAT
// business's call, so this shows the answer without offering to change it. There
// is no login-blocking control here either: that is a platform power over an
// ACCOUNT and is filed separately.
//
// ⚠ THIS CARD MUST STAY BELOW ui/StudentMoveSection IN DOM ORDER. The page has
// two "Search" buttons and verify-platform-admin clicks `.first()` — swapping
// the two cards would silently point that driver at family status, where its
// subsequent assertions about a child would fail for the wrong reason.
//
// Driven by verify-platform-controls (the search); the mapping's net is
// domain/familyRows.test.ts.

import {
  Table,
  Thead,
  Th,
  Tbody,
  Tr,
  Td,
  useTableSort,
} from "@/components/Table";
import type { FamilyStatusRow } from "../types";

export function FamilyStatusSection({
  famSearch,
  setFamSearch,
  families,
  famMessage,
  onSearch,
}: {
  famSearch: string;
  setFamSearch: (v: string) => void;
  families: FamilyStatusRow[];
  famMessage: string | null;
  onSearch: () => void;
}) {
  const familySort = useTableSort<FamilyStatusRow>({
    key: "parent_name",
    accessors: {
      family_active: (f) => !f.family_active,
      children: (f) => f.children.length,
    },
  });
  const visibleFamilies = familySort.apply(families);

  return (
      <div data-platform-card className="mt-8 rounded-card border border-border bg-surface p-4">
        <h2 className="mb-1 text-lg font-semibold text-ink">Family status</h2>
        <p className="mb-4 text-body text-ink-muted">
          Where a family stands at each business they deal with. Read-only —
          activity is the business&apos;s decision, not the platform&apos;s.
        </p>

        <div className="mb-4 flex gap-2">
          <input
            value={famSearch}
            onChange={(e) => setFamSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onSearch()}
            placeholder="Search a parent's name or email"
            className="flex-1 rounded-control border border-border-strong px-3 py-2 text-body"
          />
          <button
            onClick={onSearch}
            className="rounded-control bg-primary px-4 py-2 text-body font-medium text-white hover:bg-primary-hover"
          >
            Search
          </button>
        </div>

        {famMessage && (
          <div className="mb-3 rounded-card bg-status-info-bg px-3 py-2 text-body text-status-info-text">
            {famMessage}
          </div>
        )}

        {families.length > 0 && (
          <Table>
            <Thead>
              <Th sort={familySort} sortKey="parent_name">Parent</Th>
              <Th sort={familySort} sortKey="tenant_name">Business</Th>
              <Th sort={familySort} sortKey="family_active">Family</Th>
              <Th sort={familySort} sortKey="children">Children there</Th>
            </Thead>
            <Tbody>
              {visibleFamilies.map((f, i) => (
                <Tr key={`${f.email}:${f.tenant_name}:${i}`}>
                  <Td>
                    <div className="font-medium text-ink">{f.parent_name}</div>
                    <div className="text-label text-ink-muted">{f.email}</div>
                  </Td>
                  <Td>{f.tenant_name}</Td>
                  <Td>{f.family_active ? "Active" : "Inactive"}</Td>
                  <Td>
                    {f.children.length === 0 ? (
                      <span className="text-ink-muted">none</span>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {f.children.map((c) => (
                          <span
                            key={c.full_name}
                            className={`rounded px-1.5 py-0.5 text-label ${
                              c.is_active
                                ? "bg-status-success-bg text-status-success-text"
                                : "bg-status-neutral-bg text-ink-muted line-through"
                            }`}
                          >
                            {c.full_name}
                          </span>
                        ))}
                      </div>
                    )}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </div>
  );
}
