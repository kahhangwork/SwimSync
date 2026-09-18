// "Signed up but not in any business" — parents who registered and never entered
// a join code. Stage 5 of docs/refactor/PLATFORM_REFACTOR_PLAN.md, markup
// verbatim from page.tsx lines 1031-1057.
//
// They belong to no business, so no tenant admin can see them and nothing else
// surfaces them — and they are exactly who the student-move tool exists for.
//
// ⚠ NO DRIVER OPENS THIS PANEL (grepped 2026-09-18: no verify-*.mjs contains
// "not in any business"). It is hand-checked at Stage 5 and a verify-platform-
// controls driver is filed in BACKLOG.md. Treat a change here as unnetted.
//
// The caller renders this only when `stranded.length > 0`, exactly as the page
// did — an empty panel is not the same as no panel.

import {
  Table,
  Thead,
  Th,
  Tbody,
  Tr,
  Td,
  useTableSort,
} from "@/components/Table";
import { formatSgDate, toSgDate } from "@/lib/lessonDates";
import type { StrandedParent } from "../types";

export function StrandedPanel({ stranded }: { stranded: StrandedParent[] }) {
  const strandedSort = useTableSort<StrandedParent>({ key: "joined_at", dir: "desc" });
  const visibleStranded = strandedSort.apply(stranded);

  return (
              <div className="mb-8 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <h2 className="text-sm font-semibold text-gray-900">
            Signed up but not in any business ({stranded.length})
          </h2>
          <p className="mt-1 mb-3 text-sm text-gray-700">
            These parents registered but never entered a join code, so no
            business can see them. They are stuck until someone gives them one.
          </p>
          <Table>
            <Thead>
              <Th sort={strandedSort} sortKey="full_name">Parent</Th>
              <Th sort={strandedSort} sortKey="email">Email</Th>
              <Th sort={strandedSort} sortKey="joined_at" firstDir="desc">Registered</Th>
            </Thead>
            <Tbody>
              {visibleStranded.map((p) => (
                <Tr key={p.parent_id}>
                  <Td>{p.full_name ?? "—"}</Td>
                  <Td>{p.email ?? "—"}</Td>
                  <Td>{formatSgDate(toSgDate(p.joined_at))}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </div>
  );
}
