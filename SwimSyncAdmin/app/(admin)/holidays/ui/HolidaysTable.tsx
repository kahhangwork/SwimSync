import { Check, Trash2 } from "lucide-react";
import { Table, Thead, Th, Tbody, Tr, Td, useTableSort } from "@/components/Table";
import { Button } from "@/components/Button";
import type { Holiday } from "../types";

type Props = {
  holidays: Holiday[];
  voidCounts: Record<string, number>;
  loading: boolean;
  busy: boolean;
  onVoid: (h: Holiday) => void;
  onUnvoid: (h: Holiday) => void;
  onRemove: (h: Holiday) => void;
};

export function HolidaysTable({ holidays, voidCounts, loading, busy, onVoid, onUnvoid, onRemove }: Props) {
  const sort = useTableSort<Holiday>({ key: "holiday_date" });
  const visible = sort.apply(holidays);

  return (
    <Table>
      <Thead>
        <Th sort={sort} sortKey="holiday_date">Date</Th>
        <Th sort={sort} sortKey="name">Holiday</Th>
        <Th>Lessons</Th>
        <Th>&nbsp;</Th>
      </Thead>
      <Tbody>
        {loading ? (
          <Tr>
            <Td className="py-8 text-center text-ink-muted" colSpan={4}>
              Loading…
            </Td>
          </Tr>
        ) : visible.length === 0 ? (
          <Tr>
            <Td className="py-8 text-center text-ink-muted" colSpan={4}>
              No holidays yet. Import a CSV or add one.
            </Td>
          </Tr>
        ) : (
          visible.map((h) => {
            const voided = voidCounts[h.holiday_date] ?? 0;
            return (
              <Tr key={h.id}>
                <Td className="font-medium text-ink">{h.holiday_date}</Td>
                <Td className="text-ink-secondary">{h.name}</Td>
                <Td>
                  {voided > 0 ? (
                    <span className="inline-flex items-center gap-1 text-label font-medium text-status-success-text">
                      <Check className="h-3.5 w-3.5" />
                      Voided · {voided} lesson{voided === 1 ? "" : "s"}
                    </span>
                  ) : (
                    <span className="text-label text-ink-muted">Not voided</span>
                  )}
                </Td>
                <Td>
                  <div className="flex justify-end gap-1">
                    {voided > 0 ? (
                      <Button size="sm" variant="ghost" onClick={() => onUnvoid(h)} disabled={busy}>
                        Restore
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => onVoid(h)} disabled={busy}>
                        Void lessons
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-status-danger-text hover:bg-status-danger-bg"
                      onClick={() => onRemove(h)}
                      disabled={busy}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Remove
                    </Button>
                  </div>
                </Td>
              </Tr>
            );
          })
        )}
      </Tbody>
    </Table>
  );
}
