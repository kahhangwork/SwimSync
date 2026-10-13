// Parents page — the families table. Owns its own useTableSort.

import { Button } from "@/components/Button";
import { Tag } from "@/components/ui/Tag";
import { RowMenu, RowMenuItem } from "@/components/ui/RowMenu";
import { Table, Thead, Th, Tbody, Tr, Td, useTableSort } from "@/components/Table";
import { StatusBadge } from "@/components/StatusBadge";
import { PackageChip } from "@/components/PackageChip";
import { familyLabel } from "@/lib/packageCoverage";
import type { FamilyRow } from "../types";
import { activeChildCount } from "../domain/parentsRows";

type Props = {
  filtered: FamilyRow[];
  loading: boolean;
  pkgByParent: Map<string, number>;
  openModal: (f: FamilyRow) => void;
};

export function ParentsTable(p: Props) {
  const sort = useTableSort<FamilyRow>({
    key: "full_name",
    accessors: {
      // Sort by the count, not by "1 of 1 active" — as text, 10 sorts before 2.
      children: (f) => activeChildCount(f),
      // Active first when ascending: `true` sorts after `false`, and the rows
      // an admin acts on are the active ones.
      is_active: (f) => !f.is_active,
    },
  });

  const visible = sort.apply(p.filtered);

  return (
    <Table>
      <Thead>
        <Th sort={sort} sortKey="full_name">Parent</Th>
        <Th sort={sort} sortKey="email">Contact</Th>
        <Th sort={sort} sortKey="is_active">Status</Th>
        <Th>Payment</Th>
        <Th sort={sort} sortKey="children">Children here</Th>
        <Th>Actions</Th>
      </Thead>
      <Tbody>
        {p.loading ? (
          <Tr>
            <Td className="text-center text-ink-muted py-8" colSpan={6}>
              Loading…
            </Td>
          </Tr>
        ) : visible.length === 0 ? (
          <Tr>
            <Td className="text-center text-ink-muted py-8" colSpan={6}>
              No families found.
            </Td>
          </Tr>
        ) : (
          visible.map((f) => (
            <Tr key={`${f.parent_id}:${f.tenant_id}`}>
              <Td className="font-medium text-ink">{f.full_name}</Td>
              <Td className="text-ink-muted">
                <div>{f.email}</div>
                {f.phone && <div className="text-label">{f.phone}</div>}
              </Td>
              <Td>
                <StatusBadge status={f.is_active ? "Active" : "Inactive"} />
              </Td>
              <Td>
                <PackageChip
                  coverage={familyLabel(p.pkgByParent, f.parent_id)}
                  title={
                    p.pkgByParent.has(f.parent_id)
                      ? "The family's prepaid lessons remaining at your business, counting attended-but-uninvoiced lessons"
                      : "No prepaid package — this family is billed per lesson by invoice"
                  }
                />
              </Td>
              <Td className="text-ink-muted">
                {f.children.length === 0 ? (
                  "—"
                ) : (
                  <span>
                    {activeChildCount(f)} of {f.children.length} active
                    {/* An active family with no active children is the state
                        the prompted cascade can legitimately create. Surfaced
                        rather than prevented — a trigger enforcing it would
                        undo join-code reactivation. */}
                    {f.is_active && activeChildCount(f) === 0 && (
                      <Tag tone="warning" className="ml-2">
                        none active
                      </Tag>
                    )}
                  </span>
                )}
              </Td>
              <Td>
                {/* Reactivate is the inactive family's state action, inline; Set
                    inactive is destructive, so it sits in the row menu (DESIGN.md
                    → Tables; UI restyle 5.16). Both open the same confirm modal. */}
                {f.is_active ? (
                  <RowMenu>
                    <RowMenuItem destructive onClick={() => p.openModal(f)}>
                      Set inactive
                    </RowMenuItem>
                  </RowMenu>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => p.openModal(f)}>
                    Reactivate
                  </Button>
                )}
              </Td>
            </Tr>
          ))
        )}
      </Tbody>
    </Table>
  );
}
