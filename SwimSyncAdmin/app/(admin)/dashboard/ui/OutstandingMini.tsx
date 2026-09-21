import Link from "next/link";
import { StatusBadge } from "@/components/StatusBadge";
import { Table, Thead, Th, Tbody, Tr, Td } from "@/components/Table";
import { formatBillingMonth } from "../domain/dashboardRows";
import type { InvoiceRow } from "../types";

type Props = { invoices: InvoiceRow[]; loading: boolean };

export function OutstandingMini({ invoices, loading }: Props) {
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-bold text-gray-900">
          Outstanding Invoices
        </h2>
        <Link
          href="/invoices"
          className="text-sm text-sky-500 hover:text-sky-600 font-medium"
        >
          View all →
        </Link>
      </div>
      <Table>
        <Thead>
          <Th>Parent</Th>
          <Th>Month</Th>
          <Th>Net</Th>
          <Th>Status</Th>
        </Thead>
        <Tbody>
          {loading ? (
            <Tr>
              <Td className="text-center text-gray-400 py-6" colSpan={4}>
                Loading…
              </Td>
            </Tr>
          ) : invoices.length === 0 ? (
            <Tr>
              <Td className="text-center text-gray-400 py-6" colSpan={4}>
                No outstanding invoices
              </Td>
            </Tr>
          ) : (
            invoices.map((inv) => (
              <Tr key={inv.id}>
                <Td className="font-medium">{inv.parent_name}</Td>
                <Td className="text-gray-500">
                  {formatBillingMonth(inv.billing_month)}
                </Td>
                <Td className="font-semibold text-red-600">
                  S${inv.net_amount.toFixed(2)}
                </Td>
                <Td>
                  <StatusBadge status="Outstanding" />
                </Td>
              </Tr>
            ))
          )}
        </Tbody>
      </Table>
    </div>
  );
}
