// Coaches page — the roster table. Owns its own useTableSort.

import { Tag } from "@/components/ui/Tag";
import { RowMenu, RowMenuItem } from "@/components/ui/RowMenu";
import { UserCheck } from "lucide-react";
import { Table, Thead, Th, Tbody, Tr, Td, useTableSort } from "@/components/Table";
import { Button } from "@/components/Button";
import type { CoachRow } from "../types";

type Props = {
  coaches: CoachRow[];
  loading: boolean;
  openDisable: (c: CoachRow) => void;
  openReactivate: (c: CoachRow) => void;
};

export function CoachesTable(p: Props) {
  const sort = useTableSort<CoachRow>({
    key: "full_name",
    accessors: {
      classes: (c) => c.class_titles.length,
    },
  });
  const visible = sort.apply(p.coaches);

  return (
    <Table>
      <Thead>
        <Th sort={sort} sortKey="full_name">Name</Th>
        <Th sort={sort} sortKey="email">Email</Th>
        <Th sort={sort} sortKey="phone">Phone</Th>
        <Th sort={sort} sortKey="classes">Classes</Th>
        <Th>Actions</Th>
      </Thead>
      <Tbody>
        {p.loading ? (
          <Tr>
            <Td className="text-center text-ink-muted py-8" colSpan={5}>
              Loading…
            </Td>
          </Tr>
        ) : visible.length === 0 ? (
          <Tr>
            <Td className="text-center text-ink-muted py-8" colSpan={5}>
              No coaches yet.
            </Td>
          </Tr>
        ) : (
          visible.map((coach) => (
            <Tr key={coach.id}>
              <Td>
                <div className="flex items-center gap-3">
                  <div
                    className={`flex h-8 w-8 items-center justify-center rounded-full text-body font-semibold ${
                      coach.disabled_at
                        ? "bg-status-neutral-bg text-ink-muted"
                        : "bg-selected text-ink-secondary"
                    }`}
                  >
                    {coach.full_name.charAt(0)}
                  </div>
                  <span
                    className={`font-medium ${
                      coach.disabled_at ? "text-ink-muted" : "text-ink"
                    }`}
                  >
                    {coach.full_name}
                  </span>
                  {coach.disabled_at && (
                    <Tag tone="neutral">Disabled</Tag>
                  )}
                </div>
              </Td>
              <Td className="text-ink-muted">{coach.email}</Td>
              <Td className="text-ink-muted">{coach.phone ?? "—"}</Td>
              <Td>
                {coach.class_titles.length > 0 ? (
                  <div className="flex flex-col gap-0.5">
                    {coach.class_titles.map((t) => (
                      <span key={t} className="text-label text-ink-secondary">
                        {t}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="text-label text-ink-muted">No classes</span>
                )}
              </Td>
              <Td>
                <div className="flex items-center gap-1">
                  {coach.disabled_at ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => p.openReactivate(coach)}
                    >
                      <UserCheck className="h-3.5 w-3.5" />
                      Reactivate
                    </Button>
                  ) : (
                    // Disable is destructive (it hands the classes over and
                    // bans the login) — the row menu, never an inline red
                    // button (DESIGN.md → Tables; UI restyle 5.17).
                    <RowMenu>
                      <RowMenuItem destructive onClick={() => p.openDisable(coach)}>
                        Disable
                      </RowMenuItem>
                    </RowMenu>
                  )}
                </div>
              </Td>
            </Tr>
          ))
        )}
      </Tbody>
    </Table>
  );
}
