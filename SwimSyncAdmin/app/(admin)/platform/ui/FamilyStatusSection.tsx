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
// ⚠ NO DRIVER OPENS THIS SECTION (the plan credited verify-platform-admin in
// error; it only mentions family status in a comment). The mapping's net is
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
      <div className="mt-8 rounded-2xl border border-gray-100 bg-white p-5">
        <h2 className="mb-1 text-lg font-semibold text-gray-900">Family status</h2>
        <p className="mb-4 text-sm text-gray-500">
          Where a family stands at each business they deal with. Read-only —
          activity is the business&apos;s decision, not the platform&apos;s.
        </p>

        <div className="mb-4 flex gap-2">
          <input
            value={famSearch}
            onChange={(e) => setFamSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onSearch()}
            placeholder="Search a parent's name or email"
            className="flex-1 rounded-xl border border-gray-200 px-3 py-2 text-sm"
          />
          <button
            onClick={onSearch}
            className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-600"
          >
            Search
          </button>
        </div>

        {famMessage && (
          <div className="mb-3 rounded-xl bg-sky-50 px-3 py-2 text-sm text-sky-900">
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
                    <div className="font-medium text-gray-900">{f.parent_name}</div>
                    <div className="text-xs text-gray-500">{f.email}</div>
                  </Td>
                  <Td>{f.tenant_name}</Td>
                  <Td>{f.family_active ? "Active" : "Inactive"}</Td>
                  <Td>
                    {f.children.length === 0 ? (
                      <span className="text-gray-400">none</span>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {f.children.map((c) => (
                          <span
                            key={c.full_name}
                            className={`rounded px-1.5 py-0.5 text-xs ${
                              c.is_active
                                ? "bg-emerald-50 text-emerald-700"
                                : "bg-gray-100 text-gray-500 line-through"
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
