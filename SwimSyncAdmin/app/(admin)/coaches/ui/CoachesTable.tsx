// Coaches page — the roster table. Owns its own useTableSort.

import { UserX, UserCheck } from "lucide-react";
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
            <Td className="text-center text-gray-400 py-8" colSpan={5}>
              Loading…
            </Td>
          </Tr>
        ) : visible.length === 0 ? (
          <Tr>
            <Td className="text-center text-gray-400 py-8" colSpan={5}>
              No coaches yet.
            </Td>
          </Tr>
        ) : (
          visible.map((coach) => (
            <Tr key={coach.id}>
              <Td>
                <div className="flex items-center gap-3">
                  <div
                    className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${
                      coach.disabled_at
                        ? "bg-gray-100 text-gray-400"
                        : "bg-sky-100 text-sky-700"
                    }`}
                  >
                    {coach.full_name.charAt(0)}
                  </div>
                  <span
                    className={`font-medium ${
                      coach.disabled_at ? "text-gray-400" : "text-gray-900"
                    }`}
                  >
                    {coach.full_name}
                  </span>
                  {coach.disabled_at && (
                    <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-500">
                      Disabled
                    </span>
                  )}
                </div>
              </Td>
              <Td className="text-gray-500">{coach.email}</Td>
              <Td className="text-gray-500">{coach.phone ?? "—"}</Td>
              <Td>
                {coach.class_titles.length > 0 ? (
                  <div className="flex flex-col gap-0.5">
                    {coach.class_titles.map((t) => (
                      <span key={t} className="text-xs text-gray-600">
                        {t}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="text-xs text-gray-400">No classes</span>
                )}
              </Td>
              <Td>
                <div className="flex items-center gap-1">
                  {coach.disabled_at ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => p.openReactivate(coach)}
                    >
                      <UserCheck className="h-3.5 w-3.5" />
                      Reactivate
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-red-600 hover:bg-red-50"
                      onClick={() => p.openDisable(coach)}
                    >
                      <UserX className="h-3.5 w-3.5" />
                      Disable
                    </Button>
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
