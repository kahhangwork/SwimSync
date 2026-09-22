"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";

/** One line, only when a billing month needs attention. The detail — which
 *  lessons, which children, every run — lives on the Invoices page's Billing
 *  months card; this exists so an open month is seen without going there. */
export function BillingAlert({ summary }: { summary: string | null }) {
  if (!summary) return null;
  return (
    <Link
      href="/invoices"
      data-testid="billing-alert"
      className="mb-5 flex items-center gap-2 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 hover:bg-amber-100"
    >
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span className="flex-1">{summary}</span>
      <span className="text-xs font-semibold">Invoices →</span>
    </Link>
  );
}
