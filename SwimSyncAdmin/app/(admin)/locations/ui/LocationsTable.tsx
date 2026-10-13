import { RowMenu, RowMenuItem } from "@/components/ui/RowMenu";
import { Table, Thead, Th, Tbody, Tr, Td, type TableSort } from "@/components/Table";
import { Button } from "@/components/Button";
import type { Location } from "../types";

type Props = {
  visible: Location[];
  // ⚠ The sort STATE lives in domain/useLocations (RISK 4, §7.249). This
  // component only renders it.
  sort: TableSort<Location>;
  openEdit: (l: Location) => void;
  setRemoving: (l: Location) => void;
};

export function LocationsTable({ visible, sort, openEdit, setRemoving }: Props) {
  return (
    <Table>
      {/* No <Tr> here — Thead emits its own (components/Table.test.tsx). */}
      <Thead>
        <Th sort={sort} sortKey="sort_order">Order</Th>
        <Th sort={sort} sortKey="name">Location</Th>
        <Th sort={sort} sortKey="active_class_count">Classes</Th>
        <Th>Actions</Th>
      </Thead>
      <Tbody>
        {visible.map((l) => (
          <Tr key={l.id}>
            <Td className="text-ink-muted">{l.sort_order}</Td>
            <Td className="font-medium text-ink">
              {l.name}
              {l.address && (
                <div className="mt-0.5 text-label font-normal text-ink-muted">
                  {l.address}
                </div>
              )}
              {l.notes && (
                <div className="mt-0.5 text-label font-normal italic text-ink-muted">
                  {l.notes}
                </div>
              )}
            </Td>
            <Td className="text-ink-muted">
              <span
                title={
                  l.retired_class_count > 0
                    ? `${l.active_class_count} active. ${l.retired_class_count} retired class${
                        l.retired_class_count === 1 ? "" : "es"
                      } still here.`
                    : undefined
                }
              >
                {l.active_class_count}
              </span>
            </Td>
            <Td>
              {/* Edit inline; Remove (it archives the place) in the row menu —
                  DESIGN.md → Tables, UI restyle 5.23. Same handlers. */}
              <div className="flex items-center gap-1.5">
                <Button size="sm" variant="outline" onClick={() => openEdit(l)}>
                  Edit
                </Button>
                <RowMenu>
                  <RowMenuItem destructive onClick={() => setRemoving(l)}>
                    Remove
                  </RowMenuItem>
                </RowMenu>
              </div>
            </Td>
          </Tr>
        ))}
      </Tbody>
    </Table>
  );
}
