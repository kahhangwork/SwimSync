// The parent Invoice Detail screen's load and its "I've paid" claim
// (docs/refactor/BATCH_FGH_PLAN.md, App L-G). Moved VERBATIM from
// app/(parent)/billing/invoice/[id].tsx — builders are dao calls, the mapping is
// domain/invoiceDetailFormat, the funding tags domain/invoiceFunding (moved from
// lib/, this screen was its one importer).
//
// ⚠ plan R8: `setClaiming(false)` stays BEFORE the error check, no try/finally;
// the load effect keeps its deps ([id]). No verify-* driver presses THIS screen's
// "I've paid" — L4-G hand-checks it (plan ⚠ R5).
import { useState, useEffect } from "react";
import { useLocalSearchParams } from "expo-router";
import { confirmAction } from "@/lib/confirm";
import { useAppStore } from "@/store/useAppStore";
import {
  fetchInvoiceDetail,
  fetchAppliedCreditNotes,
  fetchPackageApplications,
  fetchSessionCoach,
} from "../dao/invoiceDetail.repo";
import { claimInvoicePaid } from "../dao/invoiceDetail.rpc";
import type { InvoiceDetail } from "../types";
import { fundingByItem } from "./invoiceFunding";
import { invoiceDetailOf } from "./invoiceDetailFormat";

export function useInvoiceDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const showToast = useAppStore((s) => s.showToast);

  function claimPaid() {
    if (!invoice || claiming) return;
    confirmAction(
      "Mark as paid?",
      "This tells your coach you've made the PayNow transfer. They'll confirm it against their bank account.",
      async () => {
        setClaiming(true);
        const { data, error } = await claimInvoicePaid(invoice.id);
        setClaiming(false);
        if (error) {
          showToast("Couldn't record that — please try again.", "error");
          return;
        }
        setInvoice((prev) =>
          prev ? { ...prev, paid_claimed_at: data as string } : prev
        );
        showToast("Noted — your coach will confirm the payment.", "success");
      },
      "I've paid"
    );
  }

  useEffect(() => {
    async function load() {
      setLoading(true);

      const { data: inv } = await fetchInvoiceDetail(id);

      if (!inv) {
        setLoading(false);
        return;
      }

      // Fetch credit notes applied to this invoice
      const { data: cns } = await fetchAppliedCreditNotes(id);

      // Which lines the package funded — the "Package Applied" total,
      // itemised. RLS scopes the ledger to the parent's own packages; a
      // failed read just means no tags (fundingByItem is null-tolerant).
      const itemIds = (inv.invoice_items ?? []).map((it: any) => it.id);
      const { data: apps } = itemIds.length
        ? await fetchPackageApplications(itemIds)
        : { data: [] };
      const funded = fundingByItem(apps ?? []);

      // Get coach id via first invoice item's lesson session.
      // NB: look up by lesson_session_id (not the invoice_item id).
      let coachId: string | null = null;
      if (inv.invoice_items?.length > 0) {
        const firstItem = inv.invoice_items[0];
        const { data: ls } = await fetchSessionCoach(firstItem.lesson_session_id);
        coachId = (ls as any)?.classes?.coach_id ?? null;
      }

      setInvoice(invoiceDetailOf(inv, cns, funded, coachId));

      setLoading(false);
    }

    load();
  }, [id]);

  return { invoice, loading, claiming, claimPaid };
}
