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
      className="mb-5 flex items-center gap-2 rounded-card border border-status-warning-border bg-status-warning-bg px-4 py-3 text-body text-status-warning-text hover:border-status-warning-text"
    >
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span className="flex-1">{summary}</span>
      <span className="text-label font-semibold">Invoices →</span>
    </Link>
  );
}
