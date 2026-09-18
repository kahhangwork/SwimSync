// The "Move a student to another business" card. Stage 9 of
// docs/refactor/PLATFORM_REFACTOR_PLAN.md, markup verbatim from page.tsx
// lines 400-481.
//
// ⚠ TWO DRIVER CONTRACTS LIVE IN THIS DOM, and neither is visible in the markup:
//
//   1. verify-platform-admin does `page.selectOption("select", …)` with a BARE
//      "select" locator. That only works while exactly ONE <select> is on the
//      page — true today because Modal renders null when closed. Do NOT add a
//      second <select> that renders with no modal open.
//   2. The page has TWO "Search" buttons (this one and family status below), so
//      the driver uses .first(). This card must therefore stay ABOVE the family
//      status card in DOM order.
//
// ⚠ THE PICKER IS UNCONTROLLED — defaultValue="" with
// key={`move-${s.id}-${moveNonce}`}. The key string is a contract with
// domain/useStudentMove: bumping the nonce is the only thing that returns it to
// "Choose…" after a move or a cancel. Do NOT make it controlled.
//
// ⚠ The notice banner renders HERE, inside this card, exactly where it did on
// the page. Moving it is a behaviour change, not a tidy-up.

import {
  Table,
  Thead,
  Th,
  Tbody,
  Tr,
  Td,
  useTableSort,
} from "@/components/Table";
import { PackageChip } from "@/components/PackageChip";
import type { StudentCoverage } from "@/lib/packageCoverage";
import type { StudentRow, TenantRow } from "../types";

export function StudentMoveSection({
  tenants,
  students,
  covMap,
  moving,
  moveNonce,
  search,
  setSearch,
  message,
  onSearch,
  onMove,
}: {
  tenants: TenantRow[];
  students: StudentRow[];
  covMap: Map<string, StudentCoverage>;
  moving: string | null;
  moveNonce: number;
  search: string;
  setSearch: (v: string) => void;
  message: string | null;
  onSearch: () => void;
  onMove: (studentId: string, tenantId: string) => void;
}) {
  const studentSort = useTableSort<StudentRow>({
    key: "full_name",
    accessors: {
      // The business NAME, which is what the cell shows — the row holds only an
      // id, and sorting by a uuid would look like no sort at all.
      tenant: (s) =>
        tenants.find((t) => t.tenant_id === s.tenant_id)?.display_name ?? null,
      is_active: (s) => !s.is_active,
    },
  });
  const visibleStudents = studentSort.apply(students);

  return (
      <div className="rounded-2xl border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-900">
          Move a student to another business
        </h2>
        <p className="mt-1 mb-3 text-sm text-gray-600">
          For when a parent entered the wrong join code. Moving closes any active
          class enrolment — attendance and billing history stay with the business
          that recorded them.
        </p>

        <div className="mb-4 flex gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onSearch()}
            placeholder="Search a child's name"
            className="flex-1 rounded-xl border border-gray-200 px-3 py-2 text-sm"
          />
          <button
            onClick={onSearch}
            className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-600"
          >
            Search
          </button>
        </div>

        {message && (
          <div className="mb-3 rounded-xl bg-sky-50 px-3 py-2 text-sm text-sky-900">
            {message}
          </div>
        )}

        {students.length > 0 && (
          <Table>
            <Thead>
              <Th sort={studentSort} sortKey="full_name">Child</Th>
              <Th sort={studentSort} sortKey="tenant">Currently with</Th>
              <Th sort={studentSort} sortKey="is_active">Active?</Th>
              <Th>Move to</Th>
            </Thead>
            <Tbody>
              {visibleStudents.map((s) => (
                <Tr key={s.id}>
                  <Td>
                    {s.full_name}
                    <span className="ml-1.5">
                      <PackageChip coverage={covMap.get(s.id)} />
                    </span>
                  </Td>
                  <Td>
                    {tenants.find((t) => t.tenant_id === s.tenant_id)?.display_name ??
                      "—"}
                  </Td>
                  <Td>{s.is_active ? "Active" : "Inactive"}</Td>
                  <Td>
                    <select
                      key={`move-${s.id}-${moveNonce}`}
                      defaultValue=""
                      disabled={moving === s.id}
                      onChange={(e) =>
                        e.target.value && onMove(s.id, e.target.value)
                      }
                      className="rounded-lg border border-gray-200 px-2 py-1 text-sm"
                    >
                      <option value="">
                        {moving === s.id ? "Moving…" : "Choose…"}
                      </option>
                      {tenants
                        .filter((t) => t.tenant_id !== s.tenant_id)
                        .map((t) => (
                          <option key={t.tenant_id} value={t.tenant_id}>
                            {t.display_name}
                          </option>
                        ))}
                    </select>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </div>
  );
}
