// Unassigned page — the children table. Owns its own useTableSort.

import { UserCheck } from "lucide-react";
import { Table, Thead, Th, Tbody, Tr, Td, useTableSort } from "@/components/Table";
import { Button } from "@/components/Button";
import { PackageChip } from "@/components/PackageChip";
import type { StudentCoverage } from "@/lib/packageCoverage";
import type { Student } from "../types";

type Props = {
  filtered: Student[];
  loading: boolean;
  covMap: Map<string, StudentCoverage>;
  openAssign: (student: Student) => void;
};

export function UnassignedTable(p: Props) {
  const sort = useTableSort<Student>({ key: "full_name" });
  const visible = sort.apply(p.filtered);

  return (
    <Table>
      <Thead>
        <Th sort={sort} sortKey="full_name">Student</Th>
        <Th sort={sort} sortKey="parent_name">Parent</Th>
        <Th>Action</Th>
      </Thead>
      <Tbody>
        {p.loading ? (
          <Tr>
            <Td className="text-center text-gray-400 py-8" colSpan={3}>
              Loading…
            </Td>
          </Tr>
        ) : visible.length === 0 ? (
          <Tr>
            <Td className="text-center text-gray-400 py-8" colSpan={3}>
              No unassigned children found.
            </Td>
          </Tr>
        ) : (
          visible.map((student) => (
            <Tr key={student.id}>
              <Td className="font-medium text-gray-900">{student.full_name}</Td>
              <Td className="text-gray-500">
                {student.parent_name}
                <span className="ml-1.5">
                  <PackageChip coverage={p.covMap.get(student.id)} />
                </span>
              </Td>
              <Td>
                <Button size="sm" onClick={() => p.openAssign(student)}>
                  <UserCheck className="h-3.5 w-3.5" />
                  Assign
                </Button>
              </Td>
            </Tr>
          ))
        )}
      </Tbody>
    </Table>
  );
}
