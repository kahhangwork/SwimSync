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
            <Td className="text-gray-500">{l.sort_order}</Td>
            <Td className="font-medium text-gray-900">
              {l.name}
              {l.address && (
                <div className="mt-0.5 text-xs font-normal text-gray-500">
                  {l.address}
                </div>
              )}
              {l.notes && (
                <div className="mt-0.5 text-xs font-normal italic text-gray-500">
                  {l.notes}
                </div>
              )}
            </Td>
            <Td className="text-gray-500">
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
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => openEdit(l)}>
                  Edit
                </Button>
                <Button variant="outline" onClick={() => setRemoving(l)}>
                  Remove
                </Button>
              </div>
            </Td>
          </Tr>
        ))}
      </Tbody>
    </Table>
  );
}
