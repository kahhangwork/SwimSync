import Link from "next/link";
import { Table, Thead, Th, Tbody, Tr, Td } from "@/components/Table";
import { PackageChip } from "@/components/PackageChip";
import type { StudentCoverage } from "@/lib/packageCoverage";
import type { UnassignedRow } from "../types";

type Props = {
  unassigned: UnassignedRow[];
  covMap: Map<string, StudentCoverage>;
  loading: boolean;
};

export function UnassignedMini({ unassigned, covMap, loading }: Props) {
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-headline font-semibold text-ink">
          Unassigned Children
        </h2>
        <Link
          href="/unassigned"
          className="text-body font-medium text-primary hover:underline underline-offset-2"
        >
          View all →
        </Link>
      </div>
      <Table>
        <Thead>
          <Th>Student</Th>
          <Th>Parent</Th>
        </Thead>
        <Tbody>
          {loading ? (
            <Tr>
              <Td className="text-center text-ink-muted py-6" colSpan={2}>
                Loading…
              </Td>
            </Tr>
          ) : unassigned.length === 0 ? (
            <Tr>
              <Td className="text-center text-ink-muted py-6" colSpan={2}>
                No unassigned children
              </Td>
            </Tr>
          ) : (
            unassigned.map((s) => (
              <Tr key={s.id}>
                <Td className="font-medium">{s.full_name}</Td>
                <Td className="text-ink-muted">
                  {s.parent_name}
                  <span className="ml-1.5">
                    <PackageChip coverage={covMap.get(s.id)} />
                  </span>
                </Td>
              </Tr>
            ))
          )}
        </Tbody>
      </Table>
    </div>
  );
}
