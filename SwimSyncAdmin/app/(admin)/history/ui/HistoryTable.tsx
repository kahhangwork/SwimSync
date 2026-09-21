import { Table, Thead, Th, Tbody, Tr, Td } from "@/components/Table";
import { diffSnapshots, formatAuditValue, actorLabel } from "../domain/auditDiff";
import { formatWhen, KIND_LABEL } from "../domain/historyRows";
import type { AuditRow } from "../types";

type Props = { rows: AuditRow[]; loading: boolean; anyFilter: boolean };

export function HistoryTable({ rows, loading, anyFilter }: Props) {
  return (
    <Table>
      <Thead>
        <Th>When</Th>
        <Th>Who</Th>
        <Th>What</Th>
        <Th>Change</Th>
      </Thead>
      <Tbody>
        {loading ? (
          <Tr>
            <Td className="text-center text-gray-400 py-8" colSpan={4}>
              Loading…
            </Td>
          </Tr>
        ) : rows.length === 0 ? (
          <Tr>
            <Td className="text-center text-gray-400 py-8" colSpan={4}>
              {anyFilter
                ? "No changes match these filters."
                : "No changes recorded."}
            </Td>
          </Tr>
        ) : (
          rows.map((r) => {
            const diff = diffSnapshots(r.old_value, r.new_value);
            return (
              <Tr key={r.id}>
                <Td className="whitespace-nowrap text-gray-500 text-xs">
                  {formatWhen(r.created_at)}
                </Td>
                <Td className="text-gray-700">
                  {actorLabel(r.actor_id, r.actor_name)}
                </Td>
                <Td className="text-gray-600">
                  <span className="font-medium text-gray-800">
                    {KIND_LABEL[diff.kind]}
                  </span>{" "}
                  <span className="text-gray-500">{r.entity_type}</span>
                  <div className="mt-0.5 text-xs text-gray-400">{r.action}</div>
                </Td>
                <Td className="text-xs">
                  {diff.changes.length === 0 ? (
                    <span className="text-gray-400">—</span>
                  ) : (
                    <ul className="space-y-0.5">
                      {diff.changes.map((c) => (
                        <li key={c.field}>
                          <span className="font-medium text-gray-700">
                            {c.field}
                          </span>
                          :{" "}
                          {diff.kind === "created" ? (
                            <span className="text-green-700">
                              {formatAuditValue(c.to)}
                            </span>
                          ) : diff.kind === "deleted" ? (
                            <span className="text-red-700 line-through">
                              {formatAuditValue(c.from)}
                            </span>
                          ) : (
                            <>
                              <span className="text-red-700 line-through">
                                {formatAuditValue(c.from)}
                              </span>{" "}
                              <span className="text-gray-400">→</span>{" "}
                              <span className="text-green-700">
                                {formatAuditValue(c.to)}
                              </span>
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </Td>
              </Tr>
            );
          })
        )}
      </Tbody>
    </Table>
  );
}
